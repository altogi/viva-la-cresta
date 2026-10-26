// The ice surface across the run, parameterised by arc length u (+ left) from the floor centre.
// Analytic version of the cross-section in track.ts: floor, then a circular arc of radius r up each
// wall, then (if the wall is taller than r) a vertical face up to the lip.

import type { Section } from './track';
import type { WallShape } from '../track/cresta';

export interface SurfacePoint {
  /** Lateral offset (m, + left) and height above the floor (m). */
  y: number;
  z: number;
  /** Unit tangent in the (lateral, up) plane, pointing towards +u. */
  ty: number;
  tz: number;
  /** Unit normal pointing out of the ice (into the channel / up). */
  ny: number;
  nz: number;
  /** Curvature of the cross-section at this point (1/m, positive = concave). */
  curvature: number;
  /** Wall angle from horizontal (rad). */
  angle: number;
}

/** Arc length from the floor centre to the lip of one wall. */
export function lipDistance(halfWidth: number, wall: WallShape): number {
  const { radius: r, height: h } = wall;
  if (h <= r) return halfWidth + r * Math.acos(1 - h / r);
  return halfWidth + (r * Math.PI) / 2 + (h - r);
}

export function lips(section: Section): { left: number; right: number } {
  const half = section.floorWidth / 2;
  return { left: lipDistance(half, section.left), right: -lipDistance(half, section.right) };
}

/** Surface point at arc length u. Beyond a lip, continues flat outward at lip height. */
export function surfaceAt(section: Section, u: number): SurfacePoint {
  const side = u >= 0 ? 1 : -1;
  const a = Math.abs(u);
  const half = section.floorWidth / 2;
  const wall = side > 0 ? section.left : section.right;
  const r = wall.radius;
  const h = wall.height;
  let y: number, z: number, ty: number, tz: number, curvature: number, angle: number;
  const phiMax = h <= r ? Math.acos(1 - h / r) : Math.PI / 2;
  const arcEnd = half + r * phiMax;
  const lip = lipDistance(half, wall);
  if (a <= half) {
    y = a; z = 0; ty = 1; tz = 0; curvature = 0; angle = 0;
  } else if (a <= arcEnd) {
    const phi = (a - half) / r;
    y = half + r * Math.sin(phi); z = r * (1 - Math.cos(phi));
    ty = Math.cos(phi); tz = Math.sin(phi); curvature = 1 / r; angle = phi;
  } else if (a <= lip) {
    y = half + r * Math.sin(phiMax); z = r * (1 - Math.cos(phiMax)) + (a - arcEnd);
    ty = 0; tz = 1; curvature = 0; angle = Math.PI / 2;
  } else {
    y = half + r * Math.sin(phiMax) + (a - lip); z = h;
    ty = 1; tz = 0; curvature = 0; angle = 0;
  }
  // Mirror for the right side: y flips, and moving towards +u means coming down that wall.
  if (side < 0) {
    y = -y;
    tz = -tz;
  }
  return { y, z, ty, tz, ny: -tz, nz: ty, curvature, angle };
}
