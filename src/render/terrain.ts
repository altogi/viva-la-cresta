// Snowy hillside around the run. Near the track the ground follows the track's elevation;
// further out it blends into a noisy valley slope. A corridor along the track is cut out
// and covered by the track's embankment skirts.

import * as THREE from 'three';
import type { Station, Track } from '../sim/track';
import { TERRAIN_BASE, trackSurfaceHeight } from './trackMesh';
import { lips } from '../sim/surface';
import { finishGround } from './finishGround';
import { colors, valueNoise } from './util';
import { CUTTING_EDGE, CUTTING_FLAT, cuttingHeight, junctionTerrace, lipAt } from './places';
import { OSM_IDS, OSM_NEAR } from '../track/osm';

const CELL = 6;
const slopeTint = new THREE.Color('#c9d5e2');
const MARGIN = 450;
/** Terrain vertices closer than this to the centreline are cut out (m). */
const CORRIDOR = 6;
const BLEND_START = 16;
const BLEND_END = 140;
/** Round the huts the ground is level with their doors this far out, then eases back by PAD_EDGE. */
const PAD_FLAT = 5;
const PAD_EDGE = 18;

/** Spatial hash for nearest-centreline queries in the horizontal plane (reach ~70 m). */
export class TrackIndex {
  private readonly buckets = new Map<number, Station[]>();
  private readonly size = 24;
  private readonly reach = 3;

  constructor(track: Track) {
    track.stations.forEach((st, i) => {
      if (i % 2) return;
      const key = this.key(Math.floor(st.pos[0] / this.size), Math.floor(st.pos[1] / this.size));
      const list = this.buckets.get(key);
      if (list) list.push(st);
      else this.buckets.set(key, [st]);
    });
  }

  private key(bx: number, by: number) {
    return (bx + 5000) * 10007 + (by + 5000);
  }

  /** Nearest station and horizontal distance; Infinity when the run is far away. */
  nearest(x: number, y: number): { station: Station | null; distance: number } {
    const bx = Math.floor(x / this.size);
    const by = Math.floor(y / this.size);
    let best: Station | null = null;
    let bestD2 = Infinity;
    for (let dx = -this.reach; dx <= this.reach; dx++) {
      for (let dy = -this.reach; dy <= this.reach; dy++) {
        const list = this.buckets.get(this.key(bx + dx, by + dy));
        if (!list) continue;
        for (const st of list) {
          const ex = st.pos[0] - x;
          const ey = st.pos[1] - y;
          const d2 = ex * ex + ey * ey;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = st;
          }
        }
      }
    }
    return { station: best, distance: Math.sqrt(bestD2) };
  }
}

export class Terrain {
  readonly mesh: THREE.Mesh;
  private readonly index: TrackIndex;
  private readonly noise = valueNoise(7);
  private readonly detail = valueNoise(11);
  /** Least-squares plane through the centreline: the general valley slope. */
  private readonly plane: [number, number, number];
  private readonly centre: [number, number];
  private readonly leftDir: [number, number];
  readonly bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Level ground round the Junction hut and the finish hut: their footprints and the ground's height. */
  private readonly pads: { ring: [number, number][]; z: number; flat?: number; edge?: number }[] = [];

  /** Where the run ends: there is no embankment past it to cover a hole in the ground. */
  private readonly end: number;

  constructor(track: Track) {
    this.index = new TrackIndex(track);
    this.end = track.length;
    this.plane = fitPlane(track.stations);
    const first = track.stations[0].pos;
    const last = track.stations[track.stations.length - 1].pos;
    const len = Math.hypot(last[0] - first[0], last[1] - first[1]);
    this.centre = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
    this.leftDir = [-(last[1] - first[1]) / len, (last[0] - first[0]) / len];
    const xs = track.stations.map((s) => s.pos[0]);
    const ys = track.stations.map((s) => s.pos[1]);
    this.bounds = {
      minX: Math.min(...xs) - MARGIN,
      maxX: Math.max(...xs) + MARGIN,
      minY: Math.min(...ys) - MARGIN,
      maxY: Math.max(...ys) + MARGIN,
    };
    const hut = OSM_NEAR.find((b) => b.id === OSM_IDS.junctionHut)!;
    let floor = track.stations[0];
    for (const st of track.stations) {
      if (Math.hypot(st.pos[0] - hut.c[0], st.pos[1] - hut.c[1]) < Math.hypot(floor.pos[0] - hut.c[0], floor.pos[1] - hut.c[1])) floor = st;
    }
    // The hut's floor stands 0.3 m under the run's (as in clubhouse.ts), its door's sill 0.55 above that.
    this.pads.push({ ring: hut.p.map(([x, y]) => [hut.c[0] + x, hut.c[1] + y]), z: floor.pos[2] - 0.3 + 0.5 });
    // The riders' terrace in front of the hut's door, level with its sill.
    const terrace = junctionTerrace(track);
    const edge = (s: number, out: number): [number, number] => {
      const f = track.frame(s);
      const u = lipAt(track, s, terrace.side > 0 ? 'left' : 'right') + terrace.side * out;
      return [f.pos[0] + f.left[0] * u, f.pos[1] + f.left[1] * u];
    };
    const terraceRing: [number, number][] = [];
    for (let s = terrace.s0; s <= terrace.s1 + 1e-6; s += (terrace.s1 - terrace.s0) / 4) terraceRing.push(edge(s, terrace.out0));
    for (let s = terrace.s1; s >= terrace.s0 - 1e-6; s -= (terrace.s1 - terrace.s0) / 4) terraceRing.push(edge(s, terrace.out1));
    if (signedArea(terraceRing) < 0) terraceRing.reverse();
    this.pads.push({ ring: terraceRing, z: terrace.z });
    // The finish hut (see finishPlaces) stands on the run-out's bank: level the snow round it a little
    // above the bank, so the hut and the riders gathered at it stand on it rather than in it.
    const end = track.length;
    const st = track.frame(end - 10);
    const u = lipAt(track, end - 3, 'left') + 4.6;
    const c = [st.pos[0] + st.left[0] * u, st.pos[1] + st.left[1] * u];
    const ring: [number, number][] = [];
    for (const [a, b] of [[-1.7, -1.8], [1.7, -1.8], [1.7, 1.3], [-1.7, 1.3]]) {
      // x down the run, y away from it (towards the run is the hut's front, with the bench).
      ring.push([c[0] + st.forward[0] * a + st.left[0] * b, c[1] + st.forward[1] * a + st.left[1] * b]);
    }
    if (signedArea(ring) < 0) ring.reverse();
    // Level just round it, easing away over a wide margin, so no shelf stands out seen from the run.
    // Just over the embankment's crest beside the run, so the pad is the snow the hut and its riders stand on.
    this.pads.push({ ring, z: st.pos[2] + 0.64, flat: 2, edge: 14 });
    this.mesh = this.build(track);
  }

  /** Distance from the centreline, if within ~60 m. */
  distanceToTrack(x: number, y: number) {
    return this.index.nearest(x, y);
  }

  private hill(x: number, y: number) {
    const [a, b, c] = this.plane;
    const base = a + b * x + c * y;
    // The valley flank: ground climbs towards St Moritz on the run's left, falls away on its right.
    const side = (x - this.centre[0]) * this.leftDir[0] + (y - this.centre[1]) * this.leftDir[1];
    const flank = side > 0 ? 0.09 * side : 0.05 * side;
    return base + flank + 14 * this.noise(x / 160, y / 160) + 3 * this.detail(x / 35, y / 35);
  }

  private blend(x: number, y: number, station: Station | null, distance: number) {
    const far = this.hill(x, y);
    if (!station || distance >= BLEND_END) return far;
    // Sits just under the track's embankment skirts, which hide the corridor's ragged edge.
    // At Stable Junction the ground rises to the footbridge: the run runs in a cutting there.
    const cut = cuttingHeight(station.s) * (1 - THREE.MathUtils.smoothstep(distance, CUTTING_FLAT, CUTTING_EDGE));
    const near = station.pos[2] + Math.max(TERRAIN_BASE - 0.6, cut - 0.02);
    return this.level(x, y, near + (far - near) * THREE.MathUtils.smoothstep(distance, BLEND_START, BLEND_END));
  }

  /** Flatten the ground round the huts, so their doors open onto level snow. */
  private level(x: number, y: number, z: number) {
    for (const pad of this.pads) {
      const d = distanceToRing(x, y, pad.ring);
      const flat = pad.flat ?? PAD_FLAT;
      const edge = pad.edge ?? PAD_EDGE;
      if (d < edge) z += (pad.z - z) * (1 - THREE.MathUtils.smoothstep(d, flat, edge));
    }
    return z;
  }

  /** The heights at the mesh's grid points, once built (so placements sit on what is drawn). */
  private grid: { z: Float32Array; nx: number; ny: number } | null = null;

  /**
   * Ground height at any horizontal point: on the drawn mesh (its triangles cut the corners of the
   * smooth shape between grid points, and what stands on the ground must stand on those), or the
   * smooth shape itself before the mesh is built.
   */
  height(x: number, y: number): number {
    const g = this.grid;
    if (g) {
      const fx = (x - this.bounds.minX) / CELL;
      const fy = (y - this.bounds.minY) / CELL;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      if (i >= 0 && j >= 0 && i < g.nx - 1 && j < g.ny - 1) {
        const u = fx - i;
        const v = fy - j;
        const za = g.z[j * g.nx + i];
        const zb = g.z[j * g.nx + i + 1];
        const zd = g.z[(j + 1) * g.nx + i];
        const ze = g.z[(j + 1) * g.nx + i + 1];
        // The two triangles of the cell, as the mesh is wound: (a, b, d) and (b, e, d).
        return u + v <= 1 ? za + (zb - za) * u + (zd - za) * v : ze + (zd - ze) * (1 - u) + (zb - ze) * (1 - v);
      }
    }
    const { station, distance } = this.index.nearest(x, y);
    return this.blend(x, y, station, distance);
  }

  private build(track: Track): THREE.Mesh {
    const { minX, maxX, minY, maxY } = this.bounds;
    const nx = Math.ceil((maxX - minX) / CELL) + 1;
    const ny = Math.ceil((maxY - minY) / CELL) + 1;
    const positions = new Float32Array(nx * ny * 3);
    const vertexColors = new Float32Array(nx * ny * 3);
    const inside = new Uint8Array(nx * ny);
    // Ground past the end of the run, which must be drawn (with the cells reaching back to the run's end).
    const beyond = new Uint8Array(nx * ny);
    const c = new THREE.Color();
    const terrace = junctionTerrace(track);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = minX + i * CELL;
        const y = minY + j * CELL;
        const { station, distance } = this.index.nearest(x, y);
        const k = j * nx + i;
        const past = !!station && station.s >= this.end - 1e-3 && (x - station.pos[0]) * station.forward[0] + (y - station.pos[1]) * station.forward[1] > 0;
        beyond[k] = past ? 1 : 0;
        // Round the finish the run-out bends hard (a hairpin), and most of the ground there lies within
        // the corridor of one part of it or another: draw it all, kept under the ice where the run
        // passes over it, so the embankments always have snow beneath them.
        const finish = !!station && station.s > this.end - 70;
        // The riders' terrace by the Junction hut reaches into the corridor: the ground under it is
        // drawn too (else the sky shows through where the riders wait), on the hut's side of the run.
        const onTerrace =
          !!station &&
          station.s > terrace.s0 - CELL &&
          station.s < terrace.s1 + CELL &&
          ((x - station.pos[0]) * station.left[0] + (y - station.pos[1]) * station.left[1]) * terrace.side > 0;
        inside[k] = station && distance < CORRIDOR && !past && !finish && !onTerrace ? 1 : 0;
        let z = this.blend(x, y, station, distance);
        if (onTerrace && distance < CORRIDOR + CELL) {
          // Under the ice within a cell of the channel; beyond, just under the embankment.
          const lateral = (x - station!.pos[0]) * station!.left[0] + (y - station!.pos[1]) * station!.left[1];
          const lip = lips(track.section(station!.s));
          if (lateral < lip.left + CELL && lateral > lip.right - CELL) z = Math.min(z, station!.pos[2] - 0.3);
          else {
            const h = trackSurfaceHeight(track, station!.s, lateral);
            if (h !== null) z = Math.min(z, station!.pos[2] + h - 0.12);
          }
        }
        if (finish) {
          // Within a cell of the channel, under its ice (a cell reaching across it mustn't show through
          // the floor); beyond, just under the embankment where that is lower.
          const lateral = (x - station!.pos[0]) * station!.left[0] + (y - station!.pos[1]) * station!.left[1];
          const lip = lips(track.section(station!.s));
          if (lateral < lip.left + CELL && lateral > lip.right - CELL) z = Math.min(z, station!.pos[2] - 0.3);
          else {
            const h = trackSurfaceHeight(track, station!.s, lateral);
            if (h !== null) z = Math.min(z, station!.pos[2] + h - 0.12);
          }
          // And under the finish's own sheet of snow.
          const sheet = finishGround(track).height(x, y);
          if (sheet !== null) z = Math.min(z, sheet - 0.12);
        }
        positions[k * 3] = x;
        positions[k * 3 + 1] = z;
        positions[k * 3 + 2] = -y;
        c.copy(colors.snow).lerp(colors.snowShade, 0.5 + 0.5 * this.detail(x / 20, y / 20));
        vertexColors[k * 3] = c.r;
        vertexColors[k * 3 + 1] = c.g;
        vertexColors[k * 3 + 2] = c.b;
      }
    }
    // The ground's cut edge by the run tucks just under the embankment wherever that is lower, so the
    // ground rises out from under it rather than floating over it with an open edge.
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (inside[k]) continue;
        let edge = false;
        for (let dj = -1; dj <= 1 && !edge; dj++) {
          for (let di = -1; di <= 1 && !edge; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && inside[jj * nx + ii]) edge = true;
          }
        }
        if (!edge) continue;
        const x = positions[k * 3];
        const y = -positions[k * 3 + 2];
        const { station } = this.index.nearest(x, y);
        if (!station) continue;
        const lateral = (x - station.pos[0]) * station.left[0] + (y - station.pos[1]) * station.left[1];
        const h = trackSurfaceHeight(track, station.s, lateral);
        if (h !== null) positions[k * 3 + 1] = Math.min(positions[k * 3 + 1], station.pos[2] + h - 0.12);
      }
    }
    const heights = new Float32Array(nx * ny);
    for (let k = 0; k < nx * ny; k++) heights[k] = positions[k * 3 + 1];
    this.grid = { z: heights, nx, ny };
    const indices: number[] = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const d = a + nx;
        const e = d + 1;
        if ((inside[a] || inside[b] || inside[d] || inside[e]) && !(beyond[a] || beyond[b] || beyond[d] || beyond[e])) continue;
        // Grid rows run north (−z in Three.js); wind counter-clockwise seen from above.
        indices.push(a, b, d, b, e, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    // Slopes take a cooler, greyer tint than flat snow, so the ground has some shape to it.
    const normals = geometry.attributes.normal as THREE.BufferAttribute;
    for (let k = 0; k < nx * ny; k++) {
      const steep = Math.min(1, (1 - normals.getY(k)) * 3.5);
      c.setRGB(vertexColors[k * 3], vertexColors[k * 3 + 1], vertexColors[k * 3 + 2]).lerp(slopeTint, steep * 0.55);
      vertexColors[k * 3] = c.r;
      vertexColors[k * 3 + 1] = c.g;
      vertexColors[k * 3 + 2] = c.b;
    }
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
    );
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }
}

function signedArea(ring: [number, number][]) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

/** Distance from a point to a closed ring (0 inside it). */
function distanceToRing(x: number, y: number, ring: [number, number][]): number {
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(ax + ex * t - x, ay + ey * t - y));
  }
  return inside ? 0 : best;
}

function fitPlane(stations: Station[]): [number, number, number] {
  // Solve z = a + b x + c y by normal equations.
  let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  for (const st of stations) {
    const [x, y, z] = st.pos;
    n++; sx += x; sy += y; sz += z;
    sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z;
  }
  const m = [
    [n, sx, sy],
    [sx, sxx, sxy],
    [sy, sxy, syy],
  ];
  const r = [sz, sxz, syz];
  const det = (q: number[][]) =>
    q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) -
    q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) +
    q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
  const d = det(m);
  const col = (k: number) => m.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}
