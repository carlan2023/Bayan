import { fmtPrice } from "../api";

/**
 * Tells the shopper what changed when the cart was re-priced against the
 * catalogue. Prices are re-read from the DB at checkout, so a silent change
 * here would mean paying a different total than the one on screen.
 */
const describe = (c) => {
  switch (c.kind) {
    case "price":
      return `${c.name} is now ${fmtPrice(c.to)} (was ${fmtPrice(c.from)}).`;
    case "qty":
      return `${c.name} — only ${c.to} left, so we reduced the quantity.`;
    case "soldout":
      return `${c.name} has sold out and was removed from your bag.`;
    case "removed":
      return `${c.name} is no longer available and was removed from your bag.`;
    default:
      return null;
  }
};

export default function CartNotice({ changes }) {
  if (!changes || changes.length === 0) return null;

  return (
    <div className="alert alert-error" role="status" style={{ marginBottom: 16 }}>
      <strong>Your bag was updated</strong>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {changes.map((c, i) => (
          <li key={i}>{describe(c)}</li>
        ))}
      </ul>
    </div>
  );
}
