// Where the smaller pieces beside the run stand, shared by the scenery (the models) and the crowd
// (the people on and around them): the observers' platform before Shuttlecock, and the finish.

import * as THREE from 'three';
import type { Track } from '../sim/track';
import { lips, surfaceAt } from '../sim/surface';
import type { Terrain } from './terrain';
import { toThree } from './util';

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
  return {
    end,
    exitS: end - 3.2,
    lip,
    hut: besideRun(track, terrain, end - 10, lip + 4.6),
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
