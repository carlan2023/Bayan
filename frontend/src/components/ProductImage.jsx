import { useState } from "react";
import { cssVar, isHex, shade } from "../theme";

/**
 * Renders the product's real photo (product.image) when present, falling back
 * to a stylised, generated visual derived from the swatch colour if there is no
 * image or the image fails to load. That fallback keeps the grid clean — no
 * broken-image icons — even when a seeded URL is unreachable.
 */
const ICONS = {
  Women: "M50 22c-6 0-10 5-10 11 0 4 2 7 4 9L30 78h40L56 42c2-2 4-5 4-9 0-6-4-11-10-11z",
  Men: "M32 30l12-8h12l12 8 6 28h-10l-2 22H38l-2-22H26z",
  Kids: "M50 20a9 9 0 100 18 9 9 0 000-18zM34 44l16-4 16 4 4 20h-8l-2 16H40l-2-16h-8z",
  // Perfume bottle — the Accessories department (jewellery & fragrance).
  Accessories: "M44 20h12v8h-12zM40 30h20a6 6 0 016 6v36a6 6 0 01-6 6H40a6 6 0 01-6-6V36a6 6 0 016-6zM42 44h16v10H42z",
};

export default function ProductImage({ product, ratio = 1.22 }) {
  const [failed, setFailed] = useState(false);
  // The gradient is product data (its swatch); only the fallback comes from the
  // theme, read as a concrete colour because shade() needs real channels.
  const base = isHex(product.swatch) ? product.swatch : cssVar("--pine", "#2e4b3f");
  const light = shade(base, 46);
  const dark = shade(base, -34);
  const icon = ICONS[product.category] || ICONS.Accessories;
  const gid = `g-${product.id || product.slug}`;

  if (product.image && !failed) {
    return (
      <img
        src={product.image}
        alt={product.name}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", aspectRatio: `1 / ${ratio}` }}
      />
    );
  }

  return (
    <svg
      viewBox={`0 0 100 ${Math.round(100 * ratio)}`}
      role="img"
      aria-label={product.name}
      style={{ width: "100%", height: "auto" }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={light} />
          <stop offset="100%" stopColor={dark} />
        </linearGradient>
      </defs>
      <rect width="100" height={100 * ratio} fill={`url(#${gid})`} />
      <circle cx="82" cy="20" r="30" style={{ fill: "var(--surface)" }} opacity="0.08" />
      <circle cx="12" cy={100 * ratio - 12} r="24" style={{ fill: "var(--ink)" }} opacity="0.08" />
      <g transform={`translate(0 ${(100 * ratio - 100) / 2})`}>
        <path d={icon} style={{ fill: "var(--surface)" }} opacity="0.85" />
      </g>
      <text
        x="50"
        y={100 * ratio - 8}
        textAnchor="middle"
        fontSize="6"
        letterSpacing="2"
        opacity="0.7"
        style={{ fill: "var(--surface)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}
      >
        BAYAN
      </text>
    </svg>
  );
}
