// Separable CMA-ES (Ros & Hansen, 2008): an evolution strategy that learns a step size per
// dimension. Each generation it samples plans around the mean, rides them all, and moves the mean
// towards the best; it needs no gradients, only scores, which is all a physics ride gives.

/** A small deterministic random source, so a run can be repeated exactly. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  let spare: number | null = null;
  const gauss = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}

export interface CmaOptions {
  sigma: number;
  lambda?: number;
  maxEvals: number;
  seed?: number;
  /** Rides a batch of genomes, returning their scores (lower is better). */
  evaluate: (batch: Float64Array[]) => Promise<number[]>;
  onGeneration?: (gen: number, evals: number, best: number, sigma: number) => void;
}

export async function cmaes(x0: Float64Array, o: CmaOptions): Promise<{ best: Float64Array; score: number; evals: number; history: [number, number][] }> {
  const n = x0.length;
  const lambda = o.lambda ?? 4 + Math.floor(3 * Math.log(n));
  const mu = Math.floor(lambda / 2);
  const raw = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const sum = raw.reduce((a, b) => a + b, 0);
  const w = raw.map((x) => x / sum);
  const mueff = 1 / w.reduce((a, b) => a + b * b, 0);
  const cs = (mueff + 2) / (n + mueff + 5);
  const ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
  const cc = (4 + mueff / n) / (n + 4 + (2 * mueff) / n);
  const sep = (n + 2) / 3;
  const c1 = Math.min(1, (sep * 2) / ((n + 1.3) ** 2 + mueff));
  const cmu = Math.min(1 - c1, (sep * 2 * (mueff - 2 + 1 / mueff)) / ((n + 2) ** 2 + mueff));
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
  const r = rng(o.seed ?? 1);

  const mean = Float64Array.from(x0);
  const C = new Float64Array(n).fill(1);
  const ps = new Float64Array(n);
  const pc = new Float64Array(n);
  let sigma = o.sigma;
  let evals = 0;
  let gen = 0;
  let best = Float64Array.from(x0);
  let bestScore = (await o.evaluate([x0]))[0];
  evals++;
  const history: [number, number][] = [[evals, bestScore]];

  while (evals + lambda <= o.maxEvals) {
    gen++;
    const zs: Float64Array[] = [];
    const xs: Float64Array[] = [];
    for (let k = 0; k < lambda; k++) {
      const z = new Float64Array(n);
      const x = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        z[i] = r.gauss();
        x[i] = mean[i] + sigma * Math.sqrt(C[i]) * z[i];
      }
      zs.push(z);
      xs.push(x);
    }
    const scores = await o.evaluate(xs);
    evals += lambda;
    const order = scores.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
    if (order[0][0] < bestScore) {
      bestScore = order[0][0];
      best = Float64Array.from(xs[order[0][1]]);
    }
    history.push([evals, bestScore]);
    // The new mean, and the step that got there.
    const zmean = new Float64Array(n);
    for (let k = 0; k < mu; k++) {
      const z = zs[order[k][1]];
      for (let i = 0; i < n; i++) zmean[i] += w[k] * z[i];
    }
    for (let i = 0; i < n; i++) mean[i] += sigma * Math.sqrt(C[i]) * zmean[i];
    let psNorm = 0;
    for (let i = 0; i < n; i++) {
      ps[i] = (1 - cs) * ps[i] + Math.sqrt(cs * (2 - cs) * mueff) * zmean[i];
      psNorm += ps[i] * ps[i];
    }
    psNorm = Math.sqrt(psNorm);
    const hs = psNorm / Math.sqrt(1 - (1 - cs) ** (2 * gen)) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const y = Math.sqrt(C[i]) * zmean[i];
      pc[i] = (1 - cc) * pc[i] + hs * Math.sqrt(cc * (2 - cc) * mueff) * y;
      let rankMu = 0;
      for (let k = 0; k < mu; k++) {
        const yk = Math.sqrt(C[i]) * zs[order[k][1]][i];
        rankMu += w[k] * yk * yk;
      }
      C[i] = (1 - c1 - cmu) * C[i] + c1 * (pc[i] * pc[i] + (1 - hs) * cc * (2 - cc) * C[i]) + cmu * rankMu;
    }
    sigma *= Math.exp((cs / ds) * (psNorm / chiN - 1));
    sigma = Math.min(sigma, 3);
    o.onGeneration?.(gen, evals, bestScore, sigma);
    if (sigma < 1e-4) break;
  }
  return { best, score: bestScore, evals, history };
}

/**
 * A last polish: nudge one number at a time (each knot's line, knives, rake cap and steer) and keep any
 * change that helps, sweeping until a sweep finds nothing.
 */
export async function polish(x: Float64Array, score: number, evaluate: (batch: Float64Array[]) => Promise<number[]>, genes: number, sweeps = 2) {
  let best = Float64Array.from(x);
  let bestScore = score;
  let evals = 0;
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let improved = false;
    for (const step of [0.6, 0.2]) {
      // All the single nudges of this size at once, then keep the best few that still help together.
      const tries: Float64Array[] = [];
      const what: [number, number][] = [];
      for (let i = 0; i < best.length; i++) {
        for (const d of i % genes === 1 ? [best[i] > 0 ? -2 * Math.abs(best[i]) - 0.2 : 2 * Math.abs(best[i]) + 0.2] : [-step, step]) {
          const t = Float64Array.from(best);
          t[i] += d;
          tries.push(t);
          what.push([i, d]);
        }
      }
      const scores = await evaluate(tries);
      evals += tries.length;
      const good = scores.map((s, k) => [s, k] as const).filter(([s]) => s < bestScore - 1e-6).sort((a, b) => a[0] - b[0]);
      for (const [s, k] of good) {
        // Apply each helpful nudge on top of the ones taken so far, if it still helps.
        const t = Float64Array.from(best);
        t[what[k][0]] += what[k][1];
        const [ts] = await evaluate([t]);
        evals++;
        if (ts < bestScore - 1e-6) {
          best = t;
          bestScore = ts;
          improved = true;
        }
        if (s >= bestScore) break;
      }
    }
    if (!improved) break;
  }
  return { best, score: bestScore, evals };
}
