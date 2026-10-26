// A "ghost" descent for the track viewer: a rough speed profile (gravity, friction, drag,
// raking before the critical banks) and the line it would take up each bank wall.
// This is only for previewing the run; the real riding physics arrive in Phase 2.

import type { Track } from '../sim/track';
import { TRACK_LENGTH } from '../track/cresta';

const G = 9.81;
const MU = 0.012; // runners on ice
const DRAG = 0.0008; // ½ρCdA/m, rider lying forward
const RAKE = 3.0; // m/s² of braking available when raking

/** Speed limits a sensible rider respects (m/s), as [s0, s1, cap]. */
const CAPS: [number, number, number][] = [
  [150, 200, 22], // Curzon
  [250, 300, 21], // Thoma
  [560, 640, 15.5], // Shuttlecock: rake from Rise and Battledore
];

export interface GhostState {
  speed: number;
  time: number;
  /** Lateral offset of the rider (m, + left) and height above the floor (m). */
  lateral: number;
  height: number;
  /** Surface normal in the local (lateral, up) plane. */
  normal: [number, number];
}

export class Ghost {
  private readonly speeds: Float64Array;
  private readonly times: Float64Array;
  private readonly angles: Float64Array;
  readonly startS: number;

  constructor(
    private readonly track: Track,
    startS: number,
    startSpeed = 4,
  ) {
    this.startS = startS;
    const n = track.stations.length;
    const step = track.step;
    const i0 = Math.round(startS / step);
    // Backward pass: the fastest speed from which the caps ahead can still be met by raking.
    const vmax = new Float64Array(n).fill(Infinity);
    for (let i = n - 2; i >= 0; i--) {
      const s = i * step;
      let cap = Infinity;
      for (const [a, b, c] of CAPS) if (s >= a && s <= b) cap = Math.min(cap, c);
      vmax[i] = Math.min(cap, Math.sqrt(vmax[i + 1] ** 2 + 2 * RAKE * step));
    }
    this.speeds = new Float64Array(n);
    this.times = new Float64Array(n);
    this.angles = new Float64Array(n);
    let v = startSpeed;
    let t = 0;
    let angle = 0;
    for (let i = i0; i < n; i++) {
      const st = track.stations[i];
      this.speeds[i] = v;
      this.times[i] = t;
      // The wall angle where gravity and centripetal demand balance.
      const target = Math.atan((v * v * Math.abs(st.curvature)) / G);
      angle += (target - angle) * 0.12;
      this.angles[i] = angle;
      const slope = Math.hypot(1, st.grade);
      const dl = step * slope;
      const a = (G * -st.grade) / slope - MU * G - DRAG * v * v;
      const next = Math.sqrt(Math.max(1, v * v + 2 * a * dl));
      const capped = Math.min(next, vmax[Math.min(i + 1, n - 1)]);
      t += dl / ((v + capped) / 2);
      v = capped;
    }
  }

  get finishTime() {
    return this.times[Math.round(TRACK_LENGTH / this.track.step)];
  }

  state(s: number): GhostState {
    const f = Math.max(s, this.startS) / this.track.step;
    const i = Math.min(Math.floor(f), this.speeds.length - 2);
    const t = f - i;
    const speed = this.speeds[i] + (this.speeds[i + 1] - this.speeds[i]) * t;
    const time = this.times[i] + (this.times[i + 1] - this.times[i]) * t;
    const angle = this.angles[i] + (this.angles[i + 1] - this.angles[i]) * t;
    const section = this.track.section(s);
    const half = section.floorWidth / 2;
    const turningLeft = this.track.curvature(s) > 0;
    // Climb the outer wall: right wall in a left-hand bend.
    const wall = turningLeft ? section.right : section.left;
    const maxAngle = wall.height <= wall.radius ? Math.acos(1 - wall.height / wall.radius) : Math.PI / 2;
    const phi = Math.min(angle, maxAngle * 0.92);
    const side = turningLeft ? -1 : 1;
    return {
      speed,
      time,
      lateral: side * (half * 0.6 + wall.radius * Math.sin(phi)),
      height: wall.radius * (1 - Math.cos(phi)),
      normal: [-side * Math.sin(phi), Math.cos(phi)],
    };
  }
}
