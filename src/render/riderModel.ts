// Articulated stand-in rider on a traditional toboggan, posed from the controls:
// forward vs back on the knives, arm steering, head turns, raking feet, the running start.
// Local frame: +X forward (head first), +Y up, +Z to the rider's right. Proper riders come in Phase 3.

import * as THREE from 'three';

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

const m = (color: string, roughness = 0.55) => new THREE.MeshStandardMaterial({ color, roughness });

export class RiderModel {
  readonly root = new THREE.Group();
  readonly toboggan = new THREE.Group();
  readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  /** The helmet; hidden for the helmet-camera view. */
  readonly head = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly legs: THREE.Group[] = [];
  /** Soft contact shadow on the ice under the toboggan. */
  readonly contactShadow: THREE.Mesh;

  constructor() {
    const suit = m('#2f6fd6');
    const black = m('#1c1c1f');
    const steel = m('#c9ccd1', 0.25);

    // Toboggan: steel runners, red frame, black sliding cushion.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.46), m('#b3261e'));
    frame.position.y = 0.12;
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.4), black);
    cushion.position.set(0, 0.19, 0);
    cushion.name = 'cushion';
    this.toboggan.add(frame, cushion);
    for (const z of [-0.2, 0.2]) {
      const runner = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.03, 0.03), steel);
      runner.position.set(0, 0.03, z);
      const strutF = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.03), steel);
      strutF.position.set(0.5, 0.075, z);
      const strutB = strutF.clone();
      strutB.position.x = -0.45;
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.04), steel);
      handle.position.set(0.55, 0.17, z * 1.05);
      this.toboggan.add(runner, strutF, strutB, handle);
    }

    // Body, lying head first along +X, pivoting about the hips.
    this.root.add(this.toboggan, this.body);
    this.body.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.55, 4, 10).rotateZ(Math.PI / 2), suit);
    chest.scale.set(1, 0.72, 1.12);
    chest.position.x = 0.32;
    this.torso.add(chest);
    this.head.position.set(0.78, 0.06, 0);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), m('#f4f4f4', 0.25));
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.024, 6, 20, Math.PI), m('#d6312b'));
    stripe.rotation.y = Math.PI / 2;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.22), m('#18181b', 0.1));
    visor.position.set(0.12, -0.02, 0);
    this.head.add(helmet, stripe, visor);
    this.torso.add(this.head);
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(0.58, 0, side * 0.2);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.42, 3, 8).rotateZ(Math.PI / 2), suit);
      upper.position.x = 0.24;
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), black);
      glove.position.x = 0.5;
      arm.add(upper, glove);
      this.torso.add(arm);
      this.arms.push(arm);
      const leg = new THREE.Group();
      leg.position.set(0, -0.02, side * 0.11);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.8, 3, 8).rotateZ(Math.PI / 2), suit);
      thigh.position.x = -0.45;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 0.1), black);
      boot.position.set(-0.92, -0.05, 0);
      const rake = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.09), steel);
      rake.position.set(-0.99, -0.13, 0);
      leg.add(thigh, boot, rake);
      this.body.add(leg);
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

  setPose(p: RiderPose) {
    const cushion = this.toboggan.getObjectByName('cushion')!;
    this.lyingPose(p);
    cushion.position.x = this.body.position.x * 0.8;
    if (p.cheer && p.cheer > 0) {
      const lying = this.capture();
      this.cheeringPose(p.cheerTime ?? 0);
      const cheering = this.capture();
      const t = p.cheer * p.cheer * (3 - 2 * p.cheer);
      this.apply(lying, cheering, t);
      return;
    }
    if (p.mount >= 1) return;
    // Blend from running beside the toboggan to lying on it, with a little spring in between.
    const lying = this.capture();
    this.runningPose(p);
    const running = this.capture();
    const t = p.mount * p.mount * (3 - 2 * p.mount);
    this.apply(running, lying, t);
    this.body.position.y += Math.sin(Math.PI * p.mount) * 0.32;
  }

  /** Bent over beside the toboggan, pushing it by the handles; legs move with the distance run. */
  private runningPose(p: RiderPose) {
    // Limbs are set relative to the body's pitch (legs straight down is π/2 from the -X axis).
    const pitch = 0.5;
    this.body.position.set(-0.55, 0.92, -0.32);
    this.body.rotation.set(0, 0, pitch);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, -0.35);
    this.arms.forEach((a) => a.rotation.set(0, 0, -1.05 - pitch));
    this.legs.forEach((leg, i) => leg.rotation.set(0, 0, Math.PI / 2 - pitch + Math.sin(p.runPhase + i * Math.PI) * 0.55));
  }

  /** Up on their feet beside the toboggan, arms raised and waving. */
  private cheeringPose(time: number) {
    const pitch = Math.PI / 2 - 0.08;
    this.body.position.set(-0.25, 0.97, -0.55);
    this.body.rotation.set(0, 0, pitch);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, -0.15);
    this.arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      a.rotation.set(0, -side * (0.45 + 0.18 * Math.sin(time * 9 + i)), -0.2);
    });
    this.legs.forEach((leg, i) => leg.rotation.set(0, 0, (i === 0 ? 1 : -1) * 0.04));
  }

  private lyingPose(p: RiderPose) {
    // Weight forward on the smooth runners, or slid back with the knives cutting in.
    const slide = 0.12 - p.posture * 0.32;
    this.body.position.set(slide, 0.3, 0);
    this.body.rotation.set(0, 0, 0.04 + p.posture * 0.12);
    // Arm steering on the knives rolls the shoulders; forward, the head turns into the wind.
    const steerKnives = p.steer * p.posture;
    const steerHead = p.steer * (1 - p.posture);
    this.torso.rotation.set(-steerKnives * 0.25, 0, 0);
    this.head.rotation.set(0, steerHead * 0.6, 0);
    // Forward: arms tucked back along the body. On the knives (as in the photographs): the right
    // arm stretched forward to the right front handle, the left hand gripping the toboggan's left
    // edge beside the hip. Steering shifts the reach a little.
    const pitch = this.body.rotation.z;
    this.arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1; // arms[0] is the left (-Z)
      const tucked = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * 2.6, 0.2));
      const reach =
        side > 0
          ? new THREE.Vector3(0.55, -0.38, 0.06 - p.steer * 0.08) // right: to the front handle
          : new THREE.Vector3(-0.49, -0.23, -0.06 + p.steer * 0.06); // left: down beside the hip
      // Into the torso's frame, which is pitched with the body.
      reach.applyAxisAngle(new THREE.Vector3(0, 0, 1), -pitch).normalize();
      const knives = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), reach);
      a.quaternion.slerpQuaternions(tucked, knives, p.posture);
    });
    // Feet up, or a boot driven down onto the ice.
    this.legs.forEach((leg, i) => {
      const rake = i === 0 ? p.rakeLeft : p.rakeRight; // legs[0] is on the left (-Z)
      leg.rotation.set(0, 0, -0.12 + rake * 0.42);
    });
  }

  private parts() {
    return [this.body, this.torso, this.head, ...this.arms, ...this.legs];
  }

  private capture() {
    return this.parts().map((o) => ({ p: o.position.clone(), r: new THREE.Vector3(o.rotation.x, o.rotation.y, o.rotation.z) }));
  }

  private apply(from: ReturnType<RiderModel['capture']>, to: ReturnType<RiderModel['capture']>, t: number) {
    this.parts().forEach((o, i) => {
      o.position.lerpVectors(from[i].p, to[i].p, t);
      const r = from[i].r.clone().lerp(to[i].r, t);
      o.rotation.set(r.x, r.y, r.z);
    });
  }
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
