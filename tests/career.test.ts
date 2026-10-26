import { describe, expect, it } from 'vitest';
import { goal, handicap, newCareer, nextDay, nextPractice, recordPractice, startConversion, SEASON_DAYS, type Career } from '../src/career/career';
import { RACES, cannotEnter, npcField, raceOn, standings } from '../src/career/races';

const ride = (c: Career, time: number | null, rand = () => 0.99) => recordPractice(c, nextPractice(c), time, time === null ? 'Shuttlecock' : null, 60, rand);

describe('career progression', () => {
  it('starts with a lying first ride at Junction on a traditional', () => {
    const c = newCareer('x', 'Game 1', 'adelaide');
    expect(nextPractice(c)).toMatchObject({ start: 'junction', toboggan: 'traditional', style: 'lying', first: true });
  });

  it('practises lying starts, then converts to a running start step by step', () => {
    const c = newCareer('x', 'Game 1', 'adelaide');
    const styles: string[] = [];
    for (let i = 0; i < 6; i++) {
      const s = nextPractice(c);
      styles.push(s.style === 'lying' ? 'L' : `R${s.steps}`);
      ride(c, 80);
    }
    expect(styles).toEqual(['L', 'L', 'L', 'R2', 'R4', 'R7']);
  });

  it('makes the rider a member at random after practice, and always after five practice rides', () => {
    const lucky = newCareer('x', 'G', 'remo');
    for (let i = 0; i < 4; i++) ride(lucky, 70, () => 0);
    expect(lucky.member).toBe(true);
    const unlucky = newCareer('y', 'G', 'remo');
    for (let i = 0; i < 5; i++) ride(unlucky, 70);
    expect(unlucky.member).toBe(false);
    expect(ride(unlucky, 70).joined).toBe(true);
  });

  it('offers flat-top or Top after three of five Junction rides under 48 s', () => {
    const c = newCareer('x', 'G', 'maximilian');
    c.member = true;
    ride(c, 49);
    ride(c, 47.8);
    ride(c, 50);
    ride(c, 47.5);
    expect(c.choicePending).toBe(false);
    expect(ride(c, 47.9).choice).toBe(true);
    expect(goal(c)).toMatch(/Choose/);
  });

  it('converts to the flat-top with three lying starts then a running conversion', () => {
    const c = newCareer('x', 'G', 'maximilian');
    c.member = true;
    startConversion(c, 'flattop');
    const seen: string[] = [];
    while (c.conversion) {
      const s = nextPractice(c);
      seen.push(`${s.toboggan[0]}${s.style === 'lying' ? 'L' : s.steps}`);
      ride(c, 47);
    }
    expect(seen).toEqual(['fL', 'fL', 'fL', 'f2', 'f4', 'f7']);
    expect(c.flattop).toBe('yes');
  });

  it('opens Top after three of five flat-top Junction rides under 47 s', () => {
    const c = newCareer('x', 'G', 'maximilian');
    c.member = true;
    c.flattop = 'yes';
    c.toboggan = 'flattop';
    for (const t of [46.5, 48, 46.8, 46.9]) ride(c, t);
    expect(c.top).toBe('converting');
    expect(nextPractice(c)).toMatchObject({ start: 'top', style: 'lying' });
  });

  it('rolls into a new season after the last day', () => {
    const c = newCareer('x', 'G', 'adelaide');
    for (let i = 0; i < SEASON_DAYS; i++) nextDay(c);
    expect(c.season).toBe(2);
    expect(c.day).toBe(0);
  });

  it('gives slower riders a bigger handicap, from scratch to 13 s', () => {
    const fast = newCareer('a', 'G', 'adelaide');
    const slow = newCareer('b', 'G', 'adelaide');
    fast.member = slow.member = true;
    for (let i = 0; i < 6; i++) {
      ride(fast, 44.4);
      ride(slow, 55);
    }
    expect(handicap(fast, 'junction')).toBeLessThan(1);
    expect(handicap(slow, 'junction')).toBeGreaterThan(7);
    expect(handicap(slow, 'junction')).toBeLessThanOrEqual(13);
  });
});

describe('races', () => {
  it('runs the majors in order through the season, ending with the Grand National', () => {
    const majors = RACES.filter((r) => r.kind === 'major').map((r) => r.id);
    expect(majors).toEqual(['curzon', 'brabazon', 'morgan', 'grand-national']);
    expect(RACES.at(-1)!.id).toBe('grand-national');
    expect(raceOn(RACES[1].day + 1)?.raceDay).toBe(1);
  });

  it('keeps SL riders out, and Top races for riders qualified for Top', () => {
    const c = newCareer('x', 'G', 'adelaide');
    expect(cannotEnter(c, RACES[0])).toMatch(/Supplementary/);
    c.member = true;
    expect(cannotEnter(c, RACES[0])).toBeNull();
    expect(cannotEnter(c, RACES.find((r) => r.id === 'grand-national')!)).toMatch(/Top/);
  });

  it('builds a believable field: a scratch winner near the fast end, a few fallers in handicaps', () => {
    const race = RACES.find((r) => r.id === 'badrutt')!;
    const field = npcField(race, 7);
    expect(field).toHaveLength(race.field);
    const rows = standings(race, field, 1);
    const fell = rows.filter((r) => r.rank === null).length;
    expect(fell).toBeGreaterThanOrEqual(0);
    expect(fell).toBeLessThan(race.field / 3);
    const gn = RACES.find((r) => r.id === 'grand-national')!;
    const best = standings(gn, npcField(gn, 3), 2)[0];
    expect(best.total! / 6).toBeGreaterThan(gn.fast - 1);
    expect(best.total! / 6).toBeLessThan(gn.fast + 1.5);
  });

  it('nets handicap races at three handicaps per day', () => {
    const race = RACES.find((r) => r.id === 'celerina-bowl')!;
    const field = npcField(race, 11);
    const row = standings(race, field, 1).find((r) => r.net !== null)!;
    expect(row.net).toBeCloseTo(row.total! - 3 * row.entrant.handicap, 2);
  });

  it('is the same field every time for the same entry', () => {
    const race = RACES[1];
    expect(npcField(race, 5)[0].name).toBe(npcField(race, 5)[0].name);
  });
});
