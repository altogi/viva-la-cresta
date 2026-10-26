// How each rider looks: build, suit, helmet and the details that show past the helmet.

import type { RiderId } from '../sim/rider';

export interface RiderLook {
  id: RiderId;
  /** Overall size (1 = about 1.75 m). */
  scale: number;
  /** Chest and shoulder breadth. */
  build: number;
  /** Arm length multiplier. */
  arms: number;
  /** Limb thickness multiplier. */
  limbs: number;
  suit: { torso: string; leftArm: string; rightArm: string; leftLeg: string; rightLeg: string; accent: string };
  helmet: { shell: string; stripes: string[] };
  ponytail?: string;
  beard?: string;
}

export const LOOKS: Record<RiderId, RiderLook> = {
  // German, 20, thin and lanky with long arms and legs. A split black-and-yellow suit.
  maximilian: {
    id: 'maximilian',
    scale: 1.08,
    build: 0.88,
    arms: 1.1,
    limbs: 0.85,
    suit: { torso: '#1e1f22', leftArm: '#1e1f22', rightArm: '#f2c318', leftLeg: '#1e1f22', rightLeg: '#f2c318', accent: '#d42a20' },
    helmet: { shell: '#141414', stripes: ['#d42a20', '#f2c318'] },
  },
  // English, 25, medium build, blonde. Royal blue with white and red.
  adelaide: {
    id: 'adelaide',
    scale: 0.97,
    build: 0.95,
    arms: 1,
    limbs: 0.95,
    suit: { torso: '#1f4fb4', leftArm: '#1f4fb4', rightArm: '#1f4fb4', leftLeg: '#1f4fb4', rightLeg: '#1f4fb4', accent: '#f4f4f4' },
    helmet: { shell: '#f4f4f4', stripes: ['#c8102e', '#1f4fb4'] },
    ponytail: '#e8c873',
  },
  // Swiss, 50, burly, bearded. Red with a white cross on the helmet.
  remo: {
    id: 'remo',
    scale: 1.02,
    build: 1.3,
    arms: 0.97,
    limbs: 1.3,
    suit: { torso: '#c8161d', leftArm: '#c8161d', rightArm: '#c8161d', leftLeg: '#c8161d', rightLeg: '#c8161d', accent: '#ffffff' },
    helmet: { shell: '#c8161d', stripes: ['#ffffff'] },
    beard: '#7a6a5a',
  },
};
