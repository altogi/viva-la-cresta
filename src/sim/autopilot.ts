// Bot riders for headless calibration: each follows a version of the usual choreography
// (when to go back on the knives, where and how hard to rake, how high to ride the banks).

import { BENDS, JUNCTION_S, TRACK_LENGTH } from '../track/cresta';
import { MAT_LENGTH, RideSim, type RideInput, type StartStyle } from './physics';
import { lips } from './surface';
import type { RiderStats, TobogganStats } from './rider';
import type { Track } from './track';

export interface Policy {
  name: string;
  start: StartStyle;
  steps?: number;
  startS?: number;
  /** Ranges of s ridden back on the knives. */
  knives: [number, number][];
  /** Raking with both feet to hold a speed, as [s0, s1, target m/s]. */
  rake: [number, number, number][];
  /** Line through the bends, as a share of the natural bank angle for the current speed. */
  line: number;
  /** Seconds between running-start strides. */
  stride?: number;
  /** Set false for a rider who never steers. */
  steers?: boolean;
}

export const SPLITS = [
  { name: 'Rise', s: 470 },
  { name: 'Stream', s: 690 },
  { name: 'Bulpetts', s: 868 },
];

export const POLICIES: Record<string, Policy> = {
  /** First ride: lying start from Junction, on the knives and raking most of the way. */
  beginner: {
    name: 'beginner',
    start: 'lying',
    knives: [[JUNCTION_S, 650]],
    rake: [
      [JUNCTION_S + 10, 560, 8.5],
      [560, 650, 8],
      [650, 1300, 16],
    ],
    line: 0.85,
  },
  /** A solid running start on a traditional: forward to Rise, rake to Shuttlecock, forward after Stream. */
  novice: {
    name: 'novice',
    start: 'running',
    steps: 7,
    knives: [[430, 645]],
    rake: [[440, 640, 13.5]],
    line: 0.9,
  },
  /** A solid traditional rider (the 49 s target): later transition, lighter rake, higher line. */
  good: {
    name: 'good',
    start: 'running',
    steps: 7,
    knives: [[485, 640]],
    rake: [[490, 640, 14.8]],
    line: 0.95,
  },
  /** A good flat-top rider (the 45 s target): later on the knives, more speed through the banks. */
  goodFlattop: {
    name: 'goodFlattop',
    start: 'running',
    steps: 7,
    knives: [[520, 638]],
    rake: [[525, 638, 16.6]],
    line: 1,
  },
  /** Pushing hard: knives late, minimal raking, a high line through Shuttlecock. */
  expert: {
    name: 'expert',
    start: 'running',
    steps: 7,
    knives: [[530, 636]],
    rake: [[535, 636, 16.2]],
    line: 1,
  },
  /** Brakes like the solid rider but never steers: should hit a wall somewhere. */
  passenger: {
    name: 'passenger',
    start: 'running',
    steps: 7,
    knives: [[485, 640]],
    rake: [[490, 640, 14.8]],
    line: 1,
    steers: false,
  },
  /** No brakes at all: should fly out of Shuttlecock. */
  reckless: {
    name: 'reckless',
    start: 'running',
    steps: 7,
    knives: [],
    rake: [],
    line: 0.5,
  },
};

const inRange = (s: number, ranges: [number, number][]) => ranges.some(([a, b]) => s >= a && s <= b);

/**
 * Steering that follows the natural bank line through bends (the wall angle where speed and
 * gravity balance, scaled by `line`) and the middle of the floor elsewhere.
 */
export function lineSteer(track: Track, sim: RideSim, line: number): number {
  const st = sim.state;
  const ahead = st.s + 3;
  const section = track.section(ahead);
  let target = 0;
  const kappa = track.curvature(ahead);
  const bend = BENDS.find((b) => ahead >= b.s0 - 2 && ahead <= b.s1 + 6);
  if (bend && section.outerSide && Math.abs(kappa) > 1e-4) {
    const v = Math.hypot(st.v, st.w);
    const wall = section.outerSide === 'left' ? section.left : section.right;
    const maxAngle = wall.height <= wall.radius ? Math.acos(1 - wall.height / wall.radius) : Math.PI / 2;
    const angle = Math.min(Math.atan((v * v * Math.abs(kappa)) / 9.81) * line, maxAngle * 0.8);
    const lip = lips(section);
    const half = section.floorWidth / 2;
    const u = Math.min(half + wall.radius * angle, (section.outerSide === 'left' ? lip.left : -lip.right) - 0.3);
    target = section.outerSide === 'left' ? u : -u;
  }
  // Point the toboggan back towards the target line (gently at speed), then steer to hold that heading.
  const speed = Math.hypot(st.v, st.w);
  const limit = Math.min(0.16, 1.6 / Math.max(speed, 1));
  const wantHeading = Math.max(-limit, Math.min(limit, (0.35 * (target - st.u)) / Math.max(1, speed / 8)));
  return Math.max(-1, Math.min(1, 9 * (wantHeading - st.heading)));
}

/**
 * The run-out after the finish, ridden for the player: back on the knives, raking to a speed that
 * brings the rider round the final hook and onto the finish mat at a gentle pace.
 */
export function runOutInput(track: Track, sim: RideSim): RideInput {
  const st = sim.state;
  // Arrive at the mat at a few metres per second, enough to slide a little way across it.
  const remaining = Math.max(0, track.length - 0.4 - MAT_LENGTH - st.s);
  const target = Math.sqrt(2 * 1.4 * remaining) + 2.4;
  const rake = Math.max(0, Math.min(1, (Math.hypot(st.v, st.w) - target) * 1.2));
  return { knives: true, steer: lineSteer(track, sim, 1), rakeLeft: rake, rakeRight: rake, runTaps: 0 };
}

export function autopilotInput(track: Track, sim: RideSim, policy: Policy, t: number, lastStride: { t: number }): RideInput {
  const st = sim.state;
  let runTaps = 0;
  if (st.phase === 'running' && t - lastStride.t >= (policy.stride ?? 0.28)) {
    runTaps = 1;
    lastStride.t = t;
  }
  const cap = policy.rake.find(([a, b]) => st.s >= a && st.s <= b)?.[2];
  const rakeAmount = cap === undefined ? 0 : Math.max(0, Math.min(1, (st.v - cap) * 0.8));
  const steer = lineSteer(track, sim, policy.line);
  return { knives: inRange(st.s, policy.knives), steer: policy.steers === false ? 0 : steer, rakeLeft: rakeAmount, rakeRight: rakeAmount, runTaps };
}

export interface BotResult {
  policy: string;
  time: number | null;
  fall: string | null;
  topSpeedMph: number;
  finishSpeedMph: number;
  splits: Record<string, number>;
}

/** Stalled: stopped on the ice after the start. */
const st0 = (sim: RideSim) => sim.state.phase === 'riding' && sim.state.v < 0.05;

export function runBot(track: Track, rider: RiderStats, toboggan: TobogganStats, policy: Policy): BotResult {
  const sim = new RideSim(track, rider, toboggan, {
    startS: policy.startS ?? JUNCTION_S,
    start: policy.start,
    steps: policy.steps,
    splitsAt: SPLITS,
  });
  sim.release();
  const dt = 1 / 60;
  const lastStride = { t: -1 };
  let finishSpeed = 0;
  for (let t = 0; t < 200 && !(st0(sim) && t > 5); t += dt) {
    sim.update(dt, autopilotInput(track, sim, policy, t, lastStride));
    const st = sim.state;
    if (st.phase === 'finished' && !finishSpeed) finishSpeed = st.v;
    if (st.phase === 'finished' || st.phase === 'fallen') break;
    if (st.s >= TRACK_LENGTH) break;
  }
  const st = sim.state;
  return {
    policy: policy.name,
    time: st.finishTime,
    fall: st.fall ? `${st.fall.kind} at ${st.fall.zone}` : null,
    topSpeedMph: st.topSpeed * 2.23694,
    finishSpeedMph: finishSpeed * 2.23694,
    splits: st.splits,
  };
}
