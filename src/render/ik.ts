// Two-bone inverse kinematics for arms and legs: given where the hand (or foot) should be,
// aim the upper bone and bend the joint so the end lands there, bending towards a pole.
// Bones lie along each joint's local +X; joints bend about their local Z.

import * as THREE from 'three';

const X = new THREE.Vector3(1, 0, 0);

export interface TwoBoneSolution {
  /** Orientation of the root joint (shoulder or hip) in its parent's frame. */
  root: THREE.Quaternion;
  /** Bend of the middle joint (elbow or knee) about its local Z, in radians. */
  bend: number;
}

/**
 * Solve a two-bone chain whose root sits at `origin` (in the parent's frame). `pole` is a point
 * the middle joint should bend towards (an elbow out and back, a knee forward).
 */
export function solveTwoBone(
  origin: THREE.Vector3,
  target: THREE.Vector3,
  upper: number,
  lower: number,
  pole: THREE.Vector3,
): TwoBoneSolution {
  const d = target.clone().sub(origin);
  const reach = THREE.MathUtils.clamp(d.length(), Math.abs(upper - lower) + 1e-3, upper + lower - 1e-3);
  const dir = d.lengthSq() > 1e-9 ? d.normalize() : X.clone();
  // Angle at the root between the target direction and the upper bone (law of cosines).
  const rootAngle = Math.acos(THREE.MathUtils.clamp((upper * upper + reach * reach - lower * lower) / (2 * upper * reach), -1, 1));
  const midAngle = Math.acos(THREE.MathUtils.clamp((upper * upper + lower * lower - reach * reach) / (2 * upper * lower), -1, 1));
  // The plane of the bend contains the target direction and the pole.
  const toPole = pole.clone().sub(origin);
  let axis = new THREE.Vector3().crossVectors(dir, toPole);
  if (axis.lengthSq() < 1e-9) axis = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
  if (axis.lengthSq() < 1e-9) axis = new THREE.Vector3(0, 0, 1);
  axis.normalize();
  // Upper bone: the target direction swung towards the pole by the root angle.
  const upperDir = dir.clone().applyAxisAngle(axis, rootAngle);
  // Joint frame: X along the bone, Z the bend axis.
  const z = axis.clone().negate();
  const y = new THREE.Vector3().crossVectors(z, upperDir).normalize();
  const basis = new THREE.Matrix4().makeBasis(upperDir, y, z);
  return { root: new THREE.Quaternion().setFromRotationMatrix(basis), bend: Math.PI - midAngle };
}
