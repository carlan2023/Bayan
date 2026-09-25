import mongoose from "mongoose";
import crypto from "crypto";

/**
 * Single-use, expiring tokens for password reset and admin invites.
 *
 * Only a SHA-256 of the token is stored. The raw value exists in exactly one
 * place — the link we email (or hand to the inviting admin) — so a read of this
 * collection, a backup or a log line cannot be replayed as a reset link.
 * SHA-256 rather than bcrypt is deliberate: the token is 256 random bits, so
 * there is nothing to brute-force and a slow hash would only cost CPU.
 */
export const TOKEN_KINDS = ["password_reset", "admin_invite"];

export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const authTokenSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: TOKEN_KINDS, required: true },
    token_hash: { type: String, required: true, unique: true },
    // Reset: the account being recovered. Invite: null until accepted.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: null },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    expires_at: { type: Date, required: true },
    used_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    toJSON: {
      versionKey: false,
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.token_hash;
        return ret;
      },
    },
  }
);
// Mongo's TTL monitor deletes rows a day after they expire, so the collection
// can't grow without bound. The day's grace keeps "this link has expired"
// distinguishable from "this link never existed" for a while — both are
// reported the same way to the user, but the row helps an operator debug.
authTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 24 * 60 * 60 });
authTokenSchema.index({ kind: 1, email: 1 });

export const AuthToken = mongoose.model("AuthToken", authTokenSchema);

export const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");

/** 32 random bytes, URL-safe — goes straight into a link. */
export const newRawToken = () => crypto.randomBytes(32).toString("base64url");

/**
 * Issue a token. Any earlier unused token of the same kind for the same email
 * is deleted first, so only the most recent link ever works.
 * Returns `{ raw, doc }`; the caller puts `raw` in the link and forgets it.
 */
export async function issueToken(kind, { email, user = null, name = null, created_by = null, ttlMs }) {
  await AuthToken.deleteMany({ kind, email: email.toLowerCase(), used_at: null });
  const raw = newRawToken();
  const doc = await AuthToken.create({
    kind,
    token_hash: hashToken(raw),
    email,
    user,
    name,
    created_by,
    expires_at: new Date(Date.now() + ttlMs),
  });
  return { raw, doc };
}

/** Look up a live (unused, unexpired) token without consuming it. */
export function findLiveToken(kind, raw) {
  if (!raw || typeof raw !== "string") return null;
  return AuthToken.findOne({
    kind,
    token_hash: hashToken(raw),
    used_at: null,
    expires_at: { $gt: new Date() },
  });
}

/**
 * Atomically claim a live token. Two concurrent requests with the same link
 * race on this single conditional update; exactly one gets the document back,
 * so a token can never be spent twice.
 */
export function consumeToken(kind, raw) {
  if (!raw || typeof raw !== "string") return null;
  return AuthToken.findOneAndUpdate(
    { kind, token_hash: hashToken(raw), used_at: null, expires_at: { $gt: new Date() } },
    { $set: { used_at: new Date() } },
    { new: true }
  );
}
