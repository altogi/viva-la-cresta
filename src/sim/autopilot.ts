// Bot riders for headless calibration: each follows a version of the usual choreography
// (when to go back on the knives, where and how hard to rake, how high to ride the banks).

import { BENDS, JUNCTION_S, TRACK_LENGTH } from '../track/cresta';
import { RideSim, type RideInput, type StartStyle } from './physics';
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
  /** How far up the outer wall to aim in bends (0 = floor, 1 = lip). */
  line: number;
  /** Seconds between running-start strides. */
  stride?: number;
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
    line: 0.25,
  },
  /** A solid running start on a traditional: forward to Rise, rake to Shuttlecock, forward after Stream. */
  novice: {
    name: 'novice',
    start: 'running',
    steps: 7,
    knives: [[430, 645]],
    rake: [[440, 640, 13.5]],
    line: 0.45,
  },
  /** A solid traditional rider (the 49 s target): later transition, lighter rake, higher line. */
  good: {
    name: 'good',
    start: 'running',
    steps: 7,
    knives: [[485, 640]],
    rake: [[490, 640, 14.8]],
    line: 0.55,
  },
  /** Pushing hard: knives late, minimal raking, a high line through Shuttlecock. */
  expert: {
    name: 'expert',
    start: 'running',
    steps: 7,
    knives: [[530, 636]],
    rake: [[535, 636, 16.2]],
    line: 0.62,
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

export function autopilotInput(track: Track, sim: RideSim, policy: Policy, t: number, lastStride: { t: number }): RideInput {
  const st = sim.state;
  let runTaps = 0;
  if (st.phase === 'running' && t - lastStride.t >= (policy.stride ?? 0.28)) {
    runTaps = 1;
    lastStride.t = t;
  }
  const cap = policy.rake.find(([a, b]) => st.s >= a && st.s <= b)?.[2];
  const rakeAmount = cap === undefined ? 0 : Math.max(0, Math.min(1, (st.v - cap) * 0.8));
  // Aim part-way up the outer wall in bends, the middle of the floor elsewhere.
  const section = track.section(st.s + 4);
  let target = 0;
  const bend = BENDS.find((b) => st.s + 4 >= b.s0 && st.s + 4 <= b.s1);
  if (bend && section.outerSide) {
    const lip = lips(section);
    const half = section.floorWidth / 2;
    target = section.outerSide === 'left' ? half + (lip.left - half) * policy.line : -(half + (-lip.right - half) * policy.line);
  }
  const steer = Math.max(-1, Math.min(1, 0.9 * (target - st.u) - 1.6 * st.w));
  return { knives: inRange(st.s, policy.knives), steer, rakeLeft: rakeAmount, rakeRight: rakeAmount, runTaps };
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
