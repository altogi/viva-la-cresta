// Everything around the ice: mountains, pines, the village, the Top hut, the Junction
// clubhouse, bridges, timing eyes, the straw and padding beyond Shuttlecock, the finish.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '../sim/track';
import { BENDS, JUNCTION_S, LANDMARKS, TRACK_LENGTH } from '../track/cresta';
import type { Terrain } from './terrain';
import { colors, mulberry32, toThree, valueNoise } from './util';

const mat = (color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...opts });

export function buildScenery(track: Track, terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scenery';
  const ctx = new Placer(track, terrain);
  group.add(buildMountains(terrain));
  group.add(buildTrees(track, terrain));
  group.add(buildVillages(ctx));
  group.add(buildTopHut(ctx));
  group.add(buildClubhouse(ctx));
  for (const lm of LANDMARKS) {
    if (lm.kind === 'bridge') group.add(buildBridge(ctx, lm.s, lm.name));
    if (lm.kind === 'timing' || lm.kind === 'start') group.add(buildTimingEye(ctx, lm.s));
  }
  group.add(buildFinish(ctx));
  group.add(buildShuttlecockRunoff(ctx));
  return group;
}

/** Positions objects relative to the run. */
class Placer {
  constructor(
    readonly track: Track,
    readonly terrain: Terrain,
  ) {}

  /** World point at distance s, `lateral` metres to the left of the centreline, on the ground. */
  ground(s: number, lateral: number, lift = 0): THREE.Vector3 {
    const st = this.track.frame(s);
    const x = st.pos[0] + st.left[0] * lateral;
    const y = st.pos[1] + st.left[1] * lateral;
    return new THREE.Vector3(x, this.terrain.height(x, y) + lift, -y);
  }

  /** World point in the track's own frame (y lateral, z above the floor). */
  local(s: number, lateral: number, up: number): THREE.Vector3 {
    const st = this.track.frame(s);
    return toThree(this.track.toWorld(st, lateral, up));
  }

  heading(s: number) {
    return this.track.heading(s);
  }

  /** Outermost lateral extent of the cross-section at s, on each side. */
  extent(s: number): { left: number; right: number; height: number } {
    const pts = this.track.crossSection(s);
    return {
      right: pts[0].y,
      left: pts[pts.length - 1].y,
      height: Math.max(pts[0].z, pts[pts.length - 1].z),
    };
  }
}

function buildMountains(terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(42);
  const { minX, maxX, minY, maxY } = terrain.bounds;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, fog: true });
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 46; i++) {
    const angle = (i / 46) * Math.PI * 2 + rng() * 0.1;
    const dist = 4800 + rng() * 3000;
    const height = 450 + rng() * 800;
    const radius = 900 + rng() * 900;
    const geo = new THREE.ConeGeometry(radius, height, 7 + Math.floor(rng() * 3), 4);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) {
      const yy = pos.getY(k);
      const h01 = (yy + height / 2) / height;
      if (h01 < 0.98) {
        pos.setX(k, pos.getX(k) * (0.85 + rng() * 0.3));
        pos.setZ(k, pos.getZ(k) * (0.85 + rng() * 0.3));
        pos.setY(k, yy + (rng() - 0.5) * height * 0.08);
      }
      const snowLine = 0.45 + rng() * 0.1;
      c.copy(h01 > snowLine ? colors.snow : colors.rock);
      col.set([c.r, c.g, c.b], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.translate(cx + Math.cos(angle) * dist, height / 2 - 120, -(cy + Math.sin(angle) * dist));
    geos.push(geo.toNonIndexed());
  }
  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  group.add(new THREE.Mesh(merged, material));
  return group;
}

function pineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers = [
    { r: 2.4, h: 4.2, y: 2.8 },
    { r: 1.8, h: 3.6, y: 5.0 },
    { r: 1.1, h: 3.0, y: 7.0 },
  ];
  for (const t of tiers) parts.push(new THREE.ConeGeometry(t.r, t.h, 7).translate(0, t.y, 0).toNonIndexed());
  return mergeGeometries(parts);
}

function buildTrees(track: Track, terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(1884);
  const forest = valueNoise(3);
  const { minX, maxX, minY, maxY } = terrain.bounds;
  const foliage = pineGeometry();
  const trunk = new THREE.CylinderGeometry(0.25, 0.35, 1.6, 6).translate(0, 0.8, 0);
  const matrices: THREE.Matrix4[] = [];
  const tints: THREE.Color[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let attempts = 0;
  while (matrices.length < 1400 && attempts++ < 40000) {
    const x = minX + rng() * (maxX - minX);
    const y = minY + rng() * (maxY - minY);
    const density = forest(x / 140, y / 140);
    if (density < 0.05 && rng() > 0.04) continue;
    const { distance } = terrain.distanceToTrack(x, y);
    if (distance < 14) continue;
    const z = terrain.height(x, y);
    const s = 0.7 + rng() * 0.9;
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, z - 0.2, -y), q, new THREE.Vector3(s, s * (0.9 + rng() * 0.3), s));
    matrices.push(m.clone());
    tints.push(colors.pine.clone().lerp(colors.pineLight, rng()));
  }
  // Pines also line the run in places, as in the photographs.
  for (let s = 20; s < TRACK_LENGTH; s += 9) {
    for (const side of [-1, 1]) {
      if (rng() < 0.55) continue;
      const st = track.frame(s);
      const lateral = side * (16 + rng() * 14);
      const x = st.pos[0] + st.left[0] * lateral;
      const y = st.pos[1] + st.left[1] * lateral;
      if (terrain.distanceToTrack(x, y).distance < 14) continue;
      const k = 0.6 + rng() * 0.7;
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      m.compose(new THREE.Vector3(x, terrain.height(x, y) - 0.2, -y), q, new THREE.Vector3(k, k, k));
      matrices.push(m.clone());
      tints.push(colors.pine.clone().lerp(colors.pineLight, rng()));
    }
  }
  const leaves = new THREE.InstancedMesh(foliage, mat('#ffffff'), matrices.length);
  const trunks = new THREE.InstancedMesh(trunk, mat(colors.trunk), matrices.length);
  matrices.forEach((mm, i) => {
    leaves.setMatrixAt(i, mm);
    leaves.setColorAt(i, tints[i]);
    trunks.setMatrixAt(i, mm);
  });
  group.add(leaves, trunks);
  return group;
}

function houseGeometry(): { body: THREE.BufferGeometry; roof: THREE.BufferGeometry } {
  const body = new THREE.BoxGeometry(8, 7, 10).translate(0, 3.5, 0);
  // Gable roof: a triangular prism along the house's length.
  const roof = new THREE.CylinderGeometry(6.2, 6.2, 11, 3, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  roof.scale(1, 0.55, 1).translate(0, 8.6, 0);
  return { body, roof };
}

function buildVillages(ctx: Placer): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(1887);
  const { body, roof } = houseGeometry();
  const facades = ['#e9dcc0', '#f2e6cf', '#e6c9a8', '#d8a48f', '#f0efe9', '#cfd8c4', '#e8b4a0'].map((c) => new THREE.Color(c));
  const clusters = [
    // St Moritz above the Top, Celerina at the bottom, a few chalets on the way.
    { s: 0, lateral: 120, count: 70, spread: 110 },
    { s: 120, lateral: 160, count: 30, spread: 80 },
    { s: TRACK_LENGTH, lateral: -150, count: 60, spread: 120 },
    { s: 900, lateral: -170, count: 18, spread: 70 },
    { s: 450, lateral: 140, count: 10, spread: 50 },
  ];
  const mats: THREE.Matrix4[] = [];
  const tints: THREE.Color[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const c of clusters) {
    const centre = ctx.ground(c.s, c.lateral);
    for (let i = 0; i < c.count; i++) {
      const x = centre.x + (rng() - 0.5) * c.spread * 2;
      const y = -centre.z + (rng() - 0.5) * c.spread * 2;
      if (ctx.terrain.distanceToTrack(x, y).distance < 30) continue;
      const k = 0.8 + rng() * 0.7;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ctx.heading(c.s) + (rng() < 0.5 ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.3);
      m.compose(new THREE.Vector3(x, ctx.terrain.height(x, y) - 0.5, -y), q, new THREE.Vector3(k, k * (0.8 + rng() * 0.6), k));
      mats.push(m.clone());
      tints.push(facades[Math.floor(rng() * facades.length)]);
    }
  }
  const bodies = new THREE.InstancedMesh(body, mat('#ffffff'), mats.length);
  const roofs = new THREE.InstancedMesh(roof, mat('#5b4a44'), mats.length);
  mats.forEach((mm, i) => {
    bodies.setMatrixAt(i, mm);
    bodies.setColorAt(i, tints[i]);
    roofs.setMatrixAt(i, mm);
  });
  bodies.castShadow = roofs.castShadow = true;
  group.add(bodies, roofs);
  return group;
}

function signTexture(text: string, bg: string, fg: string, width = 512, height = 96, font = 'bold 56px Georgia, serif') {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, width, height);
  g.fillStyle = fg;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, width / 2, height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The ornate wooden pavilion at Top, behind the start, on the run's left. */
function buildTopHut(ctx: Placer): THREE.Group {
  const hut = new THREE.Group();
  const wood = mat(colors.wood);
  const dark = mat(colors.woodDark);
  const glass = mat('#2d3e52', { roughness: 0.2, metalness: 0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 1.2, 8), dark);
  base.position.y = 0.6;
  const walls = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3.6, 8), wood);
  walls.position.y = 3;
  const windows = new THREE.Mesh(new THREE.CylinderGeometry(4.05, 4.05, 1.8, 8, 1, true), glass);
  windows.position.y = 3.3;
  const eaves = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 0.3, 8), dark);
  eaves.position.y = 4.9;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 3.2, 8), mat('#3f4a5a'));
  roof.position.y = 6.6;
  const snowCap = new THREE.Mesh(new THREE.ConeGeometry(4.2, 2.2, 8), mat(colors.snow));
  snowCap.position.y = 7.1;
  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.6, 6), dark);
  finial.position.y = 8.8;
  for (const part of [base, walls, windows, eaves, roof, snowCap, finial]) {
    part.castShadow = true;
    hut.add(part);
  }
  hut.position.copy(ctx.ground(0, 9, -0.3));
  const st = ctx.track.frame(0);
  hut.position.x -= st.forward[0] * 10;
  hut.position.z += st.forward[1] * 10;
  hut.position.y = ctx.track.elevation(0) + 0.2;
  hut.rotation.y = ctx.heading(0);
  // A level snow platform for the start area and the waiting riders.
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(16, 18, 3, 12), mat(colors.snow, { flatShading: false }));
  platform.position.set(0, -1.6, -4);
  platform.receiveShadow = true;
  hut.add(platform);
  return hut;
}

/** The white Cresta Run clubhouse at Junction, with its tower and SMTC gate. */
function buildClubhouse(ctx: Placer): THREE.Group {
  const house = new THREE.Group();
  const white = mat('#f3f3ef');
  const glass = mat('#3b5876', { roughness: 0.15, metalness: 0.4 });
  const lower = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 7), white);
  lower.position.y = 2;
  const band = new THREE.Mesh(new THREE.BoxGeometry(14.1, 1.6, 7.1), glass);
  band.position.y = 2.2;
  const upper = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 6), white);
  upper.position.y = 5.5;
  const upperBand = new THREE.Mesh(new THREE.BoxGeometry(12.1, 1.4, 6.1), glass);
  upperBand.position.y = 5.4;
  const tower = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.6, 4), white);
  tower.position.set(-2, 8.3, 0);
  const towerGlass = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.2, 4.1), glass);
  towerGlass.position.set(-2, 8.4, 0);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 0.9),
    new THREE.MeshBasicMaterial({ map: signTexture('CRESTA RUN', '#f3f3ef', '#1d2430') }),
  );
  sign.position.set(0, 4.35, 3.06);
  for (const part of [lower, band, upper, upperBand, tower, towerGlass, sign]) {
    part.castShadow = true;
    house.add(part);
  }
  // Orange SMTC gate panels by the entrance.
  const logo = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}icon.svg`);
  logo.colorSpace = THREE.SRGBColorSpace;
  for (const dx of [-0.8, 0.8]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: logo }));
    panel.position.set(5 + dx, 1.2, 4.6);
    house.add(panel);
  }
  // Junction is on the run's right, facing the ice.
  const ext = ctx.extent(JUNCTION_S);
  house.position.copy(ctx.ground(JUNCTION_S + 6, ext.right - 16));
  house.rotation.y = ctx.heading(JUNCTION_S) + Math.PI;
  return house;
}

function buildBridge(ctx: Placer, s: number, name: string): THREE.Group {
  const bridge = new THREE.Group();
  const ext = ctx.extent(s);
  const span = ext.left - ext.right + 8;
  const clearance = Math.max(ext.height, 0.75) + 2.6;
  const isRail = name.startsWith('Railway');
  const deckMat = isRail ? mat('#5c5f66') : mat(colors.wood);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(isRail ? 5 : 3, 0.5, span), deckMat);
  deck.position.y = clearance;
  bridge.add(deck);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1, span), mat(colors.woodDark));
    rail.position.set(side * (isRail ? 2.4 : 1.4), clearance + 0.75, 0);
    bridge.add(rail);
    const abutment = new THREE.Mesh(new THREE.BoxGeometry(isRail ? 6 : 3.6, clearance + 2, 2.5), mat('#8e8a83'));
    abutment.position.set(0, clearance / 2 - 1, side * (span / 2 - 0.5));
    bridge.add(abutment);
  }
  bridge.traverse((o) => (o.castShadow = true));
  bridge.position.copy(ctx.local(s, (ext.left + ext.right) / 2, 0));
  bridge.rotation.y = ctx.heading(s);
  return bridge;
}

function buildTimingEye(ctx: Placer, s: number): THREE.Group {
  const eye = new THREE.Group();
  const ext = ctx.extent(s);
  for (const lateral of [ext.right - 0.4, ext.left + 0.4]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), mat('#4a4a4a'));
    post.position.copy(ctx.local(s, lateral, 0.75 + 0.7));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat('#d8d8d8'));
    box.position.copy(ctx.local(s, lateral, 0.75 + 1.5));
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#e0302a' }));
    lens.position.copy(ctx.local(s, lateral * 0.97, 0.75 + 1.5));
    eye.add(post, box, lens);
  }
  return eye;
}

function buildFinish(ctx: Placer): THREE.Group {
  const finish = new THREE.Group();
  const s = TRACK_LENGTH - 0.5;
  const ext = ctx.extent(s);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(ext.left - ext.right + 2, 1),
    new THREE.MeshBasicMaterial({ map: signTexture('FINISH', '#c8401c', '#ffffff'), side: THREE.DoubleSide }),
  );
  const width = ext.left - ext.right + 2;
  banner.position.set(0, 3.2, 0);
  banner.rotation.y = -Math.PI / 2;
  finish.add(banner);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.8, 0.25), mat('#c8401c'));
    post.position.set(0, 1.9, side * (width / 2));
    finish.add(post);
  }
  finish.position.copy(ctx.local(s, (ext.left + ext.right) / 2, 0));
  finish.rotation.y = ctx.heading(s);
  return finish;
}

/** Straw beyond Shuttlecock's lip, then tiers of red padding and a wooden fence. */
function buildShuttlecockRunoff(ctx: Placer): THREE.Group {
  const group = new THREE.Group();
  const bend = BENDS.find((b) => b.name === 'Shuttlecock')!;
  const rng = mulberry32(5);
  const pad = new THREE.BoxGeometry(2.4, 1.1, 0.7);
  const fence = new THREE.BoxGeometry(3.2, 2.0, 0.25);
  const padMats: THREE.Matrix4[] = [];
  const fenceMats: THREE.Matrix4[] = [];
  const bales: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let s = bend.s0 - 4; s < bend.s1 + 14; s += 2.3) {
    const ext = ctx.extent(s);
    const h = ctx.heading(s);
    q.setFromAxisAngle(up, h);
    for (const tier of [0, 1]) {
      const p = ctx.ground(s, ext.right - 9 - tier * 1.2, 0.55 + tier * 0.5);
      m.compose(p, q, new THREE.Vector3(1, 1, 1));
      padMats.push(m.clone());
    }
    const f = ctx.ground(s, ext.right - 12.5, 1.0);
    m.compose(f, q, new THREE.Vector3(1, 1, 1));
    fenceMats.push(m.clone());
    for (let k = 0; k < 3; k++) {
      const b = ctx.ground(s + rng() * 2, ext.right - 2 - rng() * 5, 0.05);
      q.setFromAxisAngle(up, rng() * Math.PI);
      m.compose(b, q, new THREE.Vector3(1 + rng(), 0.4 + rng() * 0.3, 1 + rng()));
      bales.push(m.clone());
    }
  }
  const pads = new THREE.InstancedMesh(pad, mat(colors.padding, { roughness: 0.6 }), padMats.length);
  padMats.forEach((mm, i) => pads.setMatrixAt(i, mm));
  const fences = new THREE.InstancedMesh(fence, mat('#d3a35b'), fenceMats.length);
  fenceMats.forEach((mm, i) => fences.setMatrixAt(i, mm));
  const straw = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.8, 0), mat(colors.straw, { roughness: 1 }), bales.length);
  bales.forEach((mm, i) => straw.setMatrixAt(i, mm));
  pads.castShadow = fences.castShadow = true;
  group.add(pads, fences, straw);
  return group;
}
