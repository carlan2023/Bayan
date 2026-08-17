import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { User, notify } from "../db.js";
import { signToken, requireAuth } from "../auth.js";

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

const BCRYPT_ROUNDS = 10;

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
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: "An account with this email already exists" });

    const u = await User.create({
      name: name.trim(),
      email: email.toLowerCase(),
      // Async: hashSync blocks the event loop for every other request.
      password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
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
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
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
    res.json({ user: { ...publicUser(u), created_at: u.created_at } });
  } catch (err) {
    next(err);
  }
});

export default router;
