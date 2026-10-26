// The SMTC clubhouse at Junction (Annibale Fiocchi, 1962), built on its OpenStreetMap footprint:
// two white storeys wrapped in green-glass window bands with rounded corners on the run side,
// a roof terrace with steel railings, and the Tower: a third storey topped by a glazed,
// cantilevered cab with a flagpole. Plus the walkway across the run and the hut opposite.

import * as THREE from 'three';
import type { Track } from '../sim/track';
import { OSM_IDS, OSM_NEAR } from '../track/osm';
import type { Terrain } from './terrain';
import { MeshBuilder } from './buildings';

const FLOOR = 3.4;
type P = [number, number];

const mats = {
  plaster: new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.85 }),
  glass: new THREE.MeshStandardMaterial({ color: '#6f9c8a', roughness: 0.12, metalness: 0.35 }),
  frame: new THREE.MeshStandardMaterial({ color: '#fbfbf8', roughness: 0.6 }),
  steel: new THREE.MeshStandardMaterial({ color: '#8d939a', roughness: 0.45, metalness: 0.6 }),
  dark: new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.7 }),
  red: new THREE.MeshStandardMaterial({ color: '#a8332b', roughness: 0.7 }),
  snow: new THREE.MeshStandardMaterial({ color: '#f5f8fc', roughness: 0.9 }),
};

export function buildClubhouse(track: Track, terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  group.name = 'clubhouse';
  const club = OSM_NEAR.find((b) => b.id === OSM_IDS.clubhouse)!;
  // OSM rings run clockwise here; walls want counter-clockwise (outside on the right).
  const ring: P[] = club.p.map(([x, y]) => [club.c[0] + x, club.c[1] + y] as P).reverse();
  const floorZ = trackFloorNear(track, club.c) - 0.2;
  const b = new Builders();

  // Two storeys: plaster spandrels and continuous glass bands that wrap the rounded corners.
  for (let f = 0; f < 2; f++) {
    const z = floorZ + f * FLOOR;
    b.walls(ring, f === 0 ? z - 1.5 : z, z + 0.9, 'plaster');
    b.walls(ring, z + 0.9, z + 2.6, 'glass', (n) => n[0] > -0.7); // no windows on the uphill (west) side
    b.walls(ring, z + 0.9, z + 2.6, 'plaster', (n) => n[0] <= -0.7);
    b.mullions(ring, z + 0.9, z + 2.6, 1.35, (n) => n[0] > -0.7);
    b.walls(ring, z + 2.6, z + FLOOR, 'plaster');
  }
  // Roof slab with a crisp fascia, snow on the terrace, steel railing round the edge.
  const roofZ = floorZ + 2 * FLOOR;
  const fascia = offset(ring, 0.15);
  b.walls(fascia, roofZ, roofZ + 0.4, 'frame');
  b.cap(fascia, roofZ + 0.4, 'snow');
  b.railing(offset(ring, 0.05), roofZ + 0.4, 1.05);

  // The Tower: a third storey over the south-west wing, then the glazed cab overhanging the terrace.
  const [cx, cy] = club.c;
  const tower: P[] = rect(cx - 8.7, cy - 6.5, cx - 3.2, cy - 0.7);
  b.walls(tower, roofZ + 0.4, roofZ + 3.2, 'plaster');
  b.cap(tower, roofZ + 3.2, 'plaster');
  const cab: P[] = rect(cx - 8.5, cy - 6.3, cx - 0.8, cy - 0.9);
  const cabZ = roofZ + 3.2;
  b.walls(cab, cabZ, cabZ + 0.35, 'frame');
  b.cap(cab, cabZ, 'plaster', true);
  b.walls(cab, cabZ + 0.35, cabZ + 1.95, 'glass');
  b.mullions(cab, cabZ + 0.35, cabZ + 1.95, 1.3);
  const cabRoof = offset(cab, 0.45);
  b.walls(cabRoof, cabZ + 1.95, cabZ + 2.3, 'dark');
  b.cap(cabRoof, cabZ + 2.3, 'snow');
  b.cap(cabRoof, cabZ + 1.95, 'dark', true);

  // Chimney on the terrace.
  b.box(cx - 1.5, cy + 1.2, 0.7, 0.7, roofZ + 0.4, roofZ + 2.4, 'plaster');

  // External stair with red treads up the south side to the terrace.
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const x = cx + 3.2 - t * 9.5;
    b.box(x, cy - 7.6, 0.62, 1.1, floorZ + t * 2 * FLOOR, floorZ + t * 2 * FLOOR + 0.12, 'red');
  }
  b.railingLine([cx + 3.2, cy - 8.2], [cx - 6.3, cy - 8.2], floorZ, roofZ, 1.0);

  group.add(...b.meshes());
  group.add(signs(cx, cy, roofZ));
  group.add(flagpole(cx - 8.3, cy - 6.1, cabZ + 2.3));
  group.add(buildWalkwayAndHut(track, terrain, floorZ));
  return group;
}

/** Elevation of the track floor nearest to a point. */
function trackFloorNear(track: Track, [x, y]: P): number {
  let best = track.stations[0];
  let bestD = Infinity;
  for (const st of track.stations) {
    const d = Math.hypot(st.pos[0] - x, st.pos[1] - y);
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  return best.pos[2];
}

const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Push a counter-clockwise ring outward by d metres. */
function offset(ring: P[], d: number): P[] {
  const n = ring.length;
  return ring.map((p, i) => {
    const a = ring[(i - 1 + n) % n];
    const b = ring[(i + 1) % n];
    const n1 = outward(a, p);
    const n2 = outward(p, b);
    const nx = n1[0] + n2[0];
    const ny = n1[1] + n2[1];
    const len = Math.hypot(nx, ny) || 1;
    const k = d / Math.max(0.5, (nx * n1[0] + ny * n1[1]) / len);
    return [p[0] + (nx / len) * k, p[1] + (ny / len) * k] as P;
  });
}

/** Outward normal of a counter-clockwise edge a→b. */
function outward(a: P, b: P): P {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dy / len, -dx / len];
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

class Builders {
  private readonly parts: Record<keyof typeof mats, MeshBuilder> = {
    plaster: new MeshBuilder(),
    glass: new MeshBuilder(),
    frame: new MeshBuilder(),
    steel: new MeshBuilder(),
    dark: new MeshBuilder(),
    red: new MeshBuilder(),
    snow: new MeshBuilder(),
  };
  private readonly white = new THREE.Color('#ffffff');
  private readonly uv = [[0, 0], [1, 0], [1, 1], [0, 1]];

  walls(ring: P[], z0: number, z1: number, mat: keyof typeof mats, filter?: (n: P) => boolean) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-3) continue;
      if (filter && !filter(outward(a, b))) continue;
      this.parts[mat].quad(v3(a[0], a[1], z0), v3(b[0], b[1], z0), v3(b[0], b[1], z1), v3(a[0], a[1], z1), this.uv, this.white);
    }
  }

  /** Thin white frames on a glass band, at every corner and every `spacing` metres along each edge. */
  mullions(ring: P[], z0: number, z1: number, spacing: number, filter?: (n: P) => boolean) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-3 || (filter && !filter(outward(a, b)))) continue;
      const n = outward(a, b);
      const count = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k < count; k++) {
        const t = k / count;
        const x = a[0] + (b[0] - a[0]) * t + n[0] * 0.03;
        const y = a[1] + (b[1] - a[1]) * t + n[1] * 0.03;
        const dx = ((b[0] - a[0]) / len) * 0.05;
        const dy = ((b[1] - a[1]) / len) * 0.05;
        this.parts.frame.quad(v3(x - dx, y - dy, z0), v3(x + dx, y + dy, z0), v3(x + dx, y + dy, z1), v3(x - dx, y - dy, z1), this.uv, this.white);
      }
    }
  }

  /** Horizontal cap over a ring (fan triangulation; fine for these near-convex outlines). */
  cap(ring: P[], z: number, mat: keyof typeof mats, underside = false) {
    const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
    const tris = THREE.ShapeUtils.triangulateShape(shape.getPoints(), []);
    for (const [i, j, k] of tris) {
      const [a, b, c] = [ring[i], ring[j], ring[k]];
      // Counter-clockwise from above faces up; reverse for an underside.
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      const ccw = area > 0 ? [a, b, c] : [a, c, b];
      const ordered = underside ? [ccw[0], ccw[2], ccw[1]] : ccw;
      this.parts[mat].tri(v3(ordered[0][0], ordered[0][1], z), v3(ordered[1][0], ordered[1][1], z), v3(ordered[2][0], ordered[2][1], z), [0, 0], [1, 0], [0, 1], this.white);
    }
  }

  box(x: number, y: number, w: number, d: number, z0: number, z1: number, mat: keyof typeof mats) {
    const ring = rect(x - w / 2, y - d / 2, x + w / 2, y + d / 2);
    this.walls(ring, z0, z1, mat);
    this.cap(ring, z1, mat);
  }

  railing(ring: P[], z: number, height: number) {
    for (let i = 0; i < ring.length; i++) this.railingLine(ring[i], ring[(i + 1) % ring.length], z, z, height);
  }

  /** Posts and two rails between a (at height za) and b (at zb). */
  railingLine(a: P, b: P, za: number, zb: number, height: number) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.2) return;
    const posts = Math.max(1, Math.round(len / 1.6));
    for (let k = 0; k <= posts; k++) {
      const t = k / posts;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      const z = za + (zb - za) * t;
      this.box(x, y, 0.05, 0.05, z, z + height, 'steel');
    }
    for (const h of [height * 0.5, height]) {
      const n = outward(a, b);
      const w = 0.025;
      this.parts.steel.quad(
        v3(a[0] + n[0] * w, a[1] + n[1] * w, za + h - 0.04),
        v3(b[0] + n[0] * w, b[1] + n[1] * w, zb + h - 0.04),
        v3(b[0] + n[0] * w, b[1] + n[1] * w, zb + h),
        v3(a[0] + n[0] * w, a[1] + n[1] * w, za + h),
        this.uv,
        this.white,
      );
      this.parts.steel.quad(
        v3(b[0] - n[0] * w, b[1] - n[1] * w, zb + h - 0.04),
        v3(a[0] - n[0] * w, a[1] - n[1] * w, za + h - 0.04),
        v3(a[0] - n[0] * w, a[1] - n[1] * w, za + h),
        v3(b[0] - n[0] * w, b[1] - n[1] * w, zb + h),
        this.uv,
        this.white,
      );
    }
  }

  meshes(): THREE.Mesh[] {
    return (Object.keys(this.parts) as (keyof typeof mats)[])
      .filter((k) => this.parts[k].positions.length)
      .map((k) => this.parts[k].build(mats[k]));
  }
}

/** "CRESTA RUN" lettering with its red and yellow bars, on the run-side fascia. */
function signs(cx: number, cy: number, roofZ: number): THREE.Object3D {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, 1024, 128);
  g.fillStyle = '#2b3a67';
  g.font = 'bold 92px Futura, "Century Gothic", "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('CRESTA RUN', 512, 68);
  for (const x of [70, 834]) {
    g.fillStyle = '#c0392b';
    g.fillRect(x, 50, 120, 14);
    g.fillStyle = '#e8b33a';
    g.fillRect(x, 66, 120, 14);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.7), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  // East face (towards the run), just below the roof slab.
  sign.position.copy(v3(cx + 4.42, cy + 2.2, roofZ - 0.42));
  sign.rotation.y = Math.PI / 2;
  return sign;
}

function flagpole(x: number, y: number, z: number): THREE.Object3D {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 6, 8), mats.steel);
  pole.position.copy(v3(x, y, z + 3));
  const bar = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 0.12), mats.steel);
  bar.position.copy(v3(x + 2.6, y + 2.4, z + 0.5));
  g.add(pole, bar);
  return g;
}

/** The steel walkway over the run just above Junction, and the hut on the far side. */
function buildWalkwayAndHut(track: Track, terrain: Terrain, floorZ: number): THREE.Object3D {
  const group = new THREE.Group();
  const b = new Builders();
  const walk = OSM_NEAR.find((x) => x.id === OSM_IDS.junctionWalkway)!;
  const xs = walk.p.map(([x]) => walk.c[0] + x);
  const y = walk.c[1] + 0.3;
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const deckZ = floorZ + 3.2;
  b.walls(rect(x0, y - 0.8, x1, y + 0.8), deckZ - 0.25, deckZ, 'steel');
  b.cap(rect(x0, y - 0.8, x1, y + 0.8), deckZ, 'snow');
  b.railingLine([x0, y - 0.8], [x1, y - 0.8], deckZ, deckZ, 1.05);
  b.railingLine([x1, y + 0.8], [x0, y + 0.8], deckZ, deckZ, 1.05);

  const hut = OSM_NEAR.find((x) => x.id === OSM_IDS.junctionHut)!;
  const ring: P[] = hut.p.map(([x, yy]) => [hut.c[0] + x, hut.c[1] + yy] as P);
  const area = ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0);
  if (area < 0) ring.reverse();
  const ground = Math.min(trackFloorNear(track, hut.c), ...ring.map(([x, yy]) => terrain.height(x, yy))) - 0.3;
  b.walls(ring, ground, ground + 1.2, 'plaster');
  b.walls(ring, ground + 1.2, ground + 2.5, 'glass', (n) => n[0] < 0.7);
  b.walls(ring, ground + 1.2, ground + 2.5, 'plaster', (n) => n[0] >= 0.7);
  b.walls(ring, ground + 2.5, ground + 3.4, 'plaster');
  const roof = offset(ring, 0.3);
  b.walls(roof, ground + 3.4, ground + 3.7, 'frame');
  b.cap(roof, ground + 3.7, 'snow');
  group.add(...b.meshes());
  return group;
}
