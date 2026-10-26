// Track geometry: centreline, local frames and cross-sections, built from track/cresta.ts.
// Used by the physics (track coordinates s, u) and by the renderer (mesh sweep).

import {
  BENDS,
  BEND_BLEND,
  DRIFTS,
  FLOOR_WIDTH,
  LIP_WIDTH,
  PROFILE,
  START_HEADING,
  STRAIGHT_WALL,
  TRACK_LENGTH,
  ZONES,
  type Bend,
  type ProfilePoint,
  type WallShape,
} from '../track/cresta';
import { add, cross, normalize, scale, smoothstep, type Vec3 } from './vec';

const DEG = Math.PI / 180;

export interface Station {
  s: number;
  pos: Vec3;
  /** Unit tangent, following the slope. */
  forward: Vec3;
  /** Horizontal unit vector to the rider's left. */
  left: Vec3;
  /** Unit normal of the track floor. */
  up: Vec3;
  heading: number;
  /** Horizontal curvature (1/m), positive turning left. */
  curvature: number;
  /** Slope dz/ds (negative going downhill). */
  grade: number;
}

export interface Section {
  floorWidth: number;
  left: WallShape;
  right: WallShape;
  /** Bend whose cross-section dominates here, if any. */
  bend: Bend | null;
  /** Side of the outer wall in the current bend. */
  outerSide: 'left' | 'right' | null;
  runoffLeft: 'snow' | 'straw';
  runoffRight: 'snow' | 'straw';
}

export type CrossPart = 'floor' | 'wall' | 'lip';

export interface CrossPoint {
  /** Lateral offset, positive to the left (m). */
  y: number;
  /** Height above the floor (m). */
  z: number;
  /** Arc length across the surface from the floor centre, positive to the left (m). */
  u: number;
  part: CrossPart;
}

// Fixed cross-section topology, so consecutive sections can be stitched into a mesh.
export const ARC_SEGMENTS = 10;
export const VERTICAL_SEGMENTS = 2;
export const FLOOR_SEGMENTS = 8;
export const SIDE_POINTS = ARC_SEGMENTS + 1 + VERTICAL_SEGMENTS + 1;
export const CROSS_POINTS = 2 * SIDE_POINTS + FLOOR_SEGMENTS - 1;

/** Monotone cubic (Fritsch–Carlson) interpolation, so the profile never overshoots. */
class MonotoneCubic {
  private readonly xs: number[];
  private readonly ys: number[];
  private readonly ms: number[];

  constructor(points: ProfilePoint[]) {
    this.xs = points.map((p) => p.s);
    this.ys = points.map((p) => p.z);
    const n = points.length;
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((this.ys[i + 1] - this.ys[i]) / (this.xs[i + 1] - this.xs[i]));
    const m = [d[0]];
    for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
    m.push(d[n - 2]);
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = m[i + 1] = 0;
        continue;
      }
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const h = a * a + b * b;
      if (h > 9) {
        const t = 3 / Math.sqrt(h);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
    this.ms = m;
  }

  private segment(x: number) {
    const xs = this.xs;
    let lo = 0;
    let hi = xs.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  value(x: number): number {
    const i = this.segment(x);
    const h = this.xs[i + 1] - this.xs[i];
    const t = (x - this.xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * this.ys[i] +
      (t3 - 2 * t2 + t) * h * this.ms[i] +
      (-2 * t3 + 3 * t2) * this.ys[i + 1] +
      (t3 - t2) * h * this.ms[i + 1]
    );
  }

  slope(x: number): number {
    const i = this.segment(x);
    const h = this.xs[i + 1] - this.xs[i];
    const t = (x - this.xs[i]) / h;
    const t2 = t * t;
    return (
      ((6 * t2 - 6 * t) * this.ys[i]) / h +
      (3 * t2 - 4 * t + 1) * this.ms[i] +
      ((-6 * t2 + 6 * t) * this.ys[i + 1]) / h +
      (3 * t2 - 2 * t) * this.ms[i + 1]
    );
  }
}

const lerpWall = (a: WallShape, b: WallShape, t: number): WallShape => ({
  radius: a.radius + (b.radius - a.radius) * t,
  height: a.height + (b.height - a.height) * t,
});

/** Points of one wall, from the floor edge outward. y is measured outward from the centre. */
function wallPoints(shape: WallShape, halfWidth: number): { y: number; z: number; part: CrossPart }[] {
  const { radius: r, height: h } = shape;
  const phiMax = h <= r ? Math.acos(1 - h / r) : Math.PI / 2;
  const pts: { y: number; z: number; part: CrossPart }[] = [];
  for (let k = 0; k <= ARC_SEGMENTS; k++) {
    const phi = (phiMax * k) / ARC_SEGMENTS;
    pts.push({ y: halfWidth + r * Math.sin(phi), z: r * (1 - Math.cos(phi)), part: k === 0 ? 'floor' : 'wall' });
  }
  const top = pts[pts.length - 1];
  for (let k = 1; k <= VERTICAL_SEGMENTS; k++) {
    pts.push({ y: top.y, z: top.z + ((h - top.z) * k) / VERTICAL_SEGMENTS, part: 'wall' });
  }
  pts.push({ y: top.y + LIP_WIDTH, z: h, part: 'lip' });
  return pts;
}

export class Track {
  readonly step = 0.5;
  readonly length = TRACK_LENGTH;
  readonly stations: Station[] = [];
  private readonly profile = new MonotoneCubic(PROFILE);

  constructor() {
    const n = Math.round(this.length / this.step);
    let x = 0;
    let y = 0;
    for (let i = 0; i <= n; i++) {
      const s = Math.min(i * this.step, this.length);
      if (i > 0) {
        const hMid = this.heading(s - this.step / 2);
        x += this.step * Math.cos(hMid);
        y += this.step * Math.sin(hMid);
      }
      this.stations.push(this.makeStation(s, [x, y, this.elevation(s)]));
    }
  }

  private makeStation(s: number, pos: Vec3): Station {
    const heading = this.heading(s);
    const grade = this.grade(s);
    const forward = normalize([Math.cos(heading), Math.sin(heading), grade]);
    const left: Vec3 = [-Math.sin(heading), Math.cos(heading), 0];
    const up = normalize(cross(forward, left));
    return { s, pos, forward, left, up, heading, curvature: this.curvature(s), grade };
  }

  elevation(s: number): number {
    return this.profile.value(Math.min(Math.max(s, 0), this.length));
  }

  grade(s: number): number {
    return this.profile.slope(Math.min(Math.max(s, 0), this.length));
  }

  /** Heading in radians, counter-clockwise from east. Bends use a raised-cosine curvature, so entries are smooth. */
  heading(s: number): number {
    let h = START_HEADING * DEG;
    for (const b of [...BENDS, ...DRIFTS]) {
      const t = Math.min(Math.max((s - b.s0) / (b.s1 - b.s0), 0), 1);
      h += b.turn * DEG * (t - Math.sin(2 * Math.PI * t) / (2 * Math.PI));
    }
    return h;
  }

  curvature(s: number): number {
    let k = 0;
    for (const b of [...BENDS, ...DRIFTS]) {
      if (s <= b.s0 || s >= b.s1) continue;
      const len = b.s1 - b.s0;
      const t = (s - b.s0) / len;
      k += (b.turn * DEG * (1 - Math.cos(2 * Math.PI * t))) / len;
    }
    return k;
  }

  /** Interpolated frame at any distance s. */
  frame(s: number): Station {
    const f = Math.min(Math.max(s, 0), this.length) / this.step;
    const i = Math.min(Math.floor(f), this.stations.length - 2);
    const t = f - i;
    const a = this.stations[i].pos;
    const b = this.stations[i + 1].pos;
    return this.makeStation(s, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, this.elevation(s)]);
  }

  section(s: number): Section {
    let floorWidth = FLOOR_WIDTH;
    let left = STRAIGHT_WALL;
    let right = STRAIGHT_WALL;
    let bend: Bend | null = null;
    let best = 0;
    let runoffLeft: 'snow' | 'straw' = 'snow';
    let runoffRight: 'snow' | 'straw' = 'snow';
    for (const b of BENDS) {
      const w = smoothstep(b.s0 - BEND_BLEND, b.s0, s) * (1 - smoothstep(b.s1, b.s1 + BEND_BLEND, s));
      if (w <= 0) continue;
      const outerLeft = b.turn < 0; // turning right pushes the rider up the left wall
      left = lerpWall(left, outerLeft ? b.outer : b.inner, w);
      right = lerpWall(right, outerLeft ? b.inner : b.outer, w);
      if (b.floorWidth) floorWidth += (b.floorWidth - floorWidth) * w;
      if (w > best) {
        best = w;
        bend = b;
      }
      if (b.runoff === 'straw' && w > 0.3) {
        if (outerLeft) runoffLeft = 'straw';
        else runoffRight = 'straw';
      }
    }
    const outerSide = bend ? (bend.turn < 0 ? 'left' : 'right') : null;
    return { floorWidth, left, right, bend, outerSide, runoffLeft, runoffRight };
  }

  /** Cross-section polyline from the right lip to the left lip (fixed number of points). */
  crossSection(s: number, section = this.section(s)): CrossPoint[] {
    const half = section.floorWidth / 2;
    const rightSide = wallPoints(section.right, half).map((p) => ({ ...p, y: -p.y }));
    const leftSide = wallPoints(section.left, half);
    const floor: { y: number; z: number; part: CrossPart }[] = [];
    for (let k = 1; k < FLOOR_SEGMENTS; k++) {
      floor.push({ y: -half + (section.floorWidth * k) / FLOOR_SEGMENTS, z: 0, part: 'floor' });
    }
    const pts = [...rightSide.reverse(), ...floor, ...leftSide];
    const centre = SIDE_POINTS - 1 + FLOOR_SEGMENTS / 2;
    const out: CrossPoint[] = [];
    let u = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) u += Math.hypot(pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
      out.push({ ...pts[i], u });
    }
    const u0 = out[centre].u;
    for (const p of out) p.u -= u0;
    return out;
  }

  /** World position of a point given in a station's local (lateral, up) frame. */
  toWorld(frame: Station, y: number, z: number): Vec3 {
    return add(add(frame.pos, scale(frame.left, y)), scale(frame.up, z));
  }

  zoneName(s: number): string {
    let name = ZONES[0].name;
    for (const z of ZONES) if (z.s0 <= s) name = z.name;
    return name;
  }
}
