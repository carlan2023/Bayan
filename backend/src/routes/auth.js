import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { User, notify } from "../db.js";
import { signToken, requireAuth, issuedBeforePasswordChange } from "../auth.js";
import { issueToken, findLiveToken, consumeToken, RESET_TTL_MS } from "../auth-tokens.js";
import { sendEmail, appUrl, emailEnabled, escapeHtml } from "../mailer.js";
import { audit } from "../audit.js";

const router = Router();

/**
 * Credential endpoints were unlimited, which is both a brute-force path and a
 * CPU-exhaustion one: every attempt runs a bcrypt comparison, and this process
 * is single-threaded. Limits are per IP.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count toward the limit
  message: { error: "Too many sign-in attempts. Please try again in a few minutes." },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many accounts created from this device. Please try again later." },
});

/**
 * Forgot / reset / invite acceptance. Tighter than login: each forgot request
 * can send an email, so an open endpoint is a way to spam any inbox from our
 * domain (and burn the sending reputation the shop's real mail depends on).
 */
const passwordLimiter = (limit) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please wait a few minutes and try again." },
  });
// Separate budgets, so opening an invite page doesn't eat into the attempts
// for accepting it. Each is a guess at "more than a person would ever need".
const forgotLimiter = passwordLimiter(5);
const resetLimiter = passwordLimiter(10);
const inviteLimiter = passwordLimiter(20);

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD = 6;

const publicUser = (u) => ({
  id: u._id.toString(),
  name: u.name,
  email: u.email,
  is_admin: !!u.is_admin,
});

router.post("/register", registerLimiter, async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: "Name, email and password are required" });
    }
    if (String(password).length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: "An account with this email already exists" });

    const u = await User.create({
      name: name.trim(),
      email: email.toLowerCase(),
      // Async: hashSync blocks the event loop for every other request.
      password_hash: await bcrypt.hash(String(password), BCRYPT_ROUNDS),
    });
    notify("customer", `New customer: ${u.name}`, u.email, "/admin/customers");

    const user = publicUser(u);
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    const u = await User.findOne({ email: String(email).toLowerCase() });
    if (!u || !(await bcrypt.compare(String(password), u.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const user = publicUser(u);
    res.json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const u = await User.findById(req.user.id);
    if (!u) return res.status(404).json({ error: "User not found" });
    // A session issued before the last password reset is revoked. The client
    // calls /me on load and signs out on 401, so this ends a stolen session on
    // its next page view.
    if (issuedBeforePasswordChange(req.user, u)) {
      return res.status(401).json({ error: "Your password was changed. Please sign in again." });
    }
    res.json({ user: { ...publicUser(u), created_at: u.created_at } });
  } catch (err) {
    next(err);
  }
});

/* ================= Password reset ================= */

const GENERIC_FORGOT =
  "If an account exists for that email, we've sent a link to reset its password. It expires in 1 hour.";

router.post("/forgot", forgotLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!emailEnabled()) {
      return res.status(503).json({ error: "Password reset by email is not available. Please contact the shop." });
    }

    // Same answer whether or not the account exists, and email failures are
    // logged rather than surfaced — otherwise this endpoint enumerates customers.
    const u = await User.findOne({ email });
    if (u) {
      const base = appUrl();
      if (!base) {
        console.error("Password reset requested but APP_URL is not set — cannot build a safe link.");
      } else {
        const { raw } = await issueToken("password_reset", { email, user: u._id, ttlMs: RESET_TTL_MS });
        const link = `${base}/reset-password?token=${encodeURIComponent(raw)}`;
        await sendEmail({
          to: email,
          subject: "Reset your password",
          text:
            `Hi ${u.name},\n\n` +
            "Someone (hopefully you) asked to reset the password for this account.\n\n" +
            `Choose a new password here. The link works once and expires in 1 hour:\n${link}\n\n` +
            "If you didn't ask for this, ignore this email; your password stays the same.",
          html:
            `<p>Hi ${escapeHtml(u.name)},</p>` +
            "<p>Someone (hopefully you) asked to reset the password for this account.</p>" +
            `<p><a href="${escapeHtml(link)}">Choose a new password</a>. The link works once and expires in 1 hour.</p>` +
            "<p>If you didn't ask for this, ignore this email; your password stays the same.</p>",
        }).catch((err) => console.error("Failed to send password reset email:", err.message));
      }
    }
    res.json({ ok: true, message: GENERIC_FORGOT });
  } catch (err) {
    next(err);
  }
});

router.post("/reset", resetLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    if (!password || String(password).length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }
    // Hash before claiming: a slow bcrypt after the claim would widen the
    // window in which the token is spent but the password not yet changed.
    const password_hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    const claimed = await consumeToken("password_reset", token);
    if (!claimed) {
      return res
        .status(400)
        .json({ error: "This reset link is invalid, already used or expired. Please request a new one." });
    }
    const u = await User.findByIdAndUpdate(
      claimed.user,
      { $set: { password_hash, password_changed_at: new Date() } },
      { new: true }
    );
    if (!u) return res.status(400).json({ error: "This account no longer exists." });

    await audit({ id: u._id, email: u.email }, "auth.password_reset", {
      target_type: "user",
      target_id: u._id,
      summary: `${u.email} reset their password`,
    });
    // Sign them straight in with a token issued after the change.
    const user = publicUser(u);
    res.json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

/* ================= Admin invites (acceptance side) ================= */

/** What the accept page needs to render: who the invite is for. */
router.get("/invite", inviteLimiter, async (req, res, next) => {
  try {
    const invite = await findLiveToken("admin_invite", req.query.token);
    if (!invite) return res.status(404).json({ error: "This invite is invalid, already used or expired." });
    const existing = await User.exists({ email: invite.email });
    res.json({
      email: invite.email,
      name: invite.name,
      expires_at: invite.expires_at,
      existing_account: Boolean(existing),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Accept an invite. A new address gets a fresh admin account. An address that
 * already has an account must prove it with that account's password — the
 * invite must not become a way for one admin to set a customer's password and
 * take the account over.
 */
router.post("/accept-invite", resetLimiter, async (req, res, next) => {
  try {
    const { token, name, password } = req.body || {};
    if (!password || String(password).length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }
    const invite = await findLiveToken("admin_invite", token);
    if (!invite) return res.status(400).json({ error: "This invite is invalid, already used or expired." });

    let u = await User.findOne({ email: invite.email });
    if (u) {
      if (!(await bcrypt.compare(String(password), u.password_hash))) {
        return res.status(401).json({ error: "That isn't the password for this account." });
      }
    } else if (!String(name || invite.name || "").trim()) {
      return res.status(400).json({ error: "Your name is required" });
    }
    const password_hash = u ? null : await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    // Only now spend the token — a mistyped password above must not burn it.
    const claimed = await consumeToken("admin_invite", token);
    if (!claimed) return res.status(400).json({ error: "This invite is invalid, already used or expired." });

    if (u) {
      u.is_admin = true;
      await u.save();
    } else {
      u = await User.create({
        name: String(name || invite.name).trim(),
        email: invite.email,
        password_hash,
        is_admin: true,
      });
    }
    // Record who accepted, so the Team page can show it.
    claimed.user = u._id;
    await claimed.save();

    await audit({ id: u._id, email: u.email }, "admin.join", {
      target_type: "user",
      target_id: u._id,
      summary: `${u.email} accepted an admin invite`,
      after: { invited_by: claimed.created_by ? claimed.created_by.toString() : null },
    });
    notify("customer", `New admin: ${u.name}`, u.email, "/admin/team");

    const user = publicUser(u);
    res.json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

export default router;
