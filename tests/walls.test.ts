import { describe, expect, it } from 'vitest';
import { Track } from '../src/sim/track';
import { RIDERS, TOBOGGANS } from '../src/sim/rider';
import { POLICIES, autopilotInput, SPLITS } from '../src/sim/autopilot';
import { MAX_CLIMB, RideSim } from '../src/sim/physics';
import { surfaceAt } from '../src/sim/surface';

const track = new Track();

/** The steepest bit of wall a bot rides on a whole run. */
function steepest(policy: string, toboggan: 'traditional' | 'flattop', noSteer = false) {
  const p = POLICIES[policy];
  const sim = new RideSim(track, RIDERS.remo, TOBOGGANS[toboggan], { startS: p.startS ?? 322.05, start: p.start, steps: p.steps, splitsAt: SPLITS });
  sim.release();
  const last = { t: -1 };
  let max = 0;
  for (let t = 0; t < 150; t += 1 / 60) {
    const input = autopilotInput(track, sim, p, t, last);
    if (noSteer && sim.state.s > 700) input.steer = 0;
    sim.update(1 / 60, input);
    const st = sim.state;
    if (st.phase !== 'riding') break;
    max = Math.max(max, surfaceAt(track.section(st.s), st.u).angle);
  }
  return max;
}

describe('riding the banks', () => {
  it('never rides a wall vertically, steering or not, on either toboggan, from Top or Junction', () => {
    for (const [policy, tob, noSteer] of [
      ['good', 'traditional', false],
      ['goodFlattop', 'flattop', true],
      ['expert', 'flattop', false],
      ['topGoodFlattop', 'flattop', false],
      ['topReckless', 'flattop', false],
    ] as const) {
      expect(steepest(policy, tob, noSteer)).toBeLessThanOrEqual(MAX_CLIMB + 0.01);
    }
  });
});
