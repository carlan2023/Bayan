import jwt from "jsonwebtoken";

export const JWT_SECRET = process.env.JWT_SECRET || "bayan-dev-secret-change-in-production";

export function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

/** Attaches req.user if a valid Bearer token is present; never rejects. */
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      /* invalid token -> treated as guest */
    }
  }
  next();
}

/** Rejects with 401 when no valid token. */
export function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    next();
  });
}
