export interface FactionStatLike {
  id: number;
  name: string;
  color: string;
  isPlayerControlled: boolean;
  status: string;
  population: number;
  foodStockpile: number;
  productionStockpile: number;
  goldStockpile: number;
  investRate: number;
  militaryStrength: number;
}

interface Metric {
  label: string;
  get: (f: FactionStatLike) => number;
  format: (v: number) => string;
}

const METRICS: Metric[] = [
  { label: "Population", get: (f) => f.population, format: (v) => v.toFixed(1) },
  { label: "Food", get: (f) => f.foodStockpile, format: (v) => v.toFixed(0) },
  { label: "Production", get: (f) => f.productionStockpile, format: (v) => v.toFixed(0) },
  { label: "Gold", get: (f) => f.goldStockpile, format: (v) => v.toFixed(0) },
  { label: "Military", get: (f) => f.militaryStrength, format: (v) => v.toFixed(0) },
  { label: "Investment", get: (f) => f.investRate * 100, format: (v) => `${Math.round(v)}%` },
];

const BAR_HEIGHT = 14; // <=24px per the mark spec; compact since this repeats per faction per metric
const BAR_GAP = 4; // surface gap between adjacent bars
const CHART_WIDTH = 220;
const LABEL_RESERVE = 46; // room for the value label after the bar

// Small multiples - one mini bar-list per metric - rather than one combined
// chart, because Population/Food/Production/Gold/Military/Investment%
// live on wildly different scales (units in the single digits up to
// hundreds of thousands); a shared axis would flatten everything except
// the largest metric. Each panel scales only against its own current max
// across factions. Faction name sits inside the bar (white-on-fill, the
// one case where a label rides a colored mark), and the value sits at the
// bar's tip - so identity and precision are both direct labels, never
// dependent on color-matching or a separate legend/table.
export function FactionStatsChart({ factions }: { factions: FactionStatLike[] }) {
  const trackWidth = CHART_WIDTH - LABEL_RESERVE;

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${CHART_WIDTH}px, 1fr))`, gap: "1rem" }}>
      {METRICS.map((metric) => {
        const max = Math.max(1, ...factions.map((f) => metric.get(f)));
        const rowHeight = BAR_HEIGHT + BAR_GAP;
        return (
          <div key={metric.label}>
            <div style={{ fontSize: "0.8rem", color: "#666", marginBottom: 4 }}>{metric.label}</div>
            <svg width={CHART_WIDTH} height={factions.length * rowHeight} role="img" aria-label={`${metric.label} by faction`}>
              {factions.map((f, i) => {
                const value = metric.get(f);
                const barWidth = Math.max(2, (value / max) * trackWidth);
                const y = i * rowHeight;
                const opacity = f.status === "active" ? 1 : 0.4;
                const nameLabel = `${f.name}${f.isPlayerControlled ? " (you)" : ""}`;
                // Rough width estimate (no text-measurement API in SVG) - if
                // the name wouldn't fit inside the bar, put it after the bar
                // in dark text instead, so it's never clipped or unreadable
                // white-on-background.
                const nameFits = barWidth >= nameLabel.length * 5 + 8;
                return (
                  <g key={f.id} opacity={opacity}>
                    <rect x={0} y={y} width={barWidth} height={BAR_HEIGHT} rx={4} fill={f.color} />
                    <text x={nameFits ? 4 : barWidth + 4} y={y + BAR_HEIGHT - 3} fontSize={9} fill={nameFits ? "#fff" : "#333"}>
                      {nameLabel}
                    </text>
                    <text
                      x={nameFits ? barWidth + 4 : barWidth + 4 + nameLabel.length * 5 + 6}
                      y={y + BAR_HEIGHT - 3}
                      fontSize={10}
                      fill="#333"
                    >
                      {metric.format(value)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
