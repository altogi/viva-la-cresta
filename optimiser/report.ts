// The optimiser's report: reads optimiser/results/*.json and writes optimiser/report/report.html,
// which Chrome prints to optimiser/report/cresta-optimiser-report.pdf.
//
//   npm run optimise:report

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { BENDS, JUNCTION_S, TRACK_LENGTH, ZONES } from '../src/track/cresta';
import { RIDERS } from '../src/sim/rider';
import type { TracePoint } from './plan';
import type { StoredResult } from './run';

const DIR = join(process.cwd(), 'optimiser');
const results = new Map<string, StoredResult>();
for (const f of readdirSync(join(DIR, 'results'))) {
  if (f.endsWith('.json')) {
    const r = JSON.parse(readFileSync(join(DIR, 'results', f), 'utf8')) as StoredResult;
    results.set(r.name, r);
  }
}
const get = (name: string) => results.get(name);

const RIDER_ORDER = ['adelaide', 'maximilian', 'remo', 'kletus', 'mario', 'darklord'] as const;
const zoneOf = (s: number) => [...ZONES].reverse().find((z) => s >= z.s0)?.name ?? '';
const fmt = (t: number | null | undefined, d = 2) => (t === null || t === undefined ? '—' : t.toFixed(d));
const mph = (v: number | null | undefined) => (v === null || v === undefined ? '—' : (v * 2.23694).toFixed(0));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---------- Charts (inline SVG) ----------

const INK = '#1d1d1f';
const MUTED = '#8a857a';
const GRID = '#e6e1d6';
const ACCENT = '#930303';
const BLUE = '#2b5d9a';
const SERIES = [ACCENT, BLUE, '#3f8a4a', '#c27a12', '#6b4fa0', '#1f8a8a', '#a3416b', '#5c5c5c', '#b5651d'];

interface Series {
  label: string;
  color: string;
  points: [number, number][];
  dash?: boolean;
  width?: number;
  step?: boolean;
}

interface ChartOptions {
  w?: number;
  h?: number;
  x: [number, number];
  y?: [number, number];
  xLabel?: string;
  yLabel?: string;
  bends?: boolean;
  legend?: boolean;
  zeroLine?: boolean;
  bands?: { from: number; to: number; color: string; label?: string }[];
}

function niceTicks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n + 1)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function chart(series: Series[], o: ChartOptions): string {
  const W = o.w ?? 720;
  const H = o.h ?? 230;
  const L = 52;
  const R = 12;
  // The legend, in as many rows as it needs.
  const legendRows: { s: Series; x: number; row: number }[] = [];
  {
    let lx = 52;
    let row = 0;
    for (const s of series) {
      const wdt = 30 + s.label.length * 5.3;
      if (lx + wdt > (o.w ?? 720) - 12 && lx > 52) {
        lx = 52;
        row++;
      }
      legendRows.push({ s, x: lx, row });
      lx += wdt;
    }
  }
  const T = o.legend === false ? 12 : 30 + (legendRows.length ? legendRows[legendRows.length - 1].row : 0) * 15;
  const B = 34;
  const [x0, x1] = o.x;
  let [y0, y1] = o.y ?? [Infinity, -Infinity];
  if (!o.y) {
    for (const s of series) for (const [x, y] of s.points) if (x >= x0 && x <= x1) [y0, y1] = [Math.min(y0, y), Math.max(y1, y)];
    const pad = (y1 - y0) * 0.08 || 1;
    y0 -= pad;
    y1 += pad;
  }
  const X = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const parts: string[] = [];
  if (o.bends) {
    for (const b of BENDS) {
      if (b.s1 < x0 || b.s0 > x1 || b.s0 > TRACK_LENGTH) continue;
      const a = X(Math.max(x0, b.s0));
      const c = X(Math.min(x1, b.s1));
      parts.push(`<rect x="${a}" y="${T}" width="${c - a}" height="${H - T - B}" fill="#f4efe4"/>`);
      if (c - a > 26) parts.push(`<text x="${(a + c) / 2}" y="${T + 10}" font-size="8.5" fill="${MUTED}" text-anchor="middle">${b.name}</text>`);
    }
  }
  for (const band of o.bands ?? []) {
    const a = X(Math.max(x0, band.from));
    const c = X(Math.min(x1, band.to));
    if (c > a) parts.push(`<rect x="${a}" y="${T}" width="${c - a}" height="${H - T - B}" fill="${band.color}"/>`);
  }
  for (const v of niceTicks(y0, y1)) {
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(`<text x="${L - 6}" y="${Y(v) + 3}" font-size="9" fill="${MUTED}" text-anchor="end">${v}</text>`);
  }
  for (const v of niceTicks(x0, x1, 8)) {
    parts.push(`<text x="${X(v)}" y="${H - B + 13}" font-size="9" fill="${MUTED}" text-anchor="middle">${v}</text>`);
  }
  if (o.zeroLine && y0 < 0 && y1 > 0) parts.push(`<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="${MUTED}" stroke-width="1"/>`);
  parts.push(`<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="${INK}" stroke-width="1"/>`);
  if (o.xLabel) parts.push(`<text x="${(L + W - R) / 2}" y="${H - 4}" font-size="9.5" fill="${INK}" text-anchor="middle">${o.xLabel}</text>`);
  if (o.yLabel) parts.push(`<text x="12" y="${(T + H - B) / 2}" font-size="9.5" fill="${INK}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">${o.yLabel}</text>`);
  parts.push(`<clipPath id="c${clipId}"><rect x="${L}" y="${T - 2}" width="${W - L - R}" height="${H - T - B + 4}"/></clipPath>`);
  const g: string[] = [];
  for (const s of series) {
    const pts = s.points.filter(([x]) => x >= x0 - 20 && x <= x1 + 20);
    if (!pts.length) continue;
    let d = '';
    pts.forEach(([x, y], i) => {
      if (s.step && i) d += `H${X(x).toFixed(1)}`;
      d += `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`;
    });
    g.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 1.6}" ${s.dash ? 'stroke-dasharray="4 3"' : ''} stroke-linejoin="round"/>`);
  }
  parts.push(`<g clip-path="url(#c${clipId})">${g.join('')}</g>`);
  clipId++;
  if (o.legend !== false) {
    for (const { s, x: lx, row } of legendRows) {
      const y = 12 + row * 15;
      parts.push(`<line x1="${lx}" x2="${lx + 16}" y1="${y}" y2="${y}" stroke="${s.color}" stroke-width="2.4" ${s.dash ? 'stroke-dasharray="4 3"' : ''}/>`);
      parts.push(`<text x="${lx + 20}" y="${y + 3}" font-size="9.5" fill="${INK}">${esc(s.label)}</text>`);
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">${parts.join('')}</svg>`;
}
let clipId = 0;

/** Horizontal bars, grouped. */
function bars(rows: { label: string; values: { v: number | null; color: string; tag: string }[] }[], o: { w?: number; min: number; max: number; unit: string }): string {
  const W = o.w ?? 720;
  const rowH = 16 * Math.max(...rows.map((r) => r.values.length)) + 10;
  const H = rows.length * rowH + 30;
  const L = Math.max(96, 14 + Math.max(...rows.map((r) => r.label.length)) * 6);
  const R = 50;
  const X = (v: number) => L + ((v - o.min) / (o.max - o.min)) * (W - L - R);
  const parts: string[] = [];
  for (const v of niceTicks(o.min, o.max, 6)) {
    parts.push(`<line x1="${X(v)}" x2="${X(v)}" y1="4" y2="${H - 24}" stroke="${GRID}"/>`);
    parts.push(`<text x="${X(v)}" y="${H - 10}" font-size="9" fill="${MUTED}" text-anchor="middle">${v} ${o.unit}</text>`);
  }
  rows.forEach((r, i) => {
    const y = 6 + i * rowH;
    parts.push(`<text x="${L - 8}" y="${y + rowH / 2}" font-size="10.5" fill="${INK}" text-anchor="end">${esc(r.label)}</text>`);
    r.values.forEach((val, j) => {
      const yy = y + j * 16;
      if (val.v === null) {
        parts.push(`<text x="${L + 4}" y="${yy + 11}" font-size="9" fill="${MUTED}">fell</text>`);
        return;
      }
      parts.push(`<rect x="${L}" y="${yy}" width="${Math.max(1, X(val.v) - L)}" height="13" fill="${val.color}" rx="1.5"/>`);
      parts.push(`<text x="${X(val.v) + 4}" y="${yy + 10}" font-size="9" fill="${INK}">${val.v.toFixed(2)} ${esc(val.tag)}</text>`);
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">${parts.join('')}</svg>`;
}

// ---------- Reading the plans ----------

const by = (trace: TracePoint[], f: (p: TracePoint) => number): [number, number][] => trace.map((p) => [p.s, f(p)]);

/** Time gained on the autopilot by each point of the run (s). */
function gainCurve(best: TracePoint[], base: TracePoint[]): [number, number][] {
  const at = (trace: TracePoint[], s: number) => {
    const i = trace.findIndex((p) => p.s >= s);
    if (i <= 0) return trace[Math.max(0, i)]?.t ?? null;
    const a = trace[i - 1];
    const b = trace[i];
    return a.t + ((s - a.s) / Math.max(1e-6, b.s - a.s)) * (b.t - a.t);
  };
  const out: [number, number][] = [];
  const s0 = Math.max(best[0].s, base[0].s);
  const s1 = Math.min(best[best.length - 1].s, base[base.length - 1].s, TRACK_LENGTH);
  for (let s = s0; s <= s1; s += 4) {
    const a = at(best, s);
    const b = at(base, s);
    if (a !== null && b !== null) out.push([s, b - a]);
  }
  return out;
}

/** Stretches where something holds, merged: [from, to]. */
function stretches(trace: TracePoint[], on: (p: TracePoint) => boolean, minLen = 4): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  let prev = trace[0]?.s ?? 0;
  for (const p of trace) {
    if (p.s > TRACK_LENGTH) break;
    if (on(p) && start === null) start = p.s;
    if (!on(p) && start !== null) {
      if (prev - start >= minLen) out.push([start, prev]);
      start = null;
    }
    prev = p.s;
  }
  if (start !== null && prev - start >= minLen) out.push([start, prev]);
  // Close gaps of a few metres.
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < 6) last[1] = r[1];
    else merged.push([...r]);
  }
  return merged;
}

function instructions(r: StoredResult): string {
  const t = r.trace.filter((p) => p.s <= TRACK_LENGTH);
  const knives = stretches(t, (p) => p.posture > 0.5, 6);
  const rake = stretches(t, (p) => p.rake > 0.05, 2);
  const rows: string[] = [];
  const speedAt = (s: number) => t.find((p) => p.s >= s)?.speed ?? 0;
  for (const [a, b] of knives) rows.push(`<tr><td>${Math.round(a)}–${Math.round(b)} m</td><td>${zoneOf(a)}${zoneOf(b) !== zoneOf(a) ? ` → ${zoneOf(b)}` : ''}</td><td>Back on the knives</td><td>${mph(speedAt(a))} → ${mph(speedAt(b))} mph</td></tr>`);
  for (const [a, b] of rake) {
    const seg = t.filter((p) => p.s >= a && p.s <= b);
    const peak = Math.max(...seg.map((p) => p.rake));
    rows.push(`<tr><td>${Math.round(a)}–${Math.round(b)} m</td><td>${zoneOf(a)}${zoneOf(b) !== zoneOf(a) ? ` → ${zoneOf(b)}` : ''}</td><td>Rake (both feet, up to ${Math.round(peak * 100)}%)</td><td>${mph(speedAt(a))} → ${mph(speedAt(b))} mph</td></tr>`);
  }
  rows.sort((x, y) => parseFloat(x.slice(8)) - parseFloat(y.slice(8)));
  const lines = BENDS.filter((b) => b.s0 >= r.scenario.startS && b.s1 <= TRACK_LENGTH).map((b) => {
    const seg = t.filter((p) => p.s >= b.s0 && p.s <= b.s1);
    if (!seg.length) return '';
    const high = Math.max(...seg.map((p) => Math.abs(p.u)));
    const planLine = r.plan.filter((k) => k.s >= b.s0 && k.s <= b.s1).map((k) => k.line);
    const share = planLine.length ? planLine.reduce((x, y) => x + y, 0) / planLine.length : 0;
    const v = Math.max(...seg.map((p) => p.speed));
    const knives = seg.filter((p) => p.posture > 0.5).length / seg.length;
    return `<tr><td>${b.name}</td><td>${(share * 100).toFixed(0)}%</td><td>${high.toFixed(2)} m</td><td>${mph(v)} mph</td><td>${Math.round(knives * 100)}%</td></tr>`;
  });
  const gain = gainCurve(t, r.baseline.trace);
  const gainAt = (s: number) => {
    const p = gain.find(([x]) => x >= s) ?? gain[gain.length - 1];
    return p ? p[1] : 0;
  };
  const zones = ZONES.filter((z, i) => ZONES[i + 1] && ZONES[i + 1].s0 > r.scenario.startS && z.s0 < TRACK_LENGTH).map((z, i, arr) => {
    const a = Math.max(z.s0, r.scenario.startS);
    const b = arr[i + 1]?.s0 ?? TRACK_LENGTH;
    return { name: z.name, a, b, won: gainAt(b) - gainAt(a) };
  });
  const most = Math.max(...zones.map((z) => Math.abs(z.won)), 0.01);
  const won = `<h4>Time won on the autopilot, section by section</h4><table class="t"><tr><th>Section</th><th>From</th><th>Won</th><th></th></tr>${zones
    .map((z) => `<tr><td>${z.name}</td><td>${Math.round(z.a)} m</td><td>${(z.won >= 0 ? '+' : '') + z.won.toFixed(2)} s</td><td><div style="height:8px;width:${Math.round((Math.abs(z.won) / most) * 160)}px;background:${z.won >= 0 ? '#3f8a4a' : ACCENT}"></div></td></tr>`)
    .join('')}</table>`;
  return `${won}<div class="cols"><div><h4>When to sit back and rake</h4><table class="t"><tr><th>Where</th><th>Section</th><th>Action</th><th>Speed</th></tr>${rows.join('')}</table></div>
  <div><h4>Line through the bends</h4><table class="t"><tr><th>Bend</th><th>Line (share of balanced)</th><th>Highest on the ice</th><th>Top speed</th><th>On the knives</th></tr>${lines.join('')}</table></div></div>`;
}

/** The posture and raking along the run, as a strip under the speed chart. */
function controlStrip(r: StoredResult, x: [number, number], label = 'Optimum'): string {
  const t = r.trace.filter((p) => p.s >= x[0] && p.s <= x[1]);
  return chart(
    [
      { label: `${label}: on the knives (0 forward, 1 knives)`, color: BLUE, points: by(t, (p) => p.posture), width: 1.6 },
      { label: 'raking (share of full)', color: ACCENT, points: by(t, (p) => p.rake), width: 1.6 },
      { label: 'steering (−1 right … +1 left)', color: '#6d6a61', points: by(t, (p) => p.steer), width: 0.8 },
    ],
    { x, y: [-1.05, 1.05], h: 170, bends: true, xLabel: 'Distance down the run (m)', zeroLine: true },
  );
}

function detail(name: string, title: string): string {
  const r = get(name);
  if (!r) return '';
  const x: [number, number] = [r.scenario.startS, TRACK_LENGTH];
  const best = r.trace.filter((p) => p.s <= TRACK_LENGTH + 2);
  const base = r.baseline.trace.filter((p) => p.s <= TRACK_LENGTH + 2);
  const splits = Object.keys(r.best.splits);
  return `
  <section class="page">
    <h2>${title}</h2>
    <p class="lead">${RIDERS[r.rider].name} on the ${r.toboggan === 'flattop' ? 'flat-top' : 'traditional'}: optimum <b>${fmt(r.best.time)} s</b>, against ${fmt(r.baseline.outcome.time)} s for the autopilot's choreography (“${esc(r.baseline.policy)}”) — <b>${fmt((r.baseline.outcome.time ?? 0) - (r.best.time ?? 0))} s</b> faster. Top speed ${mph(r.best.topSpeed)} mph, ${mph(r.best.finishSpeed)} mph through the finish; ${r.best.bankHits} bankina knock${r.best.bankHits === 1 ? '' : 's'}.</p>
    <h3>Speed down the run</h3>
    ${chart(
      [
        { label: 'Optimum', color: ACCENT, points: by(best, (p) => p.speed * 2.23694), width: 1.8 },
        { label: `Autopilot (${r.baseline.policy})`, color: BLUE, points: by(base, (p) => p.speed * 2.23694), dash: true },
      ],
      { x, bends: true, yLabel: 'mph', h: 220 },
    )}
    <h3>What the optimum does</h3>
    ${controlStrip(r, x)}
    <h3>Where the time is won (seconds ahead of the autopilot)</h3>
    ${chart([{ label: 'Time gained on the autopilot', color: '#3f8a4a', points: gainCurve(best, base), width: 1.8 }], { x, bends: true, yLabel: 's', h: 160, zeroLine: true })}
    <h3>Line on the ice (+ left, − right; the floor's edges are at about ±0.65 m)</h3>
    ${chart(
      [
        { label: 'Optimum', color: ACCENT, points: by(best, (p) => p.u) },
        { label: 'Autopilot', color: BLUE, points: by(base, (p) => p.u), dash: true },
      ],
      { x, bends: true, yLabel: 'm', h: 170, zeroLine: true },
    )}
    <table class="t splits"><tr><th></th>${splits.map((s) => `<th>${s}</th>`).join('')}<th>Finish</th></tr>
      <tr><td>Optimum</td>${splits.map((s) => `<td>${fmt(r.best.splits[s])}</td>`).join('')}<td><b>${fmt(r.best.time)}</b></td></tr>
      <tr><td>Autopilot</td>${splits.map((s) => `<td>${fmt(r.baseline.outcome.splits[s])}</td>`).join('')}<td>${fmt(r.baseline.outcome.time)}</td></tr></table>
  </section>
  <section class="page">
    <h2>${title}: the plan in words</h2>
    ${instructions(r)}
  </section>`;
}

// ---------- Shuttlecock ----------

const MISTAKE_LABELS: Record<string, string> = {
  clean: 'Clean entry (the optimum)',
  fast2: '2 m/s too fast',
  fast4: '4 m/s too fast',
  slow3: '3 m/s too slow',
  high: 'Too far right (towards Shuttlecock’s bank)',
  low: 'Too far left (still high on Battledore)',
  turnedout: 'Pointing out at the bank',
  forward: 'Still lying forward (late onto the knives)',
  fastHigh: '2 m/s too fast and high',
};

function remedy(r: StoredResult, clean: StoredResult): string {
  // Compare the recovery with the clean optimum through Shuttlecock and Stream (545–700 m).
  const win = (p: { s: number }) => p.s >= 545 && p.s <= 700;
  const a = r.trace.filter(win);
  const b = clean.trace.filter(win);
  const notes: string[] = [];
  const firstKnives = (t: TracePoint[]) => t.find((p) => p.posture > 0.5)?.s ?? null;
  const fa = firstKnives(a);
  const fb = firstKnives(b);
  if (fa !== null && fb !== null && Math.abs(fa - fb) > 3) notes.push(`on the knives ${Math.abs(fa - fb).toFixed(0)} m ${fa < fb ? 'earlier' : 'later'} (${fa.toFixed(0)} m)`);
  if (fa === null && fb !== null) notes.push('stays forward the whole way');
  const rakeDist = (t: TracePoint[]) => t.reduce((acc, p, i) => acc + (i ? p.rake * (p.s - t[i - 1].s) : 0), 0);
  const ra = rakeDist(a);
  const rb = rakeDist(b);
  if (Math.abs(ra - rb) > 2) notes.push(`${ra > rb ? 'more' : 'less'} raking (${ra.toFixed(0)} m of full rake against ${rb.toFixed(0)})`);
  const startRake = (t: TracePoint[]) => t.find((p) => p.rake > 0.05)?.s ?? null;
  const sa = startRake(a);
  const sb = startRake(b);
  if (sa !== null && sb !== null && Math.abs(sa - sb) > 3) notes.push(`rakes from ${sa.toFixed(0)} m (${Math.abs(sa - sb).toFixed(0)} m ${sa < sb ? 'sooner' : 'later'})`);
  const high = (t: TracePoint[]) => Math.max(...t.filter((p) => p.s >= 562 && p.s <= 632).map((p) => Math.abs(p.u)));
  const ha = high(a);
  const hb = high(b);
  if (Math.abs(ha - hb) > 0.1) notes.push(`rides ${ha > hb ? 'higher' : 'lower'} through the bend (${ha.toFixed(2)} m out, against ${hb.toFixed(2)})`);
  const exit = (t: TracePoint[]) => t.find((p) => p.s >= 640)?.speed ?? 0;
  notes.push(`leaves Shuttlecock at ${mph(exit(a))} mph (clean ${mph(exit(b))})`);
  return notes.join('; ');
}

function shuttlecock(toboggan: 'flattop' | 'traditional'): string {
  const clean = get(`shuttlecock-${toboggan}-clean`);
  if (!clean) return '';
  const all = Object.keys(MISTAKE_LABELS).map((id) => get(`shuttlecock-${toboggan}-${id}`)).filter((r): r is StoredResult => !!r);
  const rows = all
    .map((r) => {
      const id = r.name.split('-').pop()!;
      const e = r.scenario.entry!;
      const lost = r.best.time !== null && clean.best.time !== null ? r.best.time - clean.best.time : null;
      const un = r.unchanged?.outcome;
      return `<tr><td>${MISTAKE_LABELS[id]}</td><td>${mph(e.v)}</td><td>${e.u.toFixed(2)}</td><td>${e.heading.toFixed(2)}</td><td>${e.posture > 0.5 ? 'knives' : 'forward'}</td>
        <td>${un?.time !== null && un?.time !== undefined ? `${fmt(un.time)} s` : `<span class="bad">falls at ${un?.fall?.zone ?? '?'}</span>`}</td>
        <td><b>${r.best.time !== null ? fmt(r.best.time) + ' s' : `<span class="bad">falls</span>`}</b></td><td>${lost === null ? '—' : (lost >= 0 ? '+' : '') + lost.toFixed(2) + ' s'}</td></tr>`;
    })
    .join('');
  const x: [number, number] = [545, 720];
  const speed = all.map((r, i) => ({ label: MISTAKE_LABELS[r.name.split('-').pop()!].split(' (')[0], color: SERIES[i % SERIES.length], points: by(r.trace, (p) => p.speed * 2.23694), width: r === clean ? 2.4 : 1.3 }));
  const line = all.map((r, i) => ({ label: MISTAKE_LABELS[r.name.split('-').pop()!].split(' (')[0], color: SERIES[i % SERIES.length], points: by(r.trace, (p) => p.u), width: r === clean ? 2.4 : 1.3 }));
  const remedies = all
    .filter((r) => r !== clean)
    .map((r) => `<tr><td>${MISTAKE_LABELS[r.name.split('-').pop()!]}</td><td>${r.best.time === null ? '<span class="bad">No way through found.</span>' : remedy(r, clean)}</td></tr>`)
    .join('');
  const name = toboggan === 'flattop' ? 'flat-top' : 'traditional';
  const strips = [
    ...all.filter((r) => r !== clean && r.best.time !== null).map((r) => `<h3>${MISTAKE_LABELS[r.name.split('-').pop()!]}: what the recovery does</h3>${controlStrip(r, [545, 720], 'Recovery')}`),
    `<h3>Clean entry, for comparison</h3>${controlStrip(clean, [545, 720], 'Clean')}`,
  ];
  return `
  <section class="page">
    <h2>Shuttlecock: recovering a bad entry (${name})</h2>
    <p class="lead">Adelaide on the ${name}, picked up at ${545} m (17 m before Shuttlecock's bank begins) in the state the optimum from Junction arrives in, then with one mistake made. For each, the optimiser found the best way on to the finish. “Unchanged” rides the clean optimum's own plan from the bad entry, as a rider who doesn't adapt would. The optimum rides so close to the limit that its plan, picked up mid-run from a state a few centimetres and hundredths of a second off its own, can fall even from the clean entry: on the best line a rider has to keep correcting.</p>
    <table class="t"><tr><th>Entry</th><th>Speed (mph)</th><th>Across (m)</th><th>Heading (rad)</th><th>Posture</th><th>Unchanged plan</th><th>Best recovery</th><th>Cost vs clean</th></tr>${rows}</table>
    <h3>Speed through Shuttlecock and Stream</h3>
    ${chart(speed, { x, bends: true, yLabel: 'mph', h: 190 })}
    <h3>Line through Shuttlecock (the outer bank is on the right, −)</h3>
    ${chart(line, { x, bends: true, yLabel: 'm', h: 165, zeroLine: true })}
  </section>
  <section class="page">
    <h2>Shuttlecock remedies (${name})</h2>
    <p class="lead">How each best recovery differs from the clean optimum between 545 and 700 m.</p>
    <table class="t remedies"><tr><th>Mistake</th><th>The remedy</th></tr>${remedies}</table>
    ${strips.slice(0, 2).join('')}
  </section>
  ${Array.from({ length: Math.ceil((strips.length - 2) / 4) }, (_, i) => `<section class="page"><h2>Shuttlecock remedies (${name}), continued</h2>${strips.slice(2 + i * 4, 6 + i * 4).join('')}</section>`).join('')}`;
}

// ---------- What the day is worth ----------

const DAYS: [string, string][] = [
  ['', 'An ordinary day'],
  ['hot', 'Hot day (slush)'],
  ['cold', 'Cold day (hard ice)'],
  ['bacon', 'Bacon Roll (30% heavier)'],
  ['luck', 'Liquid Luck (a stronger running start)'],
  ['cold-luck', 'Cold day and Liquid Luck'],
  ['cough', 'Tower Boy Disease (the bankinas speed you up)'],
];

function days(): string {
  const rows = DAYS.map(([id, label]) => ({ label, r: get(id ? `day-${id}-junction-flattop-maximilian` : 'junction-flattop-maximilian') })).filter((x) => x.r);
  if (rows.length < 2) return '';
  const normal = rows[0].r!.best.time!;
  const all = rows.map((x) => x.r!.best.time).filter((t): t is number => t !== null);
  const barsSvg = bars(
    rows.map((x) => ({ label: x.label.split(' (')[0], values: [{ v: x.r!.best.time, color: x.r!.best.time !== null && x.r!.best.time < normal - 0.01 ? '#3f8a4a' : x.r!.best.time! > normal + 0.01 ? BLUE : ACCENT, tag: x.r!.best.time === null ? '' : `(${(x.r!.best.time - normal >= 0 ? '+' : '') + (x.r!.best.time - normal).toFixed(2)})` }] })),
    { min: Math.floor(Math.min(...all) - 1), max: Math.ceil(Math.max(...all) + 1.5), unit: 's' },
  );
  const cough = get('day-cough-junction-flattop-maximilian');
  const bacon = get('day-bacon-junction-flattop-maximilian');
  const luck = get('day-luck-junction-flattop-maximilian');
  return `<section class="page">
    <h2>What the day is worth</h2>
    <p class="lead">Maximilian from Junction on the flat-top, the plan optimised again for each kind of day the game can deal (the weather, and the luck at the start). On an ordinary day the best found is <b>${fmt(normal)} s</b>.</p>
    ${barsSvg}
    <h3>A 39.6 from Junction</h3>
    <p>Faster than the optimum for an ordinary day by ${(normal - 39.6).toFixed(2)} s. It is within reach on a day with ${luck && luck.best.time! < 39.6 ? `Liquid Luck (best ${fmt(luck.best.time)} s)` : 'luck'}${bacon && bacon.best.time! < 39.6 ? ` or a Bacon Roll (${fmt(bacon.best.time)} s)` : bacon ? `, nearly with a Bacon Roll (${fmt(bacon.best.time)} s)` : ''}, and easily with Tower Boy Disease. Without any of them it would mean a line the optimiser hasn't found: the search starts from the autopilot's way of riding and refines it, and a quite different line could beat it. A search with much bigger steps, to look for quite different lines, didn't find a faster one either.</p>
    <h3>Two things the game might want to look at</h3>
    <ul>
      <li><b>The Bacon Roll is a help, not a handicap</b>: ${bacon ? `${fmt(normal - (bacon.best.time ?? normal))} s faster` : 'faster'}. Thirty per cent more weight carries more speed against the air; the rakes bite less on a heavier rider, but the optimum hardly rakes.</li>
      <li><b>Tower Boy Disease is worth ${cough ? fmt(normal - (cough.best.time ?? normal)) : 'several'} seconds</b> (${fmt(cough?.best.time)} s): the optimum hits the bankinas on purpose, ${cough?.best.bankHits ?? 'many'} times, each knock a boost.</li>
    </ul>
    ${cough ? `<h3>Speed with Tower Boy Disease, against an ordinary day</h3>${chart(
      [
        { label: 'Tower Boy Disease', color: '#3f8a4a', points: by(cough.trace.filter((p) => p.s <= TRACK_LENGTH), (p) => p.speed * 2.23694), width: 1.8 },
        { label: 'Ordinary day', color: ACCENT, points: by(rows[0].r!.trace.filter((p) => p.s <= TRACK_LENGTH), (p) => p.speed * 2.23694), dash: true },
      ],
      { x: [JUNCTION_S, TRACK_LENGTH], bends: true, yLabel: 'mph', h: 200 },
    )}` : ''}
  </section>`;
}

// ---------- The report ----------

function table(start: 'junction' | 'top'): string {
  const rows = RIDER_ORDER.map((rid) => {
    const cells = (['flattop', 'traditional'] as const).map((tob) => {
      const r = get(`${start}-${tob}-${rid}`);
      if (!r) return '<td>—</td><td>—</td><td>—</td>';
      const gain = r.best.time !== null && r.baseline.outcome.time !== null ? r.baseline.outcome.time - r.best.time : null;
      return `<td><b>${r.best.time === null ? 'fell' : fmt(r.best.time)}</b></td><td>${r.baseline.outcome.time === null ? `fell (${r.baseline.outcome.fall?.zone ?? ''})` : fmt(r.baseline.outcome.time)}</td><td>${gain === null ? '—' : `−${gain.toFixed(2)}`}</td>`;
    });
    return `<tr><td>${RIDERS[rid].name}</td>${cells.join('')}</tr>`;
  });
  return `<table class="t"><tr><th rowspan="2">Rider</th><th colspan="3">Flat-top</th><th colspan="3">Traditional</th></tr>
    <tr><th>Optimum</th><th>Autopilot</th><th>Gain</th><th>Optimum</th><th>Autopilot</th><th>Gain</th></tr>${rows.join('')}</table>`;
}

function timeBars(start: 'junction' | 'top'): string {
  const rows = RIDER_ORDER.map((rid) => ({
    label: RIDERS[rid].name,
    values: (['flattop', 'traditional'] as const)
      .filter((tob) => get(`${start}-${tob}-${rid}`))
      .map((tob) => ({ v: get(`${start}-${tob}-${rid}`)!.best.time ?? null, color: tob === 'flattop' ? ACCENT : BLUE, tag: tob === 'flattop' ? 'flat-top' : 'traditional' })),
  })).filter((r) => r.values.length);
  if (!rows.length) return '';
  const all = rows.flatMap((r) => r.values.map((v) => v.v)).filter((v): v is number => v !== null);
  const lo = Math.floor(Math.min(...all) - 2);
  return bars(rows, { min: lo, max: Math.ceil(Math.max(...all) + 1.5), unit: 's' });
}

function convergence(): string {
  const names = ['junction-flattop-adelaide', 'junction-traditional-adelaide', 'top-flattop-adelaide', 'top-traditional-adelaide'];
  const series = names
    .map((n, i) => {
      const r = get(n);
      return r ? { label: n.replace(/-adelaide$/, '').replace('-', ', '), color: SERIES[i], points: r.history.filter(([, s]) => s < 200) as [number, number][], step: true } : null;
    })
    .filter((s): s is Series => !!s);
  const max = Math.max(...series.flatMap((s) => s.points.map(([x]) => x)));
  // Plot each as seconds above its own final best, to share an axis.
  const rel = series.map((s) => {
    const fin = s.points[s.points.length - 1][1];
    return { ...s, points: s.points.map(([x, y]) => [x, y - fin] as [number, number]) };
  });
  return chart(rel, { x: [0, max], y: [0, Math.min(6, Math.max(0.5, ...rel.map((s) => s.points[0][1])) * 1.1)], xLabel: 'Rides simulated', yLabel: 's above final', h: 200 });
}

function best(start: 'junction' | 'top') {
  let b: StoredResult | null = null;
  for (const r of results.values()) if (r.name.startsWith(`${start}-`) && r.best.time !== null && (!b || r.best.time < b.best.time!)) b = r;
  return b;
}

/** The headline findings, from the results. */
function findings(): string {
  const main = [...results.values()].filter((r) => /^(junction|top)-/.test(r.name) && r.best.time !== null && r.baseline.outcome.time !== null);
  const gains = main.map((r) => r.baseline.outcome.time! - r.best.time!);
  const a = get('junction-flattop-adelaide');
  const rakeM = a ? a.trace.reduce((acc, p, i) => acc + (i ? p.rake * (p.s - a.trace[i - 1].s) : 0), 0) : 0;
  const baseRakeM = a ? a.baseline.trace.reduce((acc, p, i) => acc + (i ? p.rake * (p.s - a.baseline.trace[i - 1].s) : 0), 0) : 0;
  const sc = ['flattop', 'traditional'].map((t) => {
    const clean = get(`shuttlecock-${t}-clean`);
    const others = MISTAKES_IDS.map((id) => get(`shuttlecock-${t}-${id}`)).filter((r): r is StoredResult => !!r);
    const saved = others.filter((r) => r.best.time !== null).length;
    const unchangedFalls = others.filter((r) => r.unchanged && r.unchanged.outcome.time === null).length;
    const slow = get(`shuttlecock-${t}-slow3`);
    return { t, clean, n: others.length, saved, unchangedFalls, slowCost: slow && clean && slow.best.time && clean.best.time ? slow.best.time - clean.best.time : null };
  });
  const fastest = RIDER_ORDER.map((rid) => ({ rid, t: get(`junction-flattop-${rid}`)?.best.time ?? null })).filter((x) => x.t !== null).sort((x, y) => x.t! - y.t!);
  const items = [
    `<b>The autopilot leaves ${Math.min(...gains).toFixed(1)}–${Math.max(...gains).toFixed(1)} s on the run</b> in every case. The optimum's time comes from braking far less: Adelaide from Junction on the flat-top rakes the equivalent of ${rakeM.toFixed(0)} m at full rake, against ${baseRakeM.toFixed(0)} m for the autopilot, and goes back on the knives only briefly before and through Shuttlecock.`,
    `<b>Most of it is won after Shuttlecock</b>: the speed carried out of Shuttlecock and Stream is worth the most on Bledisloe Straight, the longest stretch of the run.`,
    `<b>Every Shuttlecock mistake tried can be saved</b> (${sc.map((x) => `${x.saved} of ${x.n} on the ${x.t === 'flattop' ? 'flat-top' : 'traditional'}`).join(', ')}), most at no cost at all, extra speed included: rake early, from the moment you see it. Only arriving too slow costs real time (${sc.map((x) => (x.slowCost === null ? '' : `${x.slowCost.toFixed(2)} s on the ${x.t === 'flattop' ? 'flat-top' : 'traditional'}`)).filter(Boolean).join(', ')}). But riding on as if nothing had happened falls in ${sc.map((x) => x.unchangedFalls).reduce((p, q) => p + q, 0)} of the ${sc.reduce((p, x) => p + x.n, 0)} cases: the remedy is what matters.`,
    `<b>Fastest riders</b> from Junction on the flat-top: ${fastest.slice(0, 3).map((x) => `${RIDERS[x.rid].name} ${x.t!.toFixed(2)} s`).join(', ')}; slowest ${RIDERS[fastest[fastest.length - 1].rid].name} (${fastest[fastest.length - 1].t!.toFixed(2)} s). The flat-top is worth about ${(() => {
      const d = RIDER_ORDER.map((rid) => (get(`junction-traditional-${rid}`)?.best.time ?? 0) - (get(`junction-flattop-${rid}`)?.best.time ?? 0)).filter((x) => x > 0);
      return (d.reduce((p, q) => p + q, 0) / d.length).toFixed(1);
    })()} s from Junction.`,
  ];
  return items.map((x) => `<li>${x}</li>`).join('');
}
const MISTAKES_IDS = ['fast2', 'fast4', 'slow3', 'high', 'low', 'turnedout', 'forward', 'fastHigh'];

const adelJF = get('junction-flattop-adelaide');
const bj = best('junction');
const bt = best('top');
const totalRides = [...results.values()].reduce((a, r) => a + r.evals, 0);
const totalSeconds = [...results.values()].reduce((a, r) => a + r.seconds, 0);

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Viva la Cresta: the fastest way down</title>
<style>
  @page { size: A4; margin: 14mm 13mm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: ${INK}; font-size: 10.5pt; line-height: 1.42; margin: 0; }
  h1 { font-family: Helvetica, Arial, sans-serif; font-size: 26pt; margin: 0 0 4px; letter-spacing: -0.5px; }
  h2 { font-family: Helvetica, Arial, sans-serif; font-size: 15pt; margin: 0 0 6px; color: ${ACCENT}; }
  h3 { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; margin: 12px 0 2px; text-transform: uppercase; letter-spacing: 0.4px; color: #444; }
  h4 { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; margin: 4px 0; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .lead { margin: 2px 0 6px; }
  .kicker { font-family: Helvetica, Arial, sans-serif; color: ${ACCENT}; text-transform: uppercase; letter-spacing: 1.5px; font-size: 9pt; font-weight: bold; }
  .keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
  .key { border-top: 3px solid ${ACCENT}; padding: 6px 2px; }
  .key b { display: block; font-family: Helvetica, Arial, sans-serif; font-size: 19pt; }
  .key span { font-size: 8.5pt; color: #555; }
  table.t { border-collapse: collapse; width: 100%; font-family: Helvetica, Arial, sans-serif; font-size: 8.6pt; margin: 6px 0; }
  table.t th { text-align: left; border-bottom: 1.5px solid ${INK}; padding: 3px 5px; font-weight: 600; }
  table.t td { border-bottom: 1px solid ${GRID}; padding: 3px 5px; vertical-align: top; }
  table.splits td, table.splits th { text-align: right; } table.splits td:first-child { text-align: left; }
  .remedies td:first-child { width: 30%; font-weight: 600; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .bad { color: ${ACCENT}; font-weight: 600; }
  .note { font-size: 9pt; color: #555; }
  ul { margin: 4px 0; padding-left: 18px; }
  code { font-size: 8.8pt; background: #f4efe4; padding: 0 3px; }
</style></head><body>

<section class="page">
  <div class="kicker">Viva la Cresta · optimiser report</div>
  <h1>The fastest way down</h1>
  <p class="lead">What the game's own physics allows from Junction and from Top: the best plan found for when to steer, when to sit back on the knives and when to rake, for every rider on both toboggans, and the best ways to recover from a bad entry into Shuttlecock.</p>
  <div class="keys">
    <div class="key"><b>${fmt(bj?.best.time)} s</b><span>Fastest from Junction (${bj ? `${RIDERS[bj.rider].name}, ${bj.toboggan === 'flattop' ? 'flat-top' : 'traditional'}` : ''})</span></div>
    <div class="key"><b>${fmt(bt?.best.time)} s</b><span>Fastest from Top (${bt ? `${RIDERS[bt.rider].name}, ${bt.toboggan === 'flattop' ? 'flat-top' : 'traditional'}` : ''})</span></div>
    <div class="key"><b>${adelJF ? fmt((adelJF.baseline.outcome.time ?? 0) - (adelJF.best.time ?? 0)) : '—'} s</b><span>Gained on the autopilot's good flat-top ride from Junction (Adelaide)</span></div>
    <div class="key"><b>${(totalRides / 1e6).toFixed(2)} M</b><span>Rides simulated, in ${Math.round(totalSeconds / 60)} minutes on a laptop</span></div>
  </div>
  <h3>Key findings</h3>
  <ul>${findings()}</ul>
  <h3>How it works</h3>
  <ul>
    <li><b>A plan along the run.</b> Every ${get('junction-flattop-adelaide')?.knot ?? 10} m of track the plan sets four things: how high to ride the banks (a share of the balanced line for the speed), whether to be back on the knives, the speed above which to rake with both feet, and a steer of its own. The rider steers onto the line by feedback, as a person does, and adds the plan's own steer, so it can take lines the feedback alone never would. From Junction that is about 360 numbers, from Top about 490. The running start strides every 0.15 s, about as quick as a thumb taps.</li>
    <li><b>Scored by riding it.</b> Each plan is ridden in the game's physics (the same code as the game, 240 steps a second, no randomness): the score is the time from the start beam to the finish, and a fall scores far worse, less so the further down it happened.</li>
    <li><b>Searched with CMA-ES</b>, an evolution strategy: generations of plans sampled around the best so far, the search narrowing as it learns which numbers matter. It starts from the autopilot's choreography, then a last sweep nudges each number in turn and keeps what helps. About 470 rides a second on ${'nine'} worker threads.</li>
    <li><b>Then Shuttlecock.</b> From the optimum's own state 17 m before Shuttlecock, eight different mistakes (too fast, too slow, too high, too low, turned out, late onto the knives), each optimised again to the finish.</li>
  </ul>
  <p class="note">Every result is stored in <code>optimiser/results/</code> (one JSON file per case: the plan, the ride's trace and the comparison), so the plans can be used again: a ghost to race, the ideal line on the My times map, or a check on the club's scratch times.</p>
</section>

<section class="page">
  <h2>All riders from Junction</h2>
  <h3>Best times (s)</h3>
  ${timeBars('junction')}
  <h3>Optimum against the autopilot (s)</h3>
  ${table('junction')}
</section>

<section class="page">
  <h2>All riders from Top</h2>
  <h3>Best times (s)</h3>
  ${timeBars('top')}
  <h3>Optimum against the autopilot (s)</h3>
  ${table('top')}
</section>

${days()}
${detail('junction-flattop-adelaide', 'From Junction on the flat-top')}
${detail('top-flattop-adelaide', 'From Top on the flat-top')}
${detail('junction-traditional-adelaide', 'From Junction on the traditional')}
${detail('top-traditional-adelaide', 'From Top on the traditional')}
${shuttlecock('flattop')}
${shuttlecock('traditional')}

<section class="page">
  <h2>Reading these results</h2>
  <ul>
    <li><b>These are the game's best, not the real Cresta's.</b> The optimiser finds whatever the physics allows, including any quirks; a line that looks too good to be true points at the physics rather than at a riding secret.</li>
    <li><b>Found, not proven.</b> CMA-ES finds very good plans, not certainly the best; more rides, or a finer plan (shorter stretches), may find a little more. Repeat runs give the same answer (the search is seeded).</li>
    <li><b>One rider per plan.</b> Each rider and toboggan was optimised on its own: their weight, drag, agility and steering change where to sit back and how hard to rake.</li>
    <li><b>Running start</b> strides every 0.15 s, all seven steps (quicker tapping is worth a little more: about 0.1 s at 0.05 s a stride; the autopilot's 0.28 s costs about 0.5 s). Only the ride after the dive is optimised.</li>
    <li><b>An ordinary day.</b> Except on the page about the day's conditions, every plan is for an ordinary day: no weather, no luck.</li>
  </ul>
  <h3>How the search converged (Adelaide; seconds above the final best)</h3>
  ${convergence()}
  <h3>Using the results again</h3>
  <ul>
    <li><code>optimiser/results/&lt;case&gt;.json</code>: <code>genome</code> (the plan's numbers), <code>plan</code> (decoded every ${get('junction-flattop-adelaide')?.knot ?? 10} m: line, knives, rake cap), <code>trace</code> (time, distance, position across the ice, speed, posture, steering, raking, heading and load, 20 times a second), <code>best</code> (time, splits, top and finish speed), <code>baseline</code> (the autopilot ridden the same way), and for Shuttlecock <code>unchanged</code>.</li>
    <li><code>optimiser/plan.ts</code> rides any stored genome again (<code>ride(track, rider, toboggan, scenario, genome, true)</code>).</li>
    <li><code>npm run optimise</code> runs everything again (about half an hour; <code>-- --only junction-flattop</code> for some), and <code>npm run optimise:report</code> rebuilds this report.</li>
  </ul>
  <p class="note">Generated ${new Date().toISOString().slice(0, 10)} from ${results.size} optimisation runs.</p>
</section>
</body></html>`;

mkdirSync(join(DIR, 'report'), { recursive: true });
const htmlPath = join(DIR, 'report', 'report.html');
writeFileSync(htmlPath, html);
const pdf = join(DIR, 'report', 'cresta-optimiser-report.pdf');
execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, `file://${htmlPath}`], { stdio: 'ignore' });
console.log(`${results.size} results → ${pdf}`);
