// What a rider has to show for a season: their record (rides, best times, the clubs of the banks
// they've come off at) and the trophies they've won, each the club's own where it's known.

import { CLUBS, dateOf, type Career, type Start } from './career';
import { RACES, raceById } from './races';

/** The trophy models (trophies.glb holds `trophy_<id>`). */
export type TrophyModel =
  | 'curzon' | 'cresta' | 'gunter-sachs' | 'grand-national' | 'morgan' | 'brabazon'
  | 'calisch' | 'coppa-italia' | 'willoughby' | 'bartley-bear' | 'urn' | 'cup' | 'flared'
  | 'heaton' | 'lightning' | 'swiss' | 'badrutt' | 'cartier' | 'bonsai' | 'amphora' | 'helmet'
  | 'rosebowl' | 'stein' | 'quaich' | 'rake' | 'ship' | 'cooler' | 'snowflake';

/**
 * Every race's trophy, each different: the club's own where it's known (the Curzon, Morgan,
 * Brabazon, Grand National, Gunter Sachs, Calisch, Coppa d'Italia, Willoughby and the Bartley Bear),
 * the rest after the race's name or its donor.
 */
export const TROPHIES: Record<string, { model: TrophyModel; text: string }> = {
  'bartley-bear': { model: 'bartley-bear', text: 'The bear himself, carved in wood. The first race of the season.' },
  'lowe-portago': { model: 'helmet', text: 'A silver racing helmet of the fifties, peak and goggles, for Alfonso de Portago, who raced cars as hard as he rode the Cresta.' },
  'nino-bibbia': { model: 'cresta', text: 'A silver vase flaring to a wide rim, slender handles, on an ebony base, for the greatest Cresta rider of them all.' },
  'fairchilds-maccarthy': { model: 'quaich', text: 'A silver quaich, the shallow two-lugged cup of friendship, on an oak base.' },
  bledisloe: { model: 'rosebowl', text: 'A wide silver rose bowl, ring handles held by lions, on a short foot.' },
  heaton: { model: 'heaton', text: 'A tall gold goblet, plain and heavy, on a knopped stem.' },
  'baron-oertzen': { model: 'stein', text: 'A lidded silver stein, thumb-lift and all: the Baron liked his beer at the Sunny Bar.' },
  lightning: { model: 'lightning', text: 'A silver bolt striking up from an ebony drum. For the quick.' },
  curzon: { model: 'curzon', text: 'A gold cup with a domed lid and scrolled handles: the oldest of the colour races.' },
  escalante: { model: 'cup', text: 'A two-handled silver cup, scrolls on the handles.' },
  'junction-calisch': { model: 'calisch', text: "The Graubünden Steinbock in silver, the canton's beast, horns swept back over his shoulders." },
  'swiss-championship': { model: 'swiss', text: 'A silver cow bell on its red leather strap, the white cross on the strap.' },
  stagni: { model: 'rake', text: "A rider's boot rake in silver, its three teeth, the strap still on." },
  knapp: { model: 'urn', text: 'A silver urn, lidded, with tall handles.' },
  'aris-vatimbella': { model: 'amphora', text: 'A silver amphora with two upright handles.' },
  harland: { model: 'ship', text: 'A silver ship under full sail (Harland, of the Belfast shipbuilders), on ebony cradles.' },
  bott: { model: 'cooler', text: 'A silver wine cooler with a bottle of fizz already in it.' },
  morgan: { model: 'morgan', text: 'A tall flared silver cup on a black block, scrolls at the rim.' },
  brabazon: { model: 'brabazon', text: 'A gold toboggan on a wooden plinth, the winners on its silver plaques since 1966.' },
  'coppa-italia': { model: 'coppa-italia', text: 'A wild boar in silver, tusks up, bristling.' },
  'grand-national': { model: 'grand-national', text: 'The silver tankard, lid, spout and all, on its stack of silver and ebony. The oldest race on the Cresta.' },
  badrutt: { model: 'badrutt', text: "The Palace's tower in silver, pointed roof and all: Johannes Badrutt's St Moritz." },
  glattfelder: { model: 'snowflake', text: 'A silver snowflake on a slender stem.' },
  'claude-cartier': { model: 'cartier', text: 'A gilt carriage clock with a white enamel dial, as only Cartier would give.' },
  'gunter-sachs': { model: 'gunter-sachs', text: 'A tall gold vase with high loop handles, on a banded wooden base.' },
  bonsai: { model: 'bonsai', text: 'A little pine in a glazed pot, its trunk twisting, its needles in pads.' },
  willoughby: { model: 'willoughby', text: 'A silver kukri, laid on its wooden stand.' },
  payne: { model: 'flared', text: 'A big flared silver cup on a stepped plinth: the last race of the season.' },
};

/** The four colour races: fireworks over the lake for these. */
export const COLOUR_RACES = ['curzon', 'brabazon', 'morgan', 'grand-national'];

/** The trophy for a race (a plain silver cup for anything not on the calendar). */
export function trophyFor(raceId: string): { model: TrophyModel; text: string } {
  return TROPHIES[raceId] ?? { model: 'cup', text: 'Silver, engraved with the names of the riders who won it before you.' };
}

/** What each bank's club says about its members. */
export const CLUB_LORE: Record<string, string> = {
  Curzon: 'Came off at the first great bank from Top. A select few.',
  Brabazon: 'Out of the left-hander at the foot of Curzon. Quietly distinguished.',
  Thoma: 'The bank before Junction: the second most crowded club on the run.',
  Rise: 'Thrown out of Rise. Rarer than you might think.',
  Battledore: 'Battledore, the bank before the famous one. Mostly late riders.',
  Shuttlecock: 'Over the top into the straw: the most popular club on the Cresta, with its own tie.',
  Stream: 'Out of Stream at full speed. Nobody joins twice.',
  Bulpetts: 'Off at Bulpetts, under the road bridge. A curious few.',
  Scylla: 'Scylla, at seventy miles an hour. A dangerous club to be in.',
  Charybdis: 'Charybdis, just short of the finish. Membership comes with a limp.',
};

export interface RiderRecord {
  junctionRides: number;
  topRides: number;
  bestJunction: number | null;
  bestTop: number | null;
  clubs: string[];
}

/** The rider's record: rides from each start, their best times, and their clubs (in the run's order). */
export function riderRecord(c: Career): RiderRecord {
  const count = (start: Start) => c.rideCounts?.[start] ?? c.rides.filter((r) => r.start === start).length;
  const best = (start: Start) => {
    const times = Object.entries(c.best)
      .filter(([k, v]) => k.startsWith(`${start}-`) && typeof v === 'number')
      .map(([, v]) => v as number);
    return times.length ? Math.min(...times) : null;
  };
  const fell = new Set([...(c.clubs ?? []), ...c.rides.map((r) => r.fall).filter((f): f is string => !!f && CLUBS.includes(f))]);
  return {
    junctionRides: count('junction'),
    topRides: count('top'),
    bestJunction: best('junction'),
    bestTop: best('top'),
    clubs: CLUBS.filter((club) => fell.has(club)),
  };
}

export interface Win {
  raceId: string;
  name: string;
  note?: string;
  season: number;
  date: string;
  /** Aggregate of all the courses, and net of handicap for a handicap race. */
  total: number;
  net: number | null;
  of: number;
  model: TrophyModel;
  text: string;
  colours: boolean;
}

/** The races the rider has won, in the order they were won. */
export function wins(c: Career): Win[] {
  return c.results
    .filter((r) => r.position === 1 && r.total !== null)
    .map((r) => {
      const race = raceById(r.raceId);
      const day = r.day ?? (race ? race.day + race.days - 1 : 0);
      const d = dateOf(day, r.season);
      const trophy = trophyFor(r.raceId);
      return {
        raceId: r.raceId,
        name: race?.name ?? r.raceId,
        note: race?.note,
        season: r.season,
        day,
        date: `${d.label} ${d.year}`,
        total: r.total!,
        net: race?.kind === 'handicap' ? r.net : null,
        of: r.of,
        model: trophy.model,
        text: trophy.text,
        colours: COLOUR_RACES.includes(r.raceId),
      };
    })
    .sort((a, b) => a.season - b.season || a.day - b.day)
    .map(({ day: _day, ...w }) => w);
}

export interface Unwon {
  raceId: string;
  name: string;
  note?: string;
  model: TrophyModel;
  /** When the race is run this season, as the calendar has it. */
  date: string;
}

/** The races the rider hasn't won yet, in the order they come in the season. */
export function unwon(c: Career): Unwon[] {
  const won = new Set(c.results.filter((r) => r.position === 1).map((r) => r.raceId));
  return RACES.filter((race) => !won.has(race.id)).map((race) => {
    const first = dateOf(race.day, c.season);
    const last = dateOf(race.day + race.days - 1, c.season);
    return {
      raceId: race.id,
      name: race.name,
      note: race.note,
      model: trophyFor(race.id).model,
      date: race.days > 1 ? `${first.label} and ${last.label} ${last.year}` : `${first.label} ${first.year}`,
    };
  });
}

