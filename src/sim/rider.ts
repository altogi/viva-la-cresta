// Rider and toboggan characteristics that feed the physics.

export interface RiderStats {
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

export const ADELAIDE: RiderStats = {
  name: 'Adelaide',
  mass: 78,
  dragArea: 0.12,
  transitionTime: 0.55,
  reach: 1,
  runSpeed: 8.6,
};

export const TRADITIONAL: TobogganStats = {
  name: 'Traditional',
  muForward: 0.005,
  muKnives: 0.045,
  dragForward: 1,
  steerGain: 1,
};

/** Tunable physics constants (exposed in the debug tuning panel). */
export const PHYSICS = {
  gravity: 9.81,
  airDensity: 1.05, // ~1800 m above sea level
  /** Drag multiplier when sitting back on the knives (less streamlined). */
  dragKnives: 1.35,
  /** Peak rake deceleration per foot on the knives, at 1 g normal load (m/s²). */
  rakeKnives: 1.6,
  /** Rake deceleration per foot when lying forward (feet can't dig in as hard). */
  rakeForward: 0.6,
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
  /** Share of speed lost glancing off a wall, at a 90° impact. */
  glanceLoss: 0.6,
  /** Speed added diving onto the toboggan after a running start (m/s). */
  diveBoost: 0.8,
  /** Friction when sliding on the near-vertical part of a wall. */
  wallFriction: 0.25,
};
