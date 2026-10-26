import { describe, expect, it } from 'vitest';
import { Track } from '../src/sim/track';
import { OSM_RUN } from '../src/track/osm';

const track = new Track();

/** Distance from a point to the OSM centreline polyline. */
function distanceToOsm(x: number, y: number) {
  let best = Infinity;
  for (let i = 0; i < OSM_RUN.length - 1; i++) {
    const [ax, ay] = OSM_RUN[i];
    const [bx, by] = OSM_RUN[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

describe('alignment with OpenStreetMap', () => {
  it('follows the real centreline closely', () => {
    const d = track.stations.map((st) => distanceToOsm(st.pos[0], st.pos[1]));
    const max = Math.max(...d);
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const worst = track.stations[d.indexOf(max)].s;
    console.info(`OSM deviation: mean ${mean.toFixed(1)} m, max ${max.toFixed(1)} m at s=${worst.toFixed(0)}`);
    expect(mean).toBeLessThan(4);
    expect(max).toBeLessThan(10);
  });
});
