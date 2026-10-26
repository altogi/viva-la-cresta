import { describe, expect, it } from 'vitest';
import { Track } from '../src/sim/track';
import { ADELAIDE, TRADITIONAL } from '../src/sim/rider';
import { POLICIES, autopilotInput, runOutInput } from '../src/sim/autopilot';
import { RideSim } from '../src/sim/physics';
import { JUNCTION_S, TRACK_LENGTH } from '../src/track/cresta';

const track = new Track();

function rideToRest(policyName: string) {
  const policy = POLICIES[policyName];
  const sim = new RideSim(track, ADELAIDE, TRADITIONAL, { startS: JUNCTION_S, start: policy.start, steps: policy.steps });
  sim.release();
  const stride = { t: -1 };
  let t = 0;
  for (; t < 200 && !sim.state.stopped && sim.state.phase !== 'fallen'; t += 1 / 60) {
    const input = sim.state.phase === 'finished' ? runOutInput(track, sim) : autopilotInput(track, sim, policy, t, stride);
    sim.update(1 / 60, input);
  }
  const st = sim.state;
  console.info(
    `${policyName}: finish ${(st.finishSpeed! * 2.237).toFixed(1)} mph, rests at s=${st.s.toFixed(0)} ` +
      `(${(st.s - TRACK_LENGTH).toFixed(0)} m past the finish), cushion ${st.cushionSpeed?.toFixed(1) ?? '—'} m/s`,
  );
  return st;
}

describe('run-out at Celerina', () => {
  for (const name of ['beginner', 'good', 'expert']) {
    it(`${name} comes to rest safely in the run-out`, () => {
      const st = rideToRest(name);
      expect(st.phase).toBe('finished');
      expect(st.stopped).toBe(true);
      expect(st.s).toBeGreaterThan(TRACK_LENGTH + 30);
      if (st.cushionSpeed !== null) expect(st.cushionSpeed).toBeLessThan(4);
    });
  }
});
