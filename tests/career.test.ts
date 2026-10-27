import { describe, expect, it } from 'vitest';
import { dateOf, goal, handicap, newCareer, nextDay, nextPractice, recordPractice, startConversion, SEASON_DAYS, TOP_OPENS, type Career } from '../src/career/career';
import { RACES, cannotEnter, npcField, raceOn, standings } from '../src/career/races';

const ride = (c: Career, time: number | null) => recordPractice(c, nextPractice(c), time, time === null ? 'Shuttlecock' : null, 60);

describe('career progression', () => {
  it('starts with a lying first ride at Junction on a traditional', () => {
    const c = newCareer('x', 'Game 1', 'adelaide');
    expect(nextPractice(c)).toMatchObject({ start: 'junction', toboggan: 'traditional', style: 'lying', first: true });
  });

  it('rides one lying start, then a short 1-2-flop running start, then the full running start', () => {
    const c = newCareer('x', 'Game 1', 'adelaide');
    const styles: string[] = [];
    for (let i = 0; i < 7; i++) {
      const s = nextPractice(c);
      styles.push(s.style === 'lying' ? 'L' : `R${s.steps}`);
      ride(c, 80);
    }
    expect(styles).toEqual(['L', 'R2', 'R7', 'R7', 'R7', 'R7', 'R7']);
  });

  it('never moves a rider on after a fall: the first ride and lying starts repeat', () => {
    const c = newCareer('x', 'Game 1', 'adelaide');
    ride(c, null);
    expect(nextPractice(c).first).toBe(true);
    ride(c, 80);
    ride(c, null);
    expect(nextPractice(c)).toMatchObject({ style: 'running', steps: 2 });
    ride(c, 80);
    expect(nextPractice(c)).toMatchObject({ style: 'running', steps: 7 });
  });

  it('makes the rider a member after five finishes under 50 s, not before', () => {
    const c = newCareer('x', 'G', 'remo');
    for (let i = 0; i < 6; i++) ride(c, 70);
    expect(c.member).toBe(false);
    for (let i = 0; i < 4; i++) ride(c, 49.5);
    ride(c, 51);
    expect(c.member).toBe(false);
    expect(ride(c, 49.9).joined).toBe(true);
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

  it('offers flat-top or Top to a beginner already fast enough in the first three rides', () => {
    const c = newCareer('x', 'G', 'maximilian');
    ride(c, 47.9);
    ride(c, 47.5);
    const out = ride(c, 47.7);
    expect(out.choice).toBe(true);
    expect(out.joined).toBe(true);
    expect(c.member).toBe(true);
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
    expect(seen).toEqual(['fL', 'fL', 'fL', 'f2', 'f7']);
    expect(c.flattop).toBe('yes');
  });

  it('opens Top after three of five flat-top Junction rides under 47 s', () => {
    const c = newCareer('x', 'G', 'maximilian');
    c.member = true;
    c.flattop = 'yes';
    c.toboggan = 'flattop';
    for (const t of [46.5, 48, 46.8, 46.9]) ride(c, t);
    expect(c.top).toBe('converting');
    // Top isn't open until 11 January: Junction till then, and those rides don't count towards Top.
    expect(nextPractice(c)).toMatchObject({ start: 'junction' });
    ride(c, 46);
    expect(c.conversion?.lying).toBe(1);
    c.day = TOP_OPENS;
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
  it('runs the season from 17 December to 28 February, the majors on their dates, Top races only once Top is open', () => {
    const majors = RACES.filter((r) => r.kind === 'major').map((r) => [r.id, dateOf(r.day).short]);
    expect(majors).toEqual([['curzon', '9 Jan'], ['morgan', '31 Jan'], ['brabazon', '6 Feb'], ['grand-national', '13 Feb']]);
    expect(dateOf(0).label).toBe('Thursday 17th December');
    expect(dateOf(SEASON_DAYS - 1).short).toBe('28 Feb');
    expect(dateOf(TOP_OPENS).short).toBe('11 Jan');
    const curzon = RACES.find((r) => r.id === 'curzon')!;
    expect(raceOn(curzon.day + 1)?.raceDay).toBe(1);
    for (const r of RACES.filter((r) => r.start === 'top')) expect(r.day).toBeGreaterThanOrEqual(TOP_OPENS);
    // One race a day.
    const days = RACES.flatMap((r) => Array.from({ length: r.days }, (_, k) => r.day + k));
    expect(new Set(days).size).toBe(days.length);
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
    const best = standings(gn, npcField(gn, 3), gn.days)[0];
    expect(best.total! / (3 * gn.days)).toBeGreaterThan(gn.fast - 1);
    expect(best.total! / (3 * gn.days)).toBeLessThan(gn.fast + 1.5);
  });

  it('nets handicap races at three handicaps per day', () => {
    const race = RACES.find((r) => r.id === 'bledisloe')!;
    const field = npcField(race, 11);
    const row = standings(race, field, 1).find((r) => r.net !== null)!;
    expect(row.net).toBeCloseTo(row.total! - 3 * row.entrant.handicap, 2);
  });

  it('is the same field every time for the same entry', () => {
    const race = RACES[1];
    expect(npcField(race, 5)[0].name).toBe(npcField(race, 5)[0].name);
  });
});
