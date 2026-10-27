// The Steinbock: one ride in a hundred, a billy ibex has wandered down onto the ice just after
// Shuttlecock. He ambles about the run, freezes and stares as a rider comes, and bounds away over
// the wall if he's hit (or once the rider is past).

import * as THREE from 'three';
import type { Track } from '../sim/track';
import { surfaceAt } from '../sim/surface';
import { toThree } from './util';

/** Where he stands: in Stream, just below Shuttlecock. */
export const STEINBOCK_S = 652;

export class Steinbock {
  readonly root = new THREE.Group();
  /** Lateral position on the run (positive left). */
  u = 0;
  private time = 0;
  private wander = 0;
  private leap: { t: number; from: THREE.Vector3; dir: THREE.Vector3 } | null = null;

  constructor(
    template: THREE.Object3D,
    private readonly track: Track,
  ) {
    const goat = template.clone();
    goat.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    this.root.add(goat);
    this.root.name = 'steinbock';
  }

  /** Put him on the ice for this ride. */
  place() {
    this.u = (Math.random() - 0.5) * 0.7;
    this.wander = Math.random() < 0.5 ? 1 : -1;
    this.leap = null;
    this.time = 0;
    this.root.visible = true;
    this.pose(false);
  }

  /** Hit, or the rider is by: off he goes, up and over the wall. */
  flee() {
    if (this.leap) return;
    const st = this.track.frame(STEINBOCK_S);
    const side = this.u > 0 ? 1 : -1;
    this.leap = { t: 0, from: this.root.position.clone(), dir: toThree([st.left[0] * side, st.left[1] * side, 0]).normalize() };
  }

  update(dt: number, riderS: number | null) {
    if (!this.root.visible) return;
    this.time += dt;
    if (this.leap) {
      // Three bounds away from the run, then gone.
      const l = this.leap;
      l.t += dt;
      const hop = (l.t % 0.55) / 0.55;
      this.root.position.copy(l.from).addScaledVector(l.dir, l.t * 5).add(new THREE.Vector3(0, Math.sin(hop * Math.PI) * 1.1 + l.t * 0.8, 0));
      this.root.rotation.y = Math.atan2(-l.dir.z, l.dir.x);
      if (l.t > 1.8) this.root.visible = false;
      return;
    }
    const coming = riderS !== null && riderS > STEINBOCK_S - 45 && riderS < STEINBOCK_S;
    if (!coming) {
      // Ambling across the run and back.
      this.u += this.wander * dt * 0.18;
      if (Math.abs(this.u) > 0.45) this.wander = -Math.sign(this.u);
    }
    if (riderS !== null && riderS > STEINBOCK_S + 3) this.flee();
    this.pose(coming);
  }

  /** On the ice across the run, facing the way he's going (or up the run, staring, as a rider comes). */
  private pose(staring: boolean) {
    const frame = this.track.frame(STEINBOCK_S);
    const sp = surfaceAt(this.track.section(STEINBOCK_S), this.u);
    toThree(this.track.toWorld(frame, sp.y, sp.z), this.root.position);
    const across = toThree([frame.left[0] * this.wander, frame.left[1] * this.wander, 0]).normalize();
    const up = toThree([-frame.forward[0], -frame.forward[1], 0]).normalize();
    const look = staring ? across.clone().lerp(up, 0.7).normalize() : across;
    this.root.rotation.y = Math.atan2(-look.z, look.x);
    // A little bob of the head as he walks.
    const goat = this.root.children[0];
    goat.position.y = staring ? 0 : Math.abs(Math.sin(this.time * 4)) * 0.02;
  }
}
