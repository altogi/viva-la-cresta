// What the day and the night before bring: the weather on the run (one day in ten hot, one in ten
// cold, one in ten snowing), announced as the run opens; and, one ride in ten each, a hangover,
// some unwelcome gossip or a timely Coca-Cola, announced at the start.

import type { RiderStats, TobogganStats } from '../sim/rider';
import type { RideInput } from '../sim/physics';

export type Weather = 'hot' | 'cold' | 'snow';
export type Mood = 'hangover' | 'rumours' | 'luck';

export const WEATHER: Record<Weather, { title: string; text: string }> = {
  hot: { title: 'Hot day', text: "It's hot and slushy today. You might feel slower." },
  cold: { title: 'Cold day', text: 'Crisp cold. You might want to rake today.' },
  snow: { title: 'Snowy day', text: 'Hope you can see Shuttlecock... before taking the turn.' },
};

export const MOODS: Record<Mood, { title: string; text: string }> = {
  hangover: { title: 'Hangover', text: "You really didn't need those last shots of Braulio last night. Try to stay sharp today." },
  rumours: { title: 'Rumours', text: "Someone in the changing room told you some gossip about your Cresta crush that you don't quite like. Try to stay focused." },
  luck: { title: 'Liquid luck', text: "That last ice-cold Coca-Cola is kicking in. Go get 'em!" },
};

/** A steady 0…1 number from a key (the same key, the same number). */
function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** The day's weather, the same all day: from a key naming the day (a career's, or today's date). */
export function weatherFor(key: string): Weather | null {
  const r = hash01(key);
  return r < 0.1 ? 'hot' : r < 0.2 ? 'cold' : r < 0.3 ? 'snow' : null;
}

/**
 * The temperature at the run in the morning (°C): St Moritz's winter, coldest in January, a
 * couple of degrees above freezing on a hot day, near -20 on a cold one, just below freezing as it snows.
 */
export function temperatureFor(key: string, seasonDay: number, weather: Weather | null): number {
  const r = hash01(`${key}-temp`);
  if (weather === 'hot') return Math.round(1 + r * 6);
  if (weather === 'cold') return Math.round(-22 + r * 6);
  if (weather === 'snow') return Math.round(-5 + r * 4);
  // Normal days: about -7 in December, -11 in mid-January, -6 by late February.
  const mid = -7 - 4 * Math.sin(Math.min(1, seasonDay / 74) * Math.PI);
  return Math.round(mid + (r - 0.5) * 8);
}

/** This ride's own luck, good and bad: each one in ten. */
export function rollMoods(rand = Math.random): Mood[] {
  return (['hangover', 'rumours', 'luck'] as Mood[]).filter(() => rand() < 0.1);
}

/** How the weather changes the ice: slush is slow, fresh snow slower still, hard cold ice fast. */
const ICE: Record<Weather, number> = { hot: 1.3, snow: 1.22, cold: 0.84 };

/** The rider and toboggan as the day and the night before have left them. */
export function adjust(rider: RiderStats, toboggan: TobogganStats, weather: Weather | null, moods: Mood[]) {
  const ice = weather ? ICE[weather] : 1;
  return {
    // A running start 50% more powerful: half as much again of the energy, so about 22% more speed.
    rider: moods.includes('luck') ? { ...rider, runSpeed: rider.runSpeed * Math.sqrt(1.5) } : rider,
    toboggan: { ...toboggan, muForward: toboggan.muForward * ice, muKnives: toboggan.muKnives * (1 + (ice - 1) * 0.5) },
    /** How well the rakes bite: not at all with the mind elsewhere. */
    rakeGrip: moods.includes('rumours') ? 0 : 1,
    /** Seconds before the hands and feet do what they're told. */
    lag: moods.includes('hangover') ? 0.2 : 0,
  };
}

/** Holds the steering, knives and rakes back by `lag` seconds (the running steps still count at once). */
export class Lag {
  private queue: { t: number; input: RideInput }[] = [];
  private t = 0;
  constructor(private readonly lag: number) {}

  apply(input: RideInput, dt: number): RideInput {
    if (this.lag <= 0) return input;
    this.t += dt;
    this.queue.push({ t: this.t, input: { ...input } });
    let late: RideInput | null = null;
    while (this.queue.length && this.queue[0].t <= this.t - this.lag) late = this.queue.shift()!.input;
    const held = late ?? this.held;
    this.held = held;
    return { ...held, runTaps: input.runTaps };
  }

  private held: RideInput = { knives: false, steer: 0, rakeLeft: 0, rakeRight: 0, runTaps: 0 };
}
