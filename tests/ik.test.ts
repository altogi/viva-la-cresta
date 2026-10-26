import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { solveTwoBone } from '../src/render/ik';

/** Where the end of the chain lands, given the solution. */
function endPoint(origin: THREE.Vector3, upper: number, lower: number, sol: ReturnType<typeof solveTwoBone>) {
  const elbow = new THREE.Vector3(upper, 0, 0).applyQuaternion(sol.root).add(origin);
  const lowerDir = new THREE.Vector3(lower, 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), sol.bend).applyQuaternion(sol.root);
  return { elbow, hand: elbow.clone().add(lowerDir) };
}

describe('two-bone IK', () => {
  const cases: [number[], number[], number[]][] = [
    [[0, 0, 0], [0.4, -0.3, 0.1], [0.1, 0.2, 0.5]],
    [[0.5, 0.1, 0.2], [0.05, -0.2, 0.25], [0.3, 0.4, 0.6]],
    [[0, 0, 0], [0, -0.6, 0], [0.5, -0.3, 0]],
  ];
  for (const [o, t, p] of cases) {
    it(`reaches ${t} and bends towards the pole`, () => {
      const origin = new THREE.Vector3(...o);
      const target = new THREE.Vector3(...t);
      const pole = new THREE.Vector3(...p);
      const sol = solveTwoBone(origin, target, 0.32, 0.3, pole);
      const { elbow, hand } = endPoint(origin, 0.32, 0.3, sol);
      expect(hand.distanceTo(target)).toBeLessThan(1e-3);
      // The elbow sits on the pole's side of the straight line to the target.
      const line = target.clone().sub(origin).normalize();
      const off = elbow.clone().sub(origin);
      off.sub(line.clone().multiplyScalar(off.dot(line)));
      const poleOff = pole.clone().sub(origin);
      poleOff.sub(line.clone().multiplyScalar(poleOff.dot(line)));
      expect(off.dot(poleOff)).toBeGreaterThan(0);
    });
  }

  it('points a straight limb at a target out of reach', () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(1, -1, 0);
    const sol = solveTwoBone(origin, target, 0.32, 0.3, new THREE.Vector3(0.5, 0, 0.3));
    const { hand } = endPoint(origin, 0.32, 0.3, sol);
    expect(hand.length()).toBeCloseTo(0.62, 2);
    expect(hand.clone().normalize().dot(target.clone().normalize())).toBeGreaterThan(0.999);
  });
});
