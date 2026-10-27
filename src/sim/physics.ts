// Riding physics, in track coordinates: distance along the run s, arc length across the ice u.
//
// The toboggan has a heading relative to the run and its runners carve: it goes where it points.
// If the rider doesn't steer, it keeps going straight while the run turns away underneath, and
// rides up the outer wall; gravity on the bank turns it back down (that's how a bank works).
// Per unit mass the rider feels gravity, the normal force of the ice (which sets runner and rake
// friction), air drag, the rakes and their own steering. Falls: flying over a lip, or hitting a
// near-vertical wall too squarely, anywhere on the run.
// Deterministic: a fixed 240 Hz step, no randomness.

import { TRACK_LENGTH } from '../track/cresta';
import { lips, surfaceAt } from './surface';
import { PHYSICS, REFERENCE_MASS, type RiderStats, type TobogganStats } from './rider';
import type { Track } from './track';

export const SIM_DT = 1 / 240;
/** The yellow mat at the end of the run-out: it stops the toboggan; the rider slides on across it. */
export const MAT_LENGTH = 6;
const MAT_END_GAP = 0.4;
/** How hard the mat slows a sliding rider (m/s²). */
const MAT_DECEL = 4.5;

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

/** The highest a rider can ride up a bank's wall (radians from the floor): never vertical. */
export const MAX_CLIMB = 1.22;
export type Phase = 'waiting' | 'running' | 'riding' | 'finished' | 'fallen';
export type FallKind = 'fly-out' | 'over-wall' | 'crash' | 'wall' | 'steinbock';

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
  /** Speed along the run and across the ice (m/s), from speed and heading. */
  v: number;
  w: number;
  /** Heading of the toboggan relative to the run (rad, + towards the left). */
  heading: number;
  /** Sideways skid across the ice when the runners can't hold (m/s, + towards +u). */
  slide: number;
  /** 0 = lying forward, 1 = back on the knives. */
  posture: number;
  /** Time since crossing the start beam (s), or null before it. */
  time: number | null;
  finishTime: number | null;
  /** Speed through the finish contacts (m/s). */
  finishSpeed: number | null;
  /** Came to rest in the run-out. */
  stopped: boolean;
  /** Speed onto the finish mat at the end of the run-out, if reached (m/s). */
  matSpeed: number | null;
  /** Where the toboggan stopped against the mat; the rider slides on from here. */
  tobogganS: number | null;
  topSpeed: number;
  runSteps: number;
  /** Normal load in g, for effects. */
  load: number;
  /** Times the rider has hit a bankina this ride (for the knock and the shake). */
  bankHits: number;
  splits: Record<string, number>;
  fall: Fall | null;
}

export interface RideOptions {
  startS: number;
  start: StartStyle;
  /** Steps allowed before diving onto the toboggan (running start conversion). */
  steps?: number;
  splitsAt?: { name: string; s: number }[];
  /** How well the rakes bite (1 normally; 0 with the mind elsewhere). */
  rakeGrip?: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class RideSim {
  readonly state: RideState;
  /** Last input, so the renderer can pose the rider. */
  input: RideInput = { ...NO_INPUT };
  private sinceTap = 0;
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
      heading: 0,
      slide: 0,
      posture: options.start === 'lying' ? 0 : 0,
      time: null,
      finishTime: null,
      finishSpeed: null,
      stopped: false,
      matSpeed: null,
      tobogganS: null,
      topSpeed: 0,
      runSteps: 0,
      bankHits: 0,
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
    if (st.phase === 'waiting' || st.phase === 'fallen' || st.stopped) return;
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
      st.v += PHYSICS.diveBoost;
      st.posture = 0;
    }
  }

  private stepRiding(dt: number, input: RideInput) {
    const st = this.state;
    const P = PHYSICS;
    const G = P.gravity;
    const finished = st.phase === 'finished';
    if (finished && st.tobogganS !== null) {
      this.slideOnMat(dt);
      return;
    }

    // Posture slides towards the wanted position at the rider's agility.
    const target = input.knives ? 1 : 0;
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

    let speed = Math.hypot(st.v, st.w - st.slide);
    let psi = st.heading;
    const cos = Math.cos(psi);
    const sin = Math.sin(psi);
    const vAlong = speed * cos;
    const vAcross = speed * sin;

    // Gravity along the run, across the ice and into it.
    const gAlong = -G * fwdZ;
    const gAcross = -G * upZ * sp.tz;
    const gInto = -G * upZ * sp.nz;
    // Normal force: what keeps the rider on a curved surface, plus the share of gravity into the ice.
    const normal = vAcross * vAcross * sp.curvature + vAlong * vAlong * (kEff * sp.ny + kVert * sp.nz) - gInto;
    const load = Math.max(0, normal);
    st.load = load / G;

    const rakeL = input.rakeLeft;
    const rakeR = input.rakeRight;
    const mu = sp.angle > 1.2 ? P.wallFriction : lerp(this.toboggan.muForward, this.toboggan.muKnives, p);
    const dragK = (0.5 * P.airDensity * this.rider.dragArea * lerp(this.toboggan.dragForward, P.dragKnives, p)) / this.rider.mass;
    const rake = (rakeL + rakeR) * lerp(P.rakeForward, P.rakeKnives, p) * Math.min(1.5, load / G) * (REFERENCE_MASS / this.rider.mass) * (this.options.rakeGrip ?? 1);
    const resist = mu * load + dragK * speed * speed + rake;

    // Steering: arms on the knives, a turn of the head into the wind when forward, a single raking foot.
    const steerAuthority = lerp(P.steerForward * speed * speed, P.steerKnives * this.rider.reach, p) * this.toboggan.steerGain;
    const steer = clamp(input.steer, -1, 1) * steerAuthority + (rakeL - rakeR) * P.rakeSteer * speed;

    // Along the direction of travel: gravity minus everything that slows the rider.
    const aPar = gAlong * cos + gAcross * sin - resist;
    // Across it: gravity on a banked wall turns the carving toboggan, up to what the runners can
    // hold; beyond that grip they skid sideways down the wall.
    const aPerpWanted = -gAlong * sin + gAcross * cos;
    const hold = lerp(P.gripForward, P.gripKnives, p) * load;
    const aPerp = clamp(aPerpWanted, -hold, hold);
    st.slide += ((aPerpWanted - aPerp) * Math.cos(psi) - st.slide * P.skidDamping) * dt;
    const dsdt = vAlong / slope / (1 - kappa * sp.y);
    // The run turning under a toboggan that holds its line shows up as a heading change.
    const turn = aPerp / Math.max(speed, 2) + steer / Math.max(speed, 4) - kappa * dsdt;

    speed = Math.max(0, speed + aPar * dt);
    psi = clamp(psi + turn * dt, -1.45, 1.45);
    st.heading = psi;
    st.v = speed * Math.cos(psi);
    st.w = speed * Math.sin(psi) + st.slide;
    st.u += st.w * dt;
    st.s += (st.v / slope / (1 - kappa * sp.y)) * dt;
    if (!finished) st.topSpeed = Math.max(st.topSpeed, speed);

    if (finished) {
      this.runOut(section);
      return;
    }
    this.capClimb(section);
    this.checkFall(section, normal);
  }

  /**
   * No riding a bank's wall at vertical: once a rider is as high as MAX_CLIMB, their outward speed is
   * spent and they come back down it. (Low banks whose lip comes first can still throw them out.)
   */
  private capClimb(section: ReturnType<Track['section']>) {
    const st = this.state;
    const side = st.u >= 0 ? 1 : -1;
    const wall = side > 0 ? section.left : section.right;
    if (wall.radius < 0.3) return;
    const phiMax = wall.height <= wall.radius ? Math.acos(1 - wall.height / wall.radius) : Math.PI / 2;
    if (phiMax <= MAX_CLIMB) return;
    const limit = section.floorWidth / 2 + wall.radius * MAX_CLIMB;
    if (Math.abs(st.u) <= limit) return;
    st.u = side * limit;
    if (st.w * side > 0) {
      // Turn the carve back along the bank, losing the outward part of the speed.
      const speed = Math.hypot(st.v, st.w - st.slide);
      st.heading = clamp(st.heading, -0.05, 0.05) - side * 0.05;
      st.slide = 0;
      st.v = speed * Math.cos(st.heading);
      st.w = speed * Math.sin(st.heading);
    }
  }

  /** After the finish: no falls, the walls only bump, and the foam cushion stops the rider. */
  private runOut(section: ReturnType<Track['section']>) {
    const st = this.state;
    const side = st.u >= 0 ? 'left' : 'right';
    const lip = lips(section);
    st.u = clamp(st.u, lip.right + 0.3, lip.left - 0.3);
    if (this.againstBankina(section, side)) {
      st.heading = -st.heading * 0.3;
      st.slide = 0;
      const speed = Math.hypot(st.v, st.w);
      st.v = speed * Math.cos(st.heading);
      st.w = speed * Math.sin(st.heading);
    }
    const matStart = this.track.length - MAT_END_GAP - MAT_LENGTH;
    if (st.s >= matStart) {
      // The toboggan stops dead at the mat's edge; the rider carries on across it.
      st.matSpeed = Math.hypot(st.v, st.w);
      st.tobogganS = matStart;
      st.s = matStart;
      st.w = st.slide = 0;
      st.v = st.matSpeed;
    } else if (Math.hypot(st.v, st.w) < 0.25) {
      st.v = st.w = st.slide = 0;
      st.stopped = true;
    }
  }

  /** The rider sliding across the mat, off the toboggan, to a stop. */
  private slideOnMat(dt: number) {
    const st = this.state;
    const speed = Math.max(0, st.v - MAT_DECEL * dt);
    st.heading *= Math.exp(-dt * 3);
    st.u *= Math.exp(-dt * 2);
    st.v = speed;
    st.s = Math.min(st.s + speed * dt, this.track.length - MAT_END_GAP);
    if (speed < 0.2 || st.s >= this.track.length - MAT_END_GAP) {
      st.v = 0;
      st.stopped = true;
    }
  }

  private checkFall(section: ReturnType<Track['section']>, normal: number) {
    const st = this.state;
    const lip = lips(section);
    const side = st.u >= 0 ? 'left' : 'right';
    const outer = section.outerSide;
    const beyond = st.u > lip.left || st.u < lip.right;
    const outward = side === 'left' ? st.w > 0.3 : st.w < -0.3;
    const sp = surfaceAt(section, st.u);
    if (beyond && outward) {
      this.fall(outer === side ? 'fly-out' : 'over-wall', side);
    } else if (beyond) {
      // The wall tapered away under a rider who wasn't moving outward: they slide down with it.
      st.u = side === 'left' ? lip.left - 0.02 : lip.right + 0.02;
    } else if (normal < -1 && sp.angle > 0.5) {
      // Thrown off the wall: the bend demands more than the ice can hold.
      this.fall('fly-out', side);
    } else if (this.againstBankina(section, side)) {
      // Into a bankina: bump off it, or hit it too squarely and fall.
      const impact = Math.abs(st.w);
      if (Math.abs(st.heading) > PHYSICS.impactAngle && impact > PHYSICS.impactSpeed) {
        this.fall('wall', side);
      } else {
        const speed = Math.hypot(st.v, st.w - st.slide);
        // Every real hit costs speed; a square one costs more.
        const hit = impact > PHYSICS.bankHitSpeed;
        if (hit) st.bankHits++;
        const loss = 1 - (hit ? PHYSICS.bankHitLoss : 0) - PHYSICS.glanceLoss * Math.abs(Math.sin(st.heading));
        st.heading = -st.heading * 0.3;
        st.slide = 0;
        st.v = speed * loss * Math.cos(st.heading);
        st.w = speed * loss * Math.sin(st.heading);
      }
    }
  }

  /**
   * True when the rider is pressed against a bankina, moving outward. Square-cornered walls
   * (the straights) are a solid barrier at the toboggan's edge, so the rider stays flat on the
   * floor and is pushed back to it; curved bank walls only count once they're near vertical.
   */
  private againstBankina(section: ReturnType<Track['section']>, side: 'left' | 'right'): boolean {
    const st = this.state;
    const outward = side === 'left' ? st.w > 0 : st.w < 0;
    if (!outward) return false;
    const wall = side === 'left' ? section.left : section.right;
    if (wall.radius < 0.3) {
      const barrier = section.floorWidth / 2 - PHYSICS.tobogganHalfWidth;
      if (Math.abs(st.u) < barrier) return false;
      st.u = side === 'left' ? barrier : -barrier;
      return true;
    }
    return surfaceAt(section, st.u).angle > PHYSICS.wallAngle;
  }

  /** Ran into a Steinbock standing on the ice: off the toboggan. */
  hitSteinbock() {
    if (this.state.phase === 'riding') this.fall('steinbock', this.state.u > 0 ? 'right' : 'left');
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
      st.finishSpeed = Math.hypot(st.v, st.w - st.slide);
    }
  }
}
