// The season's races, from the club's calendar: handicap races (three courses a day, net of Tower's
// handicap) and the scratch majors (Curzon Cup, Morgan Cup, Brabazon Trophy, Grand National), each with a field of
// NPC riders whose times, speeds and falls follow the Tower's real sheets (scaled to this run).

import { mulberry32 } from '../render/util';
import { npcName } from './names';
import { SCRATCH_JUNCTION, SCRATCH_TOP, towerHandicap, type Career, type RaceEntry, type Start } from './career';
import type { RiderId } from '../sim/rider';

export interface Race {
  id: string;
  name: string;
  /** A subtitle as the sheet prints it, e.g. "(The Poor Man's Curzon)". */
  note?: string;
  start: Start;
  kind: 'handicap' | 'major';
  days: number;
  /** First day of the race (season day). */
  day: number;
  field: number;
  /** Field strength: the best and slowest riders' average course times. */
  fast: number;
  slow: number;
  /** Open only to some riders (the Swiss Championship to the Swiss), and why. */
  only?: { riders: RiderId[]; why: string };
}

/** Season day of a date: the run opens on Thursday 17 December and closes on 28 February. */
export function seasonDay(month: 'Dec' | 'Jan' | 'Feb', date: number): number {
  return month === 'Dec' ? date - 17 : month === 'Jan' ? 15 + date - 1 : 46 + date - 1;
}

const jct = (id: string, name: string, day: number, field = 36, note?: string): Race => ({ id, name, note, start: 'junction', kind: 'handicap', days: 1, day, field, fast: 45, slow: 60 });
const top = (id: string, name: string, day: number, field = 42): Race => ({ id, name, start: 'top', kind: 'handicap', days: 1, day, field, fast: 59.5, slow: 77 });

/**
 * The races a rider can enter, one a day, from the club's calendar (CALENDAR has everything on it):
 * Junction handicaps until Top opens, the Curzon Cup at Junction, then the Top majors (the Morgan
 * Cup, the Brabazon Trophy, the Grand National) among handicaps from both starts.
 */
export const RACES: Race[] = [
  jct('bartley-bear', 'The Bartley Bear', seasonDay('Dec', 17), 30),
  jct('lowe-portago', 'The Lowe Portago Challenge', seasonDay('Dec', 27)),
  jct('nino-bibbia', 'The Nino Bibbia Challenge Cup', seasonDay('Dec', 28)),
  jct('fairchilds-maccarthy', 'The Fairchilds MacCarthy Cup', seasonDay('Dec', 29)),
  jct('bledisloe', 'The Bledisloe Cup', seasonDay('Jan', 1), 40),
  jct('heaton', 'The Heaton Gold Cup', seasonDay('Jan', 2), 38),
  jct('baron-oertzen', 'The Baron Oertzen Cup', seasonDay('Jan', 3)),
  jct('lightning', 'The Lightning Cup', seasonDay('Jan', 6)),
  { id: 'curzon', name: 'The Curzon Cup', start: 'junction', kind: 'major', days: 2, day: seasonDay('Jan', 9), field: 21, fast: SCRATCH_JUNCTION - 0.2, slow: 48.5 },
  jct('escalante', 'The Escalante Cup', seasonDay('Jan', 13)),
  jct('junction-calisch', 'The Junction Calisch', seasonDay('Jan', 16), 34),
  { ...jct('swiss-championship', 'The Swiss Championship', seasonDay('Jan', 17), 24), only: { riders: ['remo'], why: 'Only Swiss riders.' } },
  jct('stagni', 'The Stagni Cup', seasonDay('Jan', 20)),
  jct('knapp', 'The Knapp Cup', seasonDay('Jan', 23)),
  top('aris-vatimbella', 'The Aris Vatimbella Challenge Cup', seasonDay('Jan', 24)),
  jct('harland', 'The Harland Trophy', seasonDay('Jan', 27)),
  top('bott', 'The Bott Cup', seasonDay('Jan', 30)),
  { id: 'morgan', name: 'The Morgan Cup', start: 'top', kind: 'major', days: 1, day: seasonDay('Jan', 31), field: 20, fast: SCRATCH_TOP, slow: 63.5 },
  { id: 'brabazon', name: 'The Brabazon Trophy', start: 'top', kind: 'major', days: 2, day: seasonDay('Feb', 6), field: 20, fast: SCRATCH_TOP, slow: 64 },
  jct('coppa-italia', "The Coppa d'Italia", seasonDay('Feb', 11)),
  { id: 'grand-national', name: 'The Grand National', start: 'top', kind: 'major', days: 1, day: seasonDay('Feb', 13), field: 20, fast: SCRATCH_TOP - 0.2, slow: 63 },
  top('badrutt', 'The Johannes Badrutt Memorial Trophy', seasonDay('Feb', 14), 48),
  jct('glattfelder', 'The Glattfelder Cup', seasonDay('Feb', 17)),
  { ...jct('claude-cartier', 'The Claude Cartier Challenge Cup', seasonDay('Feb', 19), 34), days: 2 },
  top('gunter-sachs', 'The Gunter Sachs Challenge Cup', seasonDay('Feb', 21)),
  jct('bonsai', 'The Bonsai Challenge', seasonDay('Feb', 26), 32),
  jct('willoughby', 'The Willoughby Cup', seasonDay('Feb', 27)),
  jct('payne', 'The Payne Cup', seasonDay('Feb', 28)),
];

/** Everything on the club's calendar, by season day: the races above and the club's other events. */
export const CALENDAR: { day: number; name: string }[] = [
  ...([
    ['Dec', 17, 'The Bartley Bear'], ['Dec', 21, 'The University Challenge'], ['Dec', 27, 'The Lowe Portago Challenge'],
    ['Dec', 28, 'The Nino Bibbia Challenge Cup'], ['Dec', 29, 'The Fairchilds MacCarthy Cup'], ['Dec', 31, 'Fathers + Sons and Brothers Races'],
    ['Dec', 31, 'The Family Event'], ['Jan', 1, 'The Bledisloe Cup'], ['Jan', 1, "Children's"], ['Jan', 2, 'The Bucherer Trophy'],
    ['Jan', 2, 'The Heaton Gold Cup'], ['Jan', 3, 'The Baron Oertzen Cup'], ['Jan', 6, 'The Lightning Cup'], ['Jan', 9, 'The Curzon Cup'],
    ['Jan', 9, 'The Lorna Robertson Challenge Cup'], ['Jan', 10, 'The Curzon Cup'], ['Jan', 10, 'The Harjes Cartier Silver Chip'],
    ['Jan', 10, 'The Lorna Robertson Challenge Cup'], ['Jan', 13, 'The Escalante Cup'], ['Jan', 16, 'The Junction Calisch'],
    ['Jan', 16, 'The Calisch Grischun'], ['Jan', 17, 'The Swiss Championship'], ['Jan', 20, 'The Stagni Cup'], ['Jan', 23, 'The Knapp Cup'],
    ['Jan', 24, 'The Aris Vatimbella Challenge Cup'], ['Jan', 25, 'The Army Championship (T)'], ['Jan', 27, 'The Harland Trophy'],
    ['Jan', 27, 'The Inter Services Championship'], ['Jan', 27, "The Services' Silver Spoon"], ['Jan', 30, 'The Bott Cup'],
    ['Jan', 30, 'The Hans Badrutt Challenge Cup'], ['Jan', 31, 'The Morgan Cup'], ['Feb', 3, 'Inter Club Event'], ['Feb', 5, 'Monobob'],
    ['Feb', 6, 'The Brabazon Trophy'], ['Feb', 7, 'The Brabazon Trophy'], ['Feb', 7, 'The Roger Gibbs Challenge Cup'],
    ['Feb', 11, "The Coppa d'Italia"], ['Feb', 11, "The Coppetta d'Italia"], ['Feb', 13, 'The Grand National'],
    ['Feb', 13, 'The Ladies Grand National'], ['Feb', 14, 'The Johannes Badrutt Memorial Trophy'], ['Feb', 16, 'Seniors from Stream'],
    ['Feb', 16, 'The Crawford Cup'], ['Feb', 16, 'The Julian Board Seniors Cup'], ['Feb', 17, 'The Glattfelder Cup'], ['Feb', 17, 'The Marsden Cup'],
    ['Feb', 19, 'The Claude Cartier Challenge Cup'], ['Feb', 20, 'The Claude Cartier Challenge Cup'], ['Feb', 20, "The President's Race"],
    ['Feb', 21, 'Junction Night Riding - Coffin'], ['Feb', 21, 'The Gunter Sachs Challenge Cup'], ['Feb', 24, 'Seiler Team Race'],
    ['Feb', 25, 'End of Term Race'], ['Feb', 26, 'The Bonsai Challenge'], ['Feb', 26, 'The Combination Event'], ['Feb', 27, 'The Willoughby Cup'],
    ['Feb', 28, 'The Nigel Moores Memorial Race'], ['Feb', 28, 'The Payne Cup'],
  ] as const).map(([m, d, name]) => ({ day: seasonDay(m, d), name })),
];

export const raceById = (id: string) => RACES.find((r) => r.id === id);

/** The race running on a season day (its first or a later day), if any. */
export function raceOn(day: number): { race: Race; raceDay: number } | null {
  for (const race of RACES) if (day >= race.day && day < race.day + race.days) return { race, raceDay: day - race.day };
  return null;
}

export function upcoming(day: number, n = 3): Race[] {
  return RACES.filter((r) => r.day > day).slice(0, n);
}

/** Why a rider can't enter a race, or null if they can. */
export function cannotEnter(c: Career, race: Race): string | null {
  if (!c.member) return 'Supplementary List riders cannot race.';
  if (race.only && !race.only.riders.includes(c.rider)) return race.only.why;
  if (race.start === 'top' && c.top !== 'yes') return 'Only riders who have qualified for Top.';
  return null;
}

export interface Entrant {
  name: string;
  nation: string;
  sl?: boolean;
  handicap: number;
  /** Course times day by day; null is a fall, undefined not ridden (after a fall). */
  times: (number | null | undefined)[][];
  speeds: number[][];
  fallAt?: string;
  player?: boolean;
}

/** The NPC field for a race (the same every time it is generated for that entry). */
export function npcField(race: Race, seed: number): Entrant[] {
  const rand = mulberry32(seed);
  const out: Entrant[] = [];
  for (let i = 0; i < race.field; i++) {
    const { name, nation } = npcName(rand);
    // Abilities spread from the field's best to its slowest, bunched towards the better end.
    const skill = Math.pow(i / Math.max(1, race.field - 1), 1.25);
    const mean = race.fast + (race.slow - race.fast) * skill + (rand() - 0.5) * 0.6;
    const spread = 0.25 + skill * 1.1;
    // The Tower's handicap from their form, give or take its opacity.
    const handicap = race.kind === 'handicap' ? Math.max(0, Math.round((towerHandicap(race.start, mean) + (rand() - 0.5) * 1.2) * 10) / 10) : 0;
    // Falls: rare in the majors, about one starter in six over a handicap race (mostly Shuttlecock).
    const fallChance = race.kind === 'major' ? 0.012 : 0.05 + skill * 0.03;
    const times: (number | null | undefined)[][] = [];
    const speeds: number[][] = [];
    let fallen = false;
    let fallAt: string | undefined;
    for (let d = 0; d < race.days; d++) {
      const day: (number | null | undefined)[] = [];
      const daySpeeds: number[] = [];
      for (let k = 0; k < 3; k++) {
        if (fallen) {
          day.push(undefined);
          daySpeeds.push(0);
          continue;
        }
        if (rand() < fallChance) {
          fallen = true;
          fallAt = race.start === 'top' && rand() < 0.12 ? 'TH' : 'S';
          day.push(null);
          daySpeeds.push(0);
          continue;
        }
        // Later courses come a touch quicker as the ice and nerves settle.
        const t = mean + gauss(rand) * spread - k * 0.15;
        day.push(Math.round(t * 100) / 100);
        daySpeeds.push(speedFor(race.start, t, rand));
      }
      times.push(day);
      speeds.push(daySpeeds);
    }
    out.push({ name, nation, handicap, times, speeds, fallAt, sl: false });
  }
  return out;
}

function gauss(rand: () => number) {
  return (rand() + rand() + rand() - 1.5) * 1.15;
}

/** Finish speed (mph) for a course time: faster rides finish faster. */
function speedFor(start: Start, time: number, rand: () => number) {
  const s = start === 'top' ? 76 - (time - SCRATCH_TOP) * 0.9 : 70 - (time - SCRATCH_JUNCTION) * 1.1;
  return Math.round((s + (rand() - 0.5) * 2) * 100) / 100;
}

export interface Standing {
  entrant: Entrant;
  total: number | null;
  net: number | null;
  rank: number | null;
}

/**
 * Standings after `days` days: totals of every course ridden, net of three handicaps per day for
 * handicap races. Fallers (DQ) come after the finishers, unranked.
 */
export function standings(race: Race, field: Entrant[], days: number): Standing[] {
  const rows: Standing[] = field.map((e) => {
    const ridden = e.times.slice(0, days).flat();
    const fell = ridden.some((t) => t === null || t === undefined);
    const total = fell ? null : ridden.reduce<number>((a, t) => a + (t as number), 0);
    const net = total === null ? null : race.kind === 'handicap' ? total - 3 * days * e.handicap : total;
    return { entrant: e, total: total === null ? null : round2(total), net: net === null ? null : round2(net), rank: null };
  });
  rows.sort((a, b) => (a.net === null ? 1 : 0) - (b.net === null ? 1 : 0) || (a.net ?? 0) - (b.net ?? 0));
  let rank = 0;
  for (const r of rows) if (r.net !== null) r.rank = ++rank;
  return rows;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The player as an entrant, from their race entry. */
export function playerEntrant(entry: RaceEntry, name: string, nation: string, fallZone: string | null): Entrant {
  return { name, nation, handicap: entry.handicap, times: entry.times, speeds: entry.speeds, player: true, fallAt: fallZone ? fallCode(fallZone) : undefined };
}

/** The sheet's short code for where a rider fell: Fall(S) for Shuttlecock, Fall(TH) for Thoma. */
export function fallCode(zone: string): string {
  const codes: Record<string, string> = {
    Shuttlecock: 'S', Thoma: 'TH', Curzon: 'C', Brabazon: 'B', 'Church Leap': 'CL', Rise: 'R', Battledore: 'BD', Stream: 'ST',
    Bulpetts: 'BU', Scylla: 'SC', Charybdis: 'CH', 'Cresta Leap': 'L', 'Junction Straight': 'J', 'Bledisloe Straight': 'BS',
  };
  return codes[zone] ?? zone.slice(0, 2).toUpperCase();
}

/** Fastest time and fastest speed of the day (day index), for the sheet's footer. */
export function fastestOfDay(field: Entrant[], day: number): { time: [string, number] | null; speed: [string, number] | null } {
  let time: [string, number] | null = null;
  let speed: [string, number] | null = null;
  for (const e of field) {
    (e.times[day] ?? []).forEach((t, k) => {
      if (typeof t === 'number' && (!time || t < time[1])) time = [e.name, t];
      const s = e.speeds[day]?.[k];
      if (s && (!speed || s > speed[1])) speed = [e.name, s];
    });
  }
  return { time, speed };
}
