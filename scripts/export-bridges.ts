// Writes blender/bridges.json: each bridge over the run (not the Junction walkway, which is part
// of blender/junction.py) with the run's width and wall height under it, for blender/bridges.py.
// Run with: npx vite-node scripts/export-bridges.ts

import { writeFileSync } from 'node:fs';
import { Track } from '../src/sim/track';
import { LANDMARKS } from '../src/track/cresta';

const track = new Track();
const out = LANDMARKS.filter((lm) => lm.kind === 'bridge' && lm.name !== 'Junction walkway').map((lm) => {
  const pts = track.crossSection(lm.s);
  const right = pts[0].y;
  const left = pts[pts.length - 1].y;
  return { name: lm.name, slug: bridgeSlug(lm.name), s: lm.s, width: left - right, wall: Math.max(pts[0].z, pts[pts.length - 1].z) };
});
writeFileSync('blender/bridges.json', JSON.stringify(out, null, 1));
console.info(out);

function bridgeSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z]+/g, '_');
}
