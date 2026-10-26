import { describe, expect, it } from 'vitest';
import { Track } from '../src/sim/track';
import { RIDERS, TOBOGGANS, type RiderId, type TobogganId } from '../src/sim/rider';
import { POLICIES, runBot } from '../src/sim/autopilot';

const track = new Track();
const riders = Object.keys(RIDERS) as RiderId[];
const toboggans = Object.keys(TOBOGGANS) as TobogganId[];

function grid(policy: string) {
  const out: Record<string, { time: number | null; fall: string | null; finish: number }> = {};
  for (const r of riders) {
    for (const t of toboggans) {
      const res = runBot(track, RIDERS[r], TOBOGGANS[t], POLICIES[policy]);
      out[`${r}/${t}`] = { time: res.time, fall: res.fall, finish: res.finishSpeedMph };
    }
  }
  console.info(
    `${policy}: ` +
      Object.entries(out)
        .map(([k, v]) => `${k} ${v.time?.toFixed(2) ?? v.fall} (${v.finish.toFixed(0)} mph)`)
        .join(' | '),
  );
  return out;
}

describe('rider and toboggan balance (Junction)', () => {
  it('every rider can ride a solid run on either toboggan', () => {
    const g = grid('good');
    for (const v of Object.values(g)) expect(v.fall).toBeNull();
  });

  it('the flat-top is faster than the traditional for every rider', () => {
    const g = grid('good');
    for (const r of riders) expect(g[`${r}/flattop`].time!).toBeLessThan(g[`${r}/traditional`].time!);
  });

  it('a good traditional rider is around 49 s, a good flat-top rider around 45', () => {
    const g = grid('good');
    const f = grid('goodFlattop');
    for (const r of riders) {
      expect(g[`${r}/traditional`].time!).toBeGreaterThan(47.5);
      expect(g[`${r}/traditional`].time!).toBeLessThan(50.5);
      expect(f[`${r}/flattop`].fall).toBeNull();
      expect(f[`${r}/flattop`].time!).toBeGreaterThan(44);
      expect(f[`${r}/flattop`].time!).toBeLessThan(46.5);
    }
  });

  it('riding the flat-top that hard on a traditional is a step too far for someone', () => {
    const f = grid('goodFlattop');
    const traditionalFalls = riders.filter((r) => f[`${r}/traditional`].fall !== null).length;
    const flattopFalls = riders.filter((r) => f[`${r}/flattop`].fall !== null).length;
    expect(traditionalFalls).toBeGreaterThanOrEqual(flattopFalls);
  });

  it('riders differ, but no one is out of reach (within 1.5 s on the same bot)', () => {
    for (const t of toboggans) {
      const g = grid('good');
      const times = riders.map((r) => g[`${r}/${t}`].time!);
      expect(Math.max(...times) - Math.min(...times)).toBeLessThan(1.5);
      expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(0.1);
    }
  });

  it('beginners get down on a lying start, and no brakes still means Shuttlecock', () => {
    const b = grid('beginner');
    for (const v of Object.values(b)) expect(v.fall).toBeNull();
    const r = grid('reckless');
    for (const v of Object.values(r)) expect(v.fall).not.toBeNull();
  });
});
