import { describe, expect, it } from 'vitest';
import { Track } from '../src/sim/track';
import { Ghost } from '../src/viewer/ghost';
import { JUNCTION_S, TRACK_LENGTH } from '../src/track/cresta';

const track = new Track();

describe('viewer ghost', () => {
  it('rides in a plausible time and speed', () => {
    const junction = new Ghost(track, JUNCTION_S);
    const top = new Ghost(track, 0);
    const mph = (v: number) => v * 2.23694;
    console.info(
      `Junction ${junction.finishTime.toFixed(2)} s, finish ${mph(junction.state(TRACK_LENGTH).speed).toFixed(1)} mph, ` +
        `Rise ${junction.state(470).time.toFixed(2)}, Stream ${junction.state(690).time.toFixed(2)}, Bulpetts ${junction.state(868).time.toFixed(2)}; ` +
        `Top ${top.finishTime.toFixed(2)} s, Junction split ${top.state(JUNCTION_S).time.toFixed(2)}`,
    );
    expect(junction.finishTime).toBeGreaterThan(42);
    expect(junction.finishTime).toBeLessThan(55);
    expect(top.finishTime).toBeGreaterThan(52);
    expect(top.finishTime).toBeLessThan(72);
  });
});
