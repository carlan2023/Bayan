import { Router } from "express";
import bcrypt from "bcryptjs";
import { User } from "../db.js";
import { signToken, requireAuth } from "../auth.js";

const router = Router();

const publicUser = (u) => ({
  id: u._id.toString(),
  name: u.name,
  email: u.email,
  is_admin: !!u.is_admin,
});

router.post("/register", async (req, res, next) => {
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
      password_hash: bcrypt.hashSync(password, 10),
    });
    const user = publicUser(u);
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    const u = await User.findOne({ email: email.toLowerCase() });
    if (!u || !bcrypt.compareSync(password, u.password_hash)) {
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
