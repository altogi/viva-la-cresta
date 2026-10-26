import { describe, expect, it } from 'vitest';
import { Track } from '../src/sim/track';
import { RIDERS, TOBOGGANS, type RiderId } from '../src/sim/rider';
import { POLICIES, runBot } from '../src/sim/autopilot';

const track = new Track();
const riders = Object.keys(RIDERS) as RiderId[];
const ride = (policy: string, rider: RiderId = 'adelaide', toboggan: 'traditional' | 'flattop' = 'traditional') => {
  const r = runBot(track, RIDERS[rider], TOBOGGANS[toboggan], POLICIES[policy]);
  console.info(`${policy} ${rider}/${toboggan}: ${r.time?.toFixed(2) ?? r.fall} | finish ${r.finishSpeedMph.toFixed(0)} mph`);
  return r;
};

describe('riding from Top', () => {
  it('a lying start from Top takes about 80 s', () => {
    for (const r of riders) {
      const res = ride('topLying', r);
      expect(res.fall).toBeNull();
      expect(res.time!).toBeGreaterThan(74);
      expect(res.time!).toBeLessThan(88);
    }
  });

  it('a good traditional rider rides Top in the mid 60s, every rider', () => {
    for (const r of riders) {
      const res = ride('topGood', r);
      expect(res.fall).toBeNull();
      expect(res.time!).toBeGreaterThan(62);
      expect(res.time!).toBeLessThan(67.5);
    }
  });

  it('a very good flat-top rider is several seconds quicker from Top', () => {
    for (const r of riders) {
      const res = ride('topGoodFlattop', r, 'flattop');
      expect(res.fall).toBeNull();
      expect(res.time!).toBeLessThan(ride('topGood', r).time! - 4);
    }
  });

  it('Top is roughly 11-17 s slower than Junction on the same toboggan', () => {
    const top = ride('topGood').time!;
    const junction = ride('good').time!;
    expect(top - junction).toBeGreaterThan(11);
    expect(top - junction).toBeLessThan(18);
  });

  it('not braking down Junction Straight is too fast for what follows', () => {
    expect(ride('topNoJunctionBrake').fall).not.toBeNull();
  });

  it('no brakes at all from Top ends before Junction', () => {
    expect(ride('topReckless').fall).toMatch(/Curzon|Brabazon|Thoma|Church/);
  });
});
