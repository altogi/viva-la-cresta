// Everything around the ice: mountains, the real woods and buildings from OpenStreetMap, the Top hut,
// the Junction clubhouse, bridges, timing eyes, the straw and padding beyond Shuttlecock, the finish.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '../sim/track';
import { BENDS, LANDMARKS, TRACK_LENGTH } from '../track/cresta';
import { OSM_BUILDINGS, OSM_IDS, OSM_NEAR, OSM_TREES, OSM_WOODS } from '../track/osm';
import { buildTownBuildings } from './buildings';
import { buildClubhouse } from './clubhouse';
import { buildTopHut } from './topHut';
import type { Terrain } from './terrain';
import { colors, mulberry32, toThree } from './util';

const mat = (color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...opts });

export function buildScenery(track: Track, terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scenery';
  const ctx = new Placer(track, terrain);
  group.add(buildMountains(terrain));
  group.add(buildTrees(track, terrain));
  group.add(buildTownBuildings(terrain));
  group.add(buildTopArea(ctx));
  group.add(buildClubhouse(track, terrain));
  for (const lm of LANDMARKS) {
    // The Junction walkway is part of the clubhouse model.
    if (lm.kind === 'bridge' && lm.name !== 'Junction walkway') group.add(buildBridge(ctx, lm.s, lm.name));
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

/** A spruce: six drooping tiers tapering to a spire, the Engadin's commonest conifer. */
function pineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const radius = 2.5 * (1 - t) + 0.45;
    const height = 2.6 - t * 0.9;
    const y = 1.6 + t * 8.2;
    const cone = new THREE.ConeGeometry(radius, height, 9, 1, true).translate(0, y + height / 2, 0);
    // Pull the rim down a little so each tier droops like spruce boughs.
    const pos = cone.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) if (pos.getY(k) < y + 0.01) pos.setY(k, pos.getY(k) - 0.35);
    parts.push(cone.toNonIndexed());
  }
  parts.push(new THREE.ConeGeometry(0.3, 1.6, 6).translate(0, 11.2, 0).toNonIndexed());
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  return geo;
}

function insidePolygon(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Pines inside the woods mapped in OSM, the individually mapped trees, and a few strays on the meadows. */
function buildTrees(track: Track, terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(1884);
  const { minX, maxX, minY, maxY } = terrain.bounds;
  const spots: { x: number; y: number; scale: number; near: boolean }[] = [];
  const consider = (x: number, y: number, keepFar: number) => {
    if (x < minX || x > maxX || y < minY || y > maxY) return;
    const { distance } = terrain.distanceToTrack(x, y);
    if (distance < 12) return;
    if (distance > 260 && rng() > keepFar) return;
    spots.push({ x, y, scale: 0.75 + rng() * 0.8, near: distance < 140 });
  };
  for (const wood of OSM_WOODS) {
    const xs = wood.map((p) => p[0]);
    const ys = wood.map((p) => p[1]);
    const x0 = Math.max(Math.min(...xs), minX);
    const x1 = Math.min(Math.max(...xs), maxX);
    const y0 = Math.max(Math.min(...ys), minY);
    const y1 = Math.min(Math.max(...ys), maxY);
    if (x1 <= x0 || y1 <= y0) continue;
    const attempts = Math.min(6000, ((x1 - x0) * (y1 - y0)) / 55);
    for (let i = 0; i < attempts; i++) {
      const x = x0 + rng() * (x1 - x0);
      const y = y0 + rng() * (y1 - y0);
      if (insidePolygon(x, y, wood)) consider(x, y, 0.3);
    }
  }
  for (const [x, y] of OSM_TREES) consider(x, y, 1);
  // Spruces lining the run wherever there's no building, thicker on the upper part of the run.
  const buildings = [...OSM_BUILDINGS.map((b) => [b[0], b[1]]), ...OSM_NEAR.map((b) => b.c)];
  const clearOfBuildings = (x: number, y: number) => buildings.every(([bx, by]) => Math.hypot(bx - x, by - y) > 16);
  for (let s = 0; s < TRACK_LENGTH; s += 5) {
    for (const side of [-1, 1]) {
      if (rng() > (s < 330 ? 0.75 : 0.45)) continue;
      const st = track.frame(s);
      const lateral = side * (15 + rng() * 30);
      const x = st.pos[0] + st.left[0] * lateral;
      const y = st.pos[1] + st.left[1] * lateral;
      if (clearOfBuildings(x, y)) consider(x, y, 1);
    }
  }
  for (let i = 0; i < 2500; i++) {
    const x = minX + rng() * (maxX - minX);
    const y = minY + rng() * (maxY - minY);
    if (rng() < 0.12 && !OSM_WOODS.some((w) => insidePolygon(x, y, w))) consider(x, y, 0.5);
  }

  const detailed = pineGeometry();
  const simple = new THREE.ConeGeometry(2.3, 10.5, 7).translate(0, 5.8, 0);
  const trunk = new THREE.CylinderGeometry(0.2, 0.32, 2.2, 6).translate(0, 1.1, 0);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const build = (geo: THREE.BufferGeometry, list: typeof spots, withTrunks: boolean) => {
    // Spruce tiers are open cones: draw both sides so they don't look hollow from below.
    const leaves = new THREE.InstancedMesh(geo, mat('#ffffff', { side: THREE.DoubleSide }), list.length);
    const trunks = withTrunks ? new THREE.InstancedMesh(trunk, mat(colors.trunk), list.length) : null;
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      m.compose(new THREE.Vector3(t.x, terrain.height(t.x, t.y) - 0.2, -t.y), q, new THREE.Vector3(t.scale, t.scale * (0.9 + rng() * 0.35), t.scale));
      leaves.setMatrixAt(i, m);
      leaves.setColorAt(i, colors.pine.clone().lerp(colors.pineLight, rng()));
      trunks?.setMatrixAt(i, m);
    });
    group.add(leaves);
    if (trunks) group.add(trunks);
  };
  build(detailed, spots.filter((t) => t.near), true);
  build(simple, spots.filter((t) => !t.near), false);
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
/** The Top: the octagonal pavilion behind the start, a level snow platform, the start's back wall and timing box. */
function buildTopArea(ctx: Placer): THREE.Group {
  const group = new THREE.Group();
  const z0 = ctx.track.elevation(0);
  const st = ctx.track.frame(0);
  const heading = ctx.heading(0);
  // The pavilion mapped in OSM, 16 m behind the start, raised on the snow bank beside the run.
  const osm = OSM_NEAR.find((b) => b.id === OSM_IDS.topHut)!;
  const hut = buildTopHut();
  hut.position.set(osm.c[0], z0 + 1.1, -osm.c[1]);
  hut.rotation.y = heading;
  group.add(hut);
  // A broad, level snow platform for the start area and the riders waiting their turn.
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(15, 19, 3, 16), mat(colors.snow, { flatShading: false, roughness: 0.95 }));
  platform.position.set(-st.forward[0] * 12, z0 - 1.6, st.forward[1] * 12); // top just below the ice
  platform.receiveShadow = true;
  group.add(platform);
  // Snow wall closing the run behind the start.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 5), mat(colors.snow, { flatShading: false }));
  // Far enough back to stay behind the chase camera at the start.
  wall.position.set(-st.forward[0] * 9, z0 + 0.5, st.forward[1] * 9);
  wall.rotation.y = heading;
  wall.castShadow = wall.receiveShadow = true;
  group.add(wall);
  // The grey timing box on its post above the start, as in the photographs.
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.2, 8), mat('#5b5f66'));
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.55), mat('#c9ccd1', { roughness: 0.5 }));
  const at = ctx.local(3, -1.3, 0);
  post.position.copy(at).add(new THREE.Vector3(0, 1.6, 0));
  box.position.copy(at).add(new THREE.Vector3(0, 3.4, 0));
  box.rotation.y = heading;
  post.castShadow = box.castShadow = true;
  group.add(post, box);
  return group;
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
    new THREE.MeshBasicMaterial({ map: signTexture('FINISH', '#930303', '#ffffff'), side: THREE.DoubleSide }),
  );
  const width = ext.left - ext.right + 2;
  banner.position.set(0, 3.2, 0);
  banner.rotation.y = -Math.PI / 2;
  finish.add(banner);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.8, 0.25), mat('#930303'));
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
