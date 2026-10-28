// The fall zone beyond Shuttlecock, from the photographs: a bed of straw along the run's outer lip,
// a strip of snow, then two staggered rows of padded red vinyl mats (white labels, seams, snow on
// top), and behind them a wall of yellow timber boards. The mats are heavy but loose: a rider who
// flies out smashes into them, shoves them back and tips them, and drops into the straw.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Track } from '../sim/track';
import type { Terrain } from './terrain';
import { BENDS } from '../track/cresta';
import { lips } from '../sim/surface';
import { mulberry32, toThree } from './util';
import { groundHeight } from './ground';

/** Distances out from the run's outer lip (m). */
export const PADDING = { straw: 3.2, front: 4.9, back: 6.1, fence: 7.3 };
const MAT = { length: 2.6, height: 1.1, depth: 0.75, mass: 90 };

interface Mat {
  mesh: THREE.Object3D;
  /** Rest pose. */
  home: THREE.Vector3;
  heading: number;
  /** Outward (away from the run) in the horizontal plane. */
  out: THREE.Vector3;
  /** Shoved this far back, and tipped this far over (radians), and how fast each is changing. */
  shove: number;
  tip: number;
  shoveV: number;
  tipV: number;
}

export class Padding {
  readonly group = new THREE.Group();
  private readonly mats: Mat[] = [];

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
    const straw = new THREE.MeshStandardMaterial({ map: strawTexture(), roughness: 1, color: '#c9a25e' });
    const boards = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.8 });
    const post = new THREE.MeshStandardMaterial({ color: '#8a6a44', roughness: 0.85 });
    const strawPos: number[] = [];
    const strawUv: number[] = [];
    const strawIdx: number[] = [];
    let row = 0;
    for (let s = bend.s0 - 6; s <= bend.s1 + 16; s += 1) {
      const st = track.frame(s);
      const lip = lips(track.section(s)).right;
      // The straw bed: a soft strip from just over the lip outwards, lying on the ground.
      for (const [out, v] of [[0.2, 0], [PADDING.straw * 0.5, 0.5], [PADDING.straw, 1]] as const) {
        const u = lip - out;
        const x = st.pos[0] + st.left[0] * u;
        const y = st.pos[1] + st.left[1] * u;
        strawPos.push(x, this.ground(x, y) + 0.06 + (out < 1 ? 0.04 : 0), -y);
        strawUv.push(s / 3, v);
      }
      if (row > 0) {
        const a = (row - 1) * 3;
        const b = row * 3;
        for (let k = 0; k < 2; k++) strawIdx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
      }
      row++;
    }
    const strawGeo = new THREE.BufferGeometry();
    strawGeo.setAttribute('position', new THREE.Float32BufferAttribute(strawPos, 3));
    strawGeo.setAttribute('uv', new THREE.Float32BufferAttribute(strawUv, 2));
    strawGeo.setIndex(strawIdx);
    strawGeo.computeVertexNormals();
    const bed = new THREE.Mesh(strawGeo, straw);
    bed.receiveShadow = true;
    this.group.add(bed);
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
        this.mats.push({ mesh, home, heading, out: outDir, shove: 0, tip: 0, shoveV: 0, tipV: 0 });
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
   * A tumbling body (a sphere of `radius` at `pos`, moving at `vel`) against the mats: pushed back
   * out of any it has run into, giving the mat some of its momentum (it slides back and tips), and
   * losing most of its own.
   */
  collide(pos: THREE.Vector3, vel: THREE.Vector3, radius: number, mass: number): boolean {
    let hit = false;
    const local = new THREE.Vector3();
    for (const m of this.mats) {
      if (Math.abs(m.mesh.position.x - pos.x) > 3 || Math.abs(m.mesh.position.z - pos.z) > 3) continue;
      // Into the mat's own frame (x along it, z across it, y up), allowing for its shove and tip.
      local.copy(pos).sub(m.mesh.position);
      local.applyAxisAngle(new THREE.Vector3(0, 1, 0), -m.heading);
      const hx = MAT.length / 2 + radius;
      const hy = MAT.height / 2 + radius;
      const hz = MAT.depth / 2 + radius;
      if (Math.abs(local.x) > hx || Math.abs(local.y) > hy || Math.abs(local.z) > hz) continue;
      // Out the way it came: through the face nearest the run (or over the top if it's above it).
      const speedIn = Math.max(0, vel.dot(m.out));
      if (local.y > MAT.height / 2 - 0.1 && vel.y < 0) {
        pos.y += hy - local.y;
        vel.y = Math.abs(vel.y) * 0.2;
      } else {
        const push = hz - Math.abs(local.z);
        // Back out towards the run.
        pos.addScaledVector(m.out, -push);
        // The mat takes the blow: slides back and tips over, heavy as it is.
        const impulse = (mass * speedIn) / (mass + MAT.mass);
        m.shoveV += impulse * 0.9;
        m.tipV += impulse * (local.y + MAT.height / 2) * 0.9;
        vel.addScaledVector(m.out, -speedIn * 1.25);
      }
      vel.x *= 0.6;
      vel.z *= 0.6;
      hit = true;
    }
    return hit;
  }

  /** Mats that were hit slide to a stop and settle (tipping back if not too far over). */
  update(dt: number) {
    for (const m of this.mats) {
      if (m.shoveV === 0 && m.tipV === 0 && m.shove === 0 && m.tip === 0) continue;
      m.shove = Math.min(1.4, m.shove + m.shoveV * dt);
      m.shoveV *= Math.exp(-dt * 4);
      if (Math.abs(m.shoveV) < 0.01) m.shoveV = 0;
      m.tip += m.tipV * dt;
      // Heavy and soft: tips settle back unless pushed past about 40 degrees.
      const back = m.tip < 0.7 ? -m.tip * 6 : 0;
      m.tipV = (m.tipV + back * dt) * Math.exp(-dt * 3);
      m.tip = Math.max(0, Math.min(1.3, m.tip));
      if (Math.abs(m.tipV) < 0.005 && m.tip < 0.01) {
        m.tipV = 0;
        m.tip = 0;
      }
      m.mesh.position.copy(m.home).addScaledVector(m.out, m.shove);
      // Tipping about the bottom edge furthest from the run.
      m.mesh.rotation.set(0, m.heading, 0);
      m.mesh.rotateX(-m.tip);
      m.mesh.position.y = m.home.y - (MAT.height / 2) * (1 - Math.cos(m.tip)) + (MAT.depth / 2) * Math.sin(m.tip) * 0.3;
    }
  }

  /** All back as they were, for the next ride. */
  reset() {
    for (const m of this.mats) {
      m.shove = m.tip = m.shoveV = m.tipV = 0;
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
