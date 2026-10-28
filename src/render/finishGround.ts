// The snow round the finish. The run-out ends in a tight hairpin with the finish hut inside it, and
// the hillside's 6 m grid can't follow ground that has to sit low in the run's channel and level just
// beyond its lip: so the inside of the bend gets its own fine sheet of snow, level with the
// embankment's crest from the lip outwards, tucking under the embankment where it ends. The hut, the
// riders by it and the visitors' path all stand on it (ground.ts).

import * as THREE from 'three';
import type { Station, Track } from '../sim/track';
import { lips } from '../sim/surface';
import { trackSurfaceHeight } from './trackMesh';
import { colors } from './util';

/** How far before the end of the run-out the sheet begins (m). */
export const FINISH_FROM = 70;
/** Its height above the run's floor alongside. */
const LEVEL = 0.55;
const STEP = 0.5;
/** How far beyond the lip it reaches before tucking under the embankment. */
const REACH = 13;

export class FinishGround {
  private readonly z: Float32Array;
  private readonly nx: number;
  private readonly ny: number;
  private readonly x0: number;
  private readonly y0: number;

  constructor(private readonly track: Track) {
    const end = track.length;
    const near = track.stations.filter((st) => st.s >= end - FINISH_FROM - 20);
    const xs = near.map((st) => st.pos[0]);
    const ys = near.map((st) => st.pos[1]);
    const pad = REACH + 6;
    this.x0 = Math.min(...xs) - pad;
    this.y0 = Math.min(...ys) - pad;
    this.nx = Math.ceil((Math.max(...xs) + pad - this.x0) / STEP) + 1;
    this.ny = Math.ceil((Math.max(...ys) + pad - this.y0) / STEP) + 1;
    this.z = new Float32Array(this.nx * this.ny).fill(NaN);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.z[j * this.nx + i] = this.sample(near, this.x0 + i * STEP, this.y0 + j * STEP);
      }
    }
  }

  /** The sheet's height at a grid point, or NaN where there is none (the channel, the outside of the bend, beyond the end). */
  private sample(near: Station[], x: number, y: number): number {
    const end = this.track.length;
    let st = near[0];
    let best = Infinity;
    let floor = 0;
    let weight = 0;
    for (const s of near) {
      const d2 = (s.pos[0] - x) ** 2 + (s.pos[1] - y) ** 2;
      if (d2 < best) {
        best = d2;
        st = s;
      }
      if (d2 < 144) {
        // The run's floor round about, smoothed, so the sheet doesn't step between the hairpin's legs.
        const w = 1 / (d2 + 1);
        floor += s.pos[2] * w;
        weight += w;
      }
    }
    if (st.s < end - FINISH_FROM) return NaN;
    if (st.s >= end - 0.01 && (x - st.pos[0]) * st.forward[0] + (y - st.pos[1]) * st.forward[1] > 0) return NaN;
    const lateral = (x - st.pos[0]) * st.left[0] + (y - st.pos[1]) * st.left[1];
    const lip = lips(this.track.section(st.s));
    const out = lateral - lip.left;
    // Only the inside of the bend (the left), from just under the lip.
    if (out < -0.05 || out > REACH) return NaN;
    const level = (weight ? floor / weight : st.pos[2]) + LEVEL;
    const h = trackSurfaceHeight(this.track, st.s, lateral);
    const under = h === null ? level - 0.6 : st.pos[2] + h - 0.15;
    const k = THREE.MathUtils.smoothstep(st.s, end - FINISH_FROM, end - FINISH_FROM + 15) * (1 - THREE.MathUtils.smoothstep(out, REACH - 4, REACH));
    return under + (level - under) * k;
  }

  /** Height of the sheet at world (x, y) (north = y), or null where there is none. */
  height(x: number, y: number): number | null {
    const fx = (x - this.x0) / STEP;
    const fy = (y - this.y0) / STEP;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.ny - 1) return null;
    const a = this.z[j * this.nx + i];
    const b = this.z[j * this.nx + i + 1];
    const c = this.z[(j + 1) * this.nx + i];
    const d = this.z[(j + 1) * this.nx + i + 1];
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) return null;
    const tx = fx - i;
    const ty = fy - j;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  build(): THREE.Mesh {
    const positions = new Float32Array(this.nx * this.ny * 3);
    const vertexColors = new Float32Array(this.nx * this.ny * 3);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        const z = this.z[k];
        positions[k * 3] = this.x0 + i * STEP;
        positions[k * 3 + 1] = Number.isNaN(z) ? 0 : z;
        positions[k * 3 + 2] = -(this.y0 + j * STEP);
        vertexColors[k * 3] = colors.snow.r;
        vertexColors[k * 3 + 1] = colors.snow.g;
        vertexColors[k * 3 + 2] = colors.snow.b;
      }
    }
    const index: number[] = [];
    for (let j = 0; j < this.ny - 1; j++) {
      for (let i = 0; i < this.nx - 1; i++) {
        const a = j * this.nx + i;
        const b = a + 1;
        const d = a + this.nx;
        const e = d + 1;
        if ([a, b, d, e].some((k) => Number.isNaN(this.z[k]))) continue;
        index.push(a, b, d, b, e, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
    mesh.name = 'finish-ground';
    mesh.receiveShadow = true;
    return mesh;
  }
}

const cache = new WeakMap<Track, FinishGround>();
export function finishGround(track: Track): FinishGround {
  let g = cache.get(track);
  if (!g) cache.set(track, (g = new FinishGround(track)));
  return g;
}
