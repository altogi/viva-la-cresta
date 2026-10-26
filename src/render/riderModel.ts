// Articulated stand-in rider on a traditional toboggan, posed from the controls:
// forward vs back on the knives, arm steering, head turns, raking feet, the running start.
// Local frame: +X forward (head first), +Y up, +Z to the rider's right. Proper riders come in Phase 3.

import * as THREE from 'three';

export interface RiderPose {
  posture: number; // 0 forward … 1 knives
  steer: number; // -1 right … +1 left
  rakeLeft: number;
  rakeRight: number;
  running: boolean;
  runPhase: number; // radians, advances with strides
}

const m = (color: string, roughness = 0.55) => new THREE.MeshStandardMaterial({ color, roughness });

export class RiderModel {
  readonly root = new THREE.Group();
  readonly toboggan = new THREE.Group();
  readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly legs: THREE.Group[] = [];

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
    this.setPose({ posture: 0, steer: 0, rakeLeft: 0, rakeRight: 0, running: false, runPhase: 0 });
  }

  setPose(p: RiderPose) {
    const cushion = this.toboggan.getObjectByName('cushion')!;
    if (p.running) {
      // Bent over beside the toboggan, pushing it by the handles. Body pitch 0.5 rad; limbs are
      // set in world angles relative to that pitch (legs straight down is π/2 from the -X axis).
      const pitch = 0.5;
      this.body.position.set(-0.55, 0.92, -0.32);
      this.body.rotation.set(0, 0, pitch);
      this.torso.rotation.set(0, 0, 0);
      this.head.rotation.set(0, 0, -0.35);
      this.arms.forEach((a) => a.rotation.set(0, 0, -1.05 - pitch));
      this.legs.forEach((leg, i) => leg.rotation.set(0, 0, Math.PI / 2 - pitch + Math.sin(p.runPhase + i * Math.PI) * 0.55));
      cushion.position.x = 0;
      return;
    }
    // Weight forward on the smooth runners, or slid back with the knives cutting in.
    const slide = 0.12 - p.posture * 0.32;
    this.body.position.set(slide, 0.3, 0);
    this.body.rotation.set(0, 0, 0.04 + p.posture * 0.12);
    cushion.position.x = slide * 0.8;
    // Arm steering on the knives rolls the shoulders; forward, the head turns into the wind.
    const steerKnives = p.steer * p.posture;
    const steerHead = p.steer * (1 - p.posture);
    this.torso.rotation.set(-steerKnives * 0.25, 0, 0);
    this.head.rotation.set(0, steerHead * 0.6, 0);
    this.arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      // Knives: reaching down to the front handles, pushing on the outside arm. Forward: tucked back.
      const reach = -0.35 - p.posture * 0.2 + (side * steerKnives > 0 ? -0.25 : 0) * Math.abs(steerKnives);
      a.rotation.set(0, (1 - p.posture) * side * 2.6, reach * p.posture + (1 - p.posture) * 0.2);
    });
    // Feet up, or a boot driven down onto the ice.
    this.legs.forEach((leg, i) => {
      const rake = i === 0 ? p.rakeLeft : p.rakeRight; // legs[0] is on the left (-Z)
      leg.rotation.set(0, 0, -0.12 + rake * 0.42);
    });
  }
}
