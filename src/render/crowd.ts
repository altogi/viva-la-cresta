// Visitors on the path beside the run: a man walking his dog, a mother with two children, an old
// lady with a stick, and (one ride in ten) nothing but young blondes in fur coats, St Moritz style.
// They watch riders go past, and run for it when one falls near them, then stop to look back.
// Also the riders waiting their turn at Top, with their toboggans.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Track } from '../sim/track';
import type { Terrain } from './terrain';
import { lips } from '../sim/surface';
import { RiderModel, looseToboggan, type Prop, type StandPosture } from './riderModel';
import { clubhouseTerrace } from './clubhouse';
import { JUNCTION_S } from '../track/cresta';
import { OSM_IDS, OSM_NEAR } from '../track/osm';
import { PLATFORM, finishPlaces, platformFrame } from './places';
import { HUT_APOTHEM } from './topHut';
import { TOP_PLATFORM } from './scenery';
import { LOOKS, type RiderLook } from './riderLooks';
import { groundHeight } from './ground';
import { bakeParts } from './bake';

type Kind = 'man' | 'mother' | 'child' | 'oldLady' | 'furGirl' | 'dog';

interface Body {
  group: THREE.Group;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  head: THREE.Object3D;
  /** Where a lead clips on (the dog's collar, the man's hand), in the body's frame. */
  hand?: THREE.Vector3;
  /** For a skinned body: carry the parts' swings over to its bones (after they're set each frame). */
  sync?: () => void;
}

interface Agent {
  kind: Kind;
  body: Body;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  heading: number;
  /** Faces the run when idle. */
  homeHeading: number;
  mode: 'idle' | 'flee' | 'look' | 'return';
  /** Up on the clubhouse terrace: stays put (no fleeing, no ground to follow). */
  perch?: boolean;
  timer: number;
  dir: THREE.Vector2;
  phase: number;
  speed: number;
  /** Followers (children, the dog) keep near their leader. */
  leader?: Agent;
  offset: THREE.Vector2;
  scared: THREE.Vector3;
}

const mats = new Map<string, THREE.MeshStandardMaterial>();
const mat = (color: string, roughness = 0.8) => {
  const key = `${color}-${roughness}`;
  let m = mats.get(key);
  if (!m) mats.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness })));
  return m;
};

/** One mesh per moving part (body, legs, arms): a handful of draw calls per visitor. */
function bake(body: Body): Body {
  bakeParts(body.group, [...body.legs, ...body.arms]);
  return body;
}

const RUN_SPEED: Record<Kind, number> = { man: 4.6, mother: 3.8, child: 3.4, oldLady: 1.4, furGirl: 3.2, dog: 6.5 };

/** The visitors' parts made in Blender (blender/people.py), once loaded. */
let PEOPLE: THREE.Object3D | null = null;
export function setPeopleTemplates(scene: THREE.Object3D | undefined) {
  PEOPLE = scene ?? null;
  // The garments' zone tags come in as vertex colours; keep them out of the colour multiply.
  PEOPLE?.traverse((o) => {
    const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && geo?.getAttribute('color')) {
      geo.setAttribute('zone', geo.getAttribute('color'));
      geo.deleteAttribute('color');
    }
  });
}

/**
 * One material per visitor (blender/people_mpfb.py packs each person into one atlas): the
 * garments tagged by zone (coat, hat, scarf, gloves) take this visitor's colours.
 */
function zonedMaterial(base: THREE.MeshStandardMaterial, colours: { coat: string; hat: string; scarf: string; gloves: string }) {
  const m = base.clone();
  m.vertexColors = false;
  m.transparent = false;
  m.alphaTest = 0.5;
  m.depthWrite = true;
  m.side = THREE.DoubleSide;
  m.roughness = 0.8;
  m.metalness = 0;
  const uniforms = {
    tintCoat: { value: new THREE.Color(colours.coat) },
    tintHat: { value: new THREE.Color(colours.hat) },
    tintScarf: { value: new THREE.Color(colours.scarf) },
    tintGloves: { value: new THREE.Color(colours.gloves) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 zone;\nvarying float vZone;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvZone = zone.r;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vZone;\nuniform vec3 tintCoat;\nuniform vec3 tintHat;\nuniform vec3 tintScarf;\nuniform vec3 tintGloves;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (vZone > 0.125) diffuseColor.rgb *= vZone < 0.375 ? tintCoat : vZone < 0.625 ? tintHat : vZone < 0.875 ? tintScarf : tintGloves;`,
      );
  };
  m.customProgramCacheKey = () => 'person-zones';
  return m;
}

type PersonOptions = Parameters<typeof person>[0];

/**
 * A person from the Blender parts: the same skeleton as the simple one (hips, torso, shoulders,
 * head), so walking, running and looking work unchanged; every part coloured from the options.
 */
function modelledPerson(kind: string, o: PersonOptions): Body | null {
  if (!PEOPLE?.getObjectByName(`${kind}_torso`)) return null;
  const colours: Record<string, string> = { coat: o.coat, trousers: o.trousers, boots: o.boots, skin: o.skin, hair: o.hair, hat: o.hat ?? o.hair, scarf: o.scarf ?? o.coat, dark: '#141414' };
  const part = (name: string): THREE.Object3D | null => {
    const src = PEOPLE!.getObjectByName(name);
    if (!src) return null;
    const copy = src.clone();
    copy.position.set(0, 0, 0);
    copy.traverse((m) => {
      if (m instanceof THREE.Mesh) {
        const zone = (m.material as THREE.Material).name.replace(/^pp_/, '');
        m.material = mat(colours[zone] ?? '#808080', zone === 'skin' ? 0.6 : o.fur && zone === 'coat' ? 1 : 0.8);
        m.castShadow = true;
      }
    });
    return copy;
  };
  const g = new THREE.Group();
  const k = o.height / 1.75;
  g.scale.set(k, k, (o.width ?? 1) * k);
  const legs: THREE.Object3D[] = [];
  const arms: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0.92, side * 0.09);
    const leg = part(`${kind}_leg`);
    if (leg) hip.add(leg);
    g.add(hip);
    legs.push(hip);
  }
  const torso = new THREE.Group();
  torso.position.y = 0.92;
  torso.rotation.z = -(o.stoop ?? 0);
  g.add(torso);
  for (const name of [`${kind}_torso`, ...(o.scarf ? [`${kind}_scarf`] : [])]) {
    const p = part(name);
    if (p) torso.add(p);
  }
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 0.47, side * 0.19);
    shoulder.rotation.x = side * 0.08;
    const arm = part(`${kind}_arm`);
    if (arm) shoulder.add(arm);
    if (o.stick && side > 0) {
      const stick = part(`${kind}_stick`);
      if (stick) shoulder.add(stick);
    }
    torso.add(shoulder);
    arms.push(shoulder);
  }
  const head = new THREE.Group();
  head.position.y = 0.66;
  torso.add(head);
  const face = part(`${kind}_head`);
  if (face) head.add(face);
  if (o.hat) {
    const hat = part(`${kind}_hat`);
    if (hat) head.add(hat);
  }
  return { group: g, legs, arms, head, hand: new THREE.Vector3(0.05, 0.36, 0.2) };
}

/** A person standing on the origin facing +X: legs, a coat, arms, a head with hair and a hat. */
function person(o: {
  height: number;
  coat: string;
  trousers: string;
  boots: string;
  skin: string;
  hair: string;
  hairLong?: boolean;
  hat?: string;
  /** 0 = jacket to the hips, 1 = coat to the knees. */
  coatLength: number;
  width?: number;
  fur?: boolean;
  scarf?: string;
  glasses?: boolean;
  stick?: boolean;
  stoop?: number;
}): Body {
  const k = o.height / 1.75;
  const w = (o.width ?? 1) * k;
  const g = new THREE.Group();
  const legs: THREE.Object3D[] = [];
  const arms: THREE.Object3D[] = [];
  const hipY = 0.92 * k;
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0, hipY, side * 0.09 * w);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.062 * w, 0.05 * w, hipY - 0.06 * k, 8).translate(0, -(hipY - 0.06 * k) / 2, 0), mat(o.trousers));
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24 * k, 0.1 * k, 0.11 * w), mat(o.boots, 0.6));
    boot.position.set(0.04 * k, -hipY + 0.05 * k, 0);
    hip.add(leg, boot);
    g.add(hip);
    legs.push(hip);
  }
  const torso = new THREE.Group();
  torso.position.y = hipY;
  torso.rotation.z = -(o.stoop ?? 0);
  g.add(torso);
  // The coat: turned from a profile, flaring below the waist for a long coat.
  const hem = -0.25 * k - o.coatLength * 0.38 * k;
  const profile = [
    [0.15 + o.coatLength * 0.07, hem],
    [0.14, -0.05 * k],
    [0.135, 0.15 * k],
    [0.16, 0.38 * k],
    [0.12, 0.5 * k],
    [0.05, 0.54 * k],
  ].map(([r, y]) => new THREE.Vector2(r * w * (o.fur ? 1.12 : 1), y));
  const coat = new THREE.Mesh(new THREE.LatheGeometry(profile, 14).scale(0.8, 1, 1), mat(o.coat, o.fur ? 1 : 0.75));
  torso.add(coat);
  if (o.fur) {
    // A big fur collar.
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.1 * w, 0.055 * w, 8, 16).rotateX(Math.PI / 2), mat(o.coat, 1));
    collar.position.y = 0.49 * k;
    torso.add(collar);
  }
  if (o.scarf) {
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.075 * w, 0.03 * w, 6, 14).rotateX(Math.PI / 2), mat(o.scarf, 0.9));
    scarf.position.y = 0.53 * k;
    torso.add(scarf);
  }
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 0.47 * k, side * 0.19 * w);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * w, 0.042 * w, 0.56 * k, 8).translate(0, -0.28 * k, 0), mat(o.coat, o.fur ? 1 : 0.75));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042 * k, 8, 6), mat(o.skin, 0.6));
    hand.position.y = -0.58 * k;
    shoulder.add(arm, hand);
    shoulder.rotation.x = side * 0.08;
    if (o.stick && side > 0) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.85 * k, 6).translate(0, -0.42 * k, 0), mat('#4a3020', 0.6));
      stick.position.y = -0.58 * k;
      stick.rotation.z = 0.25;
      shoulder.add(stick);
    }
    torso.add(shoulder);
    arms.push(shoulder);
  }
  const head = new THREE.Group();
  head.position.y = 0.66 * k;
  torso.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.105 * k, 14, 10).scale(1, 1.15, 0.92), mat(o.skin, 0.6)));
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.022 * k, 6, 5), mat(o.skin, 0.6));
  nose.position.set(0.1 * k, -0.01 * k, 0);
  head.add(nose);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.112 * k, 14, 8, 0, Math.PI * 2, 0, 1.6).scale(1, 1.1, 0.95), mat(o.hair, 0.85));
  hair.position.x = -0.01 * k;
  hair.rotation.z = 0.35;
  head.add(hair);
  if (o.hairLong) {
    // Long hair down the back.
    const fall = new THREE.Mesh(new THREE.BoxGeometry(0.07 * k, 0.32 * k, 0.2 * k), mat(o.hair, 0.85));
    fall.position.set(-0.07 * k, -0.14 * k, 0);
    head.add(fall);
  }
  if (o.hat) {
    const hat = o.fur
      ? new THREE.Mesh(new THREE.CylinderGeometry(0.12 * k, 0.115 * k, 0.15 * k, 14), mat(o.hat, 1))
      : new THREE.Mesh(new THREE.SphereGeometry(0.115 * k, 12, 8, 0, Math.PI * 2, 0, 1.4), mat(o.hat, 0.9));
    hat.position.y = (o.fur ? 0.1 : 0.03) * k;
    head.add(hat);
  }
  if (o.glasses) {
    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.02 * k, 0.035 * k, 0.17 * k), mat('#101010', 0.2));
    glasses.position.set(0.095 * k, 0.025 * k, 0);
    head.add(glasses);
  }
  g.traverse((m) => (m.castShadow = true));
  return { group: g, legs, arms, head, hand: new THREE.Vector3(0.05, 0.36 * k, 0.2 * w) };
}

function dog(): Body {
  const g = new THREE.Group();
  const coat = mat(['#6b4a2a', '#d9b479', '#222222', '#efe9df'][Math.floor(Math.random() * 4)], 0.9);
  if (PEOPLE?.getObjectByName('dog_trunk')) {
    // The Blender dog: trunk, head, four legs and the tail, in the same places as the simple one.
    const part = (name: string, at: [number, number, number], parent: THREE.Object3D) => {
      const copy = PEOPLE!.getObjectByName(name)!.clone();
      copy.position.set(0, 0, 0);
      copy.traverse((m) => {
        if (m instanceof THREE.Mesh) {
          m.material = (m.material as THREE.Material).name === 'pp_dark' ? mat('#141414', 0.4) : coat;
          m.castShadow = true;
        }
      });
      const holder = new THREE.Group();
      holder.position.set(...at);
      holder.add(copy);
      parent.add(holder);
      return holder;
    };
    part('dog_trunk', [0, 0, 0], g);
    const head = part('dog_head', [0.36, 0.58, 0], g);
    const legs = ([[0.2, 0.08], [0.2, -0.08], [-0.22, 0.08], [-0.22, -0.08]] as const).map(([x, z]) => part('dog_leg', [x, 0.38, z], g));
    const tail = part('dog_tail', [-0.33, 0.47, 0], g);
    return { group: g, legs, arms: [tail], head, hand: new THREE.Vector3(0.3, 0.5, 0) };
  }
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.42, 4, 10).rotateZ(Math.PI / 2), coat);
  body.position.y = 0.42;
  const head = new THREE.Group();
  head.position.set(0.36, 0.58, 0);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), coat));
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.08), coat);
  snout.position.set(0.11, -0.03, 0);
  head.add(snout);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.05), coat);
    ear.position.set(-0.02, 0.06, side * 0.08);
    ear.rotation.x = side * 0.4;
    head.add(ear);
  }
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[0.24, 0.08], [0.24, -0.08], [-0.24, 0.08], [-0.24, -0.08]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.36, z);
    hip.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.36, 6).translate(0, -0.18, 0), coat));
    g.add(hip);
    legs.push(hip);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.28, 6).translate(0, 0.14, 0), coat);
  tail.position.set(-0.33, 0.5, 0);
  tail.rotation.z = 0.6;
  g.add(body, head, tail);
  g.traverse((m) => (m.castShadow = true));
  return { group: g, legs, arms: [tail], head, hand: new THREE.Vector3(0.3, 0.5, 0) };
}

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const SKINS = ['#f1cdb5', '#e6bea4', '#d9a384', '#c68e6b', '#8d5a3c'];

function makeBody(kind: Kind): Body {
  return bake(buildBody(kind));
}

/** The MakeHuman person when loaded, else the Blender parts, else the simple one. */
function dressed(kind: Kind, o: PersonOptions): Body {
  // A share of the men are the gent in the long coat and fedora.
  const variant = kind === 'man' && Math.random() < 0.4 ? 'gent' : kind;
  return skinnedPerson(variant, o) ?? modelledPerson(kind, o) ?? person(o);
}

/** Heights of the MakeHuman people as built, measured once. */
const modelHeights = new Map<string, number>();

/**
 * A visitor on a MakeHuman body (blender/people_mpfb.py): face, hair and clothes from MakeHuman,
 * the coat, hat, scarf and gloves in this visitor's colours. The crowd swings simple parts (hips,
 * shoulders, head) as for the other bodies; `sync` turns the skeleton's bones to match.
 */
function skinnedPerson(kind: string, o: PersonOptions): Body | null {
  const template = PEOPLE?.getObjectByName(`person_${kind}`);
  if (!template) return null;
  if (!modelHeights.has(kind)) modelHeights.set(kind, new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3()).y || 1.75);
  const root = cloneSkinned(template);
  root.position.set(0, 0, 0);
  const colours = { coat: o.coat, hat: o.hat ?? o.coat, scarf: o.scarf ?? o.coat, gloves: pick(['#2a2622', '#3a2a20', '#1d2433', o.hat ?? '#2a2622']) };
  const bones = new Map<string, THREE.Bone>();
  root.traverse((n) => {
    if ((n as THREE.Bone).isBone) bones.set(n.name.replace(/_\d+$/, ''), n as THREE.Bone);
    if (n instanceof THREE.Mesh) {
      n.castShadow = true;
      const restyle = (m: THREE.Material) => zonedMaterial(m as THREE.MeshStandardMaterial, colours);
      n.material = Array.isArray(n.material) ? n.material.map(restyle) : restyle(n.material);
    }
  });
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.y = Math.PI / 2; // built facing -Y in Blender (+Z here); the crowd's people face +X
  inner.add(root);
  g.add(inner);
  const k = o.height / modelHeights.get(kind)!;
  g.scale.setScalar(k);
  g.updateMatrixWorld(true);
  // Each driven bone: its rest rotation and its parent's, in the body's frame.
  const gq = new THREE.Quaternion();
  g.getWorldQuaternion(gq).invert();
  const drive = (name: string) => {
    const bone = bones.get(name);
    if (!bone) return null;
    const parent = new THREE.Quaternion();
    bone.parent!.getWorldQuaternion(parent);
    parent.premultiply(gq);
    return { bone, rest: bone.quaternion.clone(), parent, parentInv: parent.clone().invert(), proxy: new THREE.Object3D() };
  };
  const legs = [drive('thighL'), drive('thighR')].filter((d) => d) as NonNullable<ReturnType<typeof drive>>[];
  const arms = [drive('upperarmL'), drive('upperarmR')].filter((d) => d) as NonNullable<ReturnType<typeof drive>>[];
  const neck = drive('neck');
  const spine = drive('spine');
  const all = [...legs, ...arms, ...(neck ? [neck] : [])];
  // MakeHuman's A pose holds the arms out; bring them down to hang at the sides first.
  const hang = new Map(arms.map((d, i) => [d, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), i === 0 ? -0.62 : 0.62)]));
  const turn = new THREE.Quaternion();
  const stoop = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -(o.stoop ?? 0));
  if (spine) spine.bone.quaternion.copy(spine.parentInv.clone().multiply(stoop).multiply(spine.parent).multiply(spine.rest));
  const sync = () => {
    for (const d of all) {
      turn.setFromEuler(d.proxy.rotation);
      const down = hang.get(d);
      if (down) turn.multiply(down);
      d.bone.quaternion.copy(d.parentInv).multiply(turn).multiply(d.parent).multiply(d.rest);
    }
  };
  sync();
  g.updateMatrixWorld(true);
  const hand = bones.get('handR');
  const handAt = new THREE.Vector3(0.05, 0.36, 0.2);
  if (hand) g.worldToLocal(hand.getWorldPosition(handAt));
  // Legs and arms are listed left then right, as the simple bodies' are (side -1 then +1).
  return { group: g, legs: legs.map((d) => d.proxy), arms: arms.map((d) => d.proxy), head: neck?.proxy ?? new THREE.Object3D(), hand: handAt, sync };
}

function buildBody(kind: Kind): Body {
  switch (kind) {
    case 'man':
      return dressed('man', { height: 1.8, coat: pick(['#2d3a4f', '#5a2a24', '#3b3f2e', '#1d1d20']), trousers: '#2a2a30', boots: '#3a2a1c', skin: pick(SKINS), hair: pick(['#3a2a1e', '#1a1716', '#8a6a48']), hat: pick(['#8a1c1c', '#20304e', '#d9d2c2']), coatLength: 0.1, scarf: pick(['#c9a13d', '#7c1b1b', '#e8e2d4']) });
    case 'mother':
      return dressed('mother', { height: 1.68, coat: pick(['#b34a3a', '#e7e1d4', '#3d5f8a', '#6d4c7d']), trousers: '#2c2c34', boots: '#2b211a', skin: pick(SKINS), hair: pick(['#5b3a22', '#c9a26a', '#22191a']), hairLong: true, hat: pick(['#f2ede3', '#2d2d33']), coatLength: 0.5, width: 0.92 });
    case 'child':
      return dressed('child', { height: 1.1 + Math.random() * 0.25, coat: pick(['#e0402e', '#2f8ad8', '#f2c230', '#4fb35a', '#e86fa8']), trousers: pick(['#1f3f7a', '#303034']), boots: '#222', skin: pick(SKINS), hair: pick(['#c9a26a', '#5b3a22']), hat: pick(['#f2c230', '#e0402e', '#ffffff', '#2f8ad8']), coatLength: 0.1, width: 1.1 });
    case 'oldLady':
      return dressed('oldLady', { height: 1.58, coat: pick(['#6a5a4a', '#4a5a6a', '#7a3a4a']), trousers: '#3a3a3a', boots: '#2a2018', skin: '#ecc9b5', hair: '#d8d4cf', hat: pick(['#8a7a9a', '#5a2a3a', '#2a3a4a']), coatLength: 0.8, stick: true, stoop: 0.22, scarf: '#9a6a8a' });
    case 'furGirl':
      return dressed('furGirl', { height: 1.72, coat: pick(['#f2eadc', '#e8dcc6', '#c8a27a', '#1c1a18', '#efe6d8']), trousers: '#1a1a1c', boots: pick(['#efe6d8', '#1a1a1c', '#7a5a3a']), skin: '#f3d3be', hair: pick(['#ecd08a', '#e2c27a', '#f3dc9e']), hairLong: true, hat: Math.random() < 0.6 ? pick(['#f2eadc', '#c8a27a', '#1c1a18']) : undefined, coatLength: 0.85, width: 0.9, fur: true, glasses: true });
    case 'dog':
      return dog();
  }
}

/** A wooden park bench, seat 0.46 m high, facing +X. */
function buildBench(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat('#6b4a2e', 0.8);
  const iron = mat('#2a2a2a', 0.5);
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 1.7), wood);
    slat.position.set(-0.05 + i * 0.13, 0.45, 0);
    g.add(slat);
  }
  for (let i = 0; i < 2; i++) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 1.7), wood);
    back.position.set(-0.17, 0.6 + i * 0.16, 0);
    back.rotation.z = -0.15;
    g.add(back);
  }
  for (const z of [-0.75, 0.75]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.05), iron);
    leg.position.set(0.02, 0.22, z);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.05), iron);
    post.position.set(-0.18, 0.62, z);
    post.rotation.z = -0.15;
    g.add(leg, post);
  }
  g.traverse((o) => (o.castShadow = o.receiveShadow = true));
  return g;
}

/** Riders waiting their turn at Top, in their own colours, on a walkway kit of the three builds. */
function waitingLook(base: RiderLook, suit: string, helmet: string): RiderLook {
  return {
    ...base,
    hair: { ...base.hair },
    helmet: { shell: helmet, visor: '#15191c' },
    outfit: { ...base.outfit, torso: suit, upperArm: suit, forearm: suit, pelvis: suit, thigh: suit, shin: suit, lettering: '#f4f4f0', backStripe: undefined, legStripe: undefined, bottle: false, braces: undefined },
  };
}

export class Crowd {
  readonly group = new THREE.Group();
  private agents: Agent[] = [];
  private readonly terraceCrowd: Agent[] = [];
  private leads: { line: THREE.Line; from: Agent; to: Agent }[] = [];
  private readonly waiting: { model: RiderModel; time: number; posture: StandPosture; look: number }[] = [];
  /** This ride's visitors are all fur coats (one ride in ten). */
  furDay = false;

  constructor(
    private readonly track: Track,
    private readonly terrain: Terrain,
  ) {
    this.group.name = 'crowd';
    this.group.add(this.buildPath());
    this.buildWaitingRiders();
    this.buildJunction();
    this.buildStandAndFinish();
    this.populate();
  }

  /** Lateral offset of the visitors' path (left of the run), smoothed along it. */
  private pathU(s: number): number {
    let sum = 0;
    let n = 0;
    for (let d = -14; d <= 14; d += 2) {
      const at = THREE.MathUtils.clamp(s + d, 0, this.track.length);
      sum += lips(this.track.section(at)).left + 4.2;
      n++;
    }
    return Math.max(5.2, sum / n);
  }

  private ground(s: number, u: number, out = new THREE.Vector3()): THREE.Vector3 {
    const st = this.track.frame(s);
    const x = st.pos[0] + st.left[0] * u;
    const y = st.pos[1] + st.left[1] * u;
    return out.set(x, groundHeight(this.track, this.terrain, x, -y), -y);
  }

  /** A trodden path of packed snow alongside the run, from Junction to the finish. */
  private buildPath(): THREE.Mesh {
    const positions: number[] = [];
    const index: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let row = 0;
    for (let s = 335; s <= this.track.length - 10; s += 2, row++) {
      const u = this.pathU(s);
      this.ground(s, u - 0.8, a);
      this.ground(s, u + 0.8, b);
      positions.push(a.x, a.y + 0.04, a.z, b.x, b.y + 0.04, b.z);
      if (row > 0) {
        const i = row * 2;
        index.push(i - 2, i, i - 1, i - 1, i, i + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#dcd6ca', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * The scene at the Top hut: two riders on a bench by the hut (one smoking), a couple leaning on
   * the hut's door with a cola each, and two more at the start with their toboggans, watching.
   */
  private buildWaitingRiders() {
    const top = this.track.frame(0);
    const fwd = new THREE.Vector3(top.forward[0], 0, -top.forward[1]).normalize();
    const side = new THREE.Vector3(top.left[0], 0, -top.left[1]).normalize();
    const facing = (dir: THREE.Vector3) => Math.atan2(-dir.z, dir.x);
    const osm = OSM_NEAR.find((b) => b.id === OSM_IDS.topHut)!;
    const ground = this.track.elevation(0) + TOP_PLATFORM;
    const hut = new THREE.Vector3(osm.c[0], ground, -osm.c[1]);
    // Everyone gathers on the side of the hut that faces the start, where the riders go.
    const out = fwd.clone();
    const wall = hut.clone().addScaledVector(out, HUT_APOTHEM + 0.16);
    const benchAt = hut.clone().addScaledVector(out, HUT_APOTHEM + 1.5).addScaledVector(side, 3.6);
    const bench = buildBench();
    bench.position.copy(benchAt);
    bench.rotation.y = facing(out);
    this.group.add(bench);

    // A rider's body stands 0.75 m to the left of the model's origin: put the body itself at `at`.
    const place = (model: RiderModel, at: THREE.Vector3, dir: THREE.Vector3) => {
      const heading = facing(dir);
      model.root.rotation.y = heading;
      model.root.position.copy(at).add(new THREE.Vector3(0, 0, 0.75).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading));
      this.group.add(model.root);
    };
    const towardStart = (at: THREE.Vector3) => new THREE.Vector3(top.pos[0], ground, -top.pos[1]).sub(at).setY(0).normalize();
    const watchA = hut.clone().addScaledVector(out, HUT_APOTHEM + 3.2).addScaledVector(side, -3.4);
    const watchB = hut.clone().addScaledVector(out, HUT_APOTHEM + 4.4).addScaledVector(side, -4.6);
    const cast: { look: RiderLook; toboggan: 'traditional' | 'flattop'; posture: StandPosture; prop?: Prop; at: THREE.Vector3; dir: THREE.Vector3; look_?: number; helmet?: boolean }[] = [
      { look: waitingLook(LOOKS.remo, '#7a1d1d', '#151515'), toboggan: 'traditional', posture: 'sit', prop: 'cigarette', at: benchAt.clone().addScaledVector(side, -0.35), dir: out, look_: -0.3 },
      { look: waitingLook(LOOKS.maximilian, '#1a1a1c', '#c9c9c9'), toboggan: 'flattop', posture: 'sit', at: benchAt.clone().addScaledVector(side, 0.45), dir: out, look_: 0.45 },
      { look: waitingLook(LOOKS.adelaide, '#e9e4d6', '#9a1c1c'), toboggan: 'traditional', posture: 'lean', prop: 'cola', at: wall.clone().addScaledVector(side, -0.45), dir: out, look_: -0.35 },
      { look: waitingLook(LOOKS.maximilian, '#244f7a', '#244f7a'), toboggan: 'flattop', posture: 'lean', prop: 'cola', at: wall.clone().addScaledVector(side, 0.45), dir: out, look_: 0.3 },
      // Two more, toboggans in hand, watching the riders at the start.
      { look: waitingLook(LOOKS.adelaide, '#5a2a6a', '#d8d2c4'), toboggan: 'traditional', posture: 'stand', at: watchA, dir: towardStart(watchA), look_: 0.3, helmet: true },
      { look: waitingLook(LOOKS.remo, '#2b5d3a', '#2b5d3a'), toboggan: 'traditional', posture: 'stand', at: watchB, dir: towardStart(watchB), look_: 0.2, helmet: true },
    ];
    for (const c of cast) {
      const model = new RiderModel(c.look, c.toboggan, { helmet: !!c.helmet });
      if (c.prop) model.holdProp(c.prop);
      place(model, c.at, c.dir);
      model.bake();
      this.waiting.push({ model, time: Math.random() * 5, posture: c.posture, look: c.look_ ?? 0 });
    }
  }

  /**
   * Junction, as in the photographs: toboggans laid out in a row beside the run opposite the clubhouse,
   * riders in helmets waiting by them, and the clubhouse terrace lined with spectators.
   */
  private buildJunction() {
    const s0 = JUNCTION_S;
    const st = this.track.frame(s0);
    const club = OSM_NEAR.find((b) => b.id === OSM_IDS.clubhouse)!.c;
    // Riders get ready on the side of the run opposite the clubhouse.
    const side = -(Math.sign((club[0] - st.pos[0]) * st.left[0] + (club[1] - st.pos[1]) * st.left[1]) || 1);
    const colors = ['#b3261e', '#d9a21a', '#1f4fa8', '#1d1d1f', '#b3261e', '#2f7d4a', '#d9a21a', '#7a1d1d'];
    // Uphill of the Junction hut, which stands at the run's edge from just above the start.
    for (let k = 0; k < 8; k++) {
      const s = s0 - 25 + k * 1.6;
      const f = this.track.frame(s);
      const u = side * (lips(this.track.section(s))[side > 0 ? 'left' : 'right'] * side + 1.6);
      const at = this.ground(s, u);
      const sled = looseToboggan(k % 4 === 3 ? 'flattop' : 'traditional', colors[k]);
      sled.position.copy(at);
      // Side by side, noses towards the run.
      sled.rotation.y = Math.atan2(side * f.left[1], -side * f.left[0]) + (Math.random() - 0.5) * 0.15;
      this.group.add(sled);
    }
    const kit: [RiderLook, string, string][] = [
      [LOOKS.adelaide, '#1d1d1f', '#c9c9c9'],
      [LOOKS.maximilian, '#9a1c1c', '#9a1c1c'],
      [LOOKS.remo, '#e9e4d6', '#1f4fa8'],
    ];
    kit.forEach(([look, suit, helmet], k) => {
      const s = s0 - 20 + k * 4.5;
      const u = side * (lips(this.track.section(s))[side > 0 ? 'left' : 'right'] * side + 3.6 + (k % 2) * 1.2);
      const at = this.ground(s, u);
      const f = this.track.frame(s);
      const model = new RiderModel(waitingLook(look, suit, helmet), 'traditional');
      const toRun = new THREE.Vector3(-side * f.left[0], 0, side * f.left[1]).normalize();
      const heading = Math.atan2(-toRun.z, toRun.x) + (k - 1) * 0.4;
      model.root.rotation.y = heading;
      model.root.position.copy(at).add(new THREE.Vector3(0, 0, 0.75).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading));
      model.bake();
      this.group.add(model.root);
      this.waiting.push({ model, time: Math.random() * 5, posture: 'stand', look: 0.3 * (k - 1) });
    });
    // Spectators along the terrace railing, on the sides that look over the run.
    const terrace = clubhouseTerrace(this.track);
    const ring = terrace.ring;
    const spots: [number, number, number][] = [];
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, by - ay);
      const normal = Math.atan2(-(bx - ax), by - ay); // outward, for a counter-clockwise ring
      for (let d = 0.6; d < len - 0.3; d += 0.75) {
        const x = ax + ((bx - ax) * d) / len;
        const y = ay + ((by - ay) * d) / len;
        if (this.terrain.distanceToTrack(x, y).distance > 22) continue;
        if (Math.random() < 0.35) continue;
        spots.push([x, y, normal]);
      }
    }
    for (const [x, y, normal] of spots.slice(0, 26)) {
      const kind: Kind = pick(['man', 'mother', 'man', 'furGirl', 'oldLady']);
      const body = makeBody(kind === 'oldLady' ? 'man' : kind);
      const home = new THREE.Vector3(x, terrace.z, -y);
      const heading = normal + (Math.random() - 0.5) * 0.6;
      body.group.position.copy(home);
      body.group.rotation.y = heading;
      this.group.add(body.group);
      this.terraceCrowd.push({
        kind, body, home: home.clone(), pos: home.clone(), heading, homeHeading: heading, mode: 'idle', timer: 0,
        dir: new THREE.Vector2(), phase: Math.random() * 10, speed: 0, offset: new THREE.Vector2(), scared: new THREE.Vector3(), perch: true,
      });
    }
  }

  /** Someone who stays where they are put (on a stand, at work): they only turn to watch. */
  private placeStill(body: Body, kind: Kind, home: THREE.Vector3, heading: number) {
    body.group.position.copy(home);
    body.group.rotation.y = heading;
    this.group.add(body.group);
    this.terraceCrowd.push({
      kind, body, home: home.clone(), pos: home.clone(), heading, homeHeading: heading, mode: 'idle', timer: 0,
      dir: new THREE.Vector2(), phase: Math.random() * 10, speed: 0, offset: new THREE.Vector2(), scared: new THREE.Vector3(), perch: true,
    });
  }

  /**
   * Spectators along the rail of the wooden stand before Shuttlecock, watching the riders come
   * through; and a run technician by the finish mat, there to help riders off it.
   */
  private buildStandAndFinish() {
    const frame = platformFrame(this.track, this.terrain);
    const st = this.track.frame(PLATFORM.s);
    // They stand on the run's right, facing left across it.
    const towardRun = Math.atan2(st.left[1], st.left[0]);
    for (let x = -PLATFORM.length / 2 + 0.7; x < PLATFORM.length / 2 - 0.5; x += 0.8 + Math.random() * 0.5) {
      if (Math.random() < 0.15) continue;
      const kind: Kind = pick(['man', 'man', 'mother', 'furGirl', 'oldLady']);
      // Blender's (x, y, z) in the stand's frame is three's (x, z, -y).
      const home = new THREE.Vector3(x, PLATFORM.deck, -(0.45 + Math.random() * 0.5)).applyMatrix4(frame.matrixWorld);
      this.placeStill(makeBody(kind), kind, home, towardRun + (Math.random() - 0.5) * 0.7);
    }
    const finish = finishPlaces(this.track, this.terrain);
    const tech = finish.technician;
    const fst = this.track.frame(tech.s);
    const staff = bake(dressed('man', { height: 1.8, coat: '#e0561b', trousers: '#23262e', boots: '#1d1a17', skin: pick(SKINS), hair: '#3a2a1e', hat: '#1d2433', coatLength: 0.1, scarf: '#1d2433' }));
    // Facing back up the run-out, towards the riders coming in.
    this.placeStill(staff, 'man', this.ground(tech.s, tech.u), Math.atan2(-fst.forward[1], -fst.forward[0]) + 0.5);
  }

  /** New visitors for a ride: a party every so often along the path. */
  populate() {
    for (const a of this.agents) a.body.group.removeFromParent();
    for (const l of this.leads) l.line.removeFromParent();
    this.agents = [];
    this.leads = [];
    this.furDay = Math.random() < 0.1;
    // Along the path, a party every so often; and always a gathering behind Shuttlecock's straw,
    // just beyond the padding, where the fallers land.
    const spots: [number, number][] = [];
    for (let s = 345; s < this.track.length - 30; s += 18 + Math.random() * 28) {
      if (Math.random() < 0.25) continue;
      spots.push([s, this.pathU(s) + (Math.random() - 0.5) * 0.8]);
    }
    for (const s of [584, 589, 594, 599, 604, 609]) spots.push([s + Math.random() * 3, lips(this.track.section(s)).right - 10.5 - Math.random() * 1.5]);
    for (const [s, u] of spots) {
      const add = (kind: Kind, ds: number, du: number, leader?: Agent) => this.addAgent(kind, s + ds, u + du, leader);
      if (this.furDay) {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) add('furGirl', i * 0.8, (i % 2) * 0.5);
        continue;
      }
      const party = pick(['man', 'mother', 'oldLady'] as const);
      if (party === 'man') {
        const man = add('man', 0, 0);
        const d = add('dog', 1.2, -0.3, man);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#b02020' }));
        line.frustumCulled = false;
        this.group.add(line);
        this.leads.push({ line, from: man, to: d });
      } else if (party === 'mother') {
        const mum = add('mother', 0, 0);
        add('child', 0.7, 0.4, mum);
        add('child', -0.7, 0.35, mum);
      } else {
        add('oldLady', 0, 0);
      }
    }
  }

  private addAgent(kind: Kind, s: number, u: number, leader?: Agent): Agent {
    const side = Math.sign(u) || 1;
    const body = makeBody(kind);
    const home = this.ground(s, u);
    const st = this.track.frame(s);
    // Face the run (it lies to their right-hand side of the path), give or take.
    const towardRun = Math.atan2(side * -st.left[1], side * -st.left[0]) + (Math.random() - 0.5) * 0.8;
    const agent: Agent = {
      kind,
      body,
      home: home.clone(),
      pos: home.clone(),
      heading: towardRun,
      homeHeading: towardRun,
      mode: 'idle',
      timer: 0,
      dir: new THREE.Vector2(),
      phase: Math.random() * 10,
      speed: 0,
      leader,
      offset: new THREE.Vector2(),
      scared: new THREE.Vector3(),
    };
    if (leader) agent.offset.set(home.x - leader.home.x, home.z - leader.home.z);
    body.group.position.copy(home);
    this.group.add(body.group);
    this.agents.push(agent);
    return agent;
  }

  /** A rider has fallen at `at`: everyone close enough runs away from it, then looks back. */
  scare(at: THREE.Vector3) {
    for (const a of this.agents) {
      const d = Math.hypot(a.pos.x - at.x, a.pos.z - at.z);
      if (d > 26) continue;
      a.mode = 'flee';
      a.timer = 2.2 + Math.random() * 1.4 + (a.kind === 'oldLady' ? 2 : 0);
      a.dir.set(a.pos.x - at.x, a.pos.z - at.z).normalize();
      a.scared.copy(at);
    }
  }

  update(dt: number, rider: THREE.Vector3 | null) {
    for (const w of this.waiting) {
      w.time += dt;
      w.model.setPose({ posture: 0, steer: 0, rakeLeft: 0, rakeRight: 0, mount: 1, runPhase: 0, stand: { time: w.time, action: null, t: 0, posture: w.posture, look: w.look + Math.sin(w.time * 0.3) * 0.15 } });
    }
    for (const a of this.agents) {
      this.step(a, dt, rider);
      a.body.sync?.();
    }
    for (const a of this.terraceCrowd) {
      this.step(a, dt, rider);
      a.body.sync?.();
    }
    for (const l of this.leads) {
      const p = l.line.geometry.attributes.position as THREE.BufferAttribute;
      const hand = l.from.body.hand!.clone().applyMatrix4(l.from.body.group.matrixWorld);
      const collar = l.to.body.hand!.clone().applyMatrix4(l.to.body.group.matrixWorld);
      p.setXYZ(0, hand.x, hand.y, hand.z);
      p.setXYZ(1, collar.x, collar.y, collar.z);
      p.needsUpdate = true;
    }
  }

  private step(a: Agent, dt: number, rider: THREE.Vector3 | null) {
    let target = a.homeHeading;
    let speed = 0;
    a.timer -= dt;
    if (a.mode === 'flee') {
      speed = RUN_SPEED[a.kind];
      target = Math.atan2(-a.dir.y, a.dir.x);
      if (a.timer <= 0) {
        a.mode = 'look';
        a.timer = 3 + Math.random() * 2;
      }
    } else if (a.mode === 'look') {
      // Stop and stare back at the fall.
      target = Math.atan2(-(a.scared.z - a.pos.z), a.scared.x - a.pos.x);
      if (a.timer <= 0) a.mode = 'return';
    } else if (a.mode === 'return') {
      const home = a.leader && a.leader.mode !== 'idle' ? null : a.home;
      const dx = (home ?? a.home).x - a.pos.x;
      const dz = (home ?? a.home).z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) a.mode = 'idle';
      else {
        speed = Math.min(1.2, d);
        target = Math.atan2(-dz, dx);
      }
    } else if (rider) {
      // Curious: turn to watch a rider coming past.
      const dx = rider.x - a.pos.x;
      const dz = rider.z - a.pos.z;
      if (dx * dx + dz * dz < 40 * 40) target = Math.atan2(-dz, dx);
    }
    // Followers stay near their leader when it moves.
    if (a.leader && a.mode !== 'flee' && a.leader.mode !== 'idle') {
      const want = new THREE.Vector3(a.leader.pos.x + a.offset.x * 0.6, 0, a.leader.pos.z + a.offset.y * 0.6);
      const dx = want.x - a.pos.x;
      const dz = want.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.4) {
        speed = Math.min(RUN_SPEED[a.kind], d * 2);
        target = Math.atan2(-dz, dx);
      }
    }
    const turn = ((target - a.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    a.heading += turn * Math.min(1, dt * (speed > 0 ? 8 : 3));
    a.speed += (speed - a.speed) * Math.min(1, dt * 6);
    a.pos.x += Math.cos(a.heading) * a.speed * dt;
    a.pos.z -= Math.sin(a.heading) * a.speed * dt;
    if (!a.perch) a.pos.y = groundHeight(this.track, this.terrain, a.pos.x, a.pos.z);
    // Legs and arms swing with the pace; a gentle sway standing still.
    const pace = a.speed;
    a.phase += dt * (pace > 0.1 ? 2.2 + pace * 1.6 : 1.2);
    const swing = pace > 0.1 ? Math.min(0.9, 0.3 + pace * 0.15) : 0;
    const b = a.body;
    b.legs.forEach((leg, i) => (leg.rotation.z = Math.sin(a.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * swing));
    if (a.kind === 'dog') b.arms[0].rotation.x = Math.sin(a.phase * 4) * 0.5; // the tail wags
    else b.arms.forEach((arm, i) => (arm.rotation.z = -Math.sin(a.phase + (i ? 0 : Math.PI)) * swing * 0.8 + (a.mode === 'flee' ? 0.3 : 0)));
    b.group.position.set(a.pos.x, a.pos.y + (pace > 0.1 ? Math.abs(Math.sin(a.phase)) * 0.04 : Math.sin(a.phase) * 0.004), a.pos.z);
    b.group.rotation.y = a.heading;
  }
}
