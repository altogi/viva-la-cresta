// The optimiser's runner: searches for the fastest plan for each case (a rider, a toboggan, a start
// or a Shuttlecock entry), riding candidates in parallel on worker threads, and saves each result
// to optimiser/results/<case>.json for the report and for later use.
//
//   npm run optimise                      every case (Top and Junction, every rider, both toboggans; then Shuttlecock)
//   npm run optimise -- --only junction-flattop-adelaide --evals 20000

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Track } from '../src/sim/track';
import { RIDERS, TOBOGGANS, STARTERS, type RiderId, type TobogganId } from '../src/sim/rider';
import { JUNCTION_S } from '../src/track/cresta';
import { cmaes, polish } from './cmaes';
import { GENES, KNOT, POLICIES, decode, dims, fromPolicy, knotsFor, ride, type Conditions, type Genome, type Outcome, type Scenario, type TracePoint } from './plan';

interface Case {
  name: string;
  rider: RiderId;
  toboggan: TobogganId;
  scenario: Scenario;
  /** A day other than an ordinary one: the weather, the rider's luck. */
  conditions?: Conditions;
}

const RESULTS = join(process.cwd(), 'optimiser', 'results');

// ---------- Worker side ----------

if (!isMainThread) {
  const track = new Track();
  let current: Case | null = null;
  parentPort!.on('message', (m: { id: number; case?: Case; genomes: Float64Array[] }) => {
    if (m.case) current = m.case;
    const c = current!;
    const scores = m.genomes.map((g) => ride(track, RIDERS[c.rider], TOBOGGANS[c.toboggan], c.scenario, g, false, c.conditions).score);
    parentPort!.postMessage({ id: m.id, scores });
  });
}

// ---------- Main side ----------

class Pool {
  private readonly workers: Worker[];
  private next = 0;
  private readonly waiting = new Map<number, (scores: number[]) => void>();
  private caseOf: Case | null = null;
  private sent = new WeakSet<Worker>();

  constructor(size: number) {
    this.workers = Array.from({ length: size }, () => {
      const w = new Worker(fileURLToPath(import.meta.url));
      w.on('message', (m: { id: number; scores: number[] }) => {
        this.waiting.get(m.id)!(m.scores);
        this.waiting.delete(m.id);
      });
      return w;
    });
  }

  setCase(c: Case) {
    this.caseOf = c;
    this.sent = new WeakSet();
  }

  async evaluate(batch: Float64Array[]): Promise<number[]> {
    const n = this.workers.length;
    const chunks: Float64Array[][] = Array.from({ length: n }, () => []);
    batch.forEach((g, i) => chunks[i % n].push(g));
    const parts = await Promise.all(
      chunks.map((genomes, k) => {
        if (!genomes.length) return Promise.resolve([] as number[]);
        const w = this.workers[k];
        const id = this.next++;
        return new Promise<number[]>((resolve) => {
          this.waiting.set(id, resolve);
          const first = !this.sent.has(w);
          this.sent.add(w);
          w.postMessage({ id, case: first ? this.caseOf : undefined, genomes });
        });
      }),
    );
    const out = new Array<number>(batch.length);
    parts.forEach((scores, k) => scores.forEach((s, j) => (out[j * n + k] = s)));
    return out;
  }

  close() {
    for (const w of this.workers) void w.terminate();
  }
}

/** A trace thinned to 20 points a second, rounded, for storing. */
function thin(trace: TracePoint[]): TracePoint[] {
  const out: TracePoint[] = [];
  let next = -1;
  for (const p of trace) {
    if (p.t < next && p !== trace[trace.length - 1]) continue;
    next = p.t + 0.05;
    out.push(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.round(v * 1000) / 1000])) as unknown as TracePoint);
  }
  return out;
}

function summary(o: Outcome) {
  const { trace: _trace, ...rest } = o;
  void _trace;
  return rest;
}

export interface StoredResult {
  name: string;
  rider: RiderId;
  toboggan: TobogganId;
  scenario: Scenario;
  conditions?: Conditions;
  knot: number;
  evals: number;
  seconds: number;
  /** The plan's raw numbers (plan.ts decodes them), and decoded, knot by knot. */
  genome: number[];
  plan: { s: number; line: number; knives: boolean; cap: number }[];
  best: Omit<Outcome, 'trace'>;
  trace: TracePoint[];
  /** The autopilot's choreography the search started from, ridden the same way. */
  baseline: { policy: string; outcome: Omit<Outcome, 'trace'>; trace: TracePoint[] };
  /** For a Shuttlecock entry: the clean optimum's own plan, ridden unchanged from this entry. */
  unchanged?: { outcome: Omit<Outcome, 'trace'>; trace: TracePoint[] };
  history: [number, number][];
}

const track = new Track();

function store(c: Case, g: Genome, evals: number, seconds: number, history: [number, number][], baseline: { policy: string; genome: Genome }, unchanged?: Genome): StoredResult {
  const r = RIDERS[c.rider];
  const t = TOBOGGANS[c.toboggan];
  const best = ride(track, r, t, c.scenario, g, true, c.conditions);
  const base = ride(track, r, t, c.scenario, baseline.genome, true, c.conditions);
  const result: StoredResult = {
    name: c.name,
    rider: c.rider,
    toboggan: c.toboggan,
    scenario: c.scenario,
    conditions: c.conditions,
    knot: KNOT,
    evals,
    seconds: Math.round(seconds),
    genome: Array.from(g, (x) => Math.round(x * 1e4) / 1e4),
    plan: Array.from({ length: knotsFor(c.scenario) }, (_, k) => ({ s: c.scenario.startS + k * KNOT, ...decode(g, k) })),
    best: summary(best),
    trace: thin(best.trace!),
    baseline: { policy: baseline.policy, outcome: summary(base), trace: thin(base.trace!) },
    history,
  };
  if (unchanged) {
    const u = ride(track, r, t, c.scenario, unchanged, true, c.conditions);
    result.unchanged = { outcome: summary(u), trace: thin(u.trace!) };
  }
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, `${c.name}.json`), JSON.stringify(result));
  return result;
}

const load = (name: string): StoredResult | null => {
  const f = join(RESULTS, `${name}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as StoredResult) : null;
};

async function optimise(pool: Pool, c: Case, seeds: { policy: string; genome: Genome }[], maxEvals: number, unchanged?: Genome) {
  pool.setCase(c);
  const t0 = performance.now();
  const evaluate = (b: Float64Array[]) => pool.evaluate(b);
  // Start from the best of the seeds.
  const seedScores = await evaluate(seeds.map((s) => s.genome));
  const order = seedScores.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  const start = seeds[order[0][1]].genome;
  const baseline = seeds.find((s) => s.policy !== 'previous optimum') ?? seeds[0];
  const n = dims(c.scenario);
  let last = 0;
  const run = await cmaes(Float64Array.from(start), {
    sigma: SIGMA,
    lambda: Math.max(24, 4 + Math.floor(3 * Math.log(n))),
    maxEvals: Math.floor(maxEvals * 0.85),
    seed: c.name.length * 7919 + n,
    evaluate,
    onGeneration: (gen, evals, best, sigma) => {
      if (evals - last >= 2000) {
        last = evals;
        process.stdout.write(`  ${c.name}: ${evals} rides, best ${best.toFixed(3)} (σ ${sigma.toFixed(3)})\n`);
      }
    },
  });
  const pol = await polish(run.best, run.score, evaluate, GENES);
  const history: [number, number][] = [...run.history, [run.evals + pol.evals, pol.score]];
  const result = store(c, pol.best, run.evals + pol.evals, (performance.now() - t0) / 1000, history, baseline, unchanged);
  const b = result.best;
  console.log(`${c.name}: ${b.time !== null ? `${b.time.toFixed(2)} s` : `fell at ${b.fall?.zone}`} (autopilot ${result.baseline.outcome.time?.toFixed(2) ?? 'fell'}) in ${result.evals} rides, ${result.seconds} s`);
  return result;
}

/** The rider's state as the optimum went past s (for a Shuttlecock entry). */
function stateAt(trace: TracePoint[], s: number) {
  const p = trace.find((x) => x.s >= s)!;
  return { u: p.u, v: p.speed, heading: p.heading, posture: p.posture };
}

/** The tail of a plan, from a later start (knot-aligned). */
function tail(g: number[], fromS: number, toS: number, sc: Scenario): Genome {
  const skip = Math.round((toS - fromS) / KNOT);
  const out = new Float64Array(dims(sc));
  for (let i = 0; i < out.length; i++) out[i] = g[skip * GENES + i] ?? g[g.length - GENES + (i % GENES)];
  return out;
}

export const SHUTTLECOCK_ENTRY = 545;
/** The search's first step size (larger explores more widely: --sigma). */
let SIGMA = 0.35;

/** Mistakes going into Shuttlecock, each a change to the clean entry (at 545 m the rider is still on Battledore's bank, on the left; Shuttlecock's outer bank is on the right, u < 0). */
export const MISTAKES: { id: string; label: string; change: (e: { u: number; v: number; heading: number; posture: number }) => { u: number; v: number; heading: number; posture: number } }[] = [
  { id: 'clean', label: 'Clean entry (the optimum)', change: (e) => e },
  { id: 'fast2', label: '2 m/s too fast', change: (e) => ({ ...e, v: e.v + 2 }) },
  { id: 'fast4', label: '4 m/s too fast', change: (e) => ({ ...e, v: e.v + 4 }) },
  { id: 'slow3', label: '3 m/s too slow', change: (e) => ({ ...e, v: Math.max(4, e.v - 3) }) },
  { id: 'high', label: 'Too far right (towards Shuttlecock’s bank)', change: (e) => ({ ...e, u: e.u - 0.6 }) },
  { id: 'low', label: 'Too far left (still high on Battledore)', change: (e) => ({ ...e, u: e.u + 0.5 }) },
  { id: 'turnedout', label: 'Pointing out at the bank', change: (e) => ({ ...e, heading: e.heading - 0.12 }) },
  { id: 'forward', label: 'Still lying forward (late onto the knives)', change: (e) => ({ ...e, posture: 0 }) },
  { id: 'fastHigh', label: '2 m/s too fast and high', change: (e) => ({ ...e, v: e.v + 2, u: e.u - 0.5 }) },
];

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
  if (args.includes('--sigma')) SIGMA = Number(args[args.indexOf('--sigma') + 1]);
  const scale = args.includes('--evals') ? Number(args[args.indexOf('--evals') + 1]) / 30000 : 1;
  const pool = new Pool(Math.max(1, availableParallelism() - 1));
  const want = (name: string) => !only || only.some((o) => name.startsWith(o));
  const starts: [string, Scenario, Record<TobogganId, string>][] = [
    ['junction', { name: 'junction', startS: JUNCTION_S, steps: 7 }, { traditional: 'good', flattop: 'goodFlattop' }],
    ['top', { name: 'top', startS: 0, steps: 7 }, { traditional: 'topGood', flattop: 'topGoodFlattop' }],
  ];
  const riders: RiderId[] = ['adelaide', ...STARTERS.filter((r) => r !== 'adelaide'), 'kletus', 'mario', 'darklord'];
  for (const [startName, sc, policies] of starts) {
    for (const toboggan of ['flattop', 'traditional'] as TobogganId[]) {
      for (const rider of riders) {
        const c: Case = { name: `${startName}-${toboggan}-${rider}`, rider, toboggan, scenario: sc };
        if (!want(c.name)) continue;
        const seeds = [{ policy: policies[toboggan], genome: fromPolicy(sc, POLICIES[policies[toboggan]]) }];
        if (startName === 'junction') seeds.push({ policy: 'expert', genome: fromPolicy(sc, POLICIES.expert) });
        const previous = load(`${startName}-${toboggan}-adelaide`) ?? load(c.name);
        if (previous && previous.genome.length === dims(sc)) seeds.push({ policy: 'previous optimum', genome: Float64Array.from(previous.genome) });
        await optimise(pool, c, seeds, Math.round((rider === 'adelaide' ? 40000 : 16000) * scale));
      }
    }
  }
  // Maximilian from Junction on the flat-top on the days that change the physics: what the best
  // ride is worth with the weather or the rider's luck on his side.
  const days: [string, Conditions][] = [
    ['cold', { weather: 'cold', moods: [] }],
    ['hot', { weather: 'hot', moods: [] }],
    ['luck', { weather: null, moods: ['luck'] }],
    ['cough', { weather: null, moods: ['cough'] }],
    ['bacon', { weather: null, moods: ['bacon'] }],
    ['cold-luck', { weather: 'cold', moods: ['luck'] }],
  ];
  for (const [id, conditions] of days) {
    const sc = starts[0][1];
    const c: Case = { name: `day-${id}-junction-flattop-maximilian`, rider: 'maximilian', toboggan: 'flattop', scenario: sc, conditions };
    if (!want(c.name)) continue;
    const seeds = [{ policy: 'goodFlattop', genome: fromPolicy(sc, POLICIES.goodFlattop) }];
    const normal = load('junction-flattop-maximilian');
    if (normal && normal.genome.length === dims(sc)) seeds.push({ policy: 'previous optimum', genome: Float64Array.from(normal.genome) });
    const own = load(c.name);
    if (own && own.genome.length === dims(sc)) seeds.push({ policy: 'previous optimum', genome: Float64Array.from(own.genome) });
    await optimise(pool, c, seeds, Math.round(20000 * scale));
  }
  // Shuttlecock: from each of Adelaide's clean optimum runs from Junction, a mistake at the entry,
  // and the best way on from there to the finish.
  for (const toboggan of ['flattop', 'traditional'] as TobogganId[]) {
    const clean = load(`junction-${toboggan}-adelaide`);
    if (!clean) continue;
    // The state at the entry from the clean run ridden again in full (the stored trace is thinned).
    const full = ride(track, RIDERS.adelaide, TOBOGGANS[toboggan], clean.scenario, Float64Array.from(clean.genome), true);
    const entry = stateAt(full.trace!, SHUTTLECOCK_ENTRY);
    for (const m of MISTAKES) {
      const name = `shuttlecock-${toboggan}-${m.id}`;
      if (!want(name)) continue;
      const sc: Scenario = { name, startS: SHUTTLECOCK_ENTRY, steps: 0, entry: m.change(entry) };
      const c: Case = { name, rider: 'adelaide', toboggan, scenario: sc };
      const own = tail(clean.genome, clean.scenario.startS, SHUTTLECOCK_ENTRY, sc);
      // Besides the clean plan, a spread of braking plans to start from: on the knives until a
      // point, raking down to a speed until a point, the clean plan after. A bad entry the clean
      // plan can't save makes every plan near it fall in the same place, which gives the search
      // nothing to go on; one of these gets it onto the right side of the bank.
      const seeds = [{ policy: 'clean optimum, unchanged', genome: own }];
      for (const kEnd of [580, 600, 620, 640]) {
        for (const cap of [8, 12, 15, 17, 19, 21]) {
          for (const rEnd of [570, 590, 610, 630]) {
            const g = Float64Array.from(own);
            for (let k = 0; k < knotsFor(sc); k++) {
              const s = SHUTTLECOCK_ENTRY + k * KNOT;
              if (s < kEnd) g[k * GENES + 1] = 1;
              if (s < rEnd) g[k * GENES + 2] = (cap - 30) / 8;
            }
            seeds.push({ policy: 'previous optimum', genome: g });
          }
        }
      }
      // And every plan found so far for any Shuttlecock entry on this toboggan (a second pass gets
      // to start from the others' answers), including this one's own last result.
      for (const other of MISTAKES) {
        const r = load(`shuttlecock-${toboggan}-${other.id}`);
        if (r && r.genome.length === own.length) seeds.push({ policy: 'previous optimum', genome: Float64Array.from(r.genome) });
      }
      await optimise(pool, c, seeds, Math.round(14000 * scale), own);
    }
  }
  pool.close();
}

if (isMainThread) void main();
