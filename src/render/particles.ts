// Debris kicked up by a fall: straw stalks (beyond Shuttlecock's lip) and puffs of snow; and the
// fine ice powder a raking boot throws up.
// Pooled instanced meshes; each particle flies, tumbles, lands and fades.

import * as THREE from 'three';

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  resting: boolean;
}

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private readonly items: Particle[] = [];
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, count: number, private readonly drag: number) {
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    for (let i = 0; i < count; i++) {
      this.items.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), age: 0, life: 1, size: 1, resting: false });
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
  }

  emit(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, rand: () => number) {
    const p = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    p.alive = true;
    p.resting = false;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.rot.set(rand() * 6, rand() * 6, rand() * 6);
    p.spin.set((rand() - 0.5) * 20, (rand() - 0.5) * 20, (rand() - 0.5) * 20);
    p.age = 0;
    p.life = life;
    p.size = size;
  }

  update(dt: number, groundAt: (x: number, z: number) => number) {
    this.items.forEach((p, i) => {
      if (!p.alive) return;
      p.age += dt;
      if (p.age > p.life) {
        p.alive = false;
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        return;
      }
      if (!p.resting) {
        p.vel.y -= 9.81 * dt;
        p.vel.multiplyScalar(Math.exp(-this.drag * dt));
        p.pos.addScaledVector(p.vel, dt);
        p.rot.x += p.spin.x * dt;
        p.rot.y += p.spin.y * dt;
        p.rot.z += p.spin.z * dt;
        const ground = groundAt(p.pos.x, p.pos.z) + 0.02;
        if (p.pos.y < ground) {
          p.pos.y = ground;
          p.resting = true;
        }
      }
      const fade = Math.min(1, (p.life - p.age) / 0.6);
      this.s.setScalar(p.size * fade);
      this.mesh.setMatrixAt(i, this.m.compose(p.pos, this.q.setFromEuler(p.rot), this.s));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class FallDebris {
  readonly group = new THREE.Group();
  private readonly straw: Pool;
  private readonly snow: Pool;
  private readonly powder: Pool;
  private seed = 1;

  constructor(private readonly groundAt: (x: number, z: number) => number) {
    this.straw = new Pool(
      new THREE.BoxGeometry(0.32, 0.018, 0.018),
      new THREE.MeshStandardMaterial({ color: '#d4ab55', roughness: 0.9 }),
      260,
      1.8,
    );
    this.snow = new Pool(
      new THREE.IcosahedronGeometry(0.09, 0),
      new THREE.MeshStandardMaterial({ color: '#f7fafd', roughness: 1, transparent: true, opacity: 0.85 }),
      160,
      2.6,
    );
    this.powder = new Pool(
      new THREE.IcosahedronGeometry(0.03, 0),
      new THREE.MeshStandardMaterial({ color: '#f4f8fc', roughness: 1, transparent: true, opacity: 0.75, depthWrite: false }),
      400,
      4.5,
    );
    this.powder.mesh.castShadow = false;
    this.group.add(this.straw.mesh, this.snow.mesh, this.powder.mesh);
  }

  private rand = () => {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  };

  /** A burst where a body hits the ground, carrying some of its momentum. */
  burst(at: THREE.Vector3, velocity: THREE.Vector3, straw: boolean, strength = 1) {
    const r = this.rand;
    const carry = velocity.clone().multiplyScalar(0.35);
    if (straw) {
      for (let i = 0; i < 90 * strength; i++) {
        const v = new THREE.Vector3((r() - 0.5) * 6, 2 + r() * 5, (r() - 0.5) * 6).add(carry);
        this.straw.emit(at.clone().add(new THREE.Vector3((r() - 0.5) * 0.8, 0.1, (r() - 0.5) * 0.8)), v, 2.5 + r() * 2, 0.7 + r() * 0.7, r);
      }
    }
    for (let i = 0; i < 50 * strength; i++) {
      const v = new THREE.Vector3((r() - 0.5) * 4, 1 + r() * 3.5, (r() - 0.5) * 4).add(carry);
      this.snow.emit(at.clone().add(new THREE.Vector3((r() - 0.5) * 0.6, 0.1, (r() - 0.5) * 0.6)), v, 0.9 + r() * 0.8, 0.6 + r() * 1.4, r);
    }
  }

  /** Ice powder from a raking boot: `count` grains thrown up and out, carried along at `carry`. */
  spray(at: THREE.Vector3, carry: THREE.Vector3, count: number) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      const v = carry.clone().multiplyScalar(0.45 + r() * 0.35).add(new THREE.Vector3((r() - 0.5) * 2.4, 0.8 + r() * 2.2, (r() - 0.5) * 2.4));
      this.powder.emit(at.clone().add(new THREE.Vector3((r() - 0.5) * 0.08, 0.02, (r() - 0.5) * 0.08)), v, 0.35 + r() * 0.45, 0.5 + r() * 1.1, r);
    }
  }

  update(dt: number) {
    this.straw.update(dt, this.groundAt);
    this.snow.update(dt, this.groundAt);
    this.powder.update(dt, this.groundAt);
  }
}
