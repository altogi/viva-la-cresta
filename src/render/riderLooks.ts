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
  cheeks?: string;
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
    /** Race number on the back. */
    bib?: string;
    /** A beer bottle tucked into the right sock. */
    bottle?: boolean;
  };
}

export const LOOKS: Record<RiderId, RiderLook> = {
  // German, 20: thin and lanky, slicked-back black hair, a wide grin. Dark green leathers with
  // white leg stripes, black pads, number 17 on the back, a dark green helmet.
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
      legStripe: '#e8e8e2',
      lettering: '#f2f2ee',
      bib: '17',
    },
  },
  // English, 25: blonde bun, rosy cheeks, a bright smile. Royal blue with white stripes and red
  // lettering, number 12 and the Union Jack on the back, a blue helmet with a gold visor.
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
      upperArm: '#2147ad',
      forearm: '#2147ad',
      hands: '#1c3170',
      pelvis: '#1d3f99',
      thigh: '#2147ad',
      shin: '#2147ad',
      boots: '#1b2b63',
      pads: '#1b2f6e',
      legStripe: '#f4f4f2',
      lettering: '#d9322e',
      bib: '12',
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
};
