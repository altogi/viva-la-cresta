// A code-built rider on their toboggan, after the character sheets. Arms and legs are two-bone
// chains solved by IK, so poses are described by where the hands, feet and hips should be:
//   forward:   lying flat, hands tucked by the hips, legs straight out behind and together;
//   knives:    slid back, chest up, legs straight and apart; right hand on the front-right handle,
//              left hand on the toboggan's left edge by the hip (as in the photographs);
//   raking:    a straight leg swung down until the boot bites the ice;
//   running:   bent over beside the toboggan, pushing it, legs striding with the ground covered;
//   cheering:  on their feet beside the toboggan at Celerina, arms up;
//   standing:  defiant, hands on hips, breathing; with each rider's own idle gesture.
// Local frame: +X forward (head first), +Y up, +Z to the rider's right; origin on the ice under
// the toboggan's centre. Head frame: +X is where the face looks, +Y the crown.

import * as THREE from 'three';
import type { TobogganId } from '../sim/rider';
import { drawFlag } from '../ui/flags';
import { buildFace, type FaceRig } from './face';
import { solveTwoBone } from './ik';
import { bakeParts } from './bake';
import { RiderBody, type Joints } from './riderBody';
import { LOOKS, type RiderLook } from './riderLooks';

export type IdleAction = 'comb' | 'flirt' | 'burp';
export type StandPosture = 'stand' | 'sit' | 'lean';
export type Prop = 'cigarette' | 'cola';

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
  /** Standing for the camera (rider selection): breathing, with an occasional gesture. */
  stand?: {
    time: number;
    action: IdleAction | null;
    t: number;
    /** Standing with the toboggan (default), sitting on a bench, leaning back on a wall, or watching. */
    posture?: StandPosture;
    /** Head turned this far to the left (radians), to look at something. */
    look?: number;
  };
}

const m = (color: string, roughness = 0.55, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Where the stood-up toboggan's centre is, beside a standing rider (who stands at z = -0.75). */
const STAND_TOBOGGAN = V(0.08, 0.62, -1.2);
const smooth = (t: number) => t * t * (3 - 2 * t);
const window01 = (t: number, a: number, b: number) => THREE.MathUtils.smoothstep(t, a, a + 0.12) * (1 - THREE.MathUtils.smoothstep(t, b - 0.12, b));

/**
 * A limb segment along +X from 0 to `length`, turned to a muscle profile: radii at even steps
 * along it (smoothly interpolated), with a rounded joint at the start.
 */
function segment(length: number, radii: number[], material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const curve = new THREE.SplineCurve(radii.map((r, i) => new THREE.Vector2(r, (i / (radii.length - 1)) * length)));
  const shaft = new THREE.Mesh(new THREE.LatheGeometry(curve.getPoints(16), 16).rotateZ(-Math.PI / 2), material);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(radii[0] * 1.0, 14, 10), material);
  g.add(shaft, joint);
  return g;
}

/** Suit material with a stripe down each side of the leg (the lathe's u = 0 and 0.5 face sideways). */
function striped(suit: string, stripe: string): THREE.MeshStandardMaterial {
  const map = canvasTexture(64, 8, (g) => {
    g.fillStyle = suit;
    g.fillRect(0, 0, 64, 8);
    g.fillStyle = stripe;
    for (const x of [-3, 29, 61]) g.fillRect(x, 0, 6, 8);
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.5 });
}

/** A canvas texture for lettering. */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

interface Chain {
  root: THREE.Group;
  mid: THREE.Group;
  upper: number;
  lower: number;
}

interface Targets {
  pelvis: THREE.Vector3;
  pitch: number;
  roll: number;
  headYaw: number;
  headTilt: number;
  headRoll: number;
  hands: [THREE.Vector3, THREE.Vector3]; // left, right
  feet: [THREE.Vector3, THREE.Vector3];
  elbowPoles: [THREE.Vector3, THREE.Vector3];
  kneePoles: [THREE.Vector3, THREE.Vector3];
}

export class RiderModel {
  /** Bodies made in Blender, by rider (set once the models have loaded); without them, the code-built body. */
  static templates: Partial<Record<string, THREE.Object3D>> = {};
  readonly root = new THREE.Group();
  /** The Blender body following this skeleton, when there is one. */
  private skinned: RiderBody | null = null;
  readonly toboggan = new THREE.Group();
  /** Everything of the rider, pivoting at the pelvis (detached as one body in a fall). */
  readonly body = new THREE.Group();
  /** The head (centred on the skull); hidden for the helmet-camera view. */
  readonly head = new THREE.Group();
  /** The helmet, worn when riding. */
  readonly helmet = new THREE.Group();
  /** Soft contact shadow on the ice under the toboggan. */
  readonly contactShadow: THREE.Mesh;
  private readonly torso = new THREE.Group();
  private readonly arms: Chain[] = [];
  private readonly legs: Chain[] = [];
  private readonly face: FaceRig;
  private readonly shoulder: number;
  private readonly shoulderWidth: number;
  private readonly hipWidth: number;
  private readonly legLength: number;
  private readonly seat: number;
  private readonly handleY: number;
  private readonly look: RiderLook;
  private standing = false;
  private tip: THREE.Object3D | null = null;
  private readonly smoke: THREE.Mesh[] = [];

  constructor(
    look: RiderLook = LOOKS.adelaide,
    readonly tobogganId: TobogganId = 'traditional',
    options: { helmet?: boolean } = {},
  ) {
    this.look = look;
    const s = look.scale;
    this.shoulder = 0.5 * s;
    this.shoulderWidth = 0.19 * s * look.build;
    this.hipWidth = 0.095 * s * Math.sqrt(look.build);
    const tob = tobogganId === 'flattop' ? buildFlatTop() : buildTraditional();
    this.toboggan.add(tob.group);
    this.seat = tob.seat;
    this.handleY = tob.handleY;

    this.root.add(this.toboggan, this.body);
    this.body.add(this.torso);
    this.buildPelvis(look);
    this.buildTorso(look);
    this.face = this.buildHead(look);
    this.helmet.visible = (options.helmet ?? true) && look.helmet !== null;
    // The bun is tucked away under the helmet.
    if (this.face.bun) this.face.bun.visible = !this.helmet.visible;

    const o = look.outfit;
    const hands = m(o.hands, 0.7);
    const boots = m(o.boots, 0.6);
    const pads = m(o.pads, 0.6);
    const steel = m('#c9ccd1', 0.25, 0.6);
    const limb = 0.055 * s * look.limbs;
    for (const side of [-1, 1]) {
      // Arms hang off the shoulders, in the torso's frame.
      const upper = 0.3 * s * look.arms;
      const lower = 0.28 * s * look.arms;
      // Shoulder, biceps, elbow; forearm muscle near the elbow, thin wrist.
      const arm = this.chain(upper, lower, [limb * 1.08, limb * 1.06, limb * 1.0, limb * 0.86], [limb * 0.86, limb * 0.92, limb * 0.82, limb * 0.66], m(o.upperArm, 0.5), m(o.forearm, 0.5));
      arm.root.position.set(this.shoulder - 0.02, 0.0, side * this.shoulderWidth);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(limb * 1.15, 10, 8).scale(1.35, 0.75, 1.05), hands);
      hand.position.x = lower + limb * 0.7;
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(limb * 0.98, 10, 8), pads);
      arm.mid.add(hand, elbow);
      if (o.shoulderPads) {
        const pad = new THREE.Mesh(new THREE.SphereGeometry(limb * 1.3, 12, 8).scale(1, 0.85, 1), pads);
        arm.root.add(pad);
      }
      this.torso.add(arm.root);
      this.arms.push(arm);
      // Legs from the hips, in the pelvis frame.
      const thigh = 0.44 * s;
      const shin = 0.43 * s;
      // Full thigh narrowing to the knee; calf high on the shin, slim ankle.
      const leg = this.chain(
        thigh,
        shin,
        [limb * 1.78, limb * 1.8, limb * 1.6, limb * 1.36, limb * 1.2],
        [limb * 1.2, limb * 1.38, limb * 1.2, limb * 0.95, limb * 0.82],
        o.legStripe ? striped(o.thigh, o.legStripe) : m(o.thigh, 0.5),
        o.legStripe ? striped(o.shin, o.legStripe) : m(o.shin, 0.55),
      );
      leg.root.position.set(-0.03, -0.015, side * this.hipWidth);
      const knee = new THREE.Mesh(new THREE.SphereGeometry(limb * 1.25, 12, 8), pads);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.11 * s, 0.11 * s), boots);
      boot.position.set(shin + 0.04 * s, 0, 0);
      const toe = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.13 * s, 0.1 * s), boots);
      toe.position.set(shin + 0.1 * s, -0.02 * s, 0);
      const rake = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08 * s, 0.1 * s), steel);
      rake.position.set(shin + 0.14 * s, -0.03 * s, 0);
      leg.mid.add(knee, boot, toe, rake);
      if (o.bottle && side > 0) {
        // The beer, tucked into the top of the right sock.
        const bottle = new THREE.Group();
        const glass = new THREE.MeshStandardMaterial({ color: '#4a2a10', roughness: 0.15, metalness: 0.2 });
        const bodyGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 10).rotateZ(Math.PI / 2), glass);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.07, 8).rotateZ(Math.PI / 2), glass);
        neck.position.x = -0.1;
        const label = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.06, 10).rotateZ(Math.PI / 2), m('#efe2c2', 0.6));
        bottle.add(bodyGlass, neck, label);
        bottle.position.set(0.14 * s, 0, limb * 1.2 + 0.03);
        leg.mid.add(bottle);
      }
      this.body.add(leg.root);
      this.legs.push(leg);
    }
    this.legLength = (0.44 + 0.43) * s;

    this.root.traverse((obj) => (obj.castShadow = true));
    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    this.contactShadow.position.set(-0.15, 0.015, 0);
    this.contactShadow.renderOrder = 1;
    this.contactShadow.castShadow = false;
    this.root.add(this.contactShadow);
    const template = RiderModel.templates[look.id];
    if (template) {
      // The Blender body takes over from the code-built limbs and torso; the head stays.
      const head = new Set<THREE.Object3D>();
      this.head.traverse((o) => head.add(o));
      this.body.traverse((o) => {
        if (o instanceof THREE.Mesh && !head.has(o)) o.visible = false;
      });
      this.skinned = new RiderBody(template, look);
      this.body.add(this.skinned.root);
    }
    this.setPose({ posture: 0, steer: 0, rakeLeft: 0, rakeRight: 0, mount: 1, runPhase: 0 });
  }

  /** Where a hand is now, in world space (0 left, 1 right): for something held to follow it. */
  handAt(side: 0 | 1, out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    const arm = this.arms[side];
    return out.set(arm.lower + 0.07 * this.look.scale, 0, 0).applyMatrix4(arm.mid.matrixWorld);
  }

  /** Where the skeleton's joints are now, in world space, for the Blender body to follow. */
  private joints(): Joints {
    this.root.updateMatrixWorld(true);
    const s = this.look.scale;
    const at = (o: THREE.Object3D, x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld);
    const t = this.torso;
    const pair = (f: (i: number) => THREE.Vector3): [THREE.Vector3, THREE.Vector3] => [f(0), f(1)];
    const forward = new THREE.Vector3().setFromMatrixColumn(this.root.matrixWorld, 0).normalize();
    const ankle = pair((i) => at(this.legs[i].mid, this.legs[i].lower));
    return {
      pelvis: at(this.body),
      waist: at(t, 0.14 * s),
      chest: at(t, 0.3 * s),
      neck: at(t, this.shoulder + 0.03 * s),
      neckTop: at(t, this.shoulder + 0.1 * s),
      shoulder: pair((i) => at(this.arms[i].root)),
      elbow: pair((i) => at(this.arms[i].mid)),
      wrist: pair((i) => at(this.arms[i].mid, this.arms[i].lower)),
      fingers: pair((i) => at(this.arms[i].mid, this.arms[i].lower + 0.17 * s)),
      hip: pair((i) => at(this.legs[i].root)),
      knee: pair((i) => at(this.legs[i].mid)),
      ankle,
      // Standing, the feet point ahead along the ground; lying, the toes point back along the legs.
      toe: pair((i) =>
        this.standing ? ankle[i].clone().addScaledVector(forward, 0.17 * s).add(new THREE.Vector3(0, -0.04 * s, 0)) : at(this.legs[i].mid, this.legs[i].lower + 0.17 * s),
      ),
    };
  }

  private chain(upper: number, lower: number, upperRadii: number[], lowerRadii: number[], upperMat: THREE.Material, lowerMat: THREE.Material): Chain {
    const root = new THREE.Group();
    root.add(segment(upper, upperRadii, upperMat));
    const mid = new THREE.Group();
    mid.position.x = upper;
    mid.add(segment(lower, lowerRadii, lowerMat));
    root.add(mid);
    return { root, mid, upper, lower };
  }

  /** Hips and seat: a pelvis and glutes joining the legs to the torso. */
  private buildPelvis(look: RiderLook) {
    const s = look.scale;
    const w = Math.sqrt(look.build);
    const mat = m(look.outfit.pelvis, 0.55);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.13 * s, 16, 12).scale(0.85, 0.78, 1.1 * w), mat);
    pelvis.position.x = 0.01;
    this.body.add(pelvis);
    // The torso's back (+Y in the pelvis frame) faces up when lying: the glutes are there.
    for (const side of [-1, 1]) {
      const glute = new THREE.Mesh(new THREE.SphereGeometry(0.092 * s * w, 14, 10).scale(1.2, 0.85, 1), mat);
      glute.position.set(-0.05 * s, 0.045 * s, side * 0.068 * s * w);
      this.body.add(glute);
    }
  }

  /** Pelvis to shoulders: a lathe-turned torso, flattened front to back, with lettering and back stripe. */
  private buildTorso(look: RiderLook) {
    const s = look.scale;
    const L = this.shoulder;
    const w = look.build;
    const o = look.outfit;
    const profile = [
      [0.02, 0.135], [0.08, 0.14], [0.16, 0.13], [0.26, 0.142], [0.36, 0.165], [0.44, 0.172], [(L * 0.94) / s, 0.15], [L / s, 0.085], [(L * 1.04) / s, 0.05],
    ].map(([y, r]) => new THREE.Vector2(r * s, y * s));
    const geo = new THREE.LatheGeometry(profile, 20).rotateZ(-Math.PI / 2);
    geo.scale(1, 0.72, w);
    this.torso.add(new THREE.Mesh(geo, m(o.torso, look.id === 'remo' ? 0.95 : 0.5)));
    const depth = 0.165 * s * 0.72;
    const front = -depth; // belly side (faces the ice when lying)
    const back = depth;
    // Neck, up into the head.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.058 * s, 0.12 * s, 14).rotateZ(-Math.PI / 2), m(look.skin, 0.6));
    neck.position.set(L + 0.04 * s, 0, 0);
    this.torso.add(neck);
    if (o.lettering) {
      // "CRESTA RUN" across the chest, with the flag patch.
      const tex = canvasTexture(256, 96, (g) => {
        g.clearRect(0, 0, 256, 96);
        g.fillStyle = o.lettering!;
        g.font = 'bold 44px Outfit, Verdana, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('CRESTA RUN', 128, 60);
        drawFlag(g, look.flag, 196, 4, 36, 24);
      });
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.26 * s * w, 0.1 * s), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      // Reads across the chest: text along the rider's right, facing out of the belly.
      plate.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
      plate.position.set(L * 0.78, front - 0.004, 0);
      this.torso.add(plate);
    }
    if (o.backStripe) {
      // A broad stripe down the middle of the back.
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.9, 0.09 * s), m(o.backStripe, 0.5));
      stripe.rotation.set(-Math.PI / 2, 0, 0);
      stripe.position.set(L * 0.5, back + 0.004, 0);
      this.torso.add(stripe);
    }
    if (o.braces) {
      // Lederhosen braces over the shoulders, with the chest bar.
      const leather = m(o.braces, 0.7);
      // Each strap follows the curve of the body, front and back, over the shoulder.
      const radiusAt = (x: number) => {
        for (let i = 1; i < profile.length; i++) {
          const a = profile[i - 1];
          const b = profile[i];
          if (x <= b.y) return a.x + ((b.x - a.x) * Math.max(0, x - a.y)) / (b.y - a.y);
        }
        return profile[profile.length - 1].x;
      };
      for (const side of [-1, 1]) {
        const z = side * 0.075 * s * w;
        for (const face of [-1, 1]) {
          const points: THREE.Vector3[] = [];
          for (let i = 0; i <= 10; i++) {
            const x = 0.06 * s + (L * 0.96 - 0.06 * s) * (i / 10);
            const r = radiusAt(x);
            const y = face * (0.72 * r * Math.sqrt(Math.max(0, 1 - (z / (r * w)) ** 2)) + 0.008);
            points.push(new THREE.Vector3(x, y, z));
          }
          const strap = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, 0.011 * s, 5), leather);
          this.torso.add(strap);
        }
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.01, 0.2 * s * w), leather);
      bar.position.set(L * 0.7, front - 0.008, 0);
      this.torso.add(bar);
      const tex = canvasTexture(256, 64, (g) => {
        g.fillStyle = '#e9d8b4';
        g.font = 'bold 34px Georgia, serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('CRESTA RUN', 128, 34);
      });
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.19 * s * w, 0.05 * s), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      label.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
      label.position.set(L * 0.7, front - 0.014, 0);
      this.torso.add(label);
      // A flag patch on the right sleeve's shoulder.
      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(0.05 * s, 0.05 * s),
        new THREE.MeshBasicMaterial({ map: canvasTexture(40, 40, (g) => drawFlag(g, look.flag, 0, 0, 40, 40)) }),
      );
      patch.position.set(L * 0.88, 0, this.shoulderWidth + 0.035 * s);
      this.torso.add(patch);
    }
  }

  /** Head and face, hair, beard; the helmet over them. */
  private buildHead(look: RiderLook): FaceRig {
    const s = look.scale;
    this.head.position.set(this.shoulder + 0.17 * s, 0, 0);
    this.head.scale.setScalar(s);
    this.torso.add(this.head);
    const face = buildFace(look);
    this.head.add(face.group);
    // The helmet, worn when riding.
    if (look.helmet) {
      const shell = m(look.helmet.shell, 0.28, 0.15);
      const r = 0.142;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 16), shell);
      dome.scale.set(1.08, 1.02, 0.95);
      dome.position.set(0.01, 0.005, 0);
      const visor = new THREE.Mesh(
        new THREE.SphereGeometry(r * 1.025, 22, 10, Math.PI - 0.8, 1.6, 1.3, 0.62),
        new THREE.MeshStandardMaterial({ color: look.helmet.visor, roughness: 0.06, metalness: 0.75 }),
      );
      visor.scale.copy(dome.scale);
      visor.position.copy(dome.position);
      const chin = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 8, Math.PI - 0.65, 1.3, 1.92, 0.62), shell);
      chin.scale.copy(dome.scale);
      chin.position.copy(dome.position);
      this.helmet.add(dome, visor, chin);
      this.head.add(this.helmet);
    }
    return face;
  }

  /** Facial expression: a wink of the left eye, an open mouth. */
  private express(wink: number, open: number) {
    this.face.express(wink, open);
  }

  private casting = true;

  /**
   * Whether the rider casts a shadow. High on a steep bank the low sun throws it metres away down
   * the wall, where it reads as the rider flying; there the contact shadow alone grounds them.
   */
  setCastShadow(on: boolean) {
    if (on === this.casting) return;
    this.casting = on;
    this.root.traverse((o) => {
      if (o !== this.contactShadow) o.castShadow = on;
    });
  }

  /** As setCastShadow, from the steepness of the ice under the rider, with a margin so it doesn't flicker. */
  castShadowOnSlope(angle: number) {
    this.setCastShadow(this.casting ? angle < 0.62 : angle < 0.48);
  }

  /** Put the helmet on or take it off (off to celebrate). */
  setHelmet(on: boolean) {
    this.helmet.visible = on && this.look.helmet !== null;
    if (this.face.bun) this.face.bun.visible = !this.helmet.visible;
  }

  setPose(p: RiderPose) {
    this.holdToboggan(!!p.stand);
    // Sitting or leaning, the toboggan is left elsewhere.
    this.toboggan.visible = !p.stand || (p.stand.posture ?? 'stand') === 'stand';
    let targets: Targets;
    let wink = 0;
    let open = 0;
    if (p.stand) {
      const posture = p.stand.posture ?? 'stand';
      if (posture === 'sit') targets = this.sittingTargets(p.stand.time);
      else if (posture === 'lean') targets = this.leaningTargets(p.stand.time);
      else ({ targets, wink, open } = this.standingTargets(p.stand.time, p.stand.action, p.stand.t));
      targets.headYaw += p.stand.look ?? 0;
    } else {
      targets = this.ridingTargets(p);
      if (p.cheer && p.cheer > 0) {
        const cheer = this.cheeringTargets(p.cheerTime ?? 0);
        targets = blendTargets(targets, cheer.targets, smooth(p.cheer));
        wink = cheer.wink * p.cheer;
        open = cheer.open * p.cheer;
      }
      else if (p.mount < 1) {
        targets = blendTargets(this.runningTargets(p.runPhase), targets, smooth(p.mount));
        targets.pelvis.y += Math.sin(Math.PI * p.mount) * 0.32; // the little spring onto the toboggan
      }
    }
    this.apply(targets);
    if (this.skinned) this.skinned.pose(this.joints());
    this.express(wink, open);
    if (this.smoke.length && p.stand) this.puff(p.stand.time);
    const cushion = this.toboggan.getObjectByName('cushion');
    if (cushion) cushion.position.x = THREE.MathUtils.clamp(this.body.position.x * 0.8, -0.25, 0.12);
  }

  /**
   * For background riders: merge the plain parts into one mesh per moving part. The face stops
   * winking and burping (its lids and jaw are fixed as they are).
   */
  bake() {
    const parts = [this.toboggan, this.body, this.torso, this.head, ...this.arms.flatMap((c) => [c.root, c.mid]), ...this.legs.flatMap((c) => [c.root, c.mid])];
    bakeParts(this.root, parts);
  }

  /** Give the rider something to hold in the right hand: a cigarette (smoking), or a cola. */
  holdProp(prop: Prop) {
    const arm = this.arms[1];
    const s = this.look.scale;
    const at = arm.lower + 0.055 * s * this.look.limbs * 0.9;
    const group = new THREE.Group();
    group.position.set(at, 0, 0);
    if (prop === 'cigarette') {
      // Between the fingers, sticking out sideways; a glowing tip and a curl of smoke.
      const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.075, 6).rotateX(Math.PI / 2), m('#f4f1ea', 0.7));
      paper.position.z = 0.05;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), new THREE.MeshStandardMaterial({ color: '#ff6a1a', emissive: '#ff4a10', emissiveIntensity: 1.5 }));
      tip.position.z = 0.088;
      tip.name = 'tip';
      group.add(paper, tip);
      this.tip = tip;
      for (let i = 0; i < 8; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: '#e8e8e8', transparent: true, opacity: 0.3, depthWrite: false }));
        this.root.add(puff);
        this.smoke.push(puff);
      }
    } else {
      // A glass bottle of cola: dark glass, a red label, a cap.
      const profile = [[0, 0], [0.032, 0], [0.034, 0.02], [0.028, 0.07], [0.033, 0.11], [0.026, 0.15], [0.013, 0.19], [0.012, 0.215], [0, 0.215]].map(([r, y]) => new THREE.Vector2(r, y - 0.09));
      const bottle = new THREE.Mesh(new THREE.LatheGeometry(profile, 14), new THREE.MeshStandardMaterial({ color: '#2a1408', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.92 }));
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0335, 0.045, 14, 1, true), m('#c8102e', 0.5));
      label.position.y = 0.0;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.01, 10), m('#c8102e', 0.4, 0.5));
      cap.position.y = 0.13;
      const neck = new THREE.Group();
      neck.add(bottle, label, cap);
      neck.rotation.x = Math.PI / 2; // held upright in the fist
      group.add(neck);
    }
    group.traverse((o) => (o.castShadow = true));
    arm.mid.add(group);
  }

  /** Smoke curls up from the cigarette's tip, each puff rising, spreading and fading. */
  private puff(time: number) {
    if (!this.tip) return;
    this.root.updateMatrixWorld(true);
    const tip = this.root.worldToLocal(this.tip.getWorldPosition(new THREE.Vector3()));
    this.smoke.forEach((puff, i) => {
      const k = (time * 0.4 + i / this.smoke.length) % 1;
      puff.position.set(tip.x + Math.sin(i * 2.1 + time) * 0.06 * k, tip.y + k * 0.6, tip.z + Math.cos(i * 1.3 + time * 0.7) * 0.06 * k);
      puff.scale.set(0.25 + k * 1.3, 0.5 + k * 2, 0.25 + k * 1.3);
      (puff.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - k) * Math.min(1, k * 6);
    });
  }

  /** Where the rake on a boot (0 left, 1 right) is in the world; call after posing. */
  rakeWorld(side: number, out: THREE.Vector3): THREE.Vector3 {
    const leg = this.legs[side];
    return out.set(leg.lower + 0.14 * this.look.scale, -0.03 * this.look.scale, 0).applyMatrix4(leg.mid.matrixWorld);
  }

  /** Standing for the camera, the toboggan is stood on its tail at the rider's left side. */
  private holdToboggan(standing: boolean) {
    if (standing === this.standing) return;
    this.standing = standing;
    this.contactShadow.visible = !standing;
    if (standing) {
      this.toboggan.quaternion
        .setFromEuler(new THREE.Euler(0, Math.PI + 0.55, Math.PI / 2, 'XYZ'))
        .premultiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.1));
      this.toboggan.position.copy(STAND_TOBOGGAN);
    } else {
      this.toboggan.quaternion.identity();
      this.toboggan.position.set(0, 0, 0);
    }
    this.toboggan.updateMatrix();
  }

  /** Where a hip sits in the toboggan frame, for a pelvis position and pitch/roll. */
  private hipAt(pelvis: THREE.Vector3, pitch: number, roll: number, side: number): THREE.Vector3 {
    const local = V(-0.03, -0.015, side * this.hipWidth);
    return local.applyEuler(new THREE.Euler(roll, 0, pitch)).add(pelvis);
  }

  /** Lying on the toboggan: forward on the smooth runners, or slid back on the knives. */
  private ridingTargets(p: RiderPose): Targets {
    const s = this.look.scale;
    const k = p.posture;
    const pelvis = V(0.08 - 0.3 * k, this.seat + 0.075 * Math.sqrt(this.look.build), 0);
    const pitch = 0.03 + 0.24 * k;
    const roll = -p.steer * k * 0.18;
    const steerKnives = p.steer * k;
    // Hands: tucked by the hips when forward; on the knives, right on the front handle,
    // left on the left edge by the hip. Steering pushes the hands forward or back a touch.
    const tucked: [THREE.Vector3, THREE.Vector3] = [V(pelvis.x + 0.05, this.seat + 0.05, -0.2 * s), V(pelvis.x + 0.05, this.seat + 0.05, 0.2 * s)];
    const knives: [THREE.Vector3, THREE.Vector3] = [
      V(pelvis.x + 0.14 - steerKnives * 0.05, this.seat + 0.02, -0.25),
      V(0.55 + steerKnives * 0.04, this.handleY, 0.21),
    ];
    const hands: [THREE.Vector3, THREE.Vector3] = [tucked[0].lerp(knives[0], k), tucked[1].lerp(knives[1], k)];
    // Legs straight: together lying forward, apart on the knives. A raking leg swings down,
    // still straight, until the boot reaches the ice. Targets sit just past full reach.
    const reach = this.legLength + 0.06;
    const foot = (side: number, rake: number) => {
      const hip = this.hipAt(pelvis, pitch, roll, side);
      const spread = side * (0.015 + 0.24 * k);
      const lift = 0.06;
      const down = (0.025 - hip.y) / this.legLength;
      const dir = V(-1, lift + (down - lift) * rake, spread).normalize();
      return hip.addScaledVector(dir, reach);
    };
    return {
      pelvis,
      pitch,
      roll,
      headYaw: p.steer * (1 - k) * 0.6,
      headTilt: 0,
      headRoll: 0,
      hands,
      feet: [foot(-1, p.rakeLeft), foot(1, p.rakeRight)],
      // Elbows bend up and out, just above the back; any knee bend goes up, never into the ice.
      elbowPoles: [V(pelvis.x + 0.3, this.seat + 0.38, -0.5), V(pelvis.x + 0.45, this.seat + 0.42, 0.55)],
      kneePoles: [V(pelvis.x - 0.4, this.seat + 1.2, -0.2), V(pelvis.x - 0.4, this.seat + 1.2, 0.2)],
    };
  }

  /** Bent over beside the toboggan, pushing it by the handles, legs striding. */
  /**
   * The running start: a crouched sprint beside the toboggan, pushing it. Hips low and the torso
   * pitched well forward, head up to look down the run; both hands down on the toboggan's near rail;
   * the legs driving, knees coming high and forward on the swing and pushing off behind on each step,
   * the body dipping as each foot strikes.
   */
  private runningTargets(phase: number): Targets {
    const s = this.look.scale;
    // Two dips a stride: one at each foot strike.
    const bob = -0.03 * Math.abs(Math.sin(phase)) * s;
    // Doubled over beside the toboggan, back nearly flat, so the hands reach right down to it. A
    // heavier build runs a little taller and more upright, so the thighs don't drive into the belly.
    const heavy = Math.max(0, this.look.build - 1);
    const pelvis = V(-0.5, (0.66 + 0.07 * heavy) * s + bob, -0.44);
    const stride = (offset: number) => {
      const a = phase + offset;
      // Forward through the swing (cos > 0), lifting the foot; back along the ground in contact.
      const swing = Math.cos(a);
      return V(pelvis.x - 0.06 + 0.36 * Math.sin(a) * s, 0.04 + Math.max(0, swing) * 0.2 * s, pelvis.z + (offset ? 0.13 : -0.13));
    };
    return {
      pelvis,
      pitch: 0.2 + 0.25 * heavy,
      roll: Math.sin(phase) * 0.04,
      headYaw: 0.1,
      // Eyes on the ice a few metres ahead, not up at the sky.
      headTilt: 0.1 - 0.2 * heavy,
      headRoll: 0,
      // Both hands on the toboggan's near rail, down at ice level: the left behind, the right ahead.
      hands: [V(-0.06, this.handleY + 0.01, -0.2), V(0.3, this.handleY + 0.01, -0.17)],
      feet: [stride(0), stride(Math.PI)],
      elbowPoles: [V(pelvis.x - 0.3, 1.0 * s, -1.2), V(pelvis.x + 0.3, 1.0 * s, 0.1)],
      // Knees forward and a little out, so they bend the right way in the crouch.
      kneePoles: [V(pelvis.x + 1.2, 0.5 * s, pelvis.z - 0.3), V(pelvis.x + 1.2, 0.5 * s, pelvis.z + 0.3)],
    };
  }

  /**
   * On their feet beside the toboggan at Celerina, celebrating each in their own way: Maximilian
   * cocky, arms out and palms down, calming the masses as he looks them over; Adelaide hopping with
   * excitement, hands up; Remo one fist raised high like a victorious gladiator, the other on his hip.
   */
  private cheeringTargets(time: number): { targets: Targets; wink: number; open: number } {
    const s = this.look.scale;
    const base = (pelvis: THREE.Vector3): Omit<Targets, 'hands'> => ({
      pelvis,
      pitch: Math.PI / 2 - 0.05,
      roll: 0,
      headYaw: 0,
      headTilt: 0.15,
      headRoll: 0,
      feet: [V(pelvis.x + 0.05, 0.05, pelvis.z - 0.13), V(pelvis.x + 0.05, 0.05, pelvis.z + 0.13)],
      elbowPoles: [V(pelvis.x, pelvis.y + 0.4, pelvis.z - 1), V(pelvis.x, pelvis.y + 0.4, pelvis.z + 1)],
      kneePoles: [V(pelvis.x + 1, 0.4, pelvis.z), V(pelvis.x + 1, 0.4, pelvis.z)],
    });
    if (this.look.id === 'maximilian') {
      // Arms out low to the sides, palms down, patting the air: "settle down, settle down".
      const pelvis = V(-0.25, 0.92 * s, -0.62);
      const shoulderY = pelvis.y + this.shoulder;
      const pat = Math.sin(time * 2.4) * 0.07;
      const t = base(pelvis);
      t.pitch = Math.PI / 2 - 0.1; // leaning back a touch, pleased with himself
      t.headTilt = 0.32; // chin up
      t.headYaw = Math.sin(time * 0.8) * 0.45; // looking the crowd over
      t.feet = [V(pelvis.x + 0.08, 0.05, pelvis.z - 0.2), V(pelvis.x - 0.02, 0.05, pelvis.z + 0.2)];
      t.elbowPoles = [V(pelvis.x - 0.6, pelvis.y, pelvis.z - 1), V(pelvis.x - 0.6, pelvis.y, pelvis.z + 1)];
      return {
        targets: { ...t, hands: [V(pelvis.x + 0.28, shoulderY - 0.18 + pat, pelvis.z - 0.62), V(pelvis.x + 0.28, shoulderY - 0.18 + pat, pelvis.z + 0.62)] },
        wink: Math.sin(time * 0.8) > 0.9 ? 1 : 0,
        open: 0,
      };
    }
    if (this.look.id === 'adelaide') {
      // Little hops, landing on bent knees, hands up over her head.
      const phase = (time * 1.9) % 1;
      const hop = phase < 0.62 ? Math.sin((phase / 0.62) * Math.PI) * 0.17 : 0;
      const crouch = phase >= 0.62 ? Math.sin(((phase - 0.62) / 0.38) * Math.PI) * 0.08 : 0;
      const pelvis = V(-0.25, 0.92 * s + hop - crouch, -0.62);
      const t = base(pelvis);
      t.feet = [V(pelvis.x + 0.05, 0.05 + hop * 0.9, pelvis.z - 0.12), V(pelvis.x + 0.05, 0.05 + hop * 0.9, pelvis.z + 0.12)];
      t.headTilt = 0.25;
      const shake = Math.sin(time * 14) * 0.05;
      return {
        targets: { ...t, hands: [V(pelvis.x + 0.12, pelvis.y + 1.02 * s + shake, pelvis.z - 0.2), V(pelvis.x + 0.12, pelvis.y + 1.02 * s - shake, pelvis.z + 0.2)] },
        wink: 0,
        open: 0.7,
      };
    }
    // Remo: the victorious warrior. Feet planted wide, leaning into it, the right arm thrust up and
    // brandished again and again, fist clenched as if holding up his enemy's head; the left fist
    // clenched at his side; roaring with every thrust.
    const pump = (time * 1.4) % 1;
    const thrust = pump < 0.35 ? Math.sin((pump / 0.35) * Math.PI * 0.5) : Math.cos(((pump - 0.35) / 0.65) * Math.PI * 0.5);
    const shake = Math.sin(time * 19) * 0.025 * thrust;
    const pelvis = V(-0.22, (0.88 - 0.03 * thrust) * s, -0.62);
    const t = base(pelvis);
    t.pitch = Math.PI / 2 + 0.04; // leaning in, not back
    t.headTilt = 0.15 + 0.25 * thrust;
    t.headYaw = 0.25;
    t.feet = [V(pelvis.x + 0.12, 0.05, pelvis.z - 0.26), V(pelvis.x - 0.06, 0.05, pelvis.z + 0.26)];
    t.kneePoles = [V(pelvis.x + 1, 0.4, pelvis.z - 0.4), V(pelvis.x + 1, 0.4, pelvis.z + 0.4)];
    // The raised arm swings from a bent, shoulder-high fist up to full stretch and back.
    const high = V(pelvis.x + 0.14 + shake, pelvis.y + (0.78 + 0.36 * thrust) * s, pelvis.z + 0.24 + shake);
    t.elbowPoles = [V(pelvis.x - 0.8, pelvis.y - 0.1, pelvis.z - 0.6), V(pelvis.x + 0.4, pelvis.y + 0.5, pelvis.z + 1.2)];
    return {
      targets: { ...t, hands: [V(pelvis.x + 0.1, pelvis.y - 0.18, pelvis.z - 0.32), high] },
      wink: 0,
      open: 0.25 + 0.6 * thrust,
    };
  }

  /**
   * Standing beside the toboggan for the camera, facing +X: chin up, chest out, hands on hips,
   * breathing. Gestures: Maximilian combs his hair back, Adelaide winks and blows a kiss, Remo burps.
   */
  private standingTargets(time: number, action: IdleAction | null, t: number): { targets: Targets; wink: number; open: number } {
    const s = this.look.scale;
    // Big, slow video-game breathing: the whole body rises and sinks, knees giving a little.
    const breath = Math.sin((time * Math.PI * 2) / 2.6);
    const pelvis = V(0, 0.9 * s + breath * 0.026, -0.75);
    const shoulderY = pelvis.y + this.shoulder;
    const headY = shoulderY + 0.2 * s;
    const hip = (side: number) => V(pelvis.x - 0.02, pelvis.y + 0.04, pelvis.z + side * (this.hipWidth + 0.13 * this.look.build));
    const targets: Targets = {
      pelvis,
      pitch: Math.PI / 2 + 0.03 - breath * 0.035, // chest swells back on the in-breath
      roll: 0,
      headYaw: 0,
      headTilt: 0.12 + breath * 0.03,
      headRoll: 0,
      // Left hand resting on the nose of the stood-up toboggan, right fist on the hip.
      hands: [V(0.5, 0.11, 0).applyMatrix4(this.toboggan.matrix), hip(1)],
      feet: [V(pelvis.x + 0.03, 0.06, pelvis.z - 0.17), V(pelvis.x + 0.03, 0.06, pelvis.z + 0.21)],
      elbowPoles: [V(pelvis.x - 0.4, pelvis.y + 0.1, pelvis.z - 1.2), V(pelvis.x - 0.2, pelvis.y + 0.3, pelvis.z + 1.2)],
      kneePoles: [V(pelvis.x + 1, 0.45, pelvis.z - 0.2), V(pelvis.x + 1, 0.45, pelvis.z + 0.2)],
    };
    let wink = 0;
    let open = 0;
    if (action === 'comb') {
      // Right hand sweeps from the forehead, over the top, to the back of the head.
      const w = window01(t, 0, 1);
      const u = THREE.MathUtils.smoothstep(t, 0.2, 0.8);
      const a = Math.PI * 0.15 + u * Math.PI * 0.8;
      const sweep = V(pelvis.x + Math.cos(a) * 0.14 * s, headY + 0.02 + Math.sin(a) * 0.14 * s, pelvis.z + 0.07);
      targets.hands[1] = targets.hands[1].lerp(sweep, w);
      targets.elbowPoles[1] = V(pelvis.x - 0.15, headY + 0.25, pelvis.z + 1.3); // elbow out to the side, clear of the face
      targets.headTilt += w * 0.15;
    } else if (action === 'flirt') {
      // A wink, a tilt of the head, and a kiss blown at the camera.
      const w = window01(t, 0, 1);
      wink = window01(t, 0.15, 0.6);
      targets.headRoll = w * 0.22;
      const lips = V(pelvis.x + 0.12 * s, headY - 0.04, pelvis.z + 0.03);
      const out = V(pelvis.x + 0.5 * s, headY - 0.08, pelvis.z + 0.18);
      const hand = lips.lerp(out, THREE.MathUtils.smoothstep(t, 0.45, 0.75));
      targets.hands[1] = targets.hands[1].lerp(hand, w);
      targets.elbowPoles[1] = V(pelvis.x - 0.2, pelvis.y + 0.2, pelvis.z + 1.2);
    } else if (action === 'burp') {
      // Hand on the belly, head back, a big open-mouthed burp.
      const w = window01(t, 0, 1);
      open = window01(t, 0.25, 0.7);
      targets.headTilt += open * 0.45;
      targets.pelvis.y += open * 0.012;
      targets.hands[1] = targets.hands[1].lerp(V(pelvis.x + 0.2 * s * this.look.build, pelvis.y + 0.22 * s, pelvis.z + 0.02), w);
      targets.elbowPoles[1] = V(pelvis.x, pelvis.y, pelvis.z + 1.2);
    }
    return { targets, wink, open };
  }

  /** Sitting on a bench (seat 0.46 m), leaning back a touch, hands on the thighs; a smoke now and then. */
  private sittingTargets(time: number): Targets {
    const s = this.look.scale;
    const breath = Math.sin((time * Math.PI * 2) / 3.2);
    const pelvis = V(0, 0.46 + 0.09 * s, -0.75);
    const shoulderY = pelvis.y + this.shoulder;
    const thigh = (side: number) => V(pelvis.x + 0.3 * s, pelvis.y + 0.07, pelvis.z + side * 0.13);
    const targets: Targets = {
      pelvis,
      pitch: Math.PI / 2 + 0.1 + breath * 0.02,
      roll: 0,
      headYaw: 0,
      headTilt: 0.05,
      headRoll: 0,
      hands: [thigh(-1), thigh(1)],
      feet: [V(pelvis.x + 0.48 * s, 0.06, pelvis.z - 0.18), V(pelvis.x + 0.52 * s, 0.06, pelvis.z + 0.2)],
      elbowPoles: [V(pelvis.x - 0.3, pelvis.y + 0.2, pelvis.z - 1.2), V(pelvis.x - 0.3, pelvis.y + 0.2, pelvis.z + 1.2)],
      kneePoles: [V(pelvis.x + 1, pelvis.y + 0.8, pelvis.z - 0.2), V(pelvis.x + 1, pelvis.y + 0.8, pelvis.z + 0.2)],
    };
    if (this.tip) {
      // Every few seconds the cigarette goes to the lips.
      const k = (time % 7) / 7;
      const w = window01(k, 0.1, 0.4);
      const lips = V(pelvis.x + 0.13 * s, shoulderY + 0.13 * s, pelvis.z + 0.02);
      targets.hands[1] = targets.hands[1].lerp(lips, w);
      targets.elbowPoles[1] = V(pelvis.x + 0.1, pelvis.y, pelvis.z + 1.2);
    }
    return targets;
  }

  /** Leaning back against a wall, ankles crossed, a drink in hand and a swig every so often. */
  private leaningTargets(time: number): Targets {
    const s = this.look.scale;
    const breath = Math.sin((time * Math.PI * 2) / 3.4);
    const pelvis = V(0.16, 0.86 * s + breath * 0.008, -0.75);
    const shoulderY = pelvis.y + this.shoulder;
    const hip = V(pelvis.x - 0.02, pelvis.y + 0.04, pelvis.z - (this.hipWidth + 0.13 * this.look.build));
    const targets: Targets = {
      pelvis,
      pitch: Math.PI / 2 + 0.24,
      roll: 0,
      headYaw: 0,
      headTilt: -0.12,
      headRoll: 0,
      hands: [hip, V(pelvis.x + 0.22 * s, pelvis.y + 0.25 * s, pelvis.z + 0.16)],
      feet: [V(pelvis.x + 0.42 * s, 0.06, pelvis.z - 0.12), V(pelvis.x + 0.5 * s, 0.06, pelvis.z - 0.02)],
      elbowPoles: [V(pelvis.x - 0.3, pelvis.y + 0.1, pelvis.z - 1.2), V(pelvis.x - 0.2, pelvis.y - 0.2, pelvis.z + 1)],
      kneePoles: [V(pelvis.x + 1, 0.5, pelvis.z - 0.2), V(pelvis.x + 1, 0.5, pelvis.z + 0.3)],
    };
    // A swig: bottle to the lips, head back.
    const k = ((time + 2.3) % 6) / 6;
    const w = window01(k, 0.1, 0.38);
    targets.hands[1] = targets.hands[1].lerp(V(pelvis.x + 0.08 * s, shoulderY + 0.12 * s, pelvis.z + 0.04), w);
    targets.headTilt += w * 0.4;
    targets.elbowPoles[1] = V(pelvis.x + 0.3, pelvis.y, pelvis.z + 1.2);
    return targets;
  }

  private apply(t: Targets) {
    this.body.position.copy(t.pelvis);
    this.body.rotation.set(t.roll, 0, t.pitch);
    this.torso.rotation.set(0, 0, 0);
    // Keep the face looking ahead: the neck counters the body's pitch; tilt lifts the chin.
    this.head.rotation.set(t.headRoll, t.headYaw, -t.pitch * 0.9 + 0.05 + t.headTilt);
    this.body.updateMatrix();
    this.torso.updateMatrix();
    const toBody = this.body.matrix.clone().invert();
    const toTorso = this.body.matrix.clone().multiply(this.torso.matrix).invert();
    const solve = (chain: Chain, target: THREE.Vector3, pole: THREE.Vector3, frame: THREE.Matrix4) => {
      const sol = solveTwoBone(chain.root.position, target.clone().applyMatrix4(frame), chain.upper, chain.lower, pole.clone().applyMatrix4(frame));
      chain.root.quaternion.copy(sol.root);
      chain.mid.rotation.set(0, 0, sol.bend);
    };
    this.arms.forEach((arm, i) => solve(arm, t.hands[i], t.elbowPoles[i], toTorso));
    this.legs.forEach((leg, i) => solve(leg, t.feet[i], t.kneePoles[i], toBody));
  }
}

function blendTargets(a: Targets, b: Targets, t: number): Targets {
  const lerp = (x: THREE.Vector3, y: THREE.Vector3) => x.clone().lerp(y, t);
  const pair = (x: [THREE.Vector3, THREE.Vector3], y: [THREE.Vector3, THREE.Vector3]): [THREE.Vector3, THREE.Vector3] => [lerp(x[0], y[0]), lerp(x[1], y[1])];
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    pelvis: lerp(a.pelvis, b.pelvis),
    pitch: mix(a.pitch, b.pitch),
    roll: mix(a.roll, b.roll),
    headYaw: mix(a.headYaw, b.headYaw),
    headTilt: mix(a.headTilt, b.headTilt),
    headRoll: mix(a.headRoll, b.headRoll),
    hands: pair(a.hands, b.hands),
    feet: pair(a.feet, b.feet),
    elbowPoles: pair(a.elbowPoles, b.elbowPoles),
    kneePoles: pair(a.kneePoles, b.kneePoles),
  };
}

/** Traditional: a low red steel frame on round runners turned up at the front, a sliding cushion, knives at the back. */
function buildTraditional(color = '#b3261e'): { group: THREE.Group; seat: number; handleY: number } {
  const g = new THREE.Group();
  const frame = m(color, 0.5);
  const steel = m('#c9ccd1', 0.25, 0.7);
  for (const z of [-0.21, 0.21]) {
    const runner = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.12, 8).rotateZ(Math.PI / 2), steel);
    runner.position.set(-0.03, 0.016, z);
    const nose = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 6, 12, Math.PI / 2), steel);
    nose.position.set(0.53, 0.066, z);
    nose.rotation.z = -Math.PI / 2;
    const knife = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.022, 0.006), steel);
    knife.position.set(-0.45, 0.009, z);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.022, 0.026), frame);
    rail.position.set(0, 0.075, z);
    g.add(runner, nose, knife, rail);
    for (const x of [-0.45, -0.05, 0.36]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.06, 0.022), frame);
      strut.position.set(x, 0.045, z);
      g.add(strut);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.022, 0.024), frame);
    handle.position.set(0.55, 0.085, z * 1.05);
    g.add(handle);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.01, 0.44), frame);
  plate.position.y = 0.088;
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.38), m('#202022', 0.8));
  cushion.position.y = 0.118;
  cushion.name = 'cushion';
  g.add(plate, cushion);
  return { group: g, seat: 0.15, handleY: 0.085 };
}

/** A toboggan on its own (laid out on the snow at Junction), base on the ground, nose along +X. */
export function looseToboggan(kind: TobogganId, color?: string): THREE.Group {
  const g = (kind === 'flattop' ? buildFlatTop() : buildTraditional(color)).group;
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** Flat-top: a low carbon board on fine runners, side grips, no cushion. */
function buildFlatTop(): { group: THREE.Group; seat: number; handleY: number } {
  const g = new THREE.Group();
  const steel = m('#c9ccd1', 0.25, 0.7);
  const shape = new THREE.Shape();
  const L = 0.6;
  const W = 0.23;
  shape.moveTo(-L, -W);
  shape.lineTo(L - 0.12, -W);
  shape.quadraticCurveTo(L, -W, L, -W + 0.12);
  shape.lineTo(L, W - 0.12);
  shape.quadraticCurveTo(L, W, L - 0.12, W);
  shape.lineTo(-L, W);
  shape.lineTo(-L, -W);
  // Extruded downward from the top face, so the board's top is flat and clean at the front.
  const board = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: false }).rotateX(Math.PI / 2),
    m('#2a2c30', 0.35, 0.3),
  );
  board.position.y = 0.1;
  g.add(board);
  for (const z of [-0.2, 0.2]) {
    const runner = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.15, 8).rotateZ(Math.PI / 2), steel);
    runner.position.set(0, 0.012, z);
    const knife = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.005), steel);
    knife.position.set(-0.45, 0.008, z);
    const grip = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 12, Math.PI), steel);
    grip.position.set(0.48, 0.09, z * 1.12);
    grip.rotation.x = Math.PI / 2;
    for (const x of [-0.4, 0.35]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.02), steel);
      post.position.set(x, 0.045, z);
      g.add(post);
    }
    g.add(runner, knife, grip);
  }
  return { group: g, seat: 0.13, handleY: 0.09 };
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
