import { DiplomaticStance } from "../simulation/DiplomacySystem";

// Duck-typed rather than the concrete Faction class, so historical-snapshot
// data (see GameSnapshot.ts) can be rendered the same way as live factions.
interface FactionLike {
  id: number;
  name: string;
  color: string;
}

interface DiplomacyGraphProps {
  factions: FactionLike[];
  getStance: (a: number, b: number) => DiplomaticStance;
  getStrength: (factionId: number) => number;
  size?: number;
}

const PEACE_COLOR = "#fd7e14"; // orange
const WAR_COLOR = "#dc3545"; // red
const MIN_LINE_WIDTH = 2;
const MAX_LINE_WIDTH = 14;
const NODE_RADIUS = 16;

// A relationship "line" is actually a tapered quadrilateral: thick at the
// stronger faction's end, thin at the weaker one's, so dominance is visible
// in the shape itself, not just a label. An even match renders as a
// near-uniform-width line; a lopsided one renders as a wedge.
export function DiplomacyGraph({ factions, getStance, getStrength, size = 320 }: DiplomacyGraphProps) {
  const center = size / 2;
  const layoutRadius = center - NODE_RADIUS - 24;

  const nodePositions = factions.map((_, i) => {
    const angle = (i / factions.length) * Math.PI * 2 - Math.PI / 2;
    return {
      x: center + layoutRadius * Math.cos(angle),
      y: center + layoutRadius * Math.sin(angle),
    };
  });

  const edges: { key: string; polygon: string; color: string }[] = [];
  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const a = factions[i];
      const b = factions[j];
      const posA = nodePositions[i];
      const posB = nodePositions[j];

      const color = getStance(a.id, b.id) === DiplomaticStance.War ? WAR_COLOR : PEACE_COLOR;

      const strengthA = getStrength(a.id);
      const strengthB = getStrength(b.id);
      const total = strengthA + strengthB;
      const aShare = total === 0 ? 0.5 : strengthA / total;

      const widthA = MIN_LINE_WIDTH + (MAX_LINE_WIDTH - MIN_LINE_WIDTH) * aShare;
      const widthB = MIN_LINE_WIDTH + (MAX_LINE_WIDTH - MIN_LINE_WIDTH) * (1 - aShare);

      const dx = posB.x - posA.x;
      const dy = posB.y - posA.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len;
      const py = dx / len;

      const p1 = { x: posA.x + px * (widthA / 2), y: posA.y + py * (widthA / 2) };
      const p2 = { x: posA.x - px * (widthA / 2), y: posA.y - py * (widthA / 2) };
      const p3 = { x: posB.x - px * (widthB / 2), y: posB.y - py * (widthB / 2) };
      const p4 = { x: posB.x + px * (widthB / 2), y: posB.y + py * (widthB / 2) };

      edges.push({
        key: `${a.id}-${b.id}`,
        polygon: `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`,
        color,
      });
    }
  }

  return (
    <div>
      <svg width={size} height={size}>
        {edges.map((edge) => (
          <polygon key={edge.key} points={edge.polygon} fill={edge.color} opacity={0.85} />
        ))}
        {factions.map((faction, i) => {
          const pos = nodePositions[i];
          return (
            <g key={faction.id}>
              <circle cx={pos.x} cy={pos.y} r={NODE_RADIUS} fill={faction.color} stroke="#000" strokeWidth={1.5} />
              <text x={pos.x} y={pos.y + NODE_RADIUS + 14} textAnchor="middle" fontSize={12} fill="currentColor">
                {faction.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.85rem", alignItems: "center" }}>
        <span>
          <span style={{ display: "inline-block", width: 12, height: 12, background: PEACE_COLOR, marginRight: 4 }} />
          Peace
        </span>
        <span>
          <span style={{ display: "inline-block", width: 12, height: 12, background: WAR_COLOR, marginRight: 4 }} />
          War
        </span>
        <span>Thicker end = stronger military</span>
      </div>
    </div>
  );
}
