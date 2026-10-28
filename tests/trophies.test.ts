import { describe, expect, it } from 'vitest';
import { newCareer, noteRide, recordPractice } from '../src/career/career';
import { riderRecord, showcaseWins, TROPHIES, trophyFor, wins } from '../src/career/trophies';
import { RACES } from '../src/career/races';

const practice = { start: 'junction' as const, toboggan: 'traditional' as const, style: 'running' as const, steps: 7 };

describe('the trophy room', () => {
  it('counts rides from each start and joins the club of each bank fallen at, once', () => {
    const c = newCareer('t', 'T', 'adelaide');
    c.member = true;
    expect(recordPractice(c, practice, 46.2, null, 70).club).toBeNull();
    expect(recordPractice(c, practice, null, 'Shuttlecock', 0).club).toBe('Shuttlecock');
    expect(recordPractice(c, practice, null, 'Shuttlecock', 0).club).toBeNull();
    // Off at a straight is no club.
    expect(recordPractice(c, practice, null, 'Junction Straight', 0).club).toBeNull();
    c.rides.push({ day: 0, season: 1, start: 'top', toboggan: 'traditional', style: 'running', time: 61, fall: null, speed: 75 });
    noteRide(c, 'top', null);
    const r = riderRecord(c);
    expect(r.junctionRides).toBe(4);
    expect(r.topRides).toBe(1);
    expect(r.clubs).toEqual(['Shuttlecock']);
    expect(r.bestJunction).toBeCloseTo(46.2);
  });

  it('starts the counts of an older career from its ride log', () => {
    const c = newCareer('t', 'T', 'remo');
    for (const fall of [null, 'Thoma', null]) c.rides.push({ day: 0, season: 1, start: 'junction', toboggan: 'traditional', style: 'running', time: fall ? null : 47, fall, speed: 0 });
    c.rides.push({ day: 0, season: 1, start: 'junction', toboggan: 'traditional', style: 'running', time: null, fall: 'Scylla', speed: 0 });
    expect(noteRide(c, 'junction', 'Scylla')).toBe('Scylla');
    expect(c.rideCounts).toEqual({ junction: 4, top: 0 });
    expect(riderRecord(c).clubs).toEqual(['Thoma', 'Scylla']);
  });

  it('lists only wins, in the order they were won, with the club trophy where it is known', () => {
    const c = newCareer('t', 'T', 'maximilian');
    c.results = [
      { raceId: 'brabazon', season: 1, position: 1, of: 20, total: 236.4, net: 236.4, day: 52 },
      { raceId: 'heaton', season: 1, position: 3, of: 38, total: 141, net: 126 },
      { raceId: 'curzon', season: 1, position: 1, of: 21, total: 268.1, net: 268.1, day: 24 },
      { raceId: 'stagni', season: 1, position: 1, of: 36, total: 140, net: 125, day: 34 },
    ];
    const w = wins(c);
    expect(w.map((x) => x.raceId)).toEqual(['curzon', 'stagni', 'brabazon']);
    expect(w[0]).toMatchObject({ model: 'curzon', colours: true, net: null });
    expect(w[0].date).toContain('January 2027');
    expect(w[1].net).toBe(125);
    expect(w[2].model).toBe('brabazon');
    expect(trophyFor('stagni').model).toBe('rake');
  });

  it('every race on the calendar has a trophy of its own', () => {
    const models = RACES.map((r) => TROPHIES[r.id]?.model);
    expect(models.every(Boolean)).toBe(true);
    expect(new Set(models).size).toBe(RACES.length);
  });

  it('a showcase career has the trophy of every race in the room, before any race of its own', () => {
    const c = newCareer('t', 'T', 'adelaide');
    c.showcase = true;
    expect(wins(c)).toHaveLength(RACES.length);
    expect(new Set(showcaseWins().map((w) => w.model)).size).toBe(RACES.length);
    expect(c.results).toHaveLength(0);
  });
});
