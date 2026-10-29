// How each rider looks, after the character sheets: build, face, hair, kit and the details.

import type { RiderId } from '../sim/rider';
import type { FlagCode } from '../ui/flags';

export interface RiderLook {
  id: RiderId;
  flag: FlagCode;
  /** Overall size (1 = about 1.75 m). */
  scale: number;
  /** Chest and shoulder breadth. */
  build: number;
  /** Arm length multiplier. */
  arms: number;
  /** Limb thickness multiplier. */
  limbs: number;
  skin: string;
  hair: { style: 'slick' | 'bun' | 'shaggy'; color: string };
  beard?: string;
  /** A few days' growth (Kletus). */
  stubble?: string;
  /** A big moustache (Mario). */
  moustache?: string;
  cheeks?: string;
  /** Worn always, riding too (made in Blender, blender/riders_mpfb.py): a bush hat, a cap, or the helmet that hides the face. */
  headwear?: 'bushhat' | 'cap' | 'mask';
  /** Helmet worn when riding; null rides bareheaded (as drawn). */
  helmet: { shell: string; visor: string } | null;
  outfit: {
    torso: string;
    upperArm: string;
    forearm: string;
    hands: string;
    pelvis: string;
    thigh: string;
    shin: string;
    boots: string;
    pads: string;
    shoulderPads?: boolean;
    legStripe?: string;
    /** Leather braces over the shoulders with a chest bar (lederhosen). */
    braces?: string;
    /** Chest lettering colour, on the front. */
    lettering?: string;
    /** A broad stripe down the middle of the back. */
    backStripe?: string;
    /** A beer bottle tucked into the right sock. */
    bottle?: boolean;
    /** Kit made in Blender: an open leather vest and denim shorts with a machete on the back (Kletus),
     *  dungarees over a sweater (Mario), black armour and a cape (the Dark Lord). */
    kit?: 'bush' | 'dungarees' | 'armour';
  };
}

export const LOOKS: Record<RiderId, RiderLook> = {
  // German, 20: thin and lanky, slicked-back black hair, a wide grin. A dark green suit with a broad
  // white stripe down the middle of the back, black pads, a dark green helmet.
  maximilian: {
    id: 'maximilian',
    flag: 'de',
    scale: 1.09,
    build: 0.86,
    arms: 1.1,
    limbs: 0.84,
    skin: '#e6bea4',
    hair: { style: 'slick', color: '#1d1a19' },
    helmet: { shell: '#1f3d2b', visor: '#11161a' },
    outfit: {
      torso: '#244a33',
      upperArm: '#244a33',
      forearm: '#244a33',
      hands: '#1a1c1b',
      pelvis: '#1f402c',
      thigh: '#244a33',
      shin: '#244a33',
      boots: '#151616',
      pads: '#18191a',
      shoulderPads: true,
      backStripe: '#ecece6',
      lettering: '#f2f2ee',
    },
  },
  // English, 25: blonde bun, rosy cheeks, a bright smile. A royal blue suit with pink sleeves and
  // legs, red lettering, a blue helmet with a gold visor.
  adelaide: {
    id: 'adelaide',
    flag: 'gb',
    scale: 0.96,
    build: 0.92,
    arms: 1,
    limbs: 0.92,
    skin: '#f0cbb5',
    hair: { style: 'bun', color: '#e2c27a' },
    cheeks: '#ec9a9a',
    helmet: { shell: '#1f47a8', visor: '#c9a13d' },
    outfit: {
      torso: '#2147ad',
      upperArm: '#e88db3',
      forearm: '#e88db3',
      hands: '#1c3170',
      pelvis: '#1d3f99',
      thigh: '#e88db3',
      shin: '#e88db3',
      boots: '#1b2b63',
      pads: '#1b2f6e',
      lettering: '#d9322e',
    },
  },
  // Swiss, 50: burly, bearded, hairy, grinning. Cable-knit wool sweater, leather lederhosen with
  // braces, leather knee and elbow pads, grey wool socks, brown boots, and a beer in his sock.
  remo: {
    id: 'remo',
    flag: 'ch',
    scale: 1.03,
    build: 1.32,
    arms: 0.96,
    limbs: 1.3,
    skin: '#d9a384',
    hair: { style: 'shaggy', color: '#5a4332' },
    beard: '#6b5240',
    helmet: null,
    outfit: {
      torso: '#e8dfcb',
      upperArm: '#e8dfcb',
      forearm: '#cf9a7c',
      hands: '#d9a384',
      pelvis: '#6b4a2e',
      thigh: '#6b4a2e',
      shin: '#9b9890',
      boots: '#5a3d26',
      pads: '#7a5434',
      braces: '#5e3f25',
      bottle: true,
    },
  },
  // Australian, from the bush: taller than Maximilian, ripped but for the beer belly. An open
  // leather vest over a bare chest, frayed denim shorts, work gloves and boots, a machete on his
  // back, and a bush hat with a band of shark's teeth. Bare to the cold.
  kletus: {
    id: 'kletus',
    flag: 'au',
    scale: 1.13,
    build: 1.22,
    arms: 1,
    limbs: 1.25,
    skin: '#c98d6c',
    hair: { style: 'shaggy', color: '#4a3524' },
    stubble: '#5a4433',
    headwear: 'bushhat',
    helmet: null,
    outfit: {
      torso: '#5e4128',
      upperArm: '#c98d6c',
      forearm: '#c98d6c',
      hands: '#6e6748',
      pelvis: '#4f6b8c',
      thigh: '#4f6b8c',
      shin: '#c98d6c',
      boots: '#6b5a3e',
      pads: '#c98d6c',
      kit: 'bush',
    },
  },
  // Italian, from Padova: a bit shorter than Adelaide and round in the middle. A red sweater under
  // blue dungarees with gold buttons, white gloves, black boots, a red cap and a big black moustache.
  mario: {
    id: 'mario',
    flag: 'it',
    scale: 0.9,
    build: 1.12,
    arms: 0.95,
    limbs: 1.12,
    skin: '#f2c3a0',
    hair: { style: 'shaggy', color: '#3a2416' },
    moustache: '#1c1410',
    cheeks: '#e9958a',
    headwear: 'cap',
    helmet: null,
    outfit: {
      torso: '#c8202a',
      upperArm: '#c8202a',
      forearm: '#c8202a',
      hands: '#f2f2ee',
      pelvis: '#2a4fb0',
      thigh: '#2a4fb0',
      shin: '#2a4fb0',
      boots: '#1b1b1d',
      pads: '#24439a',
      braces: '#2a4fb0',
      kit: 'dungarees',
    },
  },
  // English: tall as Maximilian, all in black. The helmet, the armour at the shoulders, the chest
  // box, the belt, the long cape.
  darklord: {
    id: 'darklord',
    flag: 'gb',
    scale: 1.09,
    build: 1.12,
    arms: 1.02,
    limbs: 1.05,
    skin: '#d9b39a',
    hair: { style: 'slick', color: '#111111' },
    headwear: 'mask',
    helmet: null,
    outfit: {
      torso: '#141416',
      upperArm: '#121214',
      forearm: '#121214',
      hands: '#0d0d0e',
      pelvis: '#121214',
      thigh: '#141416',
      shin: '#141416',
      boots: '#0c0c0d',
      pads: '#18181a',
      kit: 'armour',
    },
  },
};
