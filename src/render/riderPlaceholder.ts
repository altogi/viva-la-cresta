// Stand-in rider on a traditional toboggan, for scale in the track viewer.
// Local frame: +X forward (head first), +Y up, +Z to the rider's right. Proper riders come in Phase 3.

import * as THREE from 'three';

export function buildRiderPlaceholder(): THREE.Group {
  const rider = new THREE.Group();
  const m = (color: string, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
  const suit = m('#2f6fd6');
  const black = m('#1c1c1f');

  // Toboggan: steel runners, red frame, black cushion.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.46), m('#b3261e'));
  frame.position.y = 0.12;
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.4), black);
  cushion.position.set(-0.05, 0.19, 0);
  rider.add(frame, cushion);
  for (const z of [-0.2, 0.2]) {
    const runner = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.03, 0.03), m('#c9ccd1', 0.2));
    runner.position.set(0, 0.03, z);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.03), m('#c9ccd1', 0.2));
    strut.position.set(0.5, 0.075, z);
    rider.add(runner, strut);
  }

  // Rider lying head first.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.6, 4, 8).rotateZ(Math.PI / 2), suit);
  torso.position.set(0.05, 0.36, 0);
  torso.scale.set(1, 0.75, 1.15);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), m('#f4f4f4', 0.3));
  helmet.position.set(0.6, 0.42, 0);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 4, 16, Math.PI), m('#d6312b'));
  stripe.rotation.set(0, Math.PI / 2, 0);
  stripe.position.copy(helmet.position);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.22), black);
  visor.position.set(0.73, 0.4, 0);
  rider.add(torso, helmet, stripe, visor);
  for (const z of [-0.13, 0.13]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.42, 3, 6).rotateZ(Math.PI / 2 - 0.25), suit);
    arm.position.set(0.45, 0.26, z * 1.6);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.75, 3, 6).rotateZ(Math.PI / 2 + 0.12), suit);
    leg.position.set(-0.7, 0.3, z);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.1), black);
    boot.position.set(-1.12, 0.22, z);
    rider.add(arm, leg, boot);
  }
  rider.traverse((o) => (o.castShadow = true));
  return rider;
}
