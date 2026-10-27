// Everything around the ice: mountains, the real woods and buildings from OpenStreetMap, the Top hut,
// the Junction clubhouse, bridges, timing eyes, the straw and padding beyond Shuttlecock, the finish.

import * as THREE from 'three';
import type { Assets } from './assets';
import { MAT_LENGTH } from '../sim/physics';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Track } from '../sim/track';
import { BENDS, LANDMARKS, TRACK_LENGTH } from '../track/cresta';
import { OSM_BUILDINGS, OSM_IDS, OSM_NEAR, OSM_TREES, OSM_WOODS } from '../track/osm';
import { buildTownBuildings, placeTown } from './buildings';
import { buildClubhouse } from './clubhouse';
import { buildTopHut } from './topHut';
import { finishPlaces, pathBridge, platformFrame, PATH_BRIDGE } from './places';
import type { Terrain } from './terrain';
import { colors, mulberry32, toThree } from './util';

const mat = (color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...opts });

export function buildScenery(track: Track, terrain: Terrain, assets: Assets): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scenery';
  const ctx = new Placer(track, terrain);
  group.add(placeMountains(assets));
  if (assets.models.balloon) group.add(driftingBalloon(assets.models.balloon));
  group.add(buildTrees(track, terrain, assets));
  group.add(assets.models.town ? placeTown(terrain, assets.models.town) : buildTownBuildings(terrain));
  group.add(buildTopArea(ctx));
  group.add(assets.models.junction ? placeJunction(assets.models.junction) : buildClubhouse(track, terrain));
  for (const lm of LANDMARKS) {
    // The Junction walkway is part of the clubhouse model.
    if (lm.kind === 'bridge' && lm.name !== 'Junction walkway') group.add(assets.models.bridges ? placeBridge(ctx, lm.s, lm.name, assets.models.bridges) : buildBridge(ctx, lm.s, lm.name));
    if (lm.kind === 'timing' || lm.kind === 'start') group.add(buildTimingEye(ctx, lm.s));
  }
  group.add(buildFinish(ctx));
  group.add(buildShuttlecockRunoff(ctx));
  group.add(buildFinishMat(ctx), buildRunOutBank(ctx), buildFinishExit(ctx));
  if (assets.models.props) group.add(...placeProps(track, terrain, assets.models.props));
  return group;
}

/** The clubhouse, the walkway and the Junction hut made in Blender (blender/junction.py), built in place. */
function placeJunction(model: THREE.Object3D): THREE.Object3D {
  model.name = 'clubhouse';
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return model;
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

/** The mountain ring made in Blender (blender/mountains.py), centred on the middle of the run. */
function placeMountains(assets: Assets): THREE.Object3D {
  const ring = assets.mountains;
  ring.position.set(MOUNTAIN_CENTRE[0], 0, -MOUNTAIN_CENTRE[1]);
  return ring;
}

/** A hot-air balloon drifting slowly round the valley, a few hundred metres up, as in the photographs. */
function driftingBalloon(model: THREE.Object3D): THREE.Object3D {
  const holder = new THREE.Group();
  holder.add(model);
  let mesh: THREE.Mesh | null = null;
  model.traverse((o) => {
    if (o instanceof THREE.Mesh && !mesh) mesh = o;
  });
  const start = performance.now();
  // Moved each frame from its own render callback: no game logic needs to know it exists.
  if (mesh)
    (mesh as THREE.Mesh).onBeforeRender = () => {
      const t = (performance.now() - start) / 1000;
      const a = 0.9 + t * 0.004;
      holder.position.set(MOUNTAIN_CENTRE[0] + Math.cos(a) * 1500, 340 + Math.sin(t * 0.05) * 25, -(MOUNTAIN_CENTRE[1] + Math.sin(a) * 1500));
      holder.rotation.y = t * 0.02;
    };
  holder.position.set(MOUNTAIN_CENTRE[0] + Math.cos(0.9) * 1500, 340, -(MOUNTAIN_CENTRE[1] + Math.sin(0.9) * 1500));
  return holder;
}

/** Must match CENTRE in blender/mountains.py. */
const MOUNTAIN_CENTRE = [445, 455];

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
function buildTrees(track: Track, terrain: Terrain, assets: Assets): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(1884);
  const { minX, maxX, minY, maxY } = terrain.bounds;
  const spots: { x: number; y: number; scale: number; distance: number; card?: boolean }[] = [];
  const consider = (x: number, y: number, keepFar: number, card = false) => {
    if (x < minX || x > maxX || y < minY || y > maxY) return;
    const { distance } = terrain.distanceToTrack(x, y);
    if (distance < 12) return;
    if (distance > 260 && rng() > keepFar) return;
    spots.push({ x, y, scale: 0.75 + rng() * 0.8, distance, card });
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
  // Dense forest close beside the run where the riders see it: left of the run from Junction down
  // past the Rise, right of it at Brabazon, and both sides of the Bledisloe straight. Beyond the
  // first row the trees there are pictures (cheap on phones; they read the same at that distance).
  const dense: [number, number, number][] = [
    [322, 470, 1],
    [205, 258, -1],
    [688, 862, 1],
    [688, 862, -1],
  ];
  const clearOfBigBuildings = (x: number, y: number) => buildings.every(([bx, by]) => Math.hypot(bx - x, by - y) > 20);
  for (const [s0, s1, side] of dense) {
    for (let s = s0; s < s1; s += 2.2) {
      for (let k = 0; k < 6; k++) {
        const at = Math.min(TRACK_LENGTH, s + (rng() - 0.5) * 2.2);
        const st = track.frame(at);
        const lateral = side * (13 + rng() * 58);
        const x = st.pos[0] + st.left[0] * lateral;
        const y = st.pos[1] + st.left[1] * lateral;
        if (clearOfBigBuildings(x, y)) consider(x, y, 1, Math.abs(lateral) > 24);
      }
    }
  }
  // The Top hut stands in a stand of trees: all round it, clear of the start platform.
  const hut = OSM_NEAR.find((b) => b.id === OSM_IDS.topHut)!.c;
  const st0 = track.frame(0);
  const platform = [-st0.forward[0] * 12, -st0.forward[1] * 12];
  for (let i = 0; i < 260; i++) {
    const a = rng() * Math.PI * 2;
    const r = 10 + Math.sqrt(rng()) * 40;
    const x = hut[0] + Math.cos(a) * r;
    const y = hut[1] + Math.sin(a) * r;
    if (Math.hypot(x - platform[0], y - platform[1]) < 17) continue;
    if (!buildings.every(([bx, by]) => Math.hypot(bx - x, by - y) > 13)) continue;
    consider(x, y, 1);
  }
  for (let i = 0; i < 2500; i++) {
    const x = minX + rng() * (maxX - minX);
    const y = minY + rng() * (maxY - minY);
    if (rng() < 0.12 && !OSM_WOODS.some((w) => insidePolygon(x, y, w))) consider(x, y, 0.5);
  }

  // Near the run: the Blender trees (spruces, and a third larches), casting shadows only right
  // beside it; further off, billboards of them. Instanced in chunks of the map, so whatever is off
  // screen (or outside the sun's shadow area) is skipped.
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const NEAR = ['spruce_0', 'spruce_1', 'spruce_2', 'larch_0', 'larch_1'];
  const pick = () => (rng() < 0.3 ? NEAR[3 + Math.floor(rng() * 2)] : NEAR[Math.floor(rng() * 3)]);
  const CHUNK = 160;
  const byModel = new Map<string, { name: string; shadow: boolean; matrices: THREE.Matrix4[] }>();
  const add = (name: string, shadow: boolean, x: number, y: number, matrix: THREE.Matrix4) => {
    const key = `${name}|${shadow}|${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
    if (!byModel.has(key)) byModel.set(key, { name, shadow, matrices: [] });
    byModel.get(key)!.matrices.push(matrix);
  };
  const heights = new Map<string, number>();
  const height = (name: string) => {
    if (!heights.has(name)) {
      let h = 1;
      for (const p of assets.trees[name] ?? []) {
        p.geometry.computeBoundingBox();
        h = Math.max(h, p.geometry.boundingBox!.max.y);
      }
      heights.set(name, h);
    }
    return heights.get(name)!;
  };
  const fill = new THREE.Matrix4();
  for (const t of spots) {
    const kind = pick();
    const far = kind.startsWith('larch') ? 'larch_far' : 'spruce_far';
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    // Real heights 9-20 m: the models are 13-21 m tall.
    const s = (0.5 + rng() * 0.45) * t.scale;
    m.compose(new THREE.Vector3(t.x, terrain.height(t.x, t.y) - 0.3, -t.y), q, new THREE.Vector3(s, s * (0.92 + rng() * 0.16), s));
    if (t.distance < 35 && !t.card) {
      // Close to the run: the modelled tree, with its own picture inside it. The boughs are near
      // level, so seen side-on from a little way off they thin to nothing; the picture keeps the
      // crown's outline from every angle.
      add(kind, true, t.x, t.y, m.clone());
      const k = height(kind) / height(far);
      add(far, false, t.x, t.y, m.clone().multiply(fill.makeScale(k * 0.8, k * 0.97, k * 0.8)));
    } else {
      add(far, false, t.x, t.y, m.clone());
    }
  }
  for (const { name, shadow, matrices } of byModel.values()) {
    for (const part of assets.trees[name] ?? []) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
      matrices.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.computeBoundingSphere();
      mesh.castShadow = shadow;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
  }
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
/** Height of the snow platform round the Top start and hut, relative to the start's ice. */
export const TOP_PLATFORM = -0.1;

function buildTopArea(ctx: Placer): THREE.Group {
  const group = new THREE.Group();
  const z0 = ctx.track.elevation(0);
  const st = ctx.track.frame(0);
  const heading = ctx.heading(0);
  // The pavilion mapped in OSM, 16 m behind the start, standing on the start platform.
  const osm = OSM_NEAR.find((b) => b.id === OSM_IDS.topHut)!;
  const hut = buildTopHut();
  hut.position.set(osm.c[0], z0 + TOP_PLATFORM, -osm.c[1]);
  hut.rotation.y = heading;
  group.add(hut);
  // A broad, level snow platform for the start area and the riders waiting their turn.
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(15, 19, 3, 16), mat(colors.snow, { flatShading: false, roughness: 0.95 }));
  platform.position.set(-st.forward[0] * 12, z0 + TOP_PLATFORM - 1.5, st.forward[1] * 12); // top just below the ice
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

/**
 * A bridge made in Blender (blender/bridges.py), in the run's frame: x down the run, across it, up
 * from the floor. The Road Bridge near Bulpetts carries the railway, and now and then the red train.
 */
function placeBridge(ctx: Placer, s: number, name: string, models: THREE.Object3D): THREE.Object3D {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '_');
  const model = models.getObjectByName(`bridge_${slug}`);
  if (!model) return buildBridge(ctx, s, name);
  const holder = new THREE.Group();
  const bridge = model.clone();
  bridge.position.set(0, 0, 0);
  holder.add(bridge);
  const ext = ctx.extent(s);
  holder.position.copy(ctx.local(s, (ext.left + ext.right) / 2, 0));
  holder.rotation.y = ctx.heading(s);
  holder.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  if (name === PATH_BRIDGE.name) holder.add(footpathAcross(ctx));
  const train = models.getObjectByName('rhb_train');
  if (name === 'Road Bridge' && train) holder.add(...railwayLine(ctx, holder, ext.height, (ext.left - ext.right) / 2 + 3.6, train.clone()));
  return holder;
}

/**
 * The visitors' path, carried on across the snow from both ends of the footbridge above Church
 * Leap: down from the deck to the ground, then on over the terrain. Built in the bridge's frame.
 */
function footpathAcross(ctx: Placer): THREE.Object3D {
  const { frame, deck, span } = pathBridge(ctx.track);
  const inv = frame.matrixWorld.clone().invert();
  const positions: number[] = [];
  const index: number[] = [];
  const v = new THREE.Vector3();
  let row = 0;
  for (const dir of [-1, 1]) {
    for (let d = 0; d <= 40; d += 1.25) {
      const z = dir * (span + d);
      for (const x of [-1.1, 1.1]) {
        v.set(x, 0, z).applyMatrix4(frame.matrixWorld);
        const ground = ctx.terrain.height(v.x, -v.z) + 0.05;
        // Down a ramp from the deck to the ground over the first few metres.
        const t = Math.min(1, d / 6);
        const worldY = (frame.position.y + deck + 0.01) * (1 - t) + ground * t;
        v.y = Math.max(worldY, ground);
        v.applyMatrix4(inv);
        positions.push(v.x, v.y, v.z);
      }
      if (d > 0) {
        const a = (row - 1) * 2;
        const b = row * 2;
        if (dir > 0) index.push(a, a + 1, b + 1, a, b + 1, b);
        else index.push(a, b + 1, a + 1, a, b, b + 1);
      }
      row++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const path = new THREE.Mesh(geometry, mat('#d6dce5', { flatShading: false, roughness: 1, side: THREE.DoubleSide }));
  path.receiveShadow = true;
  return path;
}

/** Must match blender/bridges.py: the Road Bridge's deck, and where its track lies. */
const ROAD_BRIDGE = { clearance: 1.8, railTop: 0.77, trackX: 1.6 };

/**
 * The railway across the Road Bridge: an embankment of snow carrying the line out either side, and
 * the red train crossing every minute or so, one way then the other.
 */
function railwayLine(ctx: Placer, holder: THREE.Object3D, wall: number, span: number, train: THREE.Object3D): THREE.Object3D[] {
  const rail = Math.max(wall, 0.75) + ROAD_BRIDGE.clearance + ROAD_BRIDGE.railTop;
  const reach = 160;
  // Embankment: in the bridge's frame, from the ground (sampled from the terrain) up to the line.
  holder.updateMatrixWorld(true);
  const inv = holder.matrixWorld.clone().invert();
  const positions: number[] = [];
  const index: number[] = [];
  const samples = 128;
  for (let i = 0; i <= samples; i++) {
    const z = -reach + (2 * reach * i) / samples;
    for (const dx of [-2.6, 2.6]) {
      const world = new THREE.Vector3(ROAD_BRIDGE.trackX + dx, 0, z).applyMatrix4(holder.matrixWorld);
      const ground = ctx.terrain.height(world.x, -world.z);
      const below = new THREE.Vector3(world.x, ground - 1.5, world.z).applyMatrix4(inv);
      positions.push(ROAD_BRIDGE.trackX + dx * 1.8, below.y, z, ROAD_BRIDGE.trackX + dx, rail - 0.2, z);
    }
    // No bank across the run itself, where the bridge carries the line.
    const prevZ = -reach + (2 * reach * (i - 1)) / samples;
    if (i > 0 && Math.min(Math.abs(z), Math.abs(prevZ)) > span && Math.sign(z) === Math.sign(prevZ)) {
      const a = (i - 1) * 4;
      const b = i * 4;
      // Two sloping sides and the top, as quads between this row and the last.
      for (const [p, q] of [[0, 1], [1, 3], [3, 2]]) index.push(a + p, b + p, b + q, a + p, b + q, a + q);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const bank = new THREE.Mesh(geometry, mat(colors.snow, { flatShading: false, side: THREE.DoubleSide, roughness: 0.95 }));
  bank.receiveShadow = true;

  const carrier = new THREE.Group();
  carrier.add(train);
  train.rotation.y = Math.PI / 2; // its length (x) along the line (z)
  const length = 72;
  const period = 70;
  const speed = 13;
  const start = performance.now() / 1000 - 20;
  train.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  // Driven from the embankment, which is always drawn (the train itself may be hidden).
  bank.frustumCulled = false;
  bank.onBeforeRender = () => {
    const t = performance.now() / 1000 - start;
    const lap = Math.floor(t / period);
    const travel = (t - lap * period) * speed;
    const dir = lap % 2 === 0 ? 1 : -1;
    const run = 2 * reach + length;
    carrier.visible = travel < run;
    const front = -reach + Math.min(travel, run);
    carrier.position.set(ROAD_BRIDGE.trackX, rail, dir * front);
    carrier.rotation.y = dir > 0 ? Math.PI : 0;
  };
  carrier.position.set(ROAD_BRIDGE.trackX, rail, -reach);
  return [bank, carrier];
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

/** The yellow mat across the end of the run-out at Celerina: it stops the toboggan, the rider slides on. */
function buildFinishMat(ctx: Placer): THREE.Mesh {
  const track = ctx.track;
  const end = track.length - 0.4;
  const start = end - MAT_LENGTH;
  const thick = 0.14;
  const positions: number[] = [];
  const v = new THREE.Vector3();
  const rows: THREE.Vector3[][] = [];
  for (let s = start; s <= end + 1e-6; s += 0.5) {
    const st = track.frame(s);
    const half = track.section(s).floorWidth / 2 + 0.1;
    // Bottom-right, top-right, top-left, bottom-left.
    rows.push(
      [
        [-half, 0],
        [-half, thick],
        [half, thick],
        [half, 0],
      ].map(([y, z]) => toThree(track.toWorld(st, y, z), v.clone())),
    );
  }
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  for (let i = 0; i < rows.length - 1; i++) {
    const [r0, r1] = [rows[i], rows[i + 1]];
    quad(r0[1], r1[1], r1[2], r0[2]); // top
    quad(r0[0], r1[0], r1[1], r0[1]); // right side
    quad(r0[2], r1[2], r1[3], r0[3]); // left side
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  quad(first[0], first[1], first[2], first[3]);
  quad(last[3], last[2], last[1], last[0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mat = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#f2c12e', roughness: 0.85, side: THREE.DoubleSide }));
  mat.name = 'finish-mat';
  mat.castShadow = mat.receiveShadow = true;
  return mat;
}

/** The observers' stand before Shuttlecock and the hut by the finish (blender/props.py). */
function placeProps(track: Track, terrain: Terrain, models: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const put = (name: string, frame: THREE.Object3D) => {
    const model = models.getObjectByName(name);
    if (!model) return;
    const copy = model.clone();
    copy.position.copy(frame.position);
    copy.rotation.copy(frame.rotation);
    copy.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    out.push(copy);
  };
  put('shuttlecock_platform', platformFrame(track, terrain));
  put('finish_hut', finishPlaces(track, terrain).hut);
  return out;
}

/**
 * The end of the mat, as at the real finish: the foam rolled up against the end, and a few steps
 * of packed snow over the low left wall, where riders climb out with their toboggans, then a path.
 */
function buildFinishExit(ctx: Placer): THREE.Group {
  const group = new THREE.Group();
  const places = finishPlaces(ctx.track, ctx.terrain);
  const end = places.end - 0.4;
  const st = ctx.track.frame(end - 0.45);
  const width = ctx.track.section(end).floorWidth + 0.2;
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, width, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f2c12e', roughness: 0.85 }));
  roll.position.copy(ctx.local(end - 0.45, 0, 0.14 + 0.27));
  roll.rotation.y = Math.atan2(st.forward[1], st.forward[0]);
  roll.castShadow = roll.receiveShadow = true;
  group.add(roll);
  const snow = mat(colors.snow, { flatShading: false, roughness: 0.95 });
  const steps = [
    [0.95, 0.18],
    [1.2, 0.36],
    [1.45, 0.54],
  ];
  for (const [u, h] of steps) {
    const step = new THREE.Mesh(new RoundedBoxGeometry(1.4, h, 0.4, 2, 0.06), snow);
    step.position.copy(ctx.local(places.exitS, u, h / 2));
    step.rotation.y = ctx.heading(places.exitS);
    step.castShadow = step.receiveShadow = true;
    group.add(step);
  }
  // A trodden path from the steps across to the hut.
  const from = ctx.ground(places.exitS, places.lip + 0.6, 0.03);
  const to = places.hut.position.clone();
  const length = from.distanceTo(to);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(1.3, length).rotateX(-Math.PI / 2), mat('#d9dee6', { flatShading: false, roughness: 1 }));
  path.position.copy(from).lerp(to, 0.5);
  path.position.y = Math.max(from.y, to.y) + 0.03;
  path.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  path.receiveShadow = true;
  group.add(path);
  return group;
}

/** A snow bank closing the end of the run-out, beyond the mat (and covering the cut in the ground). */
function buildRunOutBank(ctx: Placer): THREE.Mesh {
  const s = ctx.track.length;
  const st = ctx.track.frame(s);
  const bank = new THREE.Mesh(new RoundedBoxGeometry(9, 2.2, 34, 4, 1.0), mat(colors.snow, { flatShading: false, roughness: 0.95 }));
  bank.position.copy(ctx.local(s, 0, 0)).add(new THREE.Vector3(st.forward[0] * 4.2, 0.3, -st.forward[1] * 4.2));
  bank.rotation.y = ctx.heading(s);
  bank.castShadow = bank.receiveShadow = true;
  return bank;
}
