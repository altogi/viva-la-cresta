// A simple fall: rider and toboggan part company and tumble as two free bodies until they stop
// in the straw, the snow or the ice. Purely visual; the ride result is already decided.

import * as THREE from 'three';

interface Body {
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  radius: number;
}

export class Ragdoll {
  private bodies: Body[] = [];
  active = false;

  constructor(
    private readonly scene: THREE.Scene,
    /** Ground height (Three.js y) at a Three.js (x, z) point. */
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  /** Detach the parts from the rider and throw them with the rider's velocity. */
  start(parts: { object: THREE.Object3D; radius: number; kick: number }[], velocity: THREE.Vector3, seed: number) {
    let r = seed;
    const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1;
    this.bodies = parts.map(({ object, radius, kick }) => {
      this.scene.attach(object); // keep its world transform
      const v = velocity.clone().multiplyScalar(0.85 + 0.1 * rand());
      v.y += kick;
      v.x += rand() * 1.2;
      v.z += rand() * 1.2;
      return { object, velocity: v, spin: new THREE.Vector3(rand() * 8, rand() * 5, rand() * 8), radius };
    });
    this.active = true;
  }

  update(dt: number) {
    if (!this.active) return;
    const q = new THREE.Quaternion();
    for (const b of this.bodies) {
      b.velocity.y -= 9.81 * dt;
      b.object.position.addScaledVector(b.velocity, dt);
      const ground = this.groundAt(b.object.position.x, b.object.position.z) + b.radius;
      if (b.object.position.y < ground) {
        b.object.position.y = ground;
        if (b.velocity.y < 0) b.velocity.y *= -0.25;
        // Scrub speed and spin on contact.
        const k = Math.exp(-dt * 2.2);
        b.velocity.x *= k;
        b.velocity.z *= k;
        b.spin.multiplyScalar(Math.exp(-dt * 3));
      }
      const angle = b.spin.length() * dt;
      if (angle > 1e-5) {
        q.setFromAxisAngle(b.spin.clone().normalize(), angle);
        b.object.quaternion.premultiply(q);
      }
    }
  }

  /** Centre of the tumbling rider, for the camera. */
  focus(): THREE.Vector3 | null {
    return this.bodies[0]?.object.getWorldPosition(new THREE.Vector3()) ?? null;
  }

  clear() {
    for (const b of this.bodies) b.object.removeFromParent();
    this.bodies = [];
    this.active = false;
  }
}
