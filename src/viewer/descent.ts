// A real descent for the title screen: the physics run by the autopilot from Junction, running
// start and all, raking and steering and going forward or back on the knives as it needs to, down
// to the finish mat at Celerina. Recorded once, then played back behind the title.

import type { Track } from '../sim/track';
import type { RiderStats, TobogganStats } from '../sim/rider';
import { RideSim } from '../sim/physics';
import { POLICIES, autopilotInput, runOutInput } from '../sim/autopilot';
import { JUNCTION_S } from '../track/cresta';

export interface DescentFrame {
  t: number;
  s: number;
  u: number;
  v: number;
  w: number;
  posture: number;
  steer: number;
  rakeLeft: number;
  rakeRight: number;
  /** 0 running beside the toboggan … 1 lying on it. */
  mount: number;
  runPhase: number;
  /** How far the rider has slid past the toboggan on the finish mat (m). */
  slidOff: number;
}

/** Ride it with the steadiest policy that gets this rider and toboggan to Celerina without a fall. */
export function recordDescent(track: Track, rider: RiderStats, toboggan: TobogganStats): DescentFrame[] {
  for (const name of ['good', 'novice']) {
    const frames = ride(track, rider, toboggan, name);
    if (frames) return frames;
  }
  return ride(track, rider, toboggan, 'beginner') ?? [];
}

function ride(track: Track, rider: RiderStats, toboggan: TobogganStats, name: string): DescentFrame[] | null {
  const policy = POLICIES[name];
  const sim = new RideSim(track, rider, toboggan, { startS: JUNCTION_S, start: policy.start, steps: policy.steps });
  sim.release();
  const dt = 1 / 60;
  const lastStride = { t: -1 };
  const frames: DescentFrame[] = [];
  let runPhase = 0;
  let mountTime = 0;
  let wasRunning = false;
  let stoppedFor = 0;
  for (let t = 0, step = 0; t < 180; t += dt, step++) {
    const st = sim.state;
    const input = st.phase === 'finished' ? runOutInput(track, sim) : autopilotInput(track, sim, policy, t, lastStride);
    sim.update(dt, input);
    if (st.phase === 'fallen') return null;
    if (st.phase === 'running') runPhase += (st.v * dt * Math.PI) / 1.7;
    if (wasRunning && st.phase !== 'running') mountTime = 0;
    wasRunning = st.phase === 'running';
    mountTime += dt;
    const mount = policy.start !== 'running' ? 1 : st.phase === 'running' || st.phase === 'waiting' ? 0 : Math.min(1, mountTime / 0.45);
    if (step % 2 === 0) {
      frames.push({
        t,
        s: st.s,
        u: st.u,
        v: st.v,
        w: st.w,
        posture: st.posture,
        steer: input.steer,
        rakeLeft: input.rakeLeft,
        rakeRight: input.rakeRight,
        mount,
        runPhase,
        slidOff: st.tobogganS === null ? 0 : st.s - st.tobogganS,
      });
    }
    // A moment on the mat at the end, then it's done.
    if (st.stopped) stoppedFor += dt;
    if (stoppedFor > 1.5) break;
  }
  return frames;
}

/** The frame at time t, blended between the two recorded either side of it. */
export function frameAt(frames: DescentFrame[], t: number, hint: { i: number }): DescentFrame {
  let i = Math.min(hint.i, frames.length - 2);
  if (frames[i].t > t) i = 0;
  while (i < frames.length - 2 && frames[i + 1].t <= t) i++;
  hint.i = i;
  const a = frames[i];
  const b = frames[i + 1];
  const k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-6, b.t - a.t)));
  const out = { ...a };
  for (const key of ['t', 's', 'u', 'v', 'w', 'posture', 'steer', 'rakeLeft', 'rakeRight', 'mount', 'runPhase', 'slidOff'] as const) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}
