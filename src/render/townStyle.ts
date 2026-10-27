// Which style each mapped building is modelled in (blender/town.py builds them):
//   pastel  - the colourful plastered blocks round Junction and the Top (salmon, yellow, peach);
//   engadin - white plastered blocks with shutters, stacked wooden balconies and timber gables;
//   chalet  - small houses and huts: plastered ground floor, timber above, a wide roof;
//   yellow  - the yellow house by the finish;
//   church  - kept as the game's own church.

import type { Track } from '../sim/track';
import type { Spec } from './buildings';

export type Style = 'pastel' | 'engadin' | 'chalet' | 'yellow' | 'church';

export function buildingStyle(spec: Spec, s: number, track: Track): Style {
  if (spec.kind === 'church') return 'church';
  const finish = track.frame(track.length - 2).pos;
  if (Math.hypot(spec.x - finish[0], spec.y - finish[1]) < 90 && spec.length * spec.width > 120 && !yellowTaken.has(track)) {
    yellowTaken.add(track);
    return 'yellow';
  }
  const area = spec.length * spec.width;
  if (area < 170 || ['hut', 'shed', 'garage', 'garages', 'roof'].includes(spec.kind)) return 'chalet';
  if (s < 400) return 'pastel';
  return 'engadin';
}

const yellowTaken = new WeakSet<Track>();
