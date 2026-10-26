// The visible ground at a world point: the run's ice, banks and their skirts where they are,
// else the hillside. Used for anything that stands or lands on it.

import type { Track } from '../sim/track';
import type { Terrain } from './terrain';
import { trackSurfaceHeight } from './trackMesh';

/** Ground height at world (x, z) (three.js axes: z = -north). */
export function groundHeight(track: Track, terrain: Terrain, x: number, z: number): number {
  const y = -z;
  const ground = terrain.height(x, y);
  const { station } = terrain.distanceToTrack(x, y);
  if (!station) return ground;
  const lateral = (x - station.pos[0]) * station.left[0] + (y - station.pos[1]) * station.left[1];
  const h = trackSurfaceHeight(track, station.s, lateral);
  return h === null ? ground : Math.max(ground, station.pos[2] + h);
}
