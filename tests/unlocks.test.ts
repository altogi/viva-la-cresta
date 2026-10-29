import { describe, expect, it } from 'vitest';
import { newCareer } from '../src/career/career';
import { UNLOCKS, unlockedRiders } from '../src/career/unlocks';

const win = (raceId: string, season = 1) => ({ raceId, season, position: 1, of: 30, total: 150, net: 140 });

describe('riders to unlock', () => {
  it('a new player has the three starters only', () => {
    expect([...unlockedRiders([])].sort()).toEqual(['adelaide', 'maximilian', 'remo']);
  });

  it('Kletus: three wins in one season, not spread over two', () => {
    const c = newCareer('k', 'K', 'remo');
    c.results = [win('bledisloe', 1), win('heaton', 1), win('stagni', 2)];
    expect(UNLOCKS.kletus!.test(c)).toBe(false);
    c.results.push(win('knapp', 1));
    expect(UNLOCKS.kletus!.test(c)).toBe(true);
  });

  it("Mario: winning the Coppa d'Italia", () => {
    const c = newCareer('m', 'M', 'adelaide');
    c.results = [{ ...win('coppa-italia'), position: 2 }];
    expect(UNLOCKS.mario!.test(c)).toBe(false);
    c.results.push(win('coppa-italia', 2));
    expect(UNLOCKS.mario!.test(c)).toBe(true);
    expect(unlockedRiders([c]).has('mario')).toBe(true);
  });

  it('the Dark Lord: the Curzon, the Morgan, the Brabazon and the Grand National, in any seasons', () => {
    const c = newCareer('d', 'D', 'maximilian');
    c.results = [win('curzon', 1), win('morgan', 2), win('brabazon', 2)];
    expect(UNLOCKS.darklord!.test(c)).toBe(false);
    c.results.push(win('grand-national', 3));
    expect(UNLOCKS.darklord!.test(c)).toBe(true);
  });
});
