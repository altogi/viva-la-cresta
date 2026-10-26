// Riding physics, in track coordinates: distance along the run s, arc length across the ice u.
//
// Per unit mass, the rider feels gravity, the centrifugal pull of the bend (which climbs them
// up the outer wall when they're too fast for their line), the normal force of the ice (which
// sets runner and rake friction), air drag, the rakes, and their own steering. Runners resist
// sliding sideways, more so on the knives. Over a lip means a fall; so does slamming down a wall.
// Deterministic: a fixed 240 Hz step, no randomness.

import { TRACK_LENGTH } from '../track/cresta';
import { lips, surfaceAt } from './surface';
import { PHYSICS, type RiderStats, type TobogganStats } from './rider';
import type { Track } from './track';

export const SIM_DT = 1 / 240;

export interface RideInput {
  /** Wants to be back on the knives (true) or forward (false). */
  knives: boolean;
  /** Steering, -1 (right) … +1 (left). */
  steer: number;
  /** Rake intensity per foot, 0 … 1. */
  rakeLeft: number;
  rakeRight: number;
  /** Running-start steps taken since the last step call. */
  runTaps: number;
}

export const NO_INPUT: RideInput = { knives: false, steer: 0, rakeLeft: 0, rakeRight: 0, runTaps: 0 };

export type StartStyle = 'lying' | 'running';
export type Phase = 'waiting' | 'running' | 'riding' | 'finished' | 'fallen';
export type FallKind = 'fly-out' | 'over-wall' | 'crash';

export interface Fall {
  kind: FallKind;
  s: number;
  zone: string;
  /** Lateral side the rider left the ice on. */
  side: 'left' | 'right';
}

export interface RideState {
  phase: Phase;
  s: number;
  u: number;
  /** Speed along the run and across the ice (m/s). */
  v: number;
  w: number;
  /** 0 = lying forward, 1 = back on the knives. */
  posture: number;
  /** Time since crossing the start beam (s), or null before it. */
  time: number | null;
  finishTime: number | null;
  topSpeed: number;
  runSteps: number;
  /** Normal load in g, for effects. */
  load: number;
  splits: Record<string, number>;
  fall: Fall | null;
}

export interface RideOptions {
  startS: number;
  start: StartStyle;
  /** Steps allowed before diving onto the toboggan (running start conversion). */
  steps?: number;
  splitsAt?: { name: string; s: number }[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class RideSim {
  readonly state: RideState;
  /** Last input, so the renderer can pose the rider. */
  input: RideInput = { ...NO_INPUT };
  private sinceTap = 0;
  private wasOnWall = false;
  private readonly beamS: number;

  constructor(
    private readonly track: Track,
    readonly rider: RiderStats,
    readonly toboggan: TobogganStats,
    readonly options: RideOptions,
  ) {
    this.beamS = options.startS + 2;
    this.state = {
      phase: 'waiting',
      s: options.startS,
      u: 0,
      v: 0,
      w: 0,
      posture: options.start === 'lying' ? 0 : 0,
      time: null,
      finishTime: null,
      topSpeed: 0,
      runSteps: 0,
      load: 1,
      splits: {},
      fall: null,
    };
  }

  get stepsAllowed() {
    return this.options.start === 'running' ? (this.options.steps ?? 7) : 0;
  }

  /** The bell: the toboggan is let go (lying) or the rider starts running. */
  release() {
    if (this.state.phase !== 'waiting') return;
    if (this.options.start === 'running' && this.stepsAllowed > 0) {
      this.state.phase = 'running';
    } else {
      this.state.phase = 'riding';
      this.state.v = 0.4;
    }
  }

  /** Advance by dt seconds (sub-stepped at SIM_DT). */
  update(dt: number, input: RideInput) {
    this.input = input;
    let taps = input.runTaps;
    let remaining = dt;
    while (remaining > 1e-9) {
      const h = Math.min(SIM_DT, remaining);
      this.step(h, { ...input, runTaps: taps });
      taps = 0;
      remaining -= h;
    }
  }

  private step(dt: number, input: RideInput) {
    const st = this.state;
    if (st.phase === 'waiting' || st.phase === 'fallen') return;
    if (st.phase === 'running') this.stepRunning(dt, input);
    else this.stepRiding(dt, input);
    this.updateTiming(dt);
  }

  private stepRunning(dt: number, input: RideInput) {
    const st = this.state;
    this.sinceTap += dt;
    for (let i = 0; i < input.runTaps; i++) {
      // Each stride gets closer to the rider's top running speed; quick strides hold it.
      st.v += (this.rider.runSpeed - st.v) * 0.3;
      st.runSteps++;
      this.sinceTap = 0;
    }
    if (this.sinceTap > 0.35) st.v *= Math.exp(-dt * 1.2);
    st.s += st.v * dt;
    if (st.runSteps >= this.stepsAllowed) {
      // Dive onto the toboggan, lying forward.
      st.phase = 'riding';
      st.v += 0.3;
      st.posture = 0;
    }
  }

  private stepRiding(dt: number, input: RideInput) {
    const st = this.state;
    const P = PHYSICS;
    const G = P.gravity;
    const finished = st.phase === 'finished';

    // Posture slides towards the wanted position at the rider's agility.
    const target = input.knives || finished ? 1 : 0;
    const rate = dt / this.rider.transitionTime;
    st.posture = target > st.posture ? Math.min(target, st.posture + rate) : Math.max(target, st.posture - rate);
    const p = st.posture;

    const section = this.track.section(st.s);
    const sp = surfaceAt(section, st.u);
    const grade = this.track.grade(st.s);
    const slope = Math.hypot(1, grade);
    const upZ = 1 / slope;
    const fwdZ = grade / slope;
    const kappa = this.track.curvature(st.s);
    const kEff = kappa / (1 - kappa * sp.y);
    const kVert = (this.track.grade(st.s + 0.5) - this.track.grade(st.s - 0.5)) / slope ** 3;

    const v = st.v;
    const w = st.w;
    const speed = Math.hypot(v, w) + 1e-6;

    // Gravity along the run, across the ice and into it.
    const gAlong = -G * fwdZ;
    const gAcross = -G * upZ * sp.tz;
    const gInto = -G * upZ * sp.nz;
    // Normal force: what keeps the rider on a curved surface, plus the share of gravity into the ice.
    const normal = w * w * sp.curvature + v * v * kEff * sp.ny + v * v * kVert * sp.nz - gInto;
    const load = Math.max(0, normal);
    st.load = load / G;

    const rakeL = finished ? 1 : input.rakeLeft;
    const rakeR = finished ? 1 : input.rakeRight;
    const mu = sp.angle > 1.2 ? P.wallFriction : lerp(this.toboggan.muForward, this.toboggan.muKnives, p);
    const dragK = (0.5 * P.airDensity * this.rider.dragArea * lerp(this.toboggan.dragForward, P.dragKnives, p)) / this.rider.mass;
    const rake = (rakeL + rakeR) * lerp(P.rakeForward, P.rakeKnives, p) * Math.min(1.5, load / G);
    const resist = mu * load + dragK * speed * speed + rake;

    const steerAuthority =
      lerp(P.steerForward * v * v, P.steerKnives * this.rider.reach, p) * this.toboggan.steerGain;
    const steer = clamp(input.steer, -1, 1) * steerAuthority + (rakeL - rakeR) * P.rakeSteer * v;
    const grip = lerp(P.gripForward, P.gripKnives, p);

    const aAlong = gAlong - (resist * v) / speed;
    const aAcross = gAcross - v * v * kEff * sp.ty + steer - grip * w - (resist * w) / speed;

    st.v = Math.max(0, v + aAlong * dt);
    st.w = w + aAcross * dt;
    st.u += st.w * dt;
    st.s += (st.v / slope / (1 - kappa * sp.y)) * dt;
    st.topSpeed = Math.max(st.topSpeed, st.v);

    if (finished) {
      st.s = Math.min(st.s, TRACK_LENGTH + 30);
      return;
    }
    this.checkFall(section, sp.angle, normal);
  }

  private checkFall(section: ReturnType<Track['section']>, angle: number, normal: number) {
    const st = this.state;
    const lip = lips(section);
    const half = section.floorWidth / 2;
    const side = st.u >= 0 ? 'left' : 'right';
    const outer = section.outerSide;
    const beyond = st.u > lip.left || st.u < lip.right;
    const outward = side === 'left' ? st.w > 0.3 : st.w < -0.3;
    if (beyond && outward) {
      this.fall(outer === side ? 'fly-out' : 'over-wall', side);
    } else if (beyond) {
      // The wall tapered away under a rider who wasn't moving outward: they slide down with it.
      st.u = side === 'left' ? lip.left - 0.02 : lip.right + 0.02;
    } else if (normal < -1 && angle > 0.5) {
      // Thrown off the wall: the bend demands more than the ice can hold.
      this.fall('fly-out', side);
    } else if (this.wasOnWall && Math.abs(st.u) <= half && Math.abs(st.w) > PHYSICS.crashSpeed) {
      // Came down the wall too hard and lost the toboggan on the floor.
      this.fall('crash', side);
    }
    this.wasOnWall = angle > 0.6;
  }

  private fall(kind: FallKind, side: 'left' | 'right') {
    const st = this.state;
    st.phase = 'fallen';
    st.fall = { kind, s: st.s, zone: this.track.zoneName(st.s), side };
  }

  private updateTiming(dt: number) {
    const st = this.state;
    if (st.time === null) {
      if (st.s >= this.beamS) st.time = 0;
      return;
    }
    if (st.phase === 'finished') return;
    st.time += dt;
    for (const split of this.options.splitsAt ?? []) {
      if (st.splits[split.name] === undefined && st.s >= split.s) st.splits[split.name] = st.time;
    }
    if (st.s >= TRACK_LENGTH) {
      st.phase = 'finished';
      st.finishTime = st.time;
    }
  }
}
