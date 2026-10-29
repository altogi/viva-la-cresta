// Rider and toboggan characteristics that feed the physics.

export type RiderId = 'maximilian' | 'adelaide' | 'remo';
export type TobogganId = 'traditional' | 'flattop';

export interface RiderStats {
  id: RiderId;
  name: string;
  /** Rider + kit mass (kg). */
  mass: number;
  /** Frontal drag area lying forward (m²·Cd). */
  dragArea: number;
  /** Seconds to slide between forward and on the knives. */
  transitionTime: number;
  /** Arm-steering strength multiplier (reach and leverage). */
  reach: number;
  /** Top running-start speed (m/s). */
  runSpeed: number;
}

export interface TobogganStats {
  id: TobogganId;
  name: string;
  /** Runner friction with the smooth front of the runners on the ice. */
  muForward: number;
  /** Runner friction with the knives cutting in. */
  muKnives: number;
  /** Drag multiplier lying forward (flat-tops let the shoulders go down). */
  dragForward: number;
  /** Steering sensitivity multiplier (flex). */
  steerGain: number;
}

/** Rake force is set for this mass; heavier riders get less deceleration from the same rakes. */
export const REFERENCE_MASS = 78;

/** Light and lanky: long arms steer hard, long legs run fast, but little weight to carry speed. */
export const MAXIMILIAN: RiderStats = {
  id: 'maximilian',
  name: 'Maximilian',
  mass: 70,
  dragArea: 0.115,
  transitionTime: 0.45,
  // Long arms, but not so much more steering than the others that the banks can't hold him.
  reach: 1.1,
  runSpeed: 9.4,
};

/** The all-rounder. */
export const ADELAIDE: RiderStats = {
  id: 'adelaide',
  name: 'Adelaide',
  mass: 78,
  dragArea: 0.12,
  transitionTime: 0.55,
  reach: 1,
  runSpeed: 8.6,
};

/** Burly: a rocket on the straights, but slow to shift, slow off the start and hard to stop. */
export const REMO: RiderStats = {
  id: 'remo',
  name: 'Remo',
  mass: 104,
  dragArea: 0.145,
  transitionTime: 0.8,
  reach: 0.9,
  runSpeed: 7.6,
};

export const RIDERS: Record<RiderId, RiderStats> = { maximilian: MAXIMILIAN, adelaide: ADELAIDE, remo: REMO };

/** Steel frame, sliding cushion: forgiving. Every rider starts on one. */
export const TRADITIONAL: TobogganStats = {
  id: 'traditional',
  name: 'Traditional',
  muForward: 0.005,
  muKnives: 0.045,
  dragForward: 1,
  steerGain: 1,
};

/** Carbon, flexible, shoulders down when forward: faster, and very sensitive to every movement. */
export const FLATTOP: TobogganStats = {
  id: 'flattop',
  name: 'Flat-top',
  muForward: 0.0035,
  muKnives: 0.042,
  dragForward: 0.74,
  steerGain: 1.3,
};

export const TOBOGGANS: Record<TobogganId, TobogganStats> = { traditional: TRADITIONAL, flattop: FLATTOP };

/** Tunable physics constants (exposed in the debug tuning panel). */
export const PHYSICS = {
  gravity: 9.81,
  airDensity: 1.05, // ~1800 m above sea level
  /** Drag multiplier when sitting back on the knives (less streamlined). */
  dragKnives: 1.35,
  /** Peak rake deceleration per foot on the knives, at 1 g normal load (m/s²). */
  rakeKnives: 1.12,
  /** Rake deceleration per foot when lying forward (feet can't dig in as hard). */
  rakeForward: 0.42,
  /** Arm steering on the knives (m/s² lateral at full input). */
  steerKnives: 6.5,
  /** Head-turn steering lying forward, per (m/s)² of speed. */
  steerForward: 0.009,
  /** Extra lateral pull from a single raking foot, per m/s of speed. */
  rakeSteer: 0.09,
  /** Sideways grip of the runners, as a share of the load on the ice. */
  gripForward: 0.45,
  gripKnives: 0.8,
  /** How quickly a sideways skid dies away (1/s). */
  skidDamping: 3,
  /** Walls steeper than this (rad) are bankinas: you glance off them or fall. */
  wallAngle: 1.2,
  /** Hitting a bankina at more than this angle to the run (rad) ends the ride… */
  impactAngle: 0.21,
  /** …provided the sideways speed is at least this (m/s). */
  impactSpeed: 2.2,
  /** Half the toboggan's width: how close its centre gets to a square-cornered wall (m). */
  tobogganHalfWidth: 0.28,
  /** Share of speed lost glancing off a wall, at a 90° impact… */
  glanceLoss: 0.6,
  /** …on top of this share lost on every hit, however shallow: a bankina always costs time… */
  bankHitLoss: 0.035,
  /** …once the toboggan comes into it at least this fast across the run (m/s), not just brushing it. */
  bankHitSpeed: 0.3,
  /** Speed added diving onto the toboggan after a running start (m/s). */
  diveBoost: 0.8,
  /** Friction when sliding on the near-vertical part of a wall. */
  wallFriction: 0.25,
};
