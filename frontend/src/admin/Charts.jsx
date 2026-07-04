/** Dependency-free SVG charts, styled with the Bayan palette. */

const PALETTE = ["#2e4b3f", "#b06a4d", "#c9a24b", "#7b8fa3", "#93a392", "#6e4b3f"];

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
              fill={d.value > 0 ? "#2e4b3f" : "#e5dccb"}
            >
              <title>{`${d.label}: ${formatValue(d.value)}`}</title>
            </rect>
            {(data.length <= 16 || i % 2 === 0) && (
              <text
                x={x + bw / 2}
                y={height - 8}
                textAnchor="middle"
                fill="#55604f"
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
        <circle cx="75" cy="75" r={r} fill="none" stroke="#efe9da" strokeWidth="20" />
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
              stroke={s.color || PALETTE[i % PALETTE.length]}
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
        <text x="75" y="72" textAnchor="middle" fontFamily="Fraunces, serif" fontSize="22" fill="#2e4b3f" fontWeight="600">
          {total}
        </text>
        <text x="75" y="90" textAnchor="middle" fontSize="9" fill="#55604f" letterSpacing="1">
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
