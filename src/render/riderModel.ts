// A code-built rider on their toboggan, posed from the controls. Arms and legs are two-bone chains
// solved by IK, so poses are described by where the hands, feet and hips should be:
//   forward:   lying flat, hands tucked by the hips, legs out behind;
//   knives:    slid back, chest up, right hand on the front-right handle, left hand on the
//              toboggan's left edge by the hip (as in the photographs);
//   raking:    a boot driven down onto the ice;
//   running:   bent over beside the toboggan, pushing it, legs striding with the ground covered;
//   cheering:  on their feet beside the toboggan at Celerina, arms up.
// Local frame: +X forward (head first), +Y up, +Z to the rider's right; origin on the ice under
// the toboggan's centre.

import * as THREE from 'three';
import type { TobogganId } from '../sim/rider';
import { solveTwoBone } from './ik';
import { LOOKS, type RiderLook } from './riderLooks';

export interface RiderPose {
  posture: number; // 0 forward … 1 knives
  steer: number; // -1 right … +1 left
  rakeLeft: number;
  rakeRight: number;
  /** 0 = running beside the toboggan, 1 = lying on it; in between is the jump on. */
  mount: number;
  runPhase: number; // radians, advances with distance run
  /** 0 = riding, 1 = standing beside the toboggan, arms up, celebrating. */
  cheer?: number;
  /** Seconds into the celebration, for the waving. */
  cheerTime?: number;
}

const m = (color: string, roughness = 0.55, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A limb segment along +X from 0 to `length`, tapering from r0 to r1, with a rounded joint at the start. */
function segment(length: number, r0: number, r1: number, material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, length, 12).rotateZ(-Math.PI / 2).translate(length / 2, 0, 0), material);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(r0 * 1.02, 12, 10), material);
  g.add(shaft, joint);
  return g;
}

interface Chain {
  root: THREE.Group;
  mid: THREE.Group;
  upper: number;
  lower: number;
}

interface Targets {
  pelvis: THREE.Vector3;
  pitch: number;
  roll: number;
  headYaw: number;
  hands: [THREE.Vector3, THREE.Vector3]; // left, right
  feet: [THREE.Vector3, THREE.Vector3];
  elbowPoles: [THREE.Vector3, THREE.Vector3];
  kneePoles: [THREE.Vector3, THREE.Vector3];
}

export class RiderModel {
  readonly root = new THREE.Group();
  readonly toboggan = new THREE.Group();
  /** Everything of the rider, pivoting at the pelvis (detached as one body in a fall). */
  readonly body = new THREE.Group();
  /** The helmet; hidden for the helmet-camera view. */
  readonly head = new THREE.Group();
  /** Soft contact shadow on the ice under the toboggan. */
  readonly contactShadow: THREE.Mesh;
  private readonly torso = new THREE.Group();
  private readonly arms: Chain[] = [];
  private readonly legs: Chain[] = [];
  private readonly shoulder: number;
  private readonly shoulderWidth: number;
  private readonly hipWidth: number;
  private readonly seat: number;
  private readonly handleY: number;
  private readonly look: RiderLook;

  constructor(
    look: RiderLook = LOOKS.adelaide,
    readonly tobogganId: TobogganId = 'traditional',
  ) {
    this.look = look;
    const s = look.scale;
    this.shoulder = 0.5 * s;
    this.shoulderWidth = 0.19 * s * look.build;
    this.hipWidth = 0.1 * s * Math.sqrt(look.build);
    const tob = tobogganId === 'flattop' ? buildFlatTop() : buildTraditional();
    this.toboggan.add(tob.group);
    this.seat = tob.seat;
    this.handleY = tob.handleY;

    this.root.add(this.toboggan, this.body);
    this.body.add(this.torso);
    this.buildTorso(look);
    this.buildHead(look);
    const gloves = m('#18181a', 0.7);
    const boots = m('#151517', 0.6);
    const steel = m('#c9ccd1', 0.25, 0.6);
    const limb = 0.055 * s * look.limbs;
    for (const side of [-1, 1]) {
      // Arms hang off the shoulders, in the torso's frame.
      const upper = 0.3 * s * look.arms;
      const lower = 0.28 * s * look.arms;
      const suitArm = m(side < 0 ? look.suit.leftArm : look.suit.rightArm, 0.45);
      const arm = this.chain(upper, lower, limb * 1.05, limb * 0.85, limb * 0.75, suitArm, suitArm);
      arm.root.position.set(this.shoulder, 0.02, side * this.shoulderWidth);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(limb * 1.15, 10, 8).scale(1.3, 0.8, 1), gloves);
      glove.position.x = lower + limb * 0.6;
      arm.mid.add(glove);
      this.torso.add(arm.root);
      this.arms.push(arm);
      // Legs from the hips, in the pelvis frame.
      const thigh = 0.44 * s;
      const shin = 0.43 * s;
      const suitLeg = m(side < 0 ? look.suit.leftLeg : look.suit.rightLeg, 0.45);
      const leg = this.chain(thigh, shin, limb * 1.7, limb * 1.25, limb * 0.95, suitLeg, suitLeg);
      leg.root.position.set(-0.02, -0.02, side * this.hipWidth);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13 * s, 0.11 * s, 0.11 * s), boots);
      boot.position.set(shin + 0.03 * s, -0.02 * s, 0);
      const rake = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06 * s, 0.1 * s), steel);
      rake.position.set(shin + 0.1 * s, -0.04 * s, 0);
      leg.mid.add(boot, rake);
      this.body.add(leg.root);
      this.legs.push(leg);
    }

    this.root.traverse((o) => (o.castShadow = true));
    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    this.contactShadow.position.set(-0.15, 0.015, 0);
    this.contactShadow.renderOrder = 1;
    this.root.add(this.contactShadow);
    this.setPose({ posture: 0, steer: 0, rakeLeft: 0, rakeRight: 0, mount: 1, runPhase: 0 });
  }

  private chain(upper: number, lower: number, r0: number, r1: number, r2: number, upperMat: THREE.Material, lowerMat: THREE.Material): Chain {
    const root = new THREE.Group();
    root.add(segment(upper, r0, r1, upperMat));
    const mid = new THREE.Group();
    mid.position.x = upper;
    mid.add(segment(lower, r1, r2, lowerMat));
    root.add(mid);
    return { root, mid, upper, lower };
  }

  /** Pelvis to shoulders: a lathe-turned torso, flattened front to back. */
  private buildTorso(look: RiderLook) {
    const s = look.scale;
    const L = this.shoulder;
    const w = look.build;
    const profile = [
      [0.0, 0.13], [0.04, 0.15], [0.14, 0.135], [0.24, 0.14], [0.34, 0.165], [0.43, 0.175], [(L * 0.94) / s, 0.15], [L / s, 0.09], [(L * 1.06) / s, 0.05],
    ].map(([y, r]) => new THREE.Vector2(r * s, y * s));
    const geo = new THREE.LatheGeometry(profile, 18).rotateZ(-Math.PI / 2);
    geo.scale(1, 0.72, w);
    this.torso.add(new THREE.Mesh(geo, m(look.suit.torso, 0.45)));
    // A suit stripe down each flank.
    const stripe = m(look.suit.accent, 0.5);
    for (const side of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(L * 0.85, 0.02 * s, 0.012), stripe);
      band.position.set(L * 0.5, 0.02 * s, side * 0.155 * s * w);
      this.torso.add(band);
    }
  }

  /** Full-face helmet: shell, dark visor, chin guard, stripes; ponytail or beard where they show. */
  private buildHead(look: RiderLook) {
    const s = look.scale;
    const r = 0.145;
    this.head.position.set(this.shoulder + 0.07 * s, 0.02, 0);
    this.torso.add(this.head);
    const shell = m(look.helmet.shell, 0.3, 0.1);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), shell);
    helmet.position.x = r * 0.9;
    helmet.scale.set(1.08, 1, 0.95);
    // Visor and chin guard face forward (+X).
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.02, 20, 10, Math.PI - 0.75, 1.5, 1.35, 0.55),
      new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.08, metalness: 0.6 }),
    );
    visor.position.copy(helmet.position);
    visor.scale.copy(helmet.scale);
    const chin = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, Math.PI - 0.6, 1.2, 1.9, 0.6), shell);
    chin.position.copy(helmet.position);
    chin.scale.copy(helmet.scale);
    this.head.add(helmet, visor, chin);
    look.helmet.stripes.forEach((color, i) => {
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(r * 1.005, 0.018, 6, 24, Math.PI), m(color, 0.35));
      stripe.position.copy(helmet.position);
      stripe.position.z += (i - (look.helmet.stripes.length - 1) / 2) * 0.042;
      stripe.scale.copy(helmet.scale);
      this.head.add(stripe);
    });
    if (look.id === 'remo') {
      // A white cross on each side of the red helmet.
      for (const side of [-1, 1]) {
        const cross = new THREE.Group();
        cross.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.004), m('#ffffff')));
        cross.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.004), m('#ffffff')));
        cross.position.set(helmet.position.x - 0.01, 0.02, side * r * 0.94);
        this.head.add(cross);
      }
    }
    if (look.ponytail) {
      const hair = m(look.ponytail, 0.8);
      const tail = new THREE.Group();
      tail.position.set(helmet.position.x - r * 0.95, -0.03, 0);
      const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.12, 4, 8).rotateZ(Math.PI / 2), hair);
      a.position.x = -0.08;
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.1, 4, 8).rotateZ(Math.PI / 2), hair);
      b.position.set(-0.19, -0.02, 0);
      tail.add(a, b);
      this.head.add(tail);
    }
    if (look.beard) {
      const beard = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8).scale(1, 0.75, 1.2), m(look.beard, 0.95));
      beard.position.set(helmet.position.x + r * 0.55, -r * 0.85, 0);
      this.head.add(beard);
    }
  }

  setPose(p: RiderPose) {
    const ride = this.ridingTargets(p);
    let targets = ride;
    if (p.cheer && p.cheer > 0) targets = blendTargets(ride, this.cheeringTargets(p.cheerTime ?? 0), smooth(p.cheer));
    else if (p.mount < 1) {
      targets = blendTargets(this.runningTargets(p.runPhase), ride, smooth(p.mount));
      targets.pelvis.y += Math.sin(Math.PI * p.mount) * 0.32; // the little spring onto the toboggan
    }
    this.apply(targets);
    const cushion = this.toboggan.getObjectByName('cushion');
    if (cushion) cushion.position.x = THREE.MathUtils.clamp(this.body.position.x * 0.8, -0.25, 0.12);
  }

  /** Lying on the toboggan: forward on the smooth runners, or slid back on the knives. */
  private ridingTargets(p: RiderPose): Targets {
    const s = this.look.scale;
    const k = p.posture;
    const pelvis = V(0.08 - 0.3 * k, this.seat + 0.07 * this.look.build, 0);
    const pitch = 0.03 + 0.24 * k;
    const steerKnives = p.steer * k;
    // Hands: tucked by the hips when forward; on the knives, right on the front handle,
    // left on the left edge by the hip. Steering pushes the hands forward or back a touch.
    const tucked: [THREE.Vector3, THREE.Vector3] = [V(pelvis.x + 0.05, this.seat + 0.05, -0.2 * s), V(pelvis.x + 0.05, this.seat + 0.05, 0.2 * s)];
    const knives: [THREE.Vector3, THREE.Vector3] = [
      V(pelvis.x + 0.14 - steerKnives * 0.05, this.seat + 0.02, -0.25),
      V(0.55 + steerKnives * 0.04, this.handleY, 0.21),
    ];
    const hands: [THREE.Vector3, THREE.Vector3] = [tucked[0].lerp(knives[0], k), tucked[1].lerp(knives[1], k)];
    // Feet: out behind, a little raised and spread (wider on the knives); a raking boot goes down to the ice.
    const legLen = (0.44 + 0.43) * s;
    const foot = (side: number, rake: number) =>
      V(pelvis.x - legLen * (0.95 - rake * 0.12), this.seat + 0.1 - (this.seat + 0.07) * rake, side * (0.14 + 0.08 * k) * s);
    return {
      pelvis,
      pitch,
      roll: -steerKnives * 0.18,
      headYaw: p.steer * (1 - k) * 0.6,
      hands,
      feet: [foot(-1, p.rakeLeft), foot(1, p.rakeRight)],
      // Elbows bend up and out, just above the back, never up into the air.
      elbowPoles: [V(pelvis.x + 0.3, this.seat + 0.38, -0.5), V(pelvis.x + 0.45, this.seat + 0.42, 0.55)],
      kneePoles: [V(pelvis.x - 0.4, -0.6, -0.2), V(pelvis.x - 0.4, -0.6, 0.2)],
    };
  }

  /** Bent over beside the toboggan, pushing it by the handles, legs striding. */
  private runningTargets(phase: number): Targets {
    const s = this.look.scale;
    const pelvis = V(-0.55, 0.9 * s, -0.42);
    const stride = (offset: number) => {
      const a = phase + offset;
      return V(pelvis.x + 0.32 * Math.sin(a) * s, Math.max(0, 0.16 * Math.cos(a)) * s + 0.04, pelvis.z + (offset ? 0.1 : -0.1));
    };
    return {
      pelvis,
      pitch: 0.55,
      roll: 0,
      headYaw: 0,
      hands: [V(0.05, this.handleY + 0.04, -0.24), V(0.42, this.handleY + 0.04, -0.17)],
      feet: [stride(0), stride(Math.PI)],
      elbowPoles: [V(-0.2, 0.4, -1), V(0.2, 0.4, -0.9)],
      kneePoles: [V(pelvis.x + 1, 0.5, pelvis.z - 0.1), V(pelvis.x + 1, 0.5, pelvis.z + 0.1)],
    };
  }

  /** On their feet beside the toboggan at Celerina, arms up and waving. */
  private cheeringTargets(time: number): Targets {
    const s = this.look.scale;
    const pelvis = V(-0.25, 0.92 * s, -0.62);
    const wave = (i: number) => Math.sin(time * 8 + i) * 0.12;
    return {
      pelvis,
      pitch: Math.PI / 2 - 0.05,
      roll: 0,
      headYaw: 0,
      hands: [V(pelvis.x + 0.05 + wave(0), pelvis.y + 1.0 * s, pelvis.z - 0.35), V(pelvis.x + 0.05 + wave(1), pelvis.y + 1.0 * s, pelvis.z + 0.35)],
      feet: [V(pelvis.x + 0.05, 0.05, pelvis.z - 0.13), V(pelvis.x + 0.05, 0.05, pelvis.z + 0.13)],
      elbowPoles: [V(pelvis.x, pelvis.y + 0.4, pelvis.z - 1), V(pelvis.x, pelvis.y + 0.4, pelvis.z + 1)],
      kneePoles: [V(pelvis.x + 1, 0.4, pelvis.z), V(pelvis.x + 1, 0.4, pelvis.z)],
    };
  }

  private apply(t: Targets) {
    this.body.position.copy(t.pelvis);
    this.body.rotation.set(t.roll, 0, t.pitch);
    this.torso.rotation.set(0, 0, 0);
    // Keep the face looking ahead: the neck counters the body's pitch.
    this.head.rotation.set(0, t.headYaw, -t.pitch * 0.85 + 0.05);
    this.body.updateMatrix();
    this.torso.updateMatrix();
    const toBody = this.body.matrix.clone().invert();
    const toTorso = this.body.matrix.clone().multiply(this.torso.matrix).invert();
    const solve = (chain: Chain, target: THREE.Vector3, pole: THREE.Vector3, frame: THREE.Matrix4) => {
      const sol = solveTwoBone(chain.root.position, target.clone().applyMatrix4(frame), chain.upper, chain.lower, pole.clone().applyMatrix4(frame));
      chain.root.quaternion.copy(sol.root);
      chain.mid.rotation.set(0, 0, sol.bend);
    };
    this.arms.forEach((arm, i) => solve(arm, t.hands[i], t.elbowPoles[i], toTorso));
    this.legs.forEach((leg, i) => solve(leg, t.feet[i], t.kneePoles[i], toBody));
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function blendTargets(a: Targets, b: Targets, t: number): Targets {
  const lerp = (x: THREE.Vector3, y: THREE.Vector3) => x.clone().lerp(y, t);
  const pair = (x: [THREE.Vector3, THREE.Vector3], y: [THREE.Vector3, THREE.Vector3]): [THREE.Vector3, THREE.Vector3] => [lerp(x[0], y[0]), lerp(x[1], y[1])];
  return {
    pelvis: lerp(a.pelvis, b.pelvis),
    pitch: a.pitch + (b.pitch - a.pitch) * t,
    roll: a.roll + (b.roll - a.roll) * t,
    headYaw: a.headYaw + (b.headYaw - a.headYaw) * t,
    hands: pair(a.hands, b.hands),
    feet: pair(a.feet, b.feet),
    elbowPoles: pair(a.elbowPoles, b.elbowPoles),
    kneePoles: pair(a.kneePoles, b.kneePoles),
  };
}

/** Traditional: red steel frame on round runners turned up at the front, a sliding cushion, knives at the back. */
function buildTraditional(): { group: THREE.Group; seat: number; handleY: number } {
  const g = new THREE.Group();
  const frame = m('#b3261e', 0.5);
  const steel = m('#c9ccd1', 0.25, 0.7);
  for (const z of [-0.21, 0.21]) {
    const runner = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.15, 8).rotateZ(Math.PI / 2), steel);
    runner.position.set(-0.03, 0.022, z);
    const nose = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 12, Math.PI / 2), steel);
    nose.position.set(0.54, 0.11, z);
    nose.rotation.z = -Math.PI / 2;
    const knife = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.006), steel);
    knife.position.set(-0.46, 0.012, z);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.03, 0.03), frame);
    rail.position.set(0, 0.15, z);
    g.add(runner, nose, knife, rail);
    for (const x of [-0.45, -0.05, 0.38]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.13, 0.025), frame);
      strut.position.set(x, 0.085, z);
      g.add(strut);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), frame);
    handle.position.set(0.55, 0.17, z * 1.04);
    g.add(handle);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.012, 0.44), frame);
  plate.position.y = 0.165;
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.38), m('#202022', 0.8));
  cushion.position.y = 0.205;
  cushion.name = 'cushion';
  g.add(plate, cushion);
  return { group: g, seat: 0.24, handleY: 0.17 };
}

/** Flat-top: a low carbon board on fine runners, side grips, no cushion. */
function buildFlatTop(): { group: THREE.Group; seat: number; handleY: number } {
  const g = new THREE.Group();
  const steel = m('#c9ccd1', 0.25, 0.7);
  const shape = new THREE.Shape();
  const L = 0.6;
  const W = 0.23;
  shape.moveTo(-L, -W);
  shape.lineTo(L - 0.1, -W);
  shape.quadraticCurveTo(L, -W, L, -W + 0.1);
  shape.lineTo(L, W - 0.1);
  shape.quadraticCurveTo(L, W, L - 0.1, W);
  shape.lineTo(-L, W);
  shape.lineTo(-L, -W);
  const board = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 2 }).rotateX(-Math.PI / 2),
    m('#2a2c30', 0.35, 0.3),
  );
  board.position.y = 0.08;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.42), m('#f2f2f2', 0.4));
  nose.position.set(0.5, 0.1, 0);
  g.add(board, nose);
  for (const z of [-0.2, 0.2]) {
    const runner = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.15, 8).rotateZ(Math.PI / 2), steel);
    runner.position.set(0, 0.012, z);
    const knife = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.005), steel);
    knife.position.set(-0.45, 0.008, z);
    const grip = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 12, Math.PI), steel);
    grip.position.set(0.52, 0.1, z * 1.12);
    grip.rotation.x = Math.PI / 2;
    for (const x of [-0.4, 0.35]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.02), steel);
      post.position.set(x, 0.045, z);
      g.add(post);
    }
    g.add(runner, knife, grip);
  }
  return { group: g, seat: 0.14, handleY: 0.11 };
}

let blob: THREE.CanvasTexture | null = null;

/** Radial falloff used for the contact shadow. */
function blobTexture(): THREE.CanvasTexture {
  if (blob) return blob;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(20,30,45,0.9)');
  grad.addColorStop(0.55, 'rgba(20,30,45,0.45)');
  grad.addColorStop(1, 'rgba(20,30,45,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blob = new THREE.CanvasTexture(canvas);
  return blob;
}
