// The Cresta Run, digitised from the 1906 "Plan and Profile" (C. Graff).
// Single source of truth for both the physics surface and the rendered mesh.
//
// Conventions: `s` is horizontal distance along the run in metres from Top start.
// Elevation `z` in metres above the finish. Turn angles in degrees, positive = left.
// Headings and turn angles are fitted to the OpenStreetMap centreline (see osm.ts), so the run
// sits on its real alignment (x = east, y = north from Top start). The elevation profile comes
// from the 1906 map. Bank geometry (radius, wall height) is estimated from photographs.

export interface ProfilePoint {
  s: number;
  z: number;
}

export interface WallShape {
  /** Radius of the curved transition from floor to wall (m). */
  radius: number;
  /** Height of the wall top (the lip) above the floor (m). */
  height: number;
}

export interface Bend {
  name: string;
  s0: number;
  s1: number;
  /** Heading change across the bend, degrees. Positive = left. */
  turn: number;
  /** Outer wall, the one the rider climbs. */
  outer: WallShape;
  /** Inner wall. */
  inner: WallShape;
  /** Floor width override through the bend (m). */
  floorWidth?: number;
  /** What lies beyond the outer lip. */
  runoff?: 'snow' | 'straw';
}

export interface Landmark {
  name: string;
  s: number;
  kind: 'start' | 'timing' | 'finish' | 'bridge' | 'section';
}

/** The finish contacts. */
export const TRACK_LENGTH = 1212.25;
/** End of the uphill run-out at Celerina, where a foam cushion stops the rider. */
export const RUN_OUT_END = 1403;
export const JUNCTION_S = 315;
/** Heading at Top start, degrees from east (counter-clockwise): the run leaves Top towards the NNE. */
export const START_HEADING = 27;

/** Elevation profile, read off the map's profile drawing. */
export const PROFILE: ProfilePoint[] = [
  { s: 0.0, z: 157.0 },
  { s: 36.7, z: 154.0 },
  { s: 73.6, z: 150.9 },
  { s: 101.2, z: 147.2 },
  { s: 128.8, z: 141.1 },
  { s: 154.2, z: 131.9 }, // bottom of Church Leap
  { s: 184.1, z: 127.1 },
  { s: 209.4, z: 119.7 },
  { s: 230.2, z: 114.8 },
  { s: 253.1, z: 109.9 },
  { s: 285.3, z: 108.7 }, // Thoma levels out
  { s: 310.6, z: 102.6 },
  { s: 322.1, z: 102.0 }, // Junction start
  { s: 365.2, z: 97.0 },
  { s: 408.4, z: 91.4 },
  { s: 444.4, z: 88.3 },
  { s: 481.9, z: 87.5 }, // Rise
  { s: 516.2, z: 81.8 },
  { s: 556.7, z: 76.2 },
  { s: 619.1, z: 68.9 },
  { s: 681.4, z: 60.8 }, // Stream corner
  { s: 740.0, z: 53.0 },
  { s: 805.1, z: 45.2 },
  { s: 860.5, z: 36.6 },
  { s: 922.4, z: 31.2 },
  { s: 994.0, z: 25.7 },
  { s: 1052.7, z: 21.0 },
  { s: 1085.2, z: 18.7 },
  { s: 1117.8, z: 14.0 },
  { s: 1156.9, z: 6.2 }, // Cresta Leap
  { s: 1212.25, z: 0.0 },
  // The run-out climbs after the finish to slow riders down.
  { s: 1245, z: 0.8 },
  { s: 1290, z: 4.2 },
  { s: 1340, z: 8.0 },
  { s: 1375, z: 10.0 },
  { s: RUN_OUT_END, z: 10.8 },
];

/** Straights: a square corner where floor meets wall, so a rider bumps the bankina instead of riding up it. */
export const STRAIGHT_WALL: WallShape = { radius: 0.05, height: 0.75 };
export const FLOOR_WIDTH = 1.3;
export const LIP_WIDTH = 0.6;

const low: WallShape = { radius: 0.4, height: 0.6 };

export const BENDS: Bend[] = [
  { name: 'Curzon', s0: 157, s1: 202, turn: 43, outer: { radius: 3.0, height: 3.6 }, inner: low },
  { name: 'Brabazon', s0: 209, s1: 250, turn: -28, outer: { radius: 2.5, height: 2.6 }, inner: low },
  { name: 'Thoma', s0: 253, s1: 305, turn: 47, outer: { radius: 3.2, height: 2.6 }, inner: low },
  { name: 'Rise', s0: 430, s1: 484, turn: -41, outer: { radius: 2.5, height: 1.6 }, inner: low },
  { name: 'Battledore', s0: 485, s1: 557, turn: -38, outer: { radius: 3.0, height: 2.0 }, inner: low },
  {
    name: 'Shuttlecock',
    s0: 562,
    s1: 632,
    turn: 89.5,
    outer: { radius: 6.0, height: 1.9 },
    inner: { radius: 0.5, height: 0.8 },
    floorWidth: 1.8,
    runoff: 'straw',
  },
  { name: 'Stream', s0: 641, s1: 689, turn: -41, outer: { radius: 4.6, height: 4.5 }, inner: low },
  { name: 'Bulpetts', s0: 862, s1: 905, turn: -14, outer: { radius: 2.0, height: 1.6 }, inner: low },
  { name: 'Scylla', s0: 988, s1: 1040, turn: 23.5, outer: { radius: 2.0, height: 1.7 }, inner: low },
  // Sharp and high: a rider has to take it up the bank, not slide through.
  { name: 'Charybdis', s0: 1071, s1: 1121, turn: -33, outer: { radius: 2.8, height: 2.7 }, inner: low },
  // Past the finish: a long left bend up the run-out, then a sharp left hook to the cushion.
  { name: 'Run-out', s0: 1273, s1: 1368, turn: 45, outer: { radius: 3.0, height: 1.8 }, inner: low },
  { name: 'Finish curve', s0: 1369, s1: 1402, turn: 133, outer: { radius: 3.0, height: 3.2 }, inner: low, floorWidth: 1.8 },
];

/** Gentle heading drift along the straights (no change to the walls). */
export const DRIFTS: { s0: number; s1: number; turn: number }[] = [
  { s0: 60, s1: 146, turn: -4 },
  { s0: 326, s1: 429, turn: -5 },
  { s0: 721, s1: 860, turn: -1 },
  { s0: 1240, s1: 1272, turn: -4 },
];

/** Distance over which cross-sections blend into a bend (m). */
export const BEND_BLEND = 10;
/** Walls taper off more slowly after a bend: riders are still coming down them. */
export const BEND_EXIT_BLEND = 22;

/** Named parts of the run, each starting at `s0` and lasting until the next. */
export const ZONES: { name: string; s0: number }[] = [
  { name: 'Top', s0: 0 },
  { name: 'Church Leap', s0: 110 },
  { name: 'Curzon', s0: 150 },
  { name: 'Brabazon', s0: 202 },
  { name: 'Thoma', s0: 250 },
  { name: 'Junction Straight', s0: 302 },
  { name: 'Rise', s0: 426 },
  { name: 'Battledore', s0: 485 },
  { name: 'Shuttlecock', s0: 560 },
  { name: 'Stream', s0: 638 },
  { name: 'Bledisloe Straight', s0: 692 },
  { name: 'Bulpetts', s0: 862 },
  { name: 'Scylla', s0: 990 },
  { name: 'Charybdis', s0: 1072 },
  { name: 'Cresta Leap', s0: 1120 },
  { name: 'Finish', s0: TRACK_LENGTH },
  { name: 'Celerina', s0: TRACK_LENGTH + 15 },
];

export const LANDMARKS: Landmark[] = [
  { name: 'Top', s: 0, kind: 'start' },
  { name: 'Stable Junction', s: 73.6, kind: 'bridge' },
  { name: 'Church Leap', s: 128, kind: 'section' },
  { name: 'Junction walkway', s: 319, kind: 'bridge' },
  { name: 'Junction', s: JUNCTION_S, kind: 'start' },
  { name: 'Junction Straight', s: 340, kind: 'section' },
  // Timing eye positions are inferred from split times, not surveyed.
  { name: 'Rise eye', s: 470, kind: 'timing' },
  { name: 'Stream eye', s: 690, kind: 'timing' },
  { name: 'Bledisloe Straight', s: 700, kind: 'section' },
  { name: 'Road Bridge', s: 857, kind: 'bridge' },
  { name: 'Bulpetts eye', s: 868, kind: 'timing' },
  { name: 'Cresta Leap', s: 1118, kind: 'section' },
  { name: 'Finish', s: TRACK_LENGTH, kind: 'finish' },
];
