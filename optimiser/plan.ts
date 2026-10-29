// A riding plan, laid out along the run, and the rider who follows it in the game's own physics.
//
// The plan says, stretch by stretch (every KNOT metres of the run): how high to ride the banks (a
// share of the natural bank line for the speed, as the autopilot does), whether to be back on the
// knives, the speed above which to rake, and a steer of its own on top of following that line (so
// it can take lines the feedback alone never would). The steering, posture and raking that come
// out are recorded in the trace. The optimiser (cmaes.ts) searches over plans for the fastest clean descent.

import { BENDS, TRACK_LENGTH } from '../src/track/cresta';
import { RideSim, type RideInput } from '../src/sim/physics';
import { PHYSICS, type RiderStats, type TobogganStats } from '../src/sim/rider';
import { lips } from '../src/sim/surface';
import { POLICIES, type Policy } from '../src/sim/autopilot';
import type { Track } from '../src/sim/track';
import { adjust, type Mood, type Weather } from '../src/game/conditions';

/** Metres between the plan's knots. */
export const KNOT = 10;
/** The controller's rate (Hz); the physics sub-steps at 240 Hz inside each step. */
const CONTROL_HZ = 60;
/** Seconds between running-start strides: about as quick as a thumb taps. */
export const STRIDE = 0.15;
/** Speed caps at or above this mean no raking at all (m/s). */
export const NO_RAKE = 45;

/** Where a ride begins: a start (Top or Junction), or a state on the run (a Shuttlecock entry). */
export interface Scenario {
  name: string;
  startS: number;
  /** A running start of this many steps, or a lying start (0). */
  steps: number;
  /** Seconds between running strides (STRIDE if not given). */
  stride?: number;
  /** For a ride picked up on the run: the rider's state there (time counts from here). */
  entry?: { u: number; v: number; heading: number; posture: number };
}

/** The plan's numbers, GENES per knot from the scenario's start: line, knives, rake cap, steering. */
export type Genome = Float64Array;

export const GENES = 4;
export const knotsFor = (sc: Scenario) => Math.ceil((TRACK_LENGTH + 4 - sc.startS) / KNOT) + 1;
export const dims = (sc: Scenario) => knotsFor(sc) * GENES;

/** What one knot of the plan asks for. */
export interface Knot {
  /** Share of the natural bank line (0 hugs the floor, 1 the balanced line, more rides higher). */
  line: number;
  knives: boolean;
  /** Rake to hold this speed (m/s); NO_RAKE for none. */
  cap: number;
  /** Steering of the rider's own on top of following the line (−1 right … +1 left). */
  steer: number;
}

export function decode(g: Genome, k: number): Knot {
  return {
    line: Math.min(1.35, Math.max(0, 0.95 + 0.25 * g[k * GENES])),
    knives: g[k * GENES + 1] > 0,
    cap: Math.min(NO_RAKE, Math.max(5, 30 + 8 * g[k * GENES + 2])),
    steer: Math.min(1, Math.max(-1, 0.4 * g[k * GENES + 3])),
  };
}

/** The genome for an autopilot policy: a good place to start the search. */
export function fromPolicy(sc: Scenario, policy: Policy): Genome {
  const n = knotsFor(sc);
  const g = new Float64Array(n * GENES);
  for (let k = 0; k < n; k++) {
    const s = sc.startS + k * KNOT;
    g[k * GENES] = (policy.line - 0.95) / 0.25;
    g[k * GENES + 1] = policy.knives.some(([a, b]) => s >= a && s <= b) ? 1 : -1;
    const cap = policy.rake.find(([a, b]) => s >= a && s <= b)?.[2];
    g[k * GENES + 2] = cap === undefined ? 2.5 : (cap - 30) / 8;
  }
  return g;
}

/** The natural line through a bend at this speed, scaled by `line`; the middle elsewhere (as the autopilot). */
function targetU(track: Track, s: number, speed: number, line: number, u: number): number {
  const ahead = s + 3;
  const section = track.section(ahead);
  let target = 0;
  const kappa = track.curvature(ahead);
  const bend = BENDS.find((b) => ahead >= b.s0 - 2 && ahead <= b.s1 + 6);
  if (bend && section.outerSide && Math.abs(kappa) > 1e-4) {
    const wall = section.outerSide === 'left' ? section.left : section.right;
    const maxAngle = wall.height <= wall.radius ? Math.acos(1 - wall.height / wall.radius) : Math.PI / 2;
    const angle = Math.min(Math.atan((speed * speed * Math.abs(kappa)) / 9.81) * line, maxAngle * 0.8);
    const lip = lips(section);
    const half = section.floorWidth / 2;
    const tu = Math.min(half + wall.radius * angle, (section.outerSide === 'left' ? lip.left : -lip.right) - 0.3);
    target = section.outerSide === 'left' ? tu : -tu;
  }
  const here = track.section(s);
  const side = u >= 0 ? 1 : -1;
  const wallHere = side > 0 ? here.left : here.right;
  if (wallHere.radius < 0.3) {
    const barrier = here.floorWidth / 2 - PHYSICS.tobogganHalfWidth;
    if (Math.abs(u) > barrier - 0.4) target = side * Math.max(0, barrier - 0.7);
  }
  return target;
}

export interface TracePoint {
  t: number;
  s: number;
  u: number;
  speed: number;
  posture: number;
  steer: number;
  rake: number;
  heading: number;
  load: number;
}

export interface Outcome {
  /** Lower is better: the time for a clean ride, far more for a fall (less the further it got). */
  score: number;
  time: number | null;
  fall: { kind: string; zone: string; s: number } | null;
  finishSpeed: number | null;
  topSpeed: number;
  splits: Record<string, number>;
  bankHits: number;
  trace?: TracePoint[];
}

export const SPLITS = [
  { name: 'Junction', s: 317 },
  { name: 'Rise', s: 470 },
  { name: 'Stream', s: 690 },
  { name: 'Bulpetts', s: 868 },
];

/** The day's weather and the rider's luck, as the game applies them (game/conditions). */
export interface Conditions {
  weather: Weather | null;
  moods: Mood[];
}

/** Ride a plan from a scenario's start to the finish (on an ordinary day unless `conditions` say otherwise). */
export function ride(track: Track, rider0: RiderStats, toboggan0: TobogganStats, sc: Scenario, g: Genome, keepTrace = false, conditions?: Conditions): Outcome {
  const day = adjust(rider0, toboggan0, conditions?.weather ?? null, conditions?.moods ?? []);
  const rider = day.rider;
  const sim = new RideSim(track, rider, day.toboggan, {
    startS: sc.startS,
    start: sc.steps > 0 ? 'running' : 'lying',
    steps: sc.steps,
    splitsAt: SPLITS.filter((x) => x.s > sc.startS + 3),
    rakeGrip: day.rakeGrip,
    bankBoost: day.bankBoost,
  });
  void rider;
  const st = sim.state;
  if (sc.entry) {
    // Picked up on the run: already riding, the clock running from here.
    st.phase = 'riding';
    st.u = sc.entry.u;
    st.heading = sc.entry.heading;
    st.v = sc.entry.v * Math.cos(sc.entry.heading);
    st.w = sc.entry.v * Math.sin(sc.entry.heading);
    st.posture = sc.entry.posture;
    st.time = 0;
  } else sim.release();
  const dt = 1 / CONTROL_HZ;
  const trace: TracePoint[] = [];
  const n = knotsFor(sc);
  let t = 0;
  let lastStride = -1;
  let stalled = 0;
  while (t < 160) {
    let input: RideInput;
    if (st.phase === 'running') {
      // Strides at a quick rhythm a thumb can keep up: every 0.15 s unless the scenario says otherwise.
      const tap = t - lastStride >= (sc.stride ?? STRIDE);
      if (tap) lastStride = t;
      input = { knives: false, steer: 0, rakeLeft: 0, rakeRight: 0, runTaps: tap ? 1 : 0 };
    } else {
      const x = (st.s - sc.startS) / KNOT;
      const k = Math.max(0, Math.min(n - 1, Math.floor(x)));
      const a = decode(g, k);
      const b = decode(g, Math.min(n - 1, k + 1));
      const f = Math.max(0, Math.min(1, x - k));
      const line = a.line + (b.line - a.line) * f;
      const speed = Math.hypot(st.v, st.w);
      const target = targetU(track, st.s, speed, line, st.u);
      const limit = Math.min(0.16, 1.6 / Math.max(speed, 1));
      const wantHeading = Math.max(-limit, Math.min(limit, (0.35 * (target - st.u)) / Math.max(1, speed / 8) - (0.7 * st.w) / Math.max(speed, 1)));
      const own = a.steer + (b.steer - a.steer) * f;
      const steer = Math.max(-1, Math.min(1, 9 * (wantHeading - st.heading) + own));
      const rake = a.cap >= NO_RAKE ? 0 : Math.max(0, Math.min(1, (st.v - a.cap) * 0.8));
      input = { knives: a.knives, steer, rakeLeft: rake, rakeRight: rake, runTaps: 0 };
    }
    sim.update(dt, input);
    t += dt;
    if (keepTrace && st.phase !== 'waiting') {
      trace.push({ t: st.time ?? 0, s: st.s, u: st.u, speed: Math.hypot(st.v, st.w), posture: st.posture, steer: input.steer, rake: input.rakeLeft, heading: st.heading, load: st.load });
    }
    if (st.phase === 'finished' || st.phase === 'fallen') break;
    if (st.phase === 'riding' && st.v < 0.05) stalled += dt;
    if (stalled > 1) break;
  }
  const finished = st.finishTime !== null;
  const reached = st.fall?.s ?? st.s;
  return {
    // A fall: the further down and the slower it happened, the nearer the plan came to working.
    score: finished ? st.finishTime! : 300 + (TRACK_LENGTH - reached) * 0.5 + Math.hypot(st.v, st.w) * 3,
    time: finished ? st.finishTime : null,
    fall: st.fall ? { kind: st.fall.kind, zone: st.fall.zone, s: st.fall.s } : finished ? null : { kind: 'stalled', zone: track.zoneName(st.s), s: st.s },
    finishSpeed: st.finishSpeed,
    topSpeed: st.topSpeed,
    splits: st.splits,
    bankHits: st.bankHits,
    trace: keepTrace ? trace : undefined,
  };
}

export { POLICIES };
