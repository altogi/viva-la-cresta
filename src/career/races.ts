// The season's races: handicap races (one day, three courses, net of the Tower's handicap) and the
// scratch majors (Curzon Cup, Brabazon Trophy, Morgan Cup, Grand National), each with a field of
// NPC riders whose times, speeds and falls follow the Tower's real sheets (scaled to this run).

import { mulberry32 } from '../render/util';
import { npcName } from './names';
import { SCRATCH_JUNCTION, SCRATCH_TOP, towerHandicap, type Career, type RaceEntry, type Start } from './career';

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
}

export const RACES: Race[] = [
  { id: 'celerina-bowl', name: 'The Celerina Bowl', start: 'junction', kind: 'handicap', days: 1, day: 6, field: 34, fast: 45, slow: 60 },
  { id: 'curzon', name: 'The Curzon Cup', start: 'junction', kind: 'major', days: 2, day: 15, field: 21, fast: SCRATCH_JUNCTION - 0.2, slow: 48.5 },
  { id: 'silver-chip', name: 'The Harjes Cartier Silver Chip', note: "(The Poor Man's Curzon)", start: 'junction', kind: 'handicap', days: 1, day: 17, field: 40, fast: 45.5, slow: 61 },
  { id: 'engadine-plate', name: 'The Engadine Plate', start: 'junction', kind: 'handicap', days: 1, day: 24, field: 38, fast: 45, slow: 60 },
  { id: 'brabazon', name: 'The Brabazon Trophy', start: 'top', kind: 'major', days: 2, day: 31, field: 20, fast: SCRATCH_TOP, slow: 64 },
  { id: 'shuttlecock-plate', name: 'The Shuttlecock Plate', start: 'top', kind: 'handicap', days: 1, day: 38, field: 44, fast: 59.5, slow: 77 },
  { id: 'morgan', name: 'The Morgan Cup', start: 'top', kind: 'major', days: 1, day: 44, field: 20, fast: SCRATCH_TOP, slow: 63.5 },
  { id: 'badrutt', name: 'The Johannes Badrutt Memorial Trophy', start: 'top', kind: 'handicap', days: 1, day: 51, field: 48, fast: 59, slow: 78 },
  { id: 'grand-national', name: 'The Grand National', start: 'top', kind: 'major', days: 2, day: 58, field: 20, fast: SCRATCH_TOP - 0.2, slow: 63 },
];

export const raceById = (id: string) => RACES.find((r) => r.id === id)!;

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
