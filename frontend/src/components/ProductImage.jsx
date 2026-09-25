import { useState } from "react";
import { cssVar, isHex, shade } from "../theme";
import { useConfig } from "../store";
import { departmentIcon } from "./departments";

/**
 * Renders the product's real photo (product.image) when present, falling back
 * to a stylised, generated visual derived from the swatch colour if there is no
 * image or the image fails to load. That fallback keeps the grid clean — no
 * broken-image icons — even when a seeded URL is unreachable.
 */
export default function ProductImage({ product, ratio = 1.22 }) {
  const [failed, setFailed] = useState(false);
  const { departments, wordmark, shop_name } = useConfig();
  // The gradient is product data (its swatch); only the fallback comes from the
  // theme, read as a concrete colour because shade() needs real channels.
  const base = isHex(product.swatch) ? product.swatch : cssVar("--pine", "#2e4b3f");
  const light = shade(base, 46);
  const dark = shade(base, -34);
  // Icon by the shop's own department list; unknown categories get a generic tag.
  const icon = departmentIcon(departments, product.category);
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
        {wordmark || shop_name}
      </text>
    </svg>
  );
}
