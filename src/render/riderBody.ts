// A rider's body made in Blender (blender/riders.py): one smooth, skinned mesh on a named armature,
// built to the same proportions as the game's rider. The game keeps posing its own IK skeleton; this
// turns each bone to point from one of those joints to the next (and twists the hips and chest to
// the line of the hips and shoulders), so the body follows every pose, fall and gesture.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { RiderLook } from './riderLooks';

/** Joint positions in world space, from the game's skeleton. */
export interface Joints {
  pelvis: THREE.Vector3;
  waist: THREE.Vector3;
  chest: THREE.Vector3;
  neck: THREE.Vector3;
  neckTop: THREE.Vector3;
  shoulder: [THREE.Vector3, THREE.Vector3]; // left, right
  elbow: [THREE.Vector3, THREE.Vector3];
  wrist: [THREE.Vector3, THREE.Vector3];
  fingers: [THREE.Vector3, THREE.Vector3];
  hip: [THREE.Vector3, THREE.Vector3];
  knee: [THREE.Vector3, THREE.Vector3];
  ankle: [THREE.Vector3, THREE.Vector3];
  toe: [THREE.Vector3, THREE.Vector3];
  /** Extra turn of each forearm about itself (radians), to turn the palms (the hands follow). */
  forearmRoll?: [number, number];
}

/** Bone, the joints it runs between, and (for the hips and chest) the pair that sets its twist. */
const BONES: [string, (j: Joints) => THREE.Vector3, (j: Joints) => THREE.Vector3, ((j: Joints) => [THREE.Vector3, THREE.Vector3])?, ((j: Joints) => number)?][] = [
  ['hips', (j) => j.pelvis, (j) => j.waist, (j) => [j.hip[0], j.hip[1]]],
  ['spine', (j) => j.waist, (j) => j.chest],
  ['chest', (j) => j.chest, (j) => j.neck, (j) => [j.shoulder[0], j.shoulder[1]]],
  ['neck', (j) => j.neck, (j) => j.neckTop],
  ...(['L', 'R'] as const).flatMap((s, i) => [
    [`upperarm${s}`, (j: Joints) => j.shoulder[i], (j: Joints) => j.elbow[i]],
    [`forearm${s}`, (j: Joints) => j.elbow[i], (j: Joints) => j.wrist[i], undefined, (j: Joints) => j.forearmRoll?.[i] ?? 0],
    [`hand${s}`, (j: Joints) => j.wrist[i], (j: Joints) => j.fingers[i]],
    [`thigh${s}`, (j: Joints) => j.hip[i], (j: Joints) => j.knee[i]],
    [`shin${s}`, (j: Joints) => j.knee[i], (j: Joints) => j.ankle[i]],
    [`foot${s}`, (j: Joints) => j.ankle[i], (j: Joints) => j.toe[i]],
  ] as (typeof BONES)[number][]),
];

/** Material name suffix (blender/riders.py zones) to the look's colour. */
const ZONES: Record<string, (l: RiderLook) => string | undefined> = {
  torso: (l) => l.outfit.torso,
  upperArm: (l) => l.outfit.upperArm,
  forearm: (l) => l.outfit.forearm,
  hands: (l) => l.outfit.hands,
  pelvis: (l) => l.outfit.pelvis,
  thigh: (l) => l.outfit.thigh,
  shin: (l) => l.outfit.shin,
  boots: (l) => l.outfit.boots,
  pads: (l) => l.outfit.pads,
  stripe: (l) => l.outfit.legStripe,
  braces: (l) => l.outfit.braces,
  skin: (l) => l.skin,
  lettering: (l) => l.outfit.lettering,
  backstripe: (l) => l.outfit.backStripe ?? l.outfit.torso,
  sweater: (l) => l.outfit.torso,
  leather: (l) => l.outfit.pelvis,
  socks: (l) => l.outfit.shin,
  bootleather: (l) => l.outfit.boots,
};

const Y = new THREE.Vector3(0, 1, 0);

export class RiderBody {
  readonly root: THREE.Object3D;
  private readonly bones: { bone: THREE.Bone; rest: THREE.Quaternion; from: (j: Joints) => THREE.Vector3; to: (j: Joints) => THREE.Vector3; twist?: (j: Joints) => [THREE.Vector3, THREE.Vector3]; lateral?: THREE.Vector3; roll?: (j: Joints) => number }[] = [];
  private readonly hips: THREE.Bone;

  constructor(template: THREE.Object3D, look: RiderLook) {
    this.root = cloneSkinned(template);
    const byName = new Map<string, THREE.Bone>();
    this.root.traverse((o) => {
      // The loader makes names unique across the three riders (hips, hips_1, …) and drops dots.
      if ((o as THREE.Bone).isBone) byName.set(o.name.replace(/_\d+$/, ''), o as THREE.Bone);
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = o as THREE.SkinnedMesh;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        // Own materials, coloured for this look (the waiting riders wear other colours).
        const recolour = (m: THREE.Material) => {
          const copy = (m as THREE.MeshStandardMaterial).clone();
          const zone = copy.name.split('_').slice(1).join('_');
          const colour = ZONES[zone]?.(look);
          if (colour) copy.color.set(colour);
          return copy;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolour) : recolour(mesh.material);
      }
    });
    for (const [name, from, to, twist, roll] of BONES) {
      const bone = byName.get(name);
      if (!bone) continue;
      const entry: (typeof this.bones)[number] = { bone, rest: bone.quaternion.clone(), from, to, twist, roll };
      if (twist) {
        // The line between the two child joints (hips or shoulders), in this bone's own frame.
        const kids = name === 'hips' ? ['thighL', 'thighR'] : ['upperarmL', 'upperarmR'];
        const a = byName.get(kids[0]);
        const b = byName.get(kids[1]);
        if (a && b) entry.lateral = a.position.clone().sub(b.position);
      }
      this.bones.push(entry);
    }
    this.hips = byName.get('hips')!;
  }

  /** Turn the bones to the joints. */
  pose(j: Joints) {
    const parentQ = new THREE.Quaternion();
    const inv = new THREE.Quaternion();
    const w0 = new THREE.Quaternion();
    const swing = new THREE.Quaternion();
    const dir = new THREE.Vector3();
    const target = new THREE.Vector3();
    // Hips at the pelvis.
    const parent = this.hips.parent!;
    parent.updateWorldMatrix(true, false);
    this.hips.position.copy(parent.worldToLocal(j.pelvis.clone()));
    for (const b of this.bones) {
      b.bone.parent!.updateWorldMatrix(true, false);
      b.bone.parent!.getWorldQuaternion(parentQ);
      w0.copy(parentQ).multiply(b.rest);
      dir.copy(Y).applyQuaternion(w0);
      target.subVectors(b.to(j), b.from(j));
      if (target.lengthSq() < 1e-8) continue;
      target.normalize();
      swing.setFromUnitVectors(dir, target);
      const w = swing.multiply(w0);
      if (b.twist && b.lateral) {
        // Twist about the bone so the hips (or shoulders) line up with the skeleton's.
        const [l, r] = b.twist(j);
        const want = l.clone().sub(r);
        const have = b.lateral.clone().applyQuaternion(w);
        want.addScaledVector(target, -want.dot(target));
        have.addScaledVector(target, -have.dot(target));
        if (want.lengthSq() > 1e-8 && have.lengthSq() > 1e-8) {
          want.normalize();
          have.normalize();
          const angle = Math.atan2(target.dot(have.clone().cross(want)), have.dot(want));
          w.premultiply(new THREE.Quaternion().setFromAxisAngle(target, angle));
        }
      }
      const roll = b.roll?.(j);
      if (roll) w.premultiply(new THREE.Quaternion().setFromAxisAngle(target, roll));
      b.bone.quaternion.copy(inv.copy(parentQ).invert().multiply(w));
      b.bone.updateMatrixWorld(true);
    }
  }
}
