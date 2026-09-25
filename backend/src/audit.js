import mongoose from "mongoose";

/**
 * Admin audit trail.
 *
 * Once a shop has two admins (see the invite flow), "who cancelled order #1042"
 * and "who dropped the dress to UGX 5,000" stop being answerable from memory.
 * Every order-status change, price edit and team change writes one row here
 * with the acting admin and the before/after values.
 *
 * Rows are append-only: nothing in the API updates or deletes them.
 */
export const AUDIT_ACTIONS = [
  "order.status",
  "product.create",
  "product.price",
  "admin.invite",
  "admin.invite_revoke",
  "admin.join",
  "admin.demote",
  "auth.password_reset",
];

const auditSchema = new mongoose.Schema(
  {
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Denormalised so the trail still reads correctly after an account changes.
    actor_email: { type: String, default: null },
    target_type: { type: String, default: null },
    target_id: { type: String, default: null },
    summary: { type: String, required: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    toJSON: {
      versionKey: false,
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        ret.actor_id = ret.actor ? ret.actor.toString() : null;
        delete ret._id;
        delete ret.actor;
        return ret;
      },
    },
  }
);
auditSchema.index({ created_at: -1 });
auditSchema.index({ action: 1, created_at: -1 });
auditSchema.index({ target_type: 1, target_id: 1, created_at: -1 });

export const AuditLog = mongoose.model("AuditLog", auditSchema);

/**
 * Record an audit entry. Awaited by callers so the row exists by the time the
 * response is sent, but a failure is logged rather than thrown: the change it
 * describes has already been committed, and failing the request would only
 * invite the admin to repeat it.
 *
 * @param actor  req.user ({ id, email }) or null for system actions
 */
export async function audit(actor, action, { target_type = null, target_id = null, summary, before = null, after = null }) {
  try {
    await AuditLog.create({
      action,
      actor: actor?.id ?? null,
      actor_email: actor?.email ?? null,
      target_type,
      target_id: target_id == null ? null : String(target_id),
      summary,
      before,
      after,
    });
  } catch (err) {
    console.error(`Failed to write audit entry (${action}):`, err.message);
  }
}

/**
 * The price fields of a product worth auditing, in a shape that compares
 * cleanly with JSON.stringify: base price, compare-at, and any per-variant
 * overrides keyed by size/colour.
 */
export function priceSnapshot(p) {
  const overrides = {};
  for (const v of p.variants || []) {
    if (v.price_cents != null) overrides[`${v.size} / ${v.color}`] = v.price_cents;
  }
  return {
    price_cents: p.price_cents,
    compare_at_cents: p.compare_at_cents ?? null,
    // Sorted so reordering the variant rows alone never reads as a price edit.
    variant_prices: Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export const samePrices = (a, b) => JSON.stringify(a) === JSON.stringify(b);
