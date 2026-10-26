import { describe, expect, it } from 'vitest';
import { Track } from '../src/sim/track';
import { ADELAIDE, TRADITIONAL } from '../src/sim/rider';
import { POLICIES, runBot } from '../src/sim/autopilot';

const track = new Track();
const ride = (name: string) => {
  const r = runBot(track, ADELAIDE, TRADITIONAL, POLICIES[name]);
  const splits = Object.entries(r.splits).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
  console.info(`${name}: ${r.time?.toFixed(2) ?? '—'} s ${r.fall ?? ''} | top ${r.topSpeedMph.toFixed(1)} mph, finish ${r.finishSpeedMph.toFixed(1)} mph | ${splits}`);
  return r;
};

describe('bot calibration (Junction, traditional, Adelaide)', () => {
  it('beginner on a lying start takes about 80 s', () => {
    const r = ride('beginner');
    expect(r.fall).toBeNull();
    expect(r.time!).toBeGreaterThan(70);
    expect(r.time!).toBeLessThan(90);
  });

  it('a cautious running start rides in the low 50s', () => {
    const r = ride('novice');
    expect(r.fall).toBeNull();
    expect(r.time!).toBeGreaterThan(50);
    expect(r.time!).toBeLessThan(54);
  });

  it('a solid traditional rider rides about 49 s, finishing at 58-67 mph (as in the season results)', () => {
    const r = ride('good');
    expect(r.fall).toBeNull();
    expect(r.time!).toBeGreaterThan(47.5);
    expect(r.time!).toBeLessThan(50.5);
    expect(r.finishSpeedMph).toBeGreaterThan(58);
    expect(r.finishSpeedMph).toBeLessThan(67);
  });

  it('an expert can go faster still, without falling', () => {
    const r = ride('expert');
    expect(r.fall).toBeNull();
    expect(r.time!).toBeLessThan(ride('good').time!);
  });

  it('never steering ends in a wall or over a lip', () => {
    const r = ride('passenger');
    expect(r.fall).not.toBeNull();
  });

  it('no brakes at all ends in Shuttlecock', () => {
    const r = ride('reckless');
    expect(r.fall).toMatch(/Shuttlecock|Stream|Battledore/);
  });
});
