// Where the smaller pieces beside the run stand, shared by the scenery (the models) and the crowd
// (the people on and around them): the observers' platform before Shuttlecock, and the finish.

import * as THREE from 'three';
import type { Track } from '../sim/track';
import { lips, surfaceAt } from '../sim/surface';
import type { Terrain } from './terrain';
import { groundHeight } from './ground';
import { toThree } from './util';
import { OSM_IDS, OSM_NEAR } from '../track/osm';

/** The observers' stand just before Shuttlecock, on the outside (right) of the run. */
export const PLATFORM = { s: 548, back: 5.5, deck: 2.6, length: 9 };

/** Lateral position (positive left) of the run's lip on one side at s. */
export function lipAt(track: Track, s: number, side: 'left' | 'right'): number {
  const section = track.section(s);
  return surfaceAt(section, lips(section)[side]).y;
}

/**
 * A frame for a model built in the run's frame in Blender (x along the run, y away from it on the
 * model's side, z up), standing on the ground at lateral `u` (positive left) at s. Models face the
 * run whichever side they stand on.
 */
export function besideRun(track: Track, terrain: Terrain, s: number, u: number): THREE.Object3D {
  const st = track.frame(s);
  const x = st.pos[0] + st.left[0] * u;
  const y = st.pos[1] + st.left[1] * u;
  const frame = new THREE.Object3D();
  frame.position.set(x, terrain.height(x, y), -y);
  // Three's local +z lies to the rider's right; Blender's +y becomes three's -z, i.e. to the left.
  frame.rotation.y = Math.atan2(st.forward[1], st.forward[0]) + (u < 0 ? Math.PI : 0);
  frame.updateMatrixWorld(true);
  return frame;
}

export function platformFrame(track: Track, terrain: Terrain): THREE.Object3D {
  return besideRun(track, terrain, PLATFORM.s, lipAt(track, PLATFORM.s, 'right') - PLATFORM.back);
}

/** The finish: the mat at the end of the run-out, the way out over the low left wall, the hut. */
export function finishPlaces(track: Track, terrain: Terrain) {
  const end = track.length;
  const lip = lipAt(track, end - 3, 'left');
  // On the drawn snow (the levelled ground or the run's embankment, whichever is higher), at the
  // lowest point under its whole footprint, so its plinth sits into the snow everywhere rather than
  // over a gap where the embankment falls away.
  const hut = besideRun(track, terrain, end - 10, lip + 4.6);
  let y = Infinity;
  for (let a = -2.2; a <= 2.21; a += 0.55) {
    for (let b = -2.3; b <= 1.81; b += 0.55) {
      const p = new THREE.Vector3(a, 0, -b).applyMatrix4(hut.matrixWorld);
      y = Math.min(y, groundHeight(track, terrain, p.x, p.z));
    }
  }
  hut.position.y = y;
  hut.updateMatrixWorld(true);
  return {
    end,
    exitS: end - 3.2,
    lip,
    hut,
    technician: { s: end - 2.2, u: lip + 0.9 },
  };
}

/** The footbridge above Church Leap, where the visitors' path crosses the run. */
export const PATH_BRIDGE = { s: 73.6, name: 'Stable Junction' };

/**
 * The footbridge's frame (x down the run, z across it, origin on the run's floor under the middle
 * of the bridge), the height of its deck above that, and how far it reaches either side.
 */
export function pathBridge(track: Track) {
  const st = track.frame(PATH_BRIDGE.s);
  const pts = track.crossSection(PATH_BRIDGE.s);
  const right = pts[0].y;
  const left = pts[pts.length - 1].y;
  const wall = Math.max(pts[0].z, pts[pts.length - 1].z);
  const frame = new THREE.Object3D();
  frame.position.copy(toThree(track.toWorld(st, (left + right) / 2, 0)));
  frame.rotation.y = track.heading(PATH_BRIDGE.s);
  frame.updateMatrixWorld(true);
  // Must match stable_junction() in blender/bridges.py.
  return { frame, deck: Math.max(wall, 0.75) + 1.65 + 0.6, span: (left - right) / 2 + 3.6 };
}

/**
 * The cutting at Stable Junction: the run passes deep between snow walls there, the road and the
 * ground level with the footbridge's deck above it (as in the photograph from the run). Height of
 * the ground above the run's floor, by distance down the run; it is level out to CUTTING_FLAT
 * metres from the run and eases back down to the hillside by CUTTING_EDGE.
 */
export const CUTTING_FLAT = 18;
export const CUTTING_EDGE = 52;

export const CUTTING = { s0: 34, s1: 116, ramp: 28, height: 3.0 };

export function cuttingHeight(s: number): number {
  const { s0, s1, ramp, height } = CUTTING;
  if (s <= s0 || s >= s1) return 0;
  const up = THREE.MathUtils.smoothstep(s, s0, s0 + ramp);
  const down = 1 - THREE.MathUtils.smoothstep(s, s1 - ramp, s1);
  return height * Math.min(up, down);
}

/**
 * The riders' terrace at Junction: a level shelf of trodden snow in front of the Junction hut's
 * door (at its uphill end), at the height of its sill, where the toboggans are laid out and the
 * riders wait. Beside it the run's bank is cut back to a wall. `side` is +1 when it lies to the
 * run's left; `z` is the world height of the shelf; from `out0` to `out1` metres beyond the lip.
 */
export interface Terrace {
  s0: number;
  s1: number;
  side: 1 | -1;
  z: number;
  out0: number;
  out1: number;
}

const terraces = new WeakMap<Track, Terrace>();

export function junctionTerrace(track: Track): Terrace {
  const cached = terraces.get(track);
  if (cached) return cached;
  const hut = OSM_NEAR.find((b) => b.id === OSM_IDS.junctionHut)!;
  let near = track.stations[0];
  for (const st of track.stations) {
    if (Math.hypot(st.pos[0] - hut.c[0], st.pos[1] - hut.c[1]) < Math.hypot(near.pos[0] - hut.c[0], near.pos[1] - hut.c[1])) near = st;
  }
  const side = (hut.c[0] - near.pos[0]) * near.left[0] + (hut.c[1] - near.pos[1]) * near.left[1] > 0 ? 1 : -1;
  // The hut's floor is 0.3 m under the run's beside it (clubhouse.ts); its door's sill 0.55 above that.
  const terrace: Terrace = { s0: 307.5, s1: 318, side, z: near.pos[2] - 0.3 + 0.5, out0: 0.4, out1: 7.5 };
  terraces.set(track, terrace);
  return terrace;
}
