import jwt from "jsonwebtoken";

// The development fallback is published in this repo, so anyone could forge a
// token with it. Refuse to boot in production rather than run on a known secret.
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  console.error(
    "FATAL: JWT_SECRET is not set. Set it to a long random string on the service before deploying."
  );
  process.exit(1);
}

export const JWT_SECRET = process.env.JWT_SECRET || "bayan-dev-secret-change-in-production";

export function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

/**
 * True when a JWT was minted before the account's last password reset.
 * Checked wherever the user row is already loaded (/auth/me, the admin gate),
 * so a reset revokes older sessions without a token blocklist. `iat` is whole
 * seconds, so allow one second of slack for a token minted in the same tick as
 * the change (the reset endpoint signs one immediately).
 */
export const issuedBeforePasswordChange = (claims, user) =>
  Boolean(
    user?.password_changed_at &&
      claims?.iat &&
      claims.iat * 1000 < new Date(user.password_changed_at).getTime() - 1000
  );

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
