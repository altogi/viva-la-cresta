import { describe, expect, it } from 'vitest';
import { adjust, MOODS, reverse, rollMoods } from '../src/game/conditions';
import { ADELAIDE, TRADITIONAL } from '../src/sim/rider';

describe("the rider's luck", () => {
  it('six of them, each one ride in twenty', () => {
    expect(Object.keys(MOODS)).toHaveLength(6);
    expect(rollMoods(() => 0.04)).toEqual(Object.keys(MOODS));
    expect(rollMoods(() => 0.06)).toEqual([]);
  });

  it("Arbeiter's Curse swaps left and right, steering and rakes", () => {
    expect(adjust(ADELAIDE, TRADITIONAL, null, ['curse']).reversed).toBe(true);
    expect(adjust(ADELAIDE, TRADITIONAL, null, []).reversed).toBe(false);
    expect(reverse({ knives: true, steer: 0.7, rakeLeft: 1, rakeRight: 0, runTaps: 2 })).toEqual({ knives: true, steer: -0.7, rakeLeft: 0, rakeRight: 1, runTaps: 2 });
  });

  it('Tower Boy Disease turns the bankinas into a boost', () => {
    expect(adjust(ADELAIDE, TRADITIONAL, null, ['cough']).bankBoost).toBe(true);
  });

  it('a Bacon Roll makes the rider 30% heavier', () => {
    expect(adjust(ADELAIDE, TRADITIONAL, null, ['bacon']).rider.mass).toBeCloseTo(ADELAIDE.mass * 1.3);
    expect(adjust(ADELAIDE, TRADITIONAL, null, []).rider.mass).toBe(ADELAIDE.mass);
  });
});
