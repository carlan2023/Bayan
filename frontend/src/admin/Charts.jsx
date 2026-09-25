/**
 * Dependency-free SVG charts, coloured entirely by CSS custom properties.
 *
 * Colours are applied through `style` rather than SVG presentation attributes
 * because attributes like fill="…" do not resolve var(); a style property does.
 * That keeps the charts in step with the shop's palette (admin.css defines
 * --chart-* from the storefront tokens), including a live retheme from
 * Admin → Settings, without re-rendering.
 */

const PALETTE = [1, 2, 3, 4, 5, 6].map((n) => `var(--chart-${n})`);

export function BarChart({ data, height = 160, formatValue = (v) => v }) {
  const w = 560;
  const pad = { top: 14, bottom: 26, left: 6, right: 6 };
  const max = Math.max(...data.map((d) => d.value), 1);
  const innerW = w - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const bw = innerW / data.length;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="bar-chart" style={{ width: "100%", height: "auto" }}>
      {data.map((d, i) => {
        const h = Math.max((d.value / max) * innerH, d.value > 0 ? 3 : 1);
        const x = pad.left + i * bw;
        return (
          <g key={d.label}>
            <rect
              x={x + bw * 0.18}
              y={pad.top + innerH - h}
              width={bw * 0.64}
              height={h}
              rx="4"
              style={{ fill: d.value > 0 ? "var(--chart-1)" : "var(--chart-empty)" }}
            >
              <title>{`${d.label}: ${formatValue(d.value)}`}</title>
            </rect>
            {(data.length <= 16 || i % 2 === 0) && (
              <text
                x={x + bw / 2}
                y={height - 8}
                textAnchor="middle"
                style={{ fill: "var(--chart-label)" }}
                fontSize="9"
              >
                {d.shortLabel ?? d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function Donut({ segments, size = 150, formatValue = (v) => v }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 56;
  const c = 2 * Math.PI * r;
  let offset = 0;

  if (total === 0) return <div className="empty-mini">No data yet.</div>;

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox="0 0 150 150">
        <circle cx="75" cy="75" r={r} fill="none" style={{ stroke: "var(--chart-track)" }} strokeWidth="20" />
        {segments.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * c;
          const el = (
            <circle
              key={s.label}
              cx="75"
              cy="75"
              r={r}
              fill="none"
              style={{ stroke: s.color || PALETTE[i % PALETTE.length] }}
              strokeWidth="20"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 75 75)"
            >
              <title>{`${s.label}: ${formatValue(s.value)}`}</title>
            </circle>
          );
          offset += dash;
          return el;
        })}
        <text
          x="75"
          y="72"
          textAnchor="middle"
          fontSize="22"
          fontWeight="600"
          style={{ fontFamily: "var(--font-display)", fill: "var(--chart-1)" }}
        >
          {total}
        </text>
        <text x="75" y="90" textAnchor="middle" fontSize="9" letterSpacing="1" style={{ fill: "var(--chart-label)" }}>
          TOTAL
        </text>
      </svg>
      <div className="donut-legend">
        {segments.map((s, i) => (
          <div className="leg" key={s.label}>
            <span className="dot" style={{ background: s.color || PALETTE[i % PALETTE.length] }} />
            {s.label} — {formatValue(s.value)}
          </div>
        ))}
      </div>
    </div>
  );
}
