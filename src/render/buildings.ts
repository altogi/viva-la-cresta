// St Moritz and Celerina as mapped in OpenStreetMap: each building becomes a plastered
// Engadin-style block with windows and a snow-covered roof, at its real position and size.

import * as THREE from 'three';
import { OSM_BUILDINGS, OSM_IDS, OSM_NEAR, type BoxBuilding } from '../track/osm';
import type { Terrain } from './terrain';
import { mulberry32 } from './util';

const FLOOR = 3;
const TIMBER = new THREE.Color('#9b7450');
/** OSM ids of the buildings beside Shuttlecock (one is the Olympia Bob Run's). */
const TRACKSIDE_HUTS = new Set([209032886, 209032907]);
const WINDOW_CELL = 3; // metres per window, horizontally and vertically

const FACADES = ['#f3eee4', '#efe6d2', '#e9dcc3', '#f1e1d3', '#e6e1d7', '#ede3c9', '#e8d6c6', '#f5f2ea'].map(
  (c) => new THREE.Color(c),
);

/** Accumulates non-indexed triangles with uvs and colours. */
export class MeshBuilder {
  positions: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: number[], ub: number[], uc: number[], color: THREE.Color) {
    for (const [p, uv] of [
      [a, ua],
      [b, ub],
      [c, uc],
    ] as const) {
      this.positions.push(p.x, p.y, p.z);
      this.uvs.push(uv[0], uv[1]);
      this.colors.push(color.r, color.g, color.b);
    }
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uv: number[][], color: THREE.Color) {
    this.tri(a, b, c, uv[0], uv[1], uv[2], color);
    this.tri(a, c, d, uv[0], uv[2], uv[3], color);
  }

  build(material: THREE.Material): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/** One window bay: plaster wall, a deep-set window with a white frame and a sill. */
function facadeTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  // Faint plaster texture.
  const rng = mulberry32(9);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${0.015 + rng() * 0.025})`;
    g.fillRect(rng() * size, rng() * size, 2, 2);
  }
  const w = size * 0.34;
  const h = size * 0.42;
  const x = (size - w) / 2;
  const y = size * 0.28;
  g.fillStyle = '#c9c2b6'; // reveal: windows sit deep in thick Engadin walls
  g.fillRect(x - 10, y - 10, w + 20, h + 20);
  g.fillStyle = '#f6f6f2';
  g.fillRect(x - 4, y - 4, w + 8, h + 8);
  const glass = g.createLinearGradient(0, y, 0, y + h);
  glass.addColorStop(0, '#5f7488');
  glass.addColorStop(1, '#2c3a48');
  g.fillStyle = glass;
  g.fillRect(x, y, w, h);
  g.fillStyle = '#f6f6f2';
  g.fillRect(x + w / 2 - 3, y, 6, h);
  g.fillRect(x, y + h * 0.4, w, 5);
  g.fillStyle = '#d9d3c7';
  g.fillRect(x - 12, y + h + 6, w + 24, 8); // sill
  // Wooden shutters either side.
  g.fillStyle = '#5a4634';
  g.fillRect(x - 10 - w * 0.36, y - 4, w * 0.34, h + 8);
  g.fillRect(x + w + 12, y - 4, w * 0.34, h + 8);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

interface Spec {
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  levels: number;
  roof: 'flat' | 'gabled' | 'hipped' | 'canopy' | 'spire';
  kind: string;
}

function specFromBox(b: BoxBuilding): Spec {
  const [x, y, angle, length, width, levelsTag, roofTag, kind] = b;
  const area = length * width;
  let levels = levelsTag > 0 ? levelsTag : 0;
  if (!levels) {
    if (kind === 'apartments' || kind === 'residential') levels = area > 450 ? 4 : 3;
    else if (kind === 'hotel') levels = area > 2000 ? 6 : 5;
    else if (['garage', 'garages', 'shed', 'roof', 'hut'].includes(kind)) levels = 1;
    else levels = area < 50 ? 1 : area < 220 ? 2 : 3;
  }
  let roof: Spec['roof'] = 'gabled';
  if (kind === 'roof') roof = 'canopy';
  else if (roofTag === 'f' || kind === 'commercial' || kind === 'industrial') roof = 'flat';
  else if (roofTag === 'h' || roofTag === 'm' || kind === 'hotel' || area > 700) roof = 'hipped';
  return { x, y, angle: (angle * Math.PI) / 180, length, width, levels, roof, kind };
}

/** Oriented box from an exact footprint (long axis along the longest edge). */
function boxFromFootprint(c: [number, number], p: [number, number][]): BoxBuilding {
  let best = { len: 0, a: 0 };
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i];
    const [bx, by] = p[(i + 1) % p.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len > best.len) best = { len, a: Math.atan2(by - ay, bx - ax) };
  }
  const ca = Math.cos(best.a);
  const sa = Math.sin(best.a);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y] of p) {
    const u = x * ca + y * sa;
    const v = -x * sa + y * ca;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  return [c[0] + uc * ca - vc * sa, c[1] + uc * sa + vc * ca, (best.a * 180) / Math.PI, u1 - u0, v1 - v0, 0, '', ''];
}

export function buildTownBuildings(terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  group.name = 'buildings';
  const walls = new MeshBuilder();
  const roofs = new MeshBuilder();
  const rng = mulberry32(1906);
  const special = new Set<number>(Object.values(OSM_IDS));
  const boxes: BoxBuilding[] = [
    ...OSM_BUILDINGS,
    ...OSM_NEAR.filter((b) => !special.has(b.id)).map((b) => {
      const box = boxFromFootprint(b.c, b.p);
      // The buildings right beside Shuttlecock are low timber huts, not apartment blocks.
      if (TRACKSIDE_HUTS.has(b.id)) box[7] = 'hut';
      return box;
    }),
  ];
  const snow = new THREE.Color('#f4f7fb');
  const eave = new THREE.Color('#6e5a48');
  for (const box of boxes) {
    const spec = specFromBox(box);
    const { minX, maxX, minY, maxY } = terrain.bounds;
    if (spec.x < minX || spec.x > maxX || spec.y < minY || spec.y > maxY) continue;
    if (spec.kind === 'church') {
      addChurch(walls, roofs, spec, terrain, snow);
      continue;
    }
    const facade = spec.kind === 'hut' ? TIMBER : FACADES[Math.floor(rng() * FACADES.length)];
    addBuilding(walls, roofs, spec, terrain, facade, snow, eave);
  }
  const facade = facadeTexture();
  group.add(walls.build(new THREE.MeshStandardMaterial({ map: facade, vertexColors: true, roughness: 0.9 })));
  group.add(roofs.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })));
  return group;
}

/** Corners of a footprint, counter-clockwise, in world (x, y). */
function corners(spec: Spec, grow = 0): [number, number][] {
  const ca = Math.cos(spec.angle);
  const sa = Math.sin(spec.angle);
  const hl = spec.length / 2 + grow;
  const hw = spec.width / 2 + grow;
  return [
    [-hl, -hw],
    [hl, -hw],
    [hl, hw],
    [-hl, hw],
  ].map(([u, v]) => [spec.x + u * ca - v * sa, spec.y + u * sa + v * ca]);
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

function addBuilding(
  walls: MeshBuilder,
  roofs: MeshBuilder,
  spec: Spec,
  terrain: Terrain,
  facade: THREE.Color,
  snow: THREE.Color,
  eave: THREE.Color,
): number {
  const c = corners(spec);
  // Sit on the lowest corner so the downhill side shows a plinth rather than floating.
  const ground = Math.min(...c.map(([x, y]) => terrain.height(x, y)));
  const base = ground - 0.5;
  const wallTop = ground + 0.6 + spec.levels * FLOOR;
  if (spec.roof === 'canopy') {
    addCanopy(roofs, spec, ground, snow, eave);
    return wallTop;
  }
  const pitch = spec.roof === 'flat' ? 0 : Math.tan((24 * Math.PI) / 180);
  const ridgeRise = (spec.width / 2) * pitch;
  // Walls, with gable triangles on the short ends of gabled roofs.
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = c[i];
    const [bx, by] = c[(i + 1) % 4];
    const len = Math.hypot(bx - ax, by - ay);
    const u1 = len / WINDOW_CELL;
    const v0 = (base - ground) / WINDOW_CELL;
    const v1 = (wallTop - ground) / WINDOW_CELL;
    walls.quad(v3(ax, ay, base), v3(bx, by, base), v3(bx, by, wallTop), v3(ax, ay, wallTop), [[0, v0], [u1, v0], [u1, v1], [0, v1]], facade);
    const shortEnd = i % 2 === 1;
    if (spec.roof === 'gabled' && shortEnd) {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      // Plaster above the windows: sample a blank strip of the texture.
      walls.tri(v3(ax, ay, wallTop), v3(bx, by, wallTop), v3(mx, my, wallTop + ridgeRise), [0.02, 0.02], [0.06, 0.02], [0.04, 0.06], facade);
    }
  }
  if (spec.roof === 'spire') {
    // A steep pyramid springing straight from the tower's eaves (no gap).
    const base = corners(spec, 0.3).map(([x, y]) => v3(x, y, wallTop));
    const tip = v3(spec.x, spec.y, wallTop + spec.width * 1.9);
    const slate = new THREE.Color('#4d5560');
    for (let i = 0; i < 4; i++) roofs.tri(base[i], base[(i + 1) % 4], tip, [0, 0], [1, 0], [0.5, 1], slate);
    roofs.quad(base[3], base[2], base[1], base[0], [[0, 0], [1, 0], [1, 1], [0, 1]], eave);
    return wallTop;
  }
  // Roof, with an overhang, its upper faces under snow.
  const o = corners(spec, 0.7);
  const eaveZ = wallTop - 0.7 * pitch;
  if (spec.roof === 'flat') {
    const z = wallTop + 0.3;
    roofs.quad(v3(o[0][0], o[0][1], z), v3(o[1][0], o[1][1], z), v3(o[2][0], o[2][1], z), v3(o[3][0], o[3][1], z), [[0, 0], [1, 0], [1, 1], [0, 1]], snow);
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = o[i];
      const [bx, by] = o[(i + 1) % 4];
      roofs.quad(v3(ax, ay, wallTop), v3(bx, by, wallTop), v3(bx, by, z), v3(ax, ay, z), [[0, 0], [1, 0], [1, 1], [0, 1]], eave);
    }
    return wallTop;
  }
  const ca = Math.cos(spec.angle);
  const sa = Math.sin(spec.angle);
  const ridgeZ = wallTop + ridgeRise + 0.05;
  const inset = spec.roof === 'hipped' ? Math.min(spec.width / 2, spec.length / 2 - 0.5) : -0.7;
  const r0: [number, number] = [spec.x - (spec.length / 2 - inset) * ca, spec.y - (spec.length / 2 - inset) * sa];
  const r1: [number, number] = [spec.x + (spec.length / 2 - inset) * ca, spec.y + (spec.length / 2 - inset) * sa];
  const R0 = v3(r0[0], r0[1], ridgeZ);
  const R1 = v3(r1[0], r1[1], ridgeZ);
  const E = o.map(([x, y]) => v3(x, y, eaveZ));
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  // Long slopes.
  roofs.quad(E[0], E[1], R1, R0, uv, snow);
  roofs.quad(E[2], E[3], R0, R1, uv, snow);
  if (spec.roof === 'hipped') {
    roofs.tri(E[1], E[2], R1, [0, 0], [1, 0], [0.5, 1], snow);
    roofs.tri(E[3], E[0], R0, [0, 0], [1, 0], [0.5, 1], snow);
  }
  // Dark eave fascia so roofs read against white walls.
  for (let i = 0; i < 4; i++) {
    const a = E[i];
    const b = E[(i + 1) % 4];
    roofs.quad(a.clone().setY(a.y - 0.25), b.clone().setY(b.y - 0.25), b, a, uv, eave);
  }
  return wallTop;
}

function addCanopy(roofs: MeshBuilder, spec: Spec, ground: number, snow: THREE.Color, eave: THREE.Color) {
  const c = corners(spec);
  const z = ground + 2.6;
  roofs.quad(v3(c[0][0], c[0][1], z), v3(c[1][0], c[1][1], z), v3(c[2][0], c[2][1], z), v3(c[3][0], c[3][1], z), [[0, 0], [1, 0], [1, 1], [0, 1]], snow);
  for (const [x, y] of c) {
    const a = v3(x - 0.1, y - 0.1, ground);
    const b = v3(x + 0.1, y - 0.1, ground);
    const top = z;
    roofs.quad(a, b, b.clone().setY(top), a.clone().setY(top), [[0, 0], [1, 0], [1, 1], [0, 1]], eave);
  }
}

/** Nave with a steep roof and a bell tower with a spire at one end. */
function addChurch(walls: MeshBuilder, roofs: MeshBuilder, spec: Spec, terrain: Terrain, snow: THREE.Color) {
  const white = new THREE.Color('#f2efe8');
  const nave: Spec = { ...spec, length: spec.length * 0.78, levels: 3, roof: 'gabled' };
  const ca = Math.cos(spec.angle);
  const sa = Math.sin(spec.angle);
  const shift = spec.length * 0.11;
  nave.x = spec.x + shift * ca;
  nave.y = spec.y + shift * sa;
  addBuilding(walls, roofs, nave, terrain, white, snow, new THREE.Color('#5b4c42'));
  const side = Math.min(spec.width * 0.55, 7);
  const tower: Spec = {
    ...spec,
    x: spec.x - (spec.length / 2 - side / 2) * ca,
    y: spec.y - (spec.length / 2 - side / 2) * sa,
    length: side,
    width: side,
    levels: 7,
    roof: 'spire',
  };
  addBuilding(walls, roofs, tower, terrain, white, snow, new THREE.Color('#5b4c42'));
}
