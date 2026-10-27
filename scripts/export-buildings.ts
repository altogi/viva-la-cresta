// Writes blender/buildings.json: every mapped building as the game sees it (oriented box, levels,
// roof), with its style and how far down the run it stands, for blender/town.py to model.
// Run with: npx vite-node scripts/export-buildings.ts

import { writeFileSync } from 'node:fs';
import { Track } from '../src/sim/track';
import { allBoxes, specFromBox } from '../src/render/buildings';
import { buildingStyle } from '../src/render/townStyle';

const track = new Track();
const boxes = allBoxes();
const xs = track.stations.map((st) => st.pos[0]);
const ys = track.stations.map((st) => st.pos[1]);
const MARGIN = 450; // as the terrain's
const inside = (x: number, y: number) => x > Math.min(...xs) - MARGIN && x < Math.max(...xs) + MARGIN && y > Math.min(...ys) - MARGIN && y < Math.max(...ys) + MARGIN;
const out = boxes.map((box, i) => {
  const spec = specFromBox(box);
  let best = { d: Infinity, s: 0 };
  for (const st of track.stations) {
    const d = Math.hypot(st.pos[0] - spec.x, st.pos[1] - spec.y);
    if (d < best.d) best = { d, s: st.s };
  }
  return { i, ...spec, s: best.s, distance: best.d, style: buildingStyle(spec, best.s, track) };
});
writeFileSync('blender/buildings.json', JSON.stringify(out.filter((b) => inside(b.x, b.y))));
console.info(`${out.filter((b) => inside(b.x, b.y)).length} buildings in the terrain`);
