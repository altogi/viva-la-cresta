// The fall zone beyond Shuttlecock, from the photographs: a bed of straw along the run's outer lip,
// a strip of snow, then two staggered rows of padded red vinyl mats (white labels, seams, snow on
// top), and behind them a wall of yellow timber boards. The mats are heavy but loose: a rider who
// flies out smashes into them and sends them flying (they're light foam), and drops into the straw.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Track } from '../sim/track';
import type { Terrain } from './terrain';
import { BENDS } from '../track/cresta';
import { lips } from '../sim/surface';
import { mulberry32, toThree } from './util';
import { groundHeight } from './ground';

/** Distances out from the run's outer lip (m). */
export const PADDING = { straw: 2.4, front: 3.1, back: 4.3, fence: 5.5 };
const MAT = { length: 2.6, height: 1.1, depth: 0.75, mass: 8 };
const GRAVITY = 9.81;

interface Mat {
  mesh: THREE.Object3D;
  /** Rest pose. */
  home: THREE.Vector3;
  heading: number;
  /** Outward (away from the run) in the horizontal plane. */
  out: THREE.Vector3;
  /** Where it is now, how fast it's going, and how far it has tumbled over and spun round (radians). */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  tip: number;
  tipV: number;
  spin: number;
  spinV: number;
  moving: boolean;
}

export class Padding {
  readonly group = new THREE.Group();
  private readonly mats: Mat[] = [];
  /** The mats as they flew in a fall, for its replay: seconds since the fall, then each mat's position and turn. */
  private takes: { t: number; poses: Float32Array }[] = [];
  /** Seconds since the fall while recording it; -1 when not. */
  private clock = -1;
  /** The replay is showing the recorded mats: the live ones wait. */
  private replaying = false;

  constructor(
    private readonly track: Track,
    private readonly terrain: Terrain,
  ) {
    this.group.name = 'shuttlecock-padding';
    const bend = BENDS.find((b) => b.name === 'Shuttlecock')!;
    const rng = mulberry32(7);
    const vinyl = new THREE.MeshStandardMaterial({ map: vinylTexture(), roughness: 0.45, metalness: 0.05 });
    const snow = new THREE.MeshStandardMaterial({ color: '#f3f6fa', roughness: 0.9 });
    const matGeo = new RoundedBoxGeometry(MAT.length, MAT.height, MAT.depth, 3, 0.12);
    const capGeo = new RoundedBoxGeometry(MAT.length * 0.96, 0.12, MAT.depth * 0.9, 2, 0.05);
    // Straw photographed beside the run at Shuttlecock (public/textures/straw.jpg), mirrored as it
    // repeats so no seams show; the drawn one until it has loaded.
    const straw = new THREE.MeshStandardMaterial({ map: strawTexture(), roughness: 1 });
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/straw.jpg`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
      tex.anisotropy = 4;
      straw.map = tex;
      straw.needsUpdate = true;
    });
    const boards = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.8 });
    const post = new THREE.MeshStandardMaterial({ color: '#8a6a44', roughness: 0.85 });
    // The straw: a lumpy heap half a metre high along the run's lip, a bed thinning out beyond it,
    // and loose tufts kicked across the snow towards the mats.
    const strawPos: number[] = [];
    const strawUv: number[] = [];
    const strawIdx: number[] = [];
    const lump = (s: number, k: number) => 0.75 + 0.5 * (0.5 + 0.5 * Math.sin(s * 1.7 + k * 2.3) * Math.cos(s * 0.63 + k));
    const profile: [number, number][] = [
      [0.05, 0.02],
      [0.4, 0.3],
      [0.9, 0.5],
      [1.5, 0.42],
      [2.0, 0.22],
      [2.5, 0.08],
      [PADDING.straw + 0.3, 0.0],
    ];
    let row = 0;
    for (let s = bend.s0 - 6; s <= bend.s1 + 16; s += 0.5) {
      const st = track.frame(s);
      const lip = lips(track.section(s)).right;
      profile.forEach(([out, h], k) => {
        const u = lip - out * (0.9 + 0.2 * lump(s, k + 7) - 0.1);
        const x = st.pos[0] + st.left[0] * u;
        const y = st.pos[1] + st.left[1] * u;
        strawPos.push(x, this.ground(x, y) + 0.03 + h * lump(s, k), -y);
        strawUv.push(s / 1.1, out / 1.1);
      });
      if (row > 0) {
        const n = profile.length;
        const a = (row - 1) * n;
        const b = row * n;
        for (let k = 0; k < n - 1; k++) strawIdx.push(a + k, a + k + 1, b + k, a + k + 1, b + k + 1, b + k);
      }
      row++;
    }
    const strawGeo = new THREE.BufferGeometry();
    strawGeo.setAttribute('position', new THREE.Float32BufferAttribute(strawPos, 3));
    strawGeo.setAttribute('uv', new THREE.Float32BufferAttribute(strawUv, 2));
    strawGeo.setIndex(strawIdx);
    strawGeo.computeVertexNormals();
    straw.side = THREE.DoubleSide;
    const bed = new THREE.Mesh(strawGeo, straw);
    bed.receiveShadow = bed.castShadow = true;
    this.group.add(bed);
    // Loose tufts on the snow between the heap and the mats.
    const tuft = new THREE.IcosahedronGeometry(1, 1);
    const tufts = new THREE.InstancedMesh(tuft, straw, 70);
    const tm = new THREE.Matrix4();
    for (let i = 0; i < 70; i++) {
      const s = bend.s0 - 4 + rng() * (bend.s1 - bend.s0 + 18);
      const st = track.frame(s);
      const u = lips(track.section(s)).right - PADDING.straw - rng() * 0.6;
      const x = st.pos[0] + st.left[0] * u;
      const y = st.pos[1] + st.left[1] * u;
      const r = 0.12 + rng() * 0.22;
      tm.compose(new THREE.Vector3(x, this.ground(x, y) + 0.02, -y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6), new THREE.Vector3(r * 1.5, r * 0.45, r));
      tufts.setMatrixAt(i, tm);
    }
    tufts.castShadow = tufts.receiveShadow = true;
    this.group.add(tufts);
    // The mats, two rows staggered, and the board wall behind.
    for (const [out, offset, lift] of [[PADDING.front, 0, 0], [PADDING.back, MAT.length / 2, 0.35]] as const) {
      for (let s = bend.s0 - 4 + offset; s < bend.s1 + 14; s += MAT.length + 0.08) {
        const st = track.frame(s);
        const lip = lips(track.section(s)).right;
        const u = lip - out;
        const x = st.pos[0] + st.left[0] * u;
        const y = st.pos[1] + st.left[1] * u;
        const heading = Math.atan2(st.forward[1], st.forward[0]) + (rng() - 0.5) * 0.12;
        const home = new THREE.Vector3(x, this.ground(x, y) + MAT.height / 2 + lift - 0.05, -y);
        const mesh = new THREE.Group();
        const body = new THREE.Mesh(matGeo, vinyl);
        const cap = new THREE.Mesh(capGeo, snow);
        cap.position.y = MAT.height / 2 + 0.03;
        body.castShadow = body.receiveShadow = cap.receiveShadow = true;
        mesh.add(body, cap);
        mesh.position.copy(home);
        mesh.rotation.y = heading;
        this.group.add(mesh);
        const outDir = toThree([-st.left[0], -st.left[1], 0]).normalize();
        this.mats.push({ mesh, home, heading, out: outDir, pos: home.clone(), vel: new THREE.Vector3(), tip: 0, tipV: 0, spin: 0, spinV: 0, moving: false });
      }
    }
    const boardGeo = new THREE.BoxGeometry(3.25, 1.9, 0.12);
    const postGeo = new THREE.BoxGeometry(0.14, 2.3, 0.14);
    for (let s = bend.s0 - 4; s < bend.s1 + 14; s += 3.0) {
      const st = track.frame(s);
      const lip = lips(track.section(s)).right;
      const u = lip - PADDING.fence;
      const x = st.pos[0] + st.left[0] * u;
      const y = st.pos[1] + st.left[1] * u;
      const g = this.ground(x, y);
      const heading = Math.atan2(st.forward[1], st.forward[0]);
      const wall = new THREE.Mesh(boardGeo, boards);
      wall.position.set(x, g + 0.95 + 0.35, -y);
      wall.rotation.y = heading;
      const p = new THREE.Mesh(postGeo, post);
      p.position.set(x, g + 1.15, -y);
      p.rotation.y = heading;
      p.translateX(-1.5);
      wall.castShadow = wall.receiveShadow = p.castShadow = true;
      this.group.add(wall, p);
    }
  }

  /** The visible snow: the ground, or the run's bank where it reaches this far. */
  private ground(x: number, y: number) {
    return groundHeight(this.track, this.terrain, x, -y);
  }

  /**
   * A tumbling body (a sphere of `radius` at `pos`, moving at `vel`) against the mats: the mats are
   * light foam, so they take the blow and fly off, tumbling, while the body only loses a little.
   */
  collide(pos: THREE.Vector3, vel: THREE.Vector3, radius: number, mass: number): boolean {
    let hit = false;
    const local = new THREE.Vector3();
    const upAxis = new THREE.Vector3(0, 1, 0);
    for (const m of this.mats) {
      if (Math.abs(m.mesh.position.x - pos.x) > 3 || Math.abs(m.mesh.position.z - pos.z) > 3) continue;
      // Into the mat's own frame (x along it, z across it, y up).
      local.copy(pos).sub(m.mesh.position);
      local.applyAxisAngle(upAxis, -(m.heading + m.spin));
      const hx = MAT.length / 2 + radius;
      const hy = MAT.height / 2 + radius;
      const hz = MAT.depth / 2 + radius;
      if (Math.abs(local.x) > hx || Math.abs(local.y) > hy || Math.abs(local.z) > hz) continue;
      // How fast the body closes on the mat.
      const rel = vel.clone().sub(m.vel);
      const speedIn = Math.max(0, rel.dot(m.out));
      if (speedIn < 0.3 && rel.y > -0.3) continue;
      // An elastic-ish knock between a heavy body and a light mat: the mat leaves at nearly twice
      // the body's speed, up and away, tumbling and slewing round.
      const share = (2 * mass) / (mass + MAT.mass);
      const kick = speedIn * share * 0.55;
      m.vel.addScaledVector(m.out, kick);
      m.vel.x += vel.x * 0.35 - m.out.x * vel.dot(m.out) * 0.35;
      m.vel.z += vel.z * 0.35 - m.out.z * vel.dot(m.out) * 0.35;
      m.vel.y += 1.5 + kick * 0.35 + Math.max(0, -vel.y) * 0.3;
      m.tipV += kick * 0.45 * (local.y > 0 ? 1 : 0.6);
      m.spinV += (Math.random() - 0.5) * kick * 0.8 + local.x * kick * 0.3;
      m.moving = true;
      // The body loses only what the mat carries off.
      vel.addScaledVector(m.out, -speedIn * ((2 * MAT.mass) / (mass + MAT.mass)));
      vel.x *= 0.9;
      vel.z *= 0.9;
      hit = true;
    }
    return hit;
  }

  /** Mats in the air fly and tumble; on the snow they bounce, slide and settle on a face. */
  update(dt: number) {
    if (this.replaying) return;
    this.step(dt);
    if (this.clock >= 0) {
      this.clock += dt;
      this.take();
    }
  }

  private step(dt: number) {
    for (const m of this.mats) {
      if (!m.moving) continue;
      m.vel.y -= GRAVITY * dt;
      m.pos.addScaledVector(m.vel, dt);
      m.tip += m.tipV * dt;
      m.spin += m.spinV * dt;
      // Lying on its side it is lower: from half its height standing to half its depth on its back.
      const lying = Math.abs(Math.sin(m.tip));
      const rest = this.ground(m.pos.x, -m.pos.z) + (MAT.height / 2) * (1 - lying) + (MAT.depth / 2) * lying;
      if (m.pos.y <= rest) {
        m.pos.y = rest;
        if (m.vel.y < -1.2) {
          m.vel.y *= -0.3;
          m.tipV *= 0.6;
        } else {
          m.vel.y = 0;
          // Settling flat on whichever face is nearest the snow.
          const face = Math.round(m.tip / (Math.PI / 2)) * (Math.PI / 2);
          m.tipV = m.tipV * Math.exp(-dt * 6) + (face - m.tip) * 10 * dt;
        }
        const f = Math.exp(-dt * 4);
        m.vel.x *= f;
        m.vel.z *= f;
        m.spinV *= f;
        if (m.vel.lengthSq() < 0.0004 && Math.abs(m.tipV) < 0.02 && Math.abs(m.spinV) < 0.02) {
          m.vel.set(0, 0, 0);
          m.tipV = m.spinV = 0;
          m.moving = false;
        }
      }
      m.mesh.position.copy(m.pos);
      m.mesh.rotation.set(0, m.heading + m.spin, 0);
      m.mesh.rotateX(-m.tip);
    }
  }

  /** A fall: record how the mats fly from now on, for the replay. */
  record() {
    this.takes = [];
    this.clock = 0;
    this.replaying = false;
    this.take();
  }

  /** The replay begins: the recording is done. */
  stopRecording() {
    this.clock = -1;
  }

  private take() {
    const poses = new Float32Array(this.mats.length * 7);
    this.mats.forEach((m, i) => {
      m.mesh.position.toArray(poses, i * 7);
      m.mesh.quaternion.toArray(poses, i * 7 + 3);
    });
    this.takes.push({ t: this.clock, poses });
  }

  /** The mats as they were `t` seconds after the fall (as they stood before it, for t < 0). */
  showAt(t: number) {
    const takes = this.takes;
    if (!takes.length) return;
    this.replaying = true;
    let i = takes.findIndex((x) => x.t >= t);
    if (i < 0) i = takes.length - 1;
    const b = takes[i];
    const a = takes[Math.max(0, i - 1)];
    const k = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    this.mats.forEach((m, j) => {
      const o = j * 7;
      m.mesh.position.set(
        THREE.MathUtils.lerp(a.poses[o], b.poses[o], k),
        THREE.MathUtils.lerp(a.poses[o + 1], b.poses[o + 1], k),
        THREE.MathUtils.lerp(a.poses[o + 2], b.poses[o + 2], k),
      );
      qa.fromArray(a.poses, o + 3);
      qb.fromArray(b.poses, o + 3);
      m.mesh.quaternion.slerpQuaternions(qa, qb, k);
    });
  }

  /** After the replay: the mats where they really are, carrying on from there. */
  live() {
    this.replaying = false;
    for (const m of this.mats) {
      m.mesh.position.copy(m.pos);
      m.mesh.rotation.set(0, m.heading + m.spin, 0);
      m.mesh.rotateX(-m.tip);
    }
  }

  /** All back as they were, for the next ride. */
  reset() {
    this.takes = [];
    this.clock = -1;
    this.replaying = false;
    for (const m of this.mats) {
      m.pos.copy(m.home);
      m.vel.set(0, 0, 0);
      m.tip = m.tipV = m.spin = m.spinV = 0;
      m.moving = false;
      m.mesh.position.copy(m.home);
      m.mesh.rotation.set(0, m.heading, 0);
    }
  }
}

/** Red vinyl: stitched seams, a white label patch, a little sheen and grime. */
function vinylTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b3141c';
  g.fillRect(0, 0, 512, 256);
  const rng = mulberry32(3);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(${rng() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + rng() * 0.04})`;
    g.fillRect(rng() * 512, rng() * 256, 2 + rng() * 6, 1 + rng() * 3);
  }
  // Seams along the top and bottom, and a few creases.
  g.strokeStyle = 'rgba(60,0,0,0.5)';
  g.lineWidth = 3;
  for (const y of [18, 238]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(70,0,0,0.25)';
  g.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    const x = 40 + rng() * 430;
    g.moveTo(x, 30);
    g.quadraticCurveTo(x + 20, 128, x - 10, 226);
    g.stroke();
  }
  // The maker's white label in a top corner.
  g.fillStyle = '#f4f2ec';
  g.fillRect(400, 40, 70, 34);
  g.fillStyle = '#9a9a9a';
  for (let k = 0; k < 3; k++) g.fillRect(408, 48 + k * 8, 54 - k * 12, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Loose golden straw, strands every way. */
function strawTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a8803f';
  g.fillRect(0, 0, 256, 256);
  const rng = mulberry32(11);
  for (let i = 0; i < 2400; i++) {
    const x = rng() * 256;
    const y = rng() * 256;
    const a = rng() * Math.PI;
    const l = 6 + rng() * 22;
    const tone = 140 + rng() * 90;
    g.strokeStyle = `rgba(${tone},${tone * 0.78},${tone * 0.42},${0.5 + rng() * 0.5})`;
    g.lineWidth = 0.8 + rng() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // Snow caught in it.
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(245,248,252,${0.3 + rng() * 0.5})`;
    g.beginPath();
    g.arc(rng() * 256, rng() * 256, 1 + rng() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Yellow pine boards, laid horizontally, with grain and knots. */
function boardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  const rng = mulberry32(19);
  const boards = 6;
  for (let b = 0; b < boards; b++) {
    const y0 = (b * 256) / boards;
    const tone = 200 + rng() * 30;
    g.fillStyle = `rgb(${tone},${tone * 0.72},${tone * 0.36})`;
    g.fillRect(0, y0, 512, 256 / boards);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(150,95,40,${0.08 + rng() * 0.15})`;
      g.lineWidth = 1;
      const yy = y0 + rng() * (256 / boards);
      g.beginPath();
      g.moveTo(0, yy);
      g.bezierCurveTo(170, yy + (rng() - 0.5) * 6, 340, yy + (rng() - 0.5) * 6, 512, yy);
      g.stroke();
    }
    if (rng() < 0.7) {
      g.fillStyle = 'rgba(120,70,30,0.6)';
      g.beginPath();
      g.ellipse(rng() * 512, y0 + 20, 6, 4, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(80,50,20,0.55)';
    g.fillRect(0, y0, 512, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
