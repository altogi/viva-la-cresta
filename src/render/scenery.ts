// Everything around the ice: mountains, the real woods and buildings from OpenStreetMap, the Top hut,
// the Junction clubhouse, bridges, timing eyes, the straw and padding beyond Shuttlecock, the finish.

import * as THREE from 'three';
import type { Assets } from './assets';
import { MAT_LENGTH } from '../sim/physics';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Track } from '../sim/track';
import { LANDMARKS, TRACK_LENGTH } from '../track/cresta';
import { OSM_BUILDINGS, OSM_IDS, OSM_NEAR, OSM_TREES, OSM_WOODS } from '../track/osm';
import { buildTownBuildings, placeTown } from './buildings';
import { buildClubhouse, towerFlag } from './clubhouse';
import { buildTopHut } from './topHut';
import { CUTTING, cuttingHeight, finishPlaces, pathBridge, platformFrame, PATH_BRIDGE } from './places';
import { lips, surfaceAt } from '../sim/surface';
import type { Terrain } from './terrain';
import { trackSurfaceHeight } from './trackMesh';
import { groundHeight } from './ground';
import { colors, mulberry32, toThree, valueNoise } from './util';

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
  group.add(buildTopArea(ctx, assets.models.tophut));
  group.add(assets.models.junction ? placeJunction(assets.models.junction) : buildClubhouse(track, terrain));
  group.add(towerFlag(track));
  for (const lm of LANDMARKS) {
    // The Junction walkway is part of the clubhouse model.
    if (lm.kind === 'bridge' && lm.name !== 'Junction walkway') group.add(assets.models.bridges ? placeBridge(ctx, lm.s, lm.name, assets.models.bridges) : buildBridge(ctx, lm.s, lm.name));
    if (lm.kind === 'timing' || lm.kind === 'start') group.add(buildTimingEye(ctx, lm.s));
    if (lm.kind === 'start') group.add(buildStartLine(ctx, lm.s));
  }
  group.add(buildFinish(ctx));
  group.add(buildFinishMat(ctx), buildRunOutBank(ctx), buildFinishExit(ctx), buildCutting(ctx));
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
/** A tree near the run as a cone: where it stands, the ground there, its height and its crown's radius at the foot. */
export interface TreeCrown {
  x: number;
  y: number;
  base: number;
  height: number;
  radius: number;
}

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
  // Dense forest close beside the run where the riders see it: both sides from Top down through
  // Church Leap, left of the run from Junction down past the Rise, right of it at Brabazon, and both
  // sides of the Bledisloe straight. Beyond the
  // first row the trees there are pictures (cheap on phones; they read the same at that distance).
  const dense: [number, number, number][] = [
    [8, 100, 1],
    [8, 100, -1],
    [100, 180, 1],
    [100, 180, -1],
    [322, 470, 1],
    [205, 258, -1],
    [240, 322, 1],
    [240, 322, -1],
    [688, 862, 1],
    [688, 862, -1],
  ];
  const clearOf = (x: number, y: number, gap: number) => buildings.every(([bx, by]) => Math.hypot(bx - x, by - y) > gap);
  for (const [s0, s1, side] of dense) {
    for (let s = s0; s < s1; s += 2.2) {
      for (let k = 0; k < (s0 >= 100 && s0 < 200 ? 9 : 6); k++) {
        const at = Math.min(TRACK_LENGTH, s + (rng() - 0.5) * 2.2);
        const st = track.frame(at);
        const lateral = side * (13 + rng() * 58);
        const x = st.pos[0] + st.left[0] * lateral;
        const y = st.pos[1] + st.left[1] * lateral;
        // Round Church Leap the trees stand between the houses; elsewhere they keep their distance.
        if (clearOf(x, y, s0 < 200 ? 13 : 20)) consider(x, y, 1, Math.abs(lateral) > 24);
      }
    }
  }
  // The Top hut stands in a stand of trees: all round it, clear of the start platform.
  const hut = OSM_NEAR.find((b) => b.id === OSM_IDS.topHut)!.c;
  const st0 = track.frame(0);
  const platform = [-st0.forward[0] * 12, -st0.forward[1] * 12];
  for (let i = 0; i < 700; i++) {
    const a = rng() * Math.PI * 2;
    const r = 9 + Math.sqrt(rng()) * 62;
    const x = hut[0] + Math.cos(a) * r;
    const y = hut[1] + Math.sin(a) * r;
    if (Math.hypot(x - platform[0], y - platform[1]) < 17) continue;
    if (!buildings.every(([bx, by]) => Math.hypot(bx - x, by - y) > 13)) continue;
    consider(x, y, 1, r > 28); // the outer ring as pictures
  }
  // Celerina, round the finish: both sides of the last of the run, and the slopes about the village
  // beyond it, among the houses.
  for (let s = 960; s < TRACK_LENGTH; s += 2.2) {
    for (const side of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        const st = track.frame(Math.min(TRACK_LENGTH, s + (rng() - 0.5) * 2.2));
        const lateral = side * (14 + rng() * 60);
        const x = st.pos[0] + st.left[0] * lateral;
        const y = st.pos[1] + st.left[1] * lateral;
        if (clearOf(x, y, 15)) consider(x, y, 1, Math.abs(lateral) > 26);
      }
    }
  }
  const end = track.frame(TRACK_LENGTH).pos;
  for (let i = 0; i < 1800; i++) {
    const a = rng() * Math.PI * 2;
    const r = 30 + Math.sqrt(rng()) * 320;
    const x = end[0] + Math.cos(a) * r;
    const y = end[1] + Math.sin(a) * r;
    // In clumps, as the larch and spruce woods round the village grow.
    if (woodNoise(x, y) < 0.42) continue;
    if (clearOf(x, y, 14)) consider(x, y, 1, true);
  }
  // A belt of forest all round the edge of the map, so the near ground runs into the far mountains
  // through trees rather than ending in bare snow. Pictures only: it's all far off.
  for (let i = 0; i < 16000; i++) {
    const edge = Math.floor(rng() * 4);
    const depth = Math.pow(rng(), 0.7) * 170;
    const along = rng();
    const x = edge === 0 ? minX + depth : edge === 1 ? maxX - depth : minX + along * (maxX - minX);
    const y = edge === 2 ? minY + depth : edge === 3 ? maxY - depth : minY + along * (maxY - minY);
    if (woodNoise(x, y) < 0.35 - depth / 900) continue;
    if (clearOf(x, y, 14)) consider(x, y, 1, true);
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
  // The trees near the run, as cones (for cameras that must see past them).
  const crowns: TreeCrown[] = [];
  for (const t of spots) {
    const kind = pick();
    const far = kind.startsWith('larch') ? 'larch_far' : 'spruce_far';
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    // Real heights 9-20 m: the models are 13-21 m tall.
    const s = (0.5 + rng() * 0.45) * t.scale;
    m.compose(new THREE.Vector3(t.x, terrain.height(t.x, t.y) - 0.3, -t.y), q, new THREE.Vector3(s, s * (0.92 + rng() * 0.16), s));
    if (t.distance < 90) crowns.push({ x: t.x, y: t.y, base: terrain.height(t.x, t.y), height: height(kind) * s, radius: height(kind) * s * 0.27 });
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
  group.userData.crowns = crowns;
  group.name = 'trees';
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

/** 0…1 patchiness for woods: where it's high the trees stand in clumps. */
const woodNoiseField = valueNoise(23);
function woodNoise(x: number, y: number) {
  return 0.5 + 0.5 * woodNoiseField(x / 90, y / 90);
}

/** The ornate wooden pavilion at Top, behind the start, on the run's left. */
/** The Top: the octagonal pavilion behind the start, a level snow platform, the start's back wall and timing box. */
/** Height of the snow platform round the Top start and hut, relative to the start's ice. */
export const TOP_PLATFORM = -0.1;

function buildTopArea(ctx: Placer, model?: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  const z0 = ctx.track.elevation(0);
  const st = ctx.track.frame(0);
  const heading = ctx.heading(0);
  // The pavilion mapped in OSM, 16 m behind the start, standing on the start platform.
  const osm = OSM_NEAR.find((b) => b.id === OSM_IDS.topHut)!;
  // Modelled in Blender (blender/tophut.py), or built here if the model didn't load.
  const hut = model ?? buildTopHut();
  hut.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
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
 * Leap, level with the deck as the ground is. Built in the bridge's frame.
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
        // The ground is level with the deck here (the run is in a cutting): the path just goes on,
        // following the ground as it eases back down to the hillside further out.
        const ground = ctx.terrain.height(v.x, -v.z);
        v.y = (d < 3 ? Math.max(ground, frame.position.y + deck - 0.05) : ground) + 0.04;
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
  // Embankment: in the bridge's frame, as wide as the bridge's deck and level with its road, from
  // inside the abutments out either side, its slopes running down to the ground (sampled from the
  // terrain) and burying the abutments' ends, so the bridge sits in the bank with no gap.
  holder.updateMatrixWorld(true);
  const inv = holder.matrixWorld.clone().invert();
  // A little under the bridge's road (which runs on a metre past its deck), never level with it:
  // two surfaces at the same height flicker against each other.
  const top = rail - 0.17;
  const halfTop = 4.9;
  const groundAt = (x: number, z: number) => {
    const world = new THREE.Vector3(x, 0, z).applyMatrix4(holder.matrixWorld);
    return new THREE.Vector3(world.x, ctx.terrain.height(world.x, -world.z) - 0.6, world.z).applyMatrix4(inv).y;
  };
  // One bank each side of the run (each its own mesh, so cameras can tell where it stands).
  const material = mat(colors.snow, { flatShading: false, side: THREE.DoubleSide, roughness: 0.95 });
  const banks: THREE.Mesh[] = [];
  for (const dir of [-1, 1]) {
    const positions: number[] = [];
    const index: number[] = [];
    let row = 0;
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      // From just inside the abutment's back face out to the end of the line.
      const z = dir * (span - 0.4 + ((reach - span) * i) / steps);
      for (const side of [-1, 1]) {
        // The foot spreads out with the bank's height, at about 1 in 1.5.
        const ground = groundAt(side * (halfTop + 2), z);
        const foot = halfTop + Math.max(0.5, (top - ground) * 1.5);
        positions.push(side * foot, groundAt(side * foot, z), z, side * halfTop, top, z);
      }
      if (i > 0) {
        const a = (row - 1) * 4;
        const b = row * 4;
        // Two sloping sides and the top, as quads between this row and the last.
        for (const [p, q] of [[0, 1], [1, 3], [3, 2]]) index.push(a + p, b + p, b + q, a + p, b + q, a + q);
      }
      row++;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const piece = new THREE.Mesh(geometry, material);
    piece.receiveShadow = true;
    banks.push(piece);
  }
  const bank = banks[0];

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
  return [...banks, carrier];
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

/** The finish: a red line painted across the ice, and a Swiss flag on a pole at either side of the run. */
function buildFinish(ctx: Placer): THREE.Group {
  const finish = new THREE.Group();
  const s = TRACK_LENGTH - 0.5;
  finish.add(buildStartLine(ctx, s, '#c8102e', 0.09));
  const pts = ctx.track.crossSection(s);
  const st = ctx.track.frame(s);
  const flagTex = swissFlag();
  for (const lat of [pts[0].y - 0.7, pts[pts.length - 1].y + 0.7]) {
    const x = st.pos[0] + st.left[0] * lat;
    const y = st.pos[1] + st.left[1] * lat;
    const base = new THREE.Vector3(x, groundHeight(ctx.track, ctx.terrain, x, -y), -y);
    finish.add(wavingFlag(base, 1.9, 0.45, flagTex, Math.atan2(st.forward[1], st.forward[0]) + Math.PI));
  }
  return finish;
}

/** A pole with a flag (`w` metres square) flying from its top, rippling; facing back up the run. */
function wavingFlag(base: THREE.Vector3, height: number, w: number, map: THREE.Texture, heading: number): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(base);
  g.rotation.y = heading;
  // Pole, finial and the flutter all in proportion to the flag.
  const k0 = Math.min(1, w / 1.4 + 0.25);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * k0, 0.06 * k0, height, 10), mat('#f2f2f0', { roughness: 0.5 }));
  pole.position.y = height / 2;
  pole.castShadow = true;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08 * k0, 10, 8), new THREE.MeshStandardMaterial({ color: '#c9a640', metalness: 0.8, roughness: 0.3 }));
  ball.position.y = height + 0.06 * k0;
  g.add(pole, ball);
  const geo = new THREE.PlaneGeometry(w, w, 14, 8);
  geo.translate(w / 2 + 0.05 * k0, height - w / 2 - 0.12 * k0, 0);
  const rest = (geo.attributes.position.array as Float32Array).slice();
  const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 0.8, side: THREE.DoubleSide }));
  flag.castShadow = true;
  const phase = Math.random() * 10;
  flag.onBeforeRender = () => {
    const t = performance.now() / 1000 + phase;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const fx = rest[i * 3];
      const fy = rest[i * 3 + 1];
      const k = Math.min(1, fx / w);
      const a = w / 1.4;
      pos.setXYZ(i, fx - k * k * 0.12 * a, fy - k * 0.08 * a, (Math.sin((fx / a) * 2.4 - t * 5 + (fy / a) * 0.5) * 0.14 + Math.sin((fx / a) * 4.1 - t * 7.7) * 0.04) * k * a);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };
  g.add(flag);
  return g;
}

/** The Swiss flag: a white cross on red, square. */
function swissFlag(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#da291c';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ffffff';
  // Arms one sixth longer than they are wide, as the federal flag has them.
  const u = 256 / 32;
  g.fillRect(13 * u, 6 * u, 6 * u, 20 * u);
  g.fillRect(6 * u, 13 * u, 20 * u, 6 * u);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

/**
 * The cutting at Stable Junction, as in the photograph from the run: tall snow walls straight up
 * from the run's lips to the ground above (raised to the footbridge's level), and along the right
 * a row of rough wooden posts with white cloth stretched between them.
 */
/** Distances out from the cutting's lip of the snow laid over the ground beside it (m). */
const SKIN = [0.6, 1.5, 3, 5, 8, 11, 14];

function buildCutting(ctx: Placer): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cutting';
  const track = ctx.track;
  const wallPos: number[] = [];
  const wallIdx: number[] = [];
  const v = (s: number, y: number, z: number) => toThree(track.toWorld(track.frame(s), y, z));
  for (const side of [1, -1]) {
    const base = wallPos.length / 3;
    let row = 0;
    for (let s = CUTTING.s0; s <= CUTTING.s1 + 1e-6; s += 1) {
      const section = track.section(s);
      const lip = surfaceAt(section, lips(section)[side > 0 ? 'left' : 'right']);
      const top = Math.max(trackSurfaceHeight(track, s, lip.y + side * 0.18) ?? lip.z, cuttingHeight(s) - 0.25) + 0.02;
      // Lip, top of the wall (a little back), then snow laid over the ground (finer than the
      // terrain's grid) out to where the terrain itself begins, its edge tucked under it.
      const points = [v(s, lip.y, lip.z - 0.02), v(s, lip.y + side * 0.18, top)];
      for (const d of SKIN) {
        const p = v(s, lip.y + side * d, 0);
        // Where the ground lies below the lip (the cutting's ends) the snow follows the run's own
        // embankment down to it, so the cutting fades into the run either side of it.
        const ground = ctx.terrain.height(p.x, -p.z) + (d === SKIN[SKIN.length - 1] ? -0.15 : 0.08);
        const bank = trackSurfaceHeight(track, s, lip.y + side * d);
        p.y = bank === null ? ground : Math.max(ground, v(s, lip.y + side * d, bank + 0.03).y);
        points.push(p);
      }
      for (const p of points) wallPos.push(p.x, p.y, p.z);
      if (row > 0) {
        const n = 2 + SKIN.length;
        const a = base + (row - 1) * n;
        const b = base + row * n;
        for (let k = 0; k < n - 1; k++) {
          if (side > 0) wallIdx.push(a + k, b + k, b + k + 1, a + k, b + k + 1, a + k + 1);
          else wallIdx.push(a + k, a + k + 1, b + k + 1, a + k, b + k + 1, b + k);
        }
      }
      row++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  geometry.setIndex(wallIdx);
  geometry.computeVertexNormals();
  const walls = new THREE.Mesh(geometry, mat(colors.snow, { flatShading: false, roughness: 0.9, side: THREE.DoubleSide }));
  walls.castShadow = walls.receiveShadow = true;
  group.add(walls);
  // Posts and cloth along the right-hand wall, where the cutting is deep.
  const postGeo = new THREE.CylinderGeometry(0.055, 0.07, 1.6, 7);
  const postMat = mat('#b59a72', { roughness: 0.9 });
  const cloth = mat('#f1efe9', { roughness: 0.95, side: THREE.DoubleSide, flatShading: false });
  const deep = (s: number) => cuttingHeight(s) > 1.6;
  let prev: THREE.Vector3 | null = null;
  for (let s = CUTTING.s0; s <= CUTTING.s1; s += 1.7) {
    if (!deep(s)) {
      prev = null;
      continue;
    }
    const section = track.section(s);
    const lip = surfaceAt(section, lips(section).right);
    const foot = v(s, lip.y - 0.35, cuttingHeight(s) - 0.15);
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.copy(foot).add(new THREE.Vector3(0, 0.75, 0));
    post.rotation.z = (Math.random() - 0.5) * 0.06;
    post.castShadow = true;
    group.add(post);
    if (prev) {
      // A sagging panel of cloth between this post and the last.
      const panel = new THREE.PlaneGeometry(1, 1, 6, 1);
      const pos = panel.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getX(i) + 0.5;
        const up = pos.getY(i) + 0.5;
        const p = prev.clone().lerp(foot, t);
        const sag = Math.sin(t * Math.PI) * 0.12 * up;
        pos.setXYZ(i, p.x, p.y + 0.2 + up * 1.15 - sag, p.z);
      }
      panel.computeVertexNormals();
      const mesh = new THREE.Mesh(panel, cloth);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    prev = foot;
  }
  return group;
}

/** A snow bank closing the end of the run-out, beyond the mat (and covering the cut in the ground). */
/** A line painted across the ice, up both walls: blue at a start, red at the finish. */
function buildStartLine(ctx: Placer, s: number, color = '#1f5fd6', half = 0.05): THREE.Mesh {
  const pts = ctx.track.crossSection(s);
  const positions: number[] = [];
  const index: number[] = [];
  // Across the floor and up the walls to the lips, just above the ice.
  pts.forEach((p, i) => {
    for (const ds of [-half, half]) {
      const v = ctx.local(Math.max(0, s + ds), p.y, p.z + 0.012);
      positions.push(v.x, v.y, v.z);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const line = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  line.receiveShadow = true;
  return line;
}

function buildRunOutBank(ctx: Placer): THREE.Mesh {
  const s = ctx.track.length;
  const st = ctx.track.frame(s);
  // A heap of snow half buried in the ground (no edges to stand out against the snow round it).
  const geo = new THREE.SphereGeometry(1, 32, 16);
  geo.scale(6, 2.6, 19);
  const bank = new THREE.Mesh(geo, mat(colors.snow, { flatShading: false, roughness: 0.95 }));
  bank.position.copy(ctx.local(s, 0, 0)).add(new THREE.Vector3(st.forward[0] * 5.5, -1.1, -st.forward[1] * 5.5));
  bank.rotation.y = ctx.heading(s);
  bank.castShadow = bank.receiveShadow = true;
  return bank;
}
