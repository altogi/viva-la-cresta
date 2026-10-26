import { describe, expect, it } from 'vitest';
import { CROSS_POINTS, Track } from '../src/sim/track';
import { BENDS, JUNCTION_S, PROFILE, RUN_OUT_END, TRACK_LENGTH } from '../src/track/cresta';
import { dot, length } from '../src/sim/vec';

const track = new Track();

describe('track profile', () => {
  it('matches the map drops', () => {
    expect(track.elevation(0) - track.elevation(TRACK_LENGTH)).toBeCloseTo(157, 0);
    expect(track.elevation(0) - track.elevation(JUNCTION_S)).toBeCloseTo(55, 0);
    expect(track.elevation(JUNCTION_S) - track.elevation(681.4)).toBeCloseTo(41.2, 0);
  });

  it('passes through every digitised profile point', () => {
    for (const p of PROFILE) expect(track.elevation(p.s)).toBeCloseTo(p.z, 5);
  });

  it('always runs downhill to the finish, then climbs the run-out', () => {
    expect(track.elevation(RUN_OUT_END)).toBeGreaterThan(track.elevation(TRACK_LENGTH) + 8);
    for (let s = 0; s <= TRACK_LENGTH; s += 0.5) expect(track.grade(s)).toBeLessThanOrEqual(1e-9);
  });

  it('has a near free fall at Church Leap and a mild Junction Straight', () => {
    expect(track.grade(140)).toBeLessThan(-0.3);
    expect(track.grade(360)).toBeGreaterThan(-0.15);
  });
});

describe('track centreline', () => {
  it('spans the run and its run-out in 0.5 m stations', () => {
    expect(track.stations[0].s).toBe(0);
    expect(track.stations.at(-1)!.s).toBeCloseTo(RUN_OUT_END, 6);
  });

  it('has orthonormal frames', () => {
    for (const st of track.stations) {
      expect(length(st.forward)).toBeCloseTo(1, 6);
      expect(length(st.up)).toBeCloseTo(1, 6);
      expect(dot(st.forward, st.left)).toBeCloseTo(0, 6);
      expect(dot(st.forward, st.up)).toBeCloseTo(0, 6);
      expect(st.up[2]).toBeGreaterThan(0.8);
    }
  });

  it('turns each bend by its full angle in the right direction', () => {
    for (const b of BENDS) {
      const dh = (track.heading(b.s1) - track.heading(b.s0)) * (180 / Math.PI);
      expect(dh).toBeCloseTo(b.turn, 6);
      const mid = (b.s0 + b.s1) / 2;
      expect(Math.sign(track.curvature(mid))).toBe(Math.sign(b.turn));
    }
  });

  it('gives Shuttlecock a tight but rideable radius', () => {
    const k = Math.max(...track.stations.filter((st) => st.s > 575 && st.s < 630).map((st) => Math.abs(st.curvature)));
    expect(1 / k).toBeGreaterThan(12);
    expect(1 / k).toBeLessThan(30);
  });
});

describe('cross-sections', () => {
  it('have a fixed number of points with u increasing to the left', () => {
    for (const s of [0, 180, 340, 600, 670, 900, TRACK_LENGTH]) {
      const pts = track.crossSection(s);
      expect(pts).toHaveLength(CROSS_POINTS);
      for (let i = 1; i < pts.length; i++) expect(pts[i].u).toBeGreaterThanOrEqual(pts[i - 1].u);
      expect(pts.some((p) => p.u === 0 && p.y === 0)).toBe(true);
    }
  });

  it('puts the tall wall on the outside of each bend', () => {
    const shuttlecock = track.section(602);
    expect(shuttlecock.outerSide).toBe('right'); // a left-hand bend
    expect(shuttlecock.right.height).toBeGreaterThan(shuttlecock.left.height);
    expect(shuttlecock.runoffRight).toBe('straw');
    const stream = track.section(669);
    expect(stream.outerSide).toBe('left');
    expect(stream.left.height).toBeGreaterThan(4);
  });

  it('makes Shuttlecock a low lip that can be flown over', () => {
    const pts = track.crossSection(602);
    // Right side runs lip end, vertical points (zero-length here), then the arc from its top down.
    const arcTop = pts[3];
    const below = pts[4];
    const angle = Math.atan2(arcTop.z - below.z, Math.abs(arcTop.y - below.y));
    expect(arcTop.z).toBeLessThan(2.5);
    expect(angle).toBeLessThan((60 * Math.PI) / 180);
  });
});
