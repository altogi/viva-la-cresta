// The game's music, written for it and synthesised as it plays (scheduled a little ahead, looping):
//   "Shuttlecock" - the menus: a fast, driving rock track in E minor, pounding kick and snare, a
//                   pumping bass, distorted power chords, a synth arpeggio, a rising build into a
//                   chorus with a soaring lead hook;
//   "Straw"       - a fall: an impact (crash, a low boom, a chord left ringing), then a heavy
//                   half-time lament in D minor down Dm-C-Bb-A, the lead falling away to nothing:
//                   the thrill of the ride and the frustration of not reaching Celerina.

const BAR = 16; // sixteenths

type Chord = { root: number; tones: number[] };
const C: Record<string, Chord> = {
  Em: { root: 40, tones: [64, 67, 71, 76] },
  C: { root: 36, tones: [60, 64, 67, 72] },
  G: { root: 43, tones: [62, 67, 71, 74] },
  D: { root: 38, tones: [62, 66, 69, 74] },
  Am: { root: 45, tones: [64, 69, 72, 76] },
  B: { root: 47, tones: [63, 66, 71, 75] },
  Dm: { root: 38, tones: [62, 65, 69, 74] },
  Bb: { root: 34, tones: [58, 62, 65, 70] },
  A: { root: 33, tones: [57, 61, 64, 69] },
};

/** Lead notes: [midi or 0 for a rest, length in eighths]. One bar per line. */
type Line = [number, number][];
const HOOK: Line[] = [
  [[76, 2], [79, 2], [81, 2], [79, 1], [76, 1]],
  [[78, 2], [81, 2], [83, 3], [81, 1]],
  [[79, 2], [78, 2], [76, 4]],
  [[0, 2], [71, 1], [74, 1], [76, 2], [79, 2]],
  [[76, 2], [79, 2], [84, 2], [83, 1], [81, 1]],
  [[83, 3], [81, 1], [78, 4]],
  [[79, 2], [76, 2], [83, 4]],
  [[81, 4], [78, 2], [75, 2]],
];
/** A counter-riff over the second half of the verse. */
const RIFF: Line = [[76, 1], [76, 1], [79, 1], [76, 1], [81, 1], [76, 1], [83, 1], [81, 1]];

type Part = 'intro' | 'verse' | 'build' | 'chorus' | 'break' | 'impact' | 'lament';
interface Bar {
  chord: string;
  part: Part;
  lead: Line | null;
  /** A crash on the first beat. */
  crash: boolean;
}

const bars = (part: Part, chords: string[], lead?: (i: number) => Line | null, crash = true): Bar[] =>
  chords.map((chord, i) => ({ chord, part, lead: lead ? lead(i) : null, crash: crash && i === 0 }));

const SHUTTLECOCK: Bar[] = [
  ...bars('intro', ['Em', 'Em', 'C', 'D'], undefined, false),
  ...bars('verse', ['Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D'], (i) => (i >= 4 ? RIFF : null)),
  ...bars('build', ['Am', 'C', 'D', 'B']),
  ...bars('chorus', ['C', 'D', 'Em', 'Em', 'C', 'D', 'Em', 'D'], (i) => HOOK[i]),
  ...bars('break', ['Em', 'C', 'G', 'D']),
  ...bars('chorus', ['C', 'D', 'Em', 'Em', 'C', 'D', 'Em', 'B'], (i) => HOOK[i]),
];
/** The lament's lead: rising hope in each first bar, sinking away in the rest. */
const LAMENT: Line[] = [
  [[74, 3], [72, 1], [74, 2], [77, 2]],
  [[76, 3], [74, 1], [72, 4]],
  [[74, 2], [72, 2], [70, 2], [69, 2]],
  [[69, 4], [73, 2], [76, 2]],
  [[77, 3], [76, 1], [74, 2], [72, 2]],
  [[72, 2], [74, 2], [76, 4]],
  [[77, 2], [76, 2], [74, 2], [70, 2]],
  [[69, 6], [0, 2]],
];

const STRAW: Bar[] = [
  { chord: 'Dm', part: 'impact', lead: null, crash: true },
  ...bars('lament', ['Dm', 'C', 'Bb', 'A', 'Dm', 'C', 'Bb', 'A'], (i) => LAMENT[i]),
];

export type SongName = 'shuttlecock' | 'straw';
/** Tempo, the bars, and where each starts and goes round again (Shuttlecock skips its soft intro). */
const SONGS: Record<SongName, { bpm: number; bars: Bar[]; start: number; loop: number; level: number }> = {
  shuttlecock: { bpm: 144, bars: SHUTTLECOCK, start: 4, loop: 4, level: 0.42 },
  straw: { bpm: 92, bars: STRAW, start: 0, loop: 1, level: 0.46 },
};

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class Music {
  private out: GainNode | null = null;
  private wet: ConvolverNode | null = null;
  private delay: DelayNode | null = null;
  private drive: WaveShaperNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: number | null = null;
  private bar = 0;
  private song: SongName = 'shuttlecock';
  /** A sixteenth at this song's tempo (s). */
  private step = 60 / 144 / 4;
  private nextBarAt = 0;
  private playing = false;

  constructor(private readonly context: () => { ctx: AudioContext; destination: AudioNode } | null) {}

  /** Play a song from its start (or keep playing it if it's already on). */
  play(song: SongName = 'shuttlecock') {
    const c = this.context();
    if (!c) return;
    const { ctx } = c;
    if (!this.out) this.build(ctx, c.destination);
    if (this.playing && this.song === song) return;
    if (this.song !== song || !this.playing) {
      this.song = song;
      this.step = 60 / SONGS[song].bpm / 4;
      this.delay!.delayTime.setValueAtTime(this.step * 3, ctx.currentTime);
      this.bar = SONGS[song].start;
      this.nextBarAt = ctx.currentTime + 0.02;
    }
    this.playing = true;
    this.out!.gain.cancelScheduledValues(ctx.currentTime);
    this.out!.gain.setTargetAtTime(SONGS[song].level, ctx.currentTime, 0.05);
    if (this.timer === null) {
      this.nextBarAt = Math.max(this.nextBarAt, ctx.currentTime + 0.02);
      this.timer = window.setInterval(() => this.schedule(), 100);
    }
  }

  /** Fade out and stop. */
  stop() {
    if (!this.playing) return;
    this.playing = false;
    const c = this.context();
    if (!c || !this.out) return;
    this.out.gain.setTargetAtTime(0, c.ctx.currentTime, 0.4);
    window.setTimeout(() => {
      if (this.playing || this.timer === null) return;
      window.clearInterval(this.timer);
      this.timer = null;
      this.bar = SONGS[this.song].start; // from its start next time
    }, 2500);
  }

  private build(ctx: AudioContext, destination: AudioNode) {
    // A bus compressor glues it together and keeps it loud.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.ratio.value = 4;
    glue.attack.value = 0.005;
    glue.release.value = 0.12;
    glue.connect(destination);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(glue);
    // A short room reverb.
    const len = Math.floor(ctx.sampleRate * 1.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    }
    this.wet = ctx.createConvolver();
    this.wet.buffer = ir;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.22;
    this.wet.connect(wetGain).connect(this.out);
    // A dotted-eighth echo for the arpeggio and the lead.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = this.step * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.3;
    this.delay.connect(feedback).connect(this.delay);
    this.delay.connect(delayOut).connect(this.out);
    // Overdrive for the guitars, through a speaker-cabinet filter.
    this.drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 6) * 0.8;
    }
    this.drive.curve = curve;
    this.drive.oversample = '2x';
    const cab = ctx.createBiquadFilter();
    cab.type = 'lowpass';
    cab.frequency.value = 3800;
    const guitar = ctx.createGain();
    guitar.gain.value = 0.32;
    this.drive.connect(cab).connect(guitar);
    guitar.connect(this.out);
    guitar.connect(this.wet);
    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = n.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = n;
  }

  /** Schedule every bar that starts within the next half second. */
  private schedule() {
    const c = this.context();
    if (!c || !this.out) return;
    const { ctx } = c;
    if (this.nextBarAt < ctx.currentTime - 0.5) this.nextBarAt = ctx.currentTime + 0.05; // after a suspend
    while (this.nextBarAt < ctx.currentTime + 0.5) {
      const song = SONGS[this.song];
      this.playBar(ctx, song.bars[this.bar], this.nextBarAt);
      this.bar++;
      if (this.bar >= song.bars.length) this.bar = song.loop;
      this.nextBarAt += BAR * this.step;
    }
  }

  private playBar(ctx: AudioContext, bar: Bar, t: number) {
    const chord = C[bar.chord];
    const at = (step: number) => t + step * this.step;
    const { part } = bar;
    if (part === 'impact' || part === 'lament') return this.strawBar(ctx, bar, t);
    // Drums: four on the floor in the intro and break, a rock beat with the backbeat elsewhere.
    if (bar.crash) this.crash(ctx, t);
    if (part === 'intro' || part === 'break') {
      for (let s = 0; s < 16; s += 4) this.kick(ctx, at(s));
      for (let s = 0; s < 16; s += 2) this.hat(ctx, at(s), s % 4 === 2 ? 0.09 : 0.05);
    } else {
      for (const s of [0, 6, 8, 11]) this.kick(ctx, at(s));
      this.snare(ctx, at(4));
      this.snare(ctx, at(12));
      for (let s = 0; s < 16; s += 2) this.hat(ctx, at(s), s === 14 ? 0.12 : 0.06, s === 14);
      // The snare rolls through the build.
      if (part === 'build') for (let s = 1; s < 16; s += 2) this.snare(ctx, at(s), 0.35);
    }
    if (part === 'build') this.riser(ctx, t, BAR * this.step);
    // Bass: pumping eighths, jumping the octave in the chorus.
    if (part !== 'intro') {
      for (let s = 0; s < 16; s += 2) this.bass(ctx, chord.root + (part === 'chorus' && s % 4 === 2 ? 12 : 0), at(s), this.step * 1.7);
    }
    // Guitars: palm-muted chugs in the verse and build, chords ringing out in the chorus.
    if (part === 'verse' || part === 'build') {
      for (let s = 0; s < 16; s += 2) this.power(ctx, chord.root + 12, at(s), this.step * 1.2, s % 8 === 0 ? 1 : 0.7);
    } else if (part === 'chorus') {
      this.power(ctx, chord.root + 12, at(0), this.step * 7.5, 1);
      this.power(ctx, chord.root + 12, at(8), this.step * 5.5, 0.9);
      this.power(ctx, chord.root + 12, at(14), this.step * 1.5, 0.8);
    }
    // The arpeggio: sixteenths up and down the chord, swelling through the intro.
    if (part !== 'verse') {
      for (let s = 0; s < 16; s++) {
        const note = chord.tones[[0, 1, 2, 3, 2, 1][s % 6]] + (part === 'chorus' ? 12 : 0);
        this.arp(ctx, note, at(s), part === 'intro' ? 0.03 + 0.01 * Math.floor(s / 4) : 0.04);
      }
    }
    if (bar.lead) {
      let step = 0;
      for (const [note, eighths] of bar.lead) {
        if (note) this.lead(ctx, note, at(step), eighths * 2 * this.step, part === 'chorus');
        step += eighths * 2;
      }
    }
  }

  /** A bar of "Straw": the impact, or the lament. */
  private strawBar(ctx: AudioContext, bar: Bar, t: number) {
    const chord = C[bar.chord];
    const at = (step: number) => t + step * this.step;
    if (bar.part === 'impact') {
      // The fall: a crash, a deep boom dropping away, the chord struck and left to ring, and the
      // noise of it sweeping down.
      this.crash(ctx, t);
      this.boom(ctx, t);
      this.power(ctx, chord.root + 12, t, BAR * this.step * 0.95, 1.2);
      this.bass(ctx, chord.root, t, BAR * this.step * 0.9);
      return;
    }
    if (bar.crash) this.crash(ctx, t);
    // Half time: the kick on one and the and of three, the snare hard on three.
    for (const s of [0, 10]) this.kick(ctx, at(s));
    this.snare(ctx, at(8), 1.2);
    for (let s = 0; s < 16; s += 2) this.hat(ctx, at(s), 0.04, s === 14);
    // A tom fill tumbling down into the turn of the progression.
    if (bar.chord === 'A') for (const [s, f] of [[12, 180], [13, 150], [14, 120], [15, 95]] as const) this.tom(ctx, at(s), f);
    // Bass and guitars: long, heavy chords, re-struck on three.
    this.bass(ctx, chord.root, at(0), this.step * 7.5);
    this.bass(ctx, chord.root, at(8), this.step * 7.5);
    this.power(ctx, chord.root + 12, at(0), this.step * 7.6, 1);
    this.power(ctx, chord.root + 12, at(8), this.step * 7.6, 0.9);
    // Strings trembling under it.
    for (let s = 0; s < 16; s++) this.arp(ctx, chord.tones[s % 2 === 0 ? 1 : 2], at(s), 0.022);
    if (bar.lead) {
      let step = 0;
      for (const [note, eighths] of bar.lead) {
        if (note) this.lead(ctx, note, at(step), eighths * 2 * this.step, true);
        step += eighths * 2;
      }
    }
  }

  /** A deep boom, the fall hitting home. */
  private boom(ctx: AudioContext, t: number) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    const env = ctx.createGain();
    env.gain.setValueAtTime(1.0, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    o.connect(env);
    this.connect(ctx, env, 1, 0.4);
    o.start(t);
    o.stop(t + 1.7);
    this.noiseHit(ctx, t, 300, 0.9, 0.4, 'lowpass', 0.5);
  }

  private tom(ctx: AudioContext, t: number, freq: number) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.25);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.5, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(env);
    this.connect(ctx, env, 1, 0.3);
    o.start(t);
    o.stop(t + 0.32);
  }

  private connect(ctx: AudioContext, node: AudioNode, dry: number, wet = 0, echo = 0) {
    const d = ctx.createGain();
    d.gain.value = dry;
    node.connect(d).connect(this.out!);
    if (wet) {
      const w = ctx.createGain();
      w.gain.value = wet;
      node.connect(w).connect(this.wet!);
    }
    if (echo) {
      const e = ctx.createGain();
      e.gain.value = echo;
      node.connect(e).connect(this.delay!);
    }
  }

  private kick(ctx: AudioContext, t: number) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.9, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(env);
    this.connect(ctx, env, 1);
    o.start(t);
    o.stop(t + 0.34);
    // The beater's click.
    this.noiseHit(ctx, t, 4000, 0.004, 0.15, 'highpass');
  }

  private snare(ctx: AudioContext, t: number, level = 1) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(230, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.35 * level, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(env);
    this.connect(ctx, env, 1, 0.3);
    o.start(t);
    o.stop(t + 0.14);
    this.noiseHit(ctx, t, 1800, 0.18, 0.5 * level, 'highpass', 0.35);
  }

  private hat(ctx: AudioContext, t: number, level: number, open = false) {
    this.noiseHit(ctx, t, 8000, open ? 0.22 : 0.04, level, 'highpass');
  }

  private crash(ctx: AudioContext, t: number) {
    this.noiseHit(ctx, t, 5000, 1.4, 0.18, 'highpass', 0.4);
  }

  private noiseHit(ctx: AudioContext, t: number, freq: number, length: number, level: number, type: BiquadFilterType, wet = 0) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.0008, t + length);
    src.connect(f).connect(env);
    this.connect(ctx, env, 1, wet);
    src.start(t, Math.random() * 0.5);
    src.stop(t + length + 0.02);
  }

  /** A white-noise swell rising through the build into the chorus. */
  private riser(ctx: AudioContext, t: number, length: number) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + length);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.18, t + length);
    env.gain.linearRampToValueAtTime(0, t + length + 0.05);
    src.connect(f).connect(env);
    this.connect(ctx, env, 1, 0.3);
    src.start(t);
    src.stop(t + length + 0.1);
  }

  private bass(ctx: AudioContext, m: number, t: number, length: number) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(m);
    const sub = ctx.createOscillator();
    sub.frequency.value = hz(m);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(260, t + length);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.32, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.001, t + length);
    o.connect(f);
    sub.connect(f);
    f.connect(env);
    this.connect(ctx, env, 1);
    for (const x of [o, sub]) {
      x.start(t);
      x.stop(t + length + 0.02);
    }
  }

  /** A power chord (root, fifth, octave) through the overdrive. */
  private power(ctx: AudioContext, root: number, t: number, length: number, level: number) {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5 * level, t + 0.005);
    env.gain.setTargetAtTime(0.32 * level, t + 0.02, 0.15);
    env.gain.setTargetAtTime(0.0001, t + length, 0.04);
    env.connect(this.drive!);
    for (const [interval, det] of [[0, -6], [7, 5], [12, 0], [0, 7]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(root + interval);
      o.detune.value = det;
      o.connect(env);
      o.start(t);
      o.stop(t + length + 0.3);
    }
  }

  private arp(ctx: AudioContext, m: number, t: number, level: number) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = hz(m);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(700, t + this.step * 0.9);
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.0008, t + this.step * 0.95);
    o.connect(f).connect(env);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.sin(t * 3) * 0.5;
    env.connect(pan);
    this.connect(ctx, pan, 1, 0.1, 0.6);
    o.start(t);
    o.stop(t + this.step);
  }

  /** The lead: a bright, singing synth with vibrato and a little slide into each note. */
  private lead(ctx: AudioContext, m: number, t: number, length: number, big: boolean) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = big ? 3600 : 2600;
    const env = ctx.createGain();
    const peak = big ? 0.12 : 0.07;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.015);
    env.gain.setTargetAtTime(peak * 0.8, t + 0.05, 0.2);
    env.gain.setTargetAtTime(0.0001, t + length * 0.9, 0.05);
    f.connect(env);
    this.connect(ctx, env, 1, 0.25, big ? 0.45 : 0.3);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(hz(m) * 0.008, t + Math.min(0.3, length));
    vib.connect(depth);
    for (const det of [-8, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(hz(m - 1), t);
      o.frequency.exponentialRampToValueAtTime(hz(m), t + 0.04);
      o.detune.value = det;
      depth.connect(o.frequency);
      o.connect(f);
      o.start(t);
      o.stop(t + length + 0.3);
    }
    vib.start(t);
    vib.stop(t + length + 0.3);
  }
}
