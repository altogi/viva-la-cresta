// A rider's career: from the first lying start at Junction, through practice and joining the
// club, to the flat-top, Top, the races and the Grand National. Pure state and rules (no UI), so
// the progression can be tested on its own.

import type { RiderId, TobogganId } from '../sim/rider';

export type Start = 'junction' | 'top';
export type Style = 'lying' | 'running';

export interface RideRecord {
  day: number;
  season: number;
  start: Start;
  toboggan: TobogganId;
  style: Style;
  time: number | null;
  /** "Shuttlecock" etc. when the rider fell. */
  fall: string | null;
  speed: number;
  race?: string;
}

/** A conversion in progress: a run of lying starts, then running starts with more steps each time. */
export interface Conversion {
  start: Start;
  toboggan: TobogganId;
  lying: number;
  steps: number[];
}

export interface RaceEntry {
  raceId: string;
  /** Day of the race (0-based) and course within the day (0-2). */
  raceDay: number;
  course: number;
  /** The player's course times so far, day by day (null for a fall). */
  times: (number | null)[][];
  speeds: number[][];
  handicap: number;
  dq: boolean;
  seed: number;
}

export interface RaceResult {
  raceId: string;
  season: number;
  position: number | null;
  of: number;
  total: number | null;
  net: number | null;
  /** Season day the race finished on. */
  day?: number;
}

export interface Career {
  id: string;
  name: string;
  rider: RiderId;
  created: number;
  lastPlayed: number;
  season: number;
  /** Day of the season, 0 = Thursday 17 December (the run opens) to 73 = 28 February. */
  day: number;
  ridesToday: number;
  /** Clean finishes in the beginner stage (first ride and practice), which move the rider on. */
  practiceRides: number;
  /** Where the first-ride guide picks up again after a fall (the step it had reached). */
  tutorialStep: number;
  member: boolean;
  flattop: 'locked' | 'converting' | 'yes';
  top: 'locked' | 'converting' | 'yes';
  /** Waiting for the rider to choose between the flat-top and Top. */
  choicePending: boolean;
  conversion: Conversion | null;
  toboggan: TobogganId;
  /** The start practised from (once Top is open). */
  start: Start;
  rides: RideRecord[];
  best: Partial<Record<string, number>>;
  seenFallHelp: boolean;
  race: RaceEntry | null;
  results: RaceResult[];
  gnWon: boolean;
  /** 2 once the season runs 17 December to 28 February (older saves started on 26 December). */
  calendar?: number;
  /** The last day whose morning screen was shown ("season-day"). */
  dayShown?: string;
  /** Every ride ever ridden from each start (the ride log itself keeps only the last few hundred). */
  rideCounts?: Record<Start, number>;
  /** The banks the rider has fallen at: a member of each one's club. */
  clubs?: string[];
}

/** The banks with a club for those who have come off in them. */
export const CLUBS = ['Curzon', 'Brabazon', 'Thoma', 'Rise', 'Battledore', 'Shuttlecock', 'Stream', 'Bulpetts', 'Scylla', 'Charybdis'];

/** Count a ride (practice or race) from a start, and a fall at a bank as joining its club. */
export function noteRide(c: Career, start: Start, fall: string | null): string | null {
  // A career from before the counts began: start them from its ride log (this ride already in it).
  if (!c.rideCounts) c.rideCounts = { junction: c.rides.filter((r) => r.start === 'junction').length, top: c.rides.filter((r) => r.start === 'top').length };
  else c.rideCounts[start]++;
  c.clubs ??= [...new Set(c.rides.slice(0, -1).map((r) => r.fall).filter((f): f is string => !!f && CLUBS.includes(f)))];
  if (!fall || !CLUBS.includes(fall)) return null;
  if (c.clubs.includes(fall)) return null;
  c.clubs.push(fall);
  return fall;
}

export const RIDES_PER_DAY = 5;
export const SEASON_DAYS = 74; // 17 December to 28 February
/** Top opens on 11 January (season day 25); until then everyone rides from Junction. */
export const TOP_OPENS = 25;
/** The club takes a rider on after this many finishes under MEMBER_TIME. */
export const MEMBER_RIDES = 5;
export const MEMBER_TIME = 50;
/** Clean lying starts before the running start comes in. */
export const LYING_RIDES = 1;
/** Running-start conversion: one short start (1-2-flop), then the full running start. */
export const CONVERSION_STEPS = [2, 7];
export const FULL_STEPS = 7;

export function newCareer(id: string, name: string, rider: RiderId, now = Date.now()): Career {
  return {
    id,
    name,
    rider,
    created: now,
    lastPlayed: now,
    season: 1,
    day: 0,
    ridesToday: 0,
    practiceRides: 0,
    tutorialStep: 0,
    member: false,
    flattop: 'locked',
    top: 'locked',
    choicePending: false,
    conversion: null,
    toboggan: 'traditional',
    start: 'junction',
    rides: [],
    best: {},
    seenFallHelp: false,
    race: null,
    results: [],
    gnWon: false,
    calendar: 2,
  };
}

/** The date of a season day, as the sheets print it (season 1 is the winter of 2026-27). */
export function dateOf(day: number, season = 1): { label: string; short: string; year: number; date: Date } {
  const d = new Date(Date.UTC(2025 + season, 11, 17 + day));
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const date = d.getUTCDate();
  const month = d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  const nth = (n: number) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  return { label: `${weekday} ${date}${nth(date)} ${month}`, short: `${date} ${month.slice(0, 3)}`, year: d.getUTCFullYear(), date: d };
}

export const bestKey = (start: Start, toboggan: TobogganId) => `${start}-${toboggan}`;

export type Setup = { start: Start; toboggan: TobogganId; style: Style; steps: number; first?: boolean };

/** What the next practice ride is: the first ride, beginner lying starts, a conversion step, or free. */
export function nextPractice(c: Career): Setup {
  if (!c.member) {
    // First ride and beginner practice: clean lying starts, then the running start comes in step by
    // step (a fall never moves a rider on), then full running starts until the club takes them on.
    const n = c.practiceRides;
    if (n === 0) return { start: 'junction', toboggan: 'traditional', style: 'lying', steps: 0, first: true };
    if (n < LYING_RIDES) return { start: 'junction', toboggan: 'traditional', style: 'lying', steps: 0 };
    const steps = CONVERSION_STEPS[Math.min(n - LYING_RIDES, CONVERSION_STEPS.length - 1)];
    return { start: 'junction', toboggan: 'traditional', style: 'running', steps };
  }
  if (c.conversion && !(c.conversion.start === 'top' && c.day < TOP_OPENS)) {
    const conv = c.conversion;
    if (conv.lying > 0) return { start: conv.start, toboggan: conv.toboggan, style: 'lying', steps: 0 };
    return { start: conv.start, toboggan: conv.toboggan, style: 'running', steps: conv.steps[0] ?? FULL_STEPS };
  }
  // Until Top opens, a rider learning Top (or qualified for it) rides from Junction.
  const start = c.top === 'yes' && c.day >= TOP_OPENS ? c.start : 'junction';
  const toboggan = c.flattop === 'yes' ? c.toboggan : 'traditional';
  return { start, toboggan, style: 'running', steps: FULL_STEPS };
}

/** Three of the last five clean rides matching `filter` under `limit`. */
export function threeOfFive(c: Career, filter: (r: RideRecord) => boolean, limit: number, anyStyle = false): { count: number; done: boolean } {
  const last = c.rides.filter((r) => filter(r) && (anyStyle || r.style === 'running')).slice(-5);
  const count = last.filter((r) => r.time !== null && r.time < limit).length;
  return { count, done: count >= 3 };
}

/** The progression goal shown in the hub, with how far along the rider is. */
export function goal(c: Career): string {
  if (!c.member) {
    const n = c.practiceRides;
    if (n < LYING_RIDES) return `Beginner: clean lying starts, ${n} of ${LYING_RIDES}. A fall doesn't count.`;
    if (n < LYING_RIDES + CONVERSION_STEPS.length - 1) return `Running start: ${CONVERSION_STEPS[n - LYING_RIDES]} steps this time. Finish clean to take more.`;
    return 'Ride well and Tower will notice.';
  }
  if (c.choicePending) return 'Tower is impressed. Choose your next step.';
  if (c.conversion?.start === 'top' && c.day < TOP_OPENS) return 'Top opens on 11 January. Junction until then.';
  if (c.conversion) {
    const conv = c.conversion;
    const what = conv.toboggan === 'flattop' && conv.start === 'junction' ? 'Converting to the flat-top' : 'Learning to ride from Top';
    return conv.lying > 0 ? `${what}: ${conv.lying} lying start${conv.lying > 1 ? 's' : ''} to go.` : `${what}: running starts, ${conv.steps[0]} steps.`;
  }
  if (c.flattop === 'locked' && c.top === 'locked') {
    const p = threeOfFive(c, (r) => r.start === 'junction' && r.toboggan === 'traditional', 48);
    return `Next: 3 of your last 5 Junction rides under 48 s on a traditional (${p.count}/3).`;
  }
  if (c.top === 'locked') {
    const p = threeOfFive(c, (r) => r.start === 'junction' && r.toboggan === 'flattop', 47);
    return `Next: 3 of your last 5 Junction rides under 47 s on the flat-top, for Top (${p.count}/3).`;
  }
  if (c.flattop === 'locked') {
    const p = threeOfFive(c, (r) => r.start === 'top' && r.toboggan === 'traditional', 66);
    return `Next: 3 of your last 5 Top rides under 66 s, for the flat-top (${p.count}/3).`;
  }
  if (c.gnWon) return 'Grand National winner. The run is yours.';
  return 'Everything is open. Win the Grand National.';
}

export interface RideOutcome {
  /** The club has made the rider a member (on this ride). */
  joined: boolean;
  /** The rider has just earned the choice of flat-top or Top. */
  choice: boolean;
  /** Something new opened up: 'flattop' or 'top'. */
  unlocked: 'flattop' | 'top' | null;
  newBest: boolean;
  /** The bank whose club the rider has just joined by falling there. */
  club: string | null;
}

/** Record a practice ride and apply the progression rules. */
export function recordPractice(c: Career, setup: Setup, time: number | null, fall: string | null, speed: number): RideOutcome {
  const out: RideOutcome = { joined: false, choice: false, unlocked: null, newBest: false, club: null };
  c.rides.push({ day: c.day, season: c.season, start: setup.start, toboggan: setup.toboggan, style: setup.style, time, fall, speed });
  out.club = noteRide(c, setup.start, fall);
  if (c.rides.length > 300) c.rides.splice(0, c.rides.length - 300);
  c.ridesToday++;
  c.lastPlayed = Date.now();
  if (time !== null) out.newBest = noteBest(c, setup.start, setup.toboggan, time);
  if (!c.member) {
    // Only a clean finish moves a beginner on.
    if (time !== null) c.practiceRides++;
    // Ride well often enough and the President takes a liking to you.
    if (memberRides(c) >= MEMBER_RIDES) {
      c.member = true;
      out.joined = true;
    }
    // A rider fast enough for the flat-top or Top from the very first rides needn't finish the
    // beginners' course first: Tower takes them on and offers the choice straight away.
    if (threeOfFive(c, (r) => r.start === 'junction' && r.toboggan === 'traditional', 48, true).done) {
      out.joined = !c.member;
      c.member = true;
      c.choicePending = true;
      out.choice = true;
    }
    return out;
  }
  // Only rides from Top count towards learning Top.
  if (c.conversion && setup.start === c.conversion.start) {
    const conv = c.conversion;
    if (conv.lying > 0) conv.lying--;
    else conv.steps.shift();
    if (conv.lying === 0 && conv.steps.length === 0) {
      if (conv.start === 'top') c.top = 'yes';
      else c.flattop = 'yes';
      c.conversion = null;
    }
    return out;
  }
  if (c.flattop === 'locked' && c.top === 'locked' && !c.choicePending) {
    if (threeOfFive(c, (r) => r.start === 'junction' && r.toboggan === 'traditional', 48).done) {
      c.choicePending = true;
      out.choice = true;
    }
  } else if (c.top === 'locked' && c.flattop === 'yes') {
    if (threeOfFive(c, (r) => r.start === 'junction' && r.toboggan === 'flattop', 47).done) {
      startConversion(c, 'top');
      out.unlocked = 'top';
    }
  } else if (c.flattop === 'locked' && c.top === 'yes') {
    if (threeOfFive(c, (r) => r.start === 'top' && r.toboggan === 'traditional', 66).done) {
      startConversion(c, 'flattop');
      out.unlocked = 'flattop';
    }
  }
  return out;
}

/** Finishes under the membership time. */
export function memberRides(c: Career): number {
  return c.rides.filter((r) => r.time !== null && r.time < MEMBER_TIME).length;
}

export function noteBest(c: Career, start: Start, toboggan: TobogganId, time: number): boolean {
  const key = bestKey(start, toboggan);
  const prev = c.best[key];
  if (prev === undefined || time < prev) {
    c.best[key] = time;
    return prev !== undefined;
  }
  return false;
}

/** Begin converting: to the flat-top (three lying starts at Junction) or to Top (one lying start). */
export function startConversion(c: Career, to: 'flattop' | 'top') {
  c.choicePending = false;
  if (to === 'flattop') {
    c.flattop = 'converting';
    c.toboggan = 'flattop';
    c.conversion = { start: 'junction', toboggan: 'flattop', lying: 3, steps: [...CONVERSION_STEPS] };
  } else {
    c.top = 'converting';
    c.start = 'top';
    c.conversion = { start: 'top', toboggan: c.flattop === 'yes' ? c.toboggan : 'traditional', lying: 1, steps: [...CONVERSION_STEPS] };
  }
}

/** The run closes for the day after a few rides; move on a day (into a new season after 1 March). */
export function nextDay(c: Career) {
  c.day++;
  c.ridesToday = 0;
  if (c.day >= SEASON_DAYS) {
    c.season++;
    c.day = 0;
  }
}

/**
 * The Tower's handicap for a start: an opaque-looking allowance from recent form, in steps of
 * 0.1 s, from scratch to 13 s. Based on the best three of the last six clean rides from that start.
 */
export function handicap(c: Career, start: Start): number {
  const recent = c.rides.filter((r) => r.start === start && r.time !== null && r.style === 'running').slice(-6);
  // No form from this start yet: a middling allowance until the Tower has seen you ride.
  if (recent.length === 0) return start === 'top' ? 8 : 6;
  const best = recent.map((r) => r.time!).sort((a, b) => a - b).slice(0, 3);
  const avg = best.reduce((a, b) => a + b, 0) / best.length;
  return towerHandicap(start, avg);
}

export function towerHandicap(start: Start, average: number): number {
  const scratch = start === 'top' ? SCRATCH_TOP : SCRATCH_JUNCTION;
  return Math.min(13, Math.max(0, Math.round((average - scratch) * 0.78 * 10) / 10));
}

/** A scratch rider's course time on the game's run (the field's best riders). */
export const SCRATCH_JUNCTION = 44.2;
export const SCRATCH_TOP = 58.2;
