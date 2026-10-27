// Writes blender/junction.json: what blender/junction.py needs to model the clubhouse, the walkway
// over the run and the Junction hut in place: the clubhouse's footprint and floor height, the
// walkway's ends and deck height, and where the hut stands at the start, opposite the clubhouse.
// Run with: npx vite-node scripts/export-junction.ts

import { writeFileSync } from 'node:fs';
import { Track } from '../src/sim/track';
import { JUNCTION_S } from '../src/track/cresta';
import { OSM_IDS, OSM_NEAR } from '../src/track/osm';
import { junctionLayout } from '../src/render/clubhouse';

const track = new Track();
const club = OSM_NEAR.find((b) => b.id === OSM_IDS.clubhouse)!;
const st = track.frame(JUNCTION_S);
const layout = junctionLayout(track);
const out = {
  club: { ring: layout.clubRing, centre: club.c, floorZ: layout.floorZ, runSide: layout.runNormal },
  walkway: layout.walkway,
  hut: layout.hut,
  junction: { s: JUNCTION_S, pos: st.pos, left: st.left, side: layout.side },
};
writeFileSync('blender/junction.json', JSON.stringify(out, null, 1));
console.info(JSON.stringify(out.hut), JSON.stringify(out.walkway));
