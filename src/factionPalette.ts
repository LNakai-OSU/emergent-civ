// Validated categorical palette (8 hues, fixed order - CVD-safe adjacency
// per the dataviz skill's palette validator: worst adjacent CVD ΔE 9.1,
// worst adjacent normal-vision ΔE 19.6, all PASS). Never cycle/reorder these
// by rank - color always follows the faction's assigned slot.
const HUES: { name: string; color: string }[] = [
  { name: "Blue", color: "#2a78d6" },
  { name: "Orange", color: "#eb6834" },
  { name: "Aqua", color: "#1baf7a" },
  { name: "Yellow", color: "#eda100" },
  { name: "Magenta", color: "#e87ba4" },
  { name: "Green", color: "#008300" },
  { name: "Violet", color: "#4a3aa7" },
  { name: "Red", color: "#e34948" },
];

// Beyond 8 simultaneous factions, color alone can't stay distinguishable
// (a well-known limit, not a bug) - cycle the same 8 hues and disambiguate
// with a number suffix, since every faction is always shown with its name
// as a direct label anyway (never color-only identity in this app).
export function getFactionAppearance(index: number): { name: string; color: string } {
  const hue = HUES[index % HUES.length];
  const cycle = Math.floor(index / HUES.length);
  return cycle === 0 ? hue : { name: `${hue.name} ${cycle + 1}`, color: hue.color };
}
