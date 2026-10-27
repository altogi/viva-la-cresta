// The menus' music: "Last Light on the Ice", a slow, wistful country-rock waltz in G written for
// the game (in the spirit of a mid-seventies Eagles ballad, nothing borrowed): an electric piano
// rolling the chords, bass, brushed drums, a string pad, and a singing lead line, in a wash of
// reverb. Synthesised as it plays and scheduled a little ahead, looping.

const BPM = 74;
const BEAT = 60 / BPM;
const BAR = 3; // beats: a waltz

type Chord = { bass: number; tones: number[] };
const C: Record<string, Chord> = {
  G: { bass: 43, tones: [55, 59, 62, 67] },
  'G/B': { bass: 47, tones: [55, 59, 62, 67] },
  C: { bass: 48, tones: [55, 60, 64, 67] },
  Em: { bass: 40, tones: [55, 59, 64, 67] },
  D: { bass: 50, tones: [54, 57, 62, 66] },
  Dsus: { bass: 50, tones: [55, 57, 62, 67] },
  Am: { bass: 45, tones: [57, 60, 64, 69] },
  Bm: { bass: 47, tones: [54, 59, 62, 66] },
  Cmaj7: { bass: 48, tones: [55, 59, 64, 67] },
};

/** Melody notes: [midi or 0 for a rest, beats]. One bar each line. */
type Line = [number, number][];
const VERSE: Line[] = [
  [[74, 2], [71, 1]],
  [[74, 1.5], [72, 0.5], [71, 1]],
  [[72, 2], [76, 1]],
  [[74, 3]],
  [[71, 2], [67, 1]],
  [[69, 1], [71, 1], [72, 1]],
  [[69, 2], [66, 1]],
  [[69, 3]],
];
const VERSE_END: Line[] = [...VERSE.slice(0, 6), [[69, 1], [71, 1], [69, 1]], [[67, 3]]];
const BRIDGE: Line[] = [
  [[76, 2], [74, 1]],
  [[72, 1.5], [71, 0.5], [69, 1]],
  [[71, 2], [74, 1]],
  [[79, 2], [78, 0.5], [76, 0.5]],
  [[76, 2], [79, 1]],
  [[74, 2], [71, 1]],
  [[72, 1], [71, 1], [69, 1]],
  [[69, 2], [66, 1]],
];
const CHORDS = {
  intro: ['G', 'Cmaj7', 'G', 'Dsus'],
  verse: ['G', 'G/B', 'C', 'G', 'Em', 'C', 'D', 'D'],
  verseEnd: ['G', 'G/B', 'C', 'Am', 'Em', 'C', 'D', 'G'],
  bridge: ['C', 'D', 'Bm', 'Em', 'C', 'G/B', 'Am', 'D'],
};

/** The song, bar by bar: chord, melody (or none), and how full the band is (0 intro … 2 bridge). */
const SONG: { chord: string; line: Line | null; level: number }[] = [
  ...CHORDS.intro.map((chord) => ({ chord, line: null, level: 0 })),
  ...CHORDS.verse.map((chord, i) => ({ chord, line: VERSE[i], level: 1 })),
  ...CHORDS.verseEnd.map((chord, i) => ({ chord, line: VERSE_END[i], level: 1 })),
  ...CHORDS.bridge.map((chord, i) => ({ chord, line: BRIDGE[i], level: 2 })),
  ...CHORDS.verseEnd.map((chord, i) => ({ chord, line: VERSE_END[i], level: 2 })),
  // An instrumental verse to breathe, then round again.
  ...CHORDS.verse.map((chord) => ({ chord, line: null, level: 1 })),
];

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class Music {
  private out: GainNode | null = null;
  private wet: ConvolverNode | null = null;
  private timer: number | null = null;
  private bar = 0;
  private nextBarAt = 0;
  private noise: AudioBuffer | null = null;
  private playing = false;

  constructor(private readonly context: () => { ctx: AudioContext; destination: AudioNode } | null) {}

  /** Start (or keep) playing, fading in. */
  play() {
    const c = this.context();
    if (!c) return;
    const { ctx } = c;
    if (!this.out) this.build(ctx, c.destination);
    if (this.playing) return;
    this.playing = true;
    this.out!.gain.cancelScheduledValues(ctx.currentTime);
    this.out!.gain.setTargetAtTime(0.5, ctx.currentTime, 1.2);
    if (this.timer === null) {
      this.nextBarAt = Math.max(this.nextBarAt, ctx.currentTime + 0.1);
      this.timer = window.setInterval(() => this.schedule(), 120);
    }
  }

  /** Fade out and stop. */
  stop() {
    if (!this.playing) return;
    this.playing = false;
    const c = this.context();
    if (!c || !this.out) return;
    this.out.gain.setTargetAtTime(0, c.ctx.currentTime, 0.6);
    window.setTimeout(() => {
      if (this.playing || this.timer === null) return;
      window.clearInterval(this.timer);
      this.timer = null;
      this.bar = 0; // from the top next time
    }, 3000);
  }

  private build(ctx: AudioContext, destination: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    // A hall-ish reverb from decaying noise.
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.wet = ctx.createConvolver();
    this.wet.buffer = ir;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.32;
    this.wet.connect(wetGain).connect(this.out);
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
    while (this.nextBarAt < ctx.currentTime + 0.6) {
      this.playBar(ctx, SONG[this.bar], this.nextBarAt);
      this.bar = (this.bar + 1) % SONG.length;
      if (this.bar === 0) this.bar = 4; // loop without the intro
      this.nextBarAt += BAR * BEAT;
    }
  }

  private playBar(ctx: AudioContext, bar: (typeof SONG)[number], t: number) {
    const chord = C[bar.chord];
    // Electric piano: the chord rolled on the first beat, broken on the others.
    this.ep(ctx, chord.tones, t, BEAT * 1.6, 0.11, 0.025);
    this.ep(ctx, [chord.tones[1], chord.tones[2]], t + BEAT, BEAT * 0.9, 0.07, 0.01);
    this.ep(ctx, [chord.tones[2], chord.tones[3]], t + 2 * BEAT, BEAT * 0.9, 0.07, 0.01);
    if (bar.level >= 1) {
      // Bass: root, then the fifth on three.
      this.bass(ctx, chord.bass, t, BEAT * 1.8);
      this.bass(ctx, chord.bass + 7, t + 2 * BEAT, BEAT * 0.9);
      // Brushed drums: a soft kick on one, the brush on two and three.
      this.kick(ctx, t);
      this.brush(ctx, t + BEAT, 0.05);
      this.brush(ctx, t + 2 * BEAT, 0.04);
      this.brush(ctx, t + 2.5 * BEAT, 0.02);
    }
    if (bar.level >= 2) this.pad(ctx, chord.tones.map((m) => m + 12), t, BAR * BEAT);
    else if (bar.level === 1) this.pad(ctx, chord.tones, t, BAR * BEAT, 0.025);
    if (bar.line) {
      let at = t;
      for (const [note, beats] of bar.line) {
        if (note) this.lead(ctx, note, at, beats * BEAT, bar.level >= 2);
        at += beats * BEAT;
      }
    }
  }

  private send(ctx: AudioContext, node: AudioNode, dry: number, wet: number) {
    const d = ctx.createGain();
    d.gain.value = dry;
    node.connect(d).connect(this.out!);
    const w = ctx.createGain();
    w.gain.value = wet;
    node.connect(w).connect(this.wet!);
  }

  /** A Rhodes-like tine: a sine with a quick bell partial and a little tremolo, struck. */
  private ep(ctx: AudioContext, notes: number[], t: number, length: number, gain: number, roll: number) {
    notes.forEach((m, i) => {
      const at = t + i * roll;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(gain, at + 0.008);
      env.gain.exponentialRampToValueAtTime(gain * 0.35, at + 0.35);
      env.gain.exponentialRampToValueAtTime(0.0008, at + length + 0.6);
      const body = ctx.createOscillator();
      body.frequency.value = hz(m);
      const bell = ctx.createOscillator();
      bell.frequency.value = hz(m) * 4.01;
      const bellGain = ctx.createGain();
      bellGain.gain.setValueAtTime(0.25, at);
      bellGain.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
      bell.connect(bellGain).connect(env);
      body.connect(env);
      const pan = ctx.createStereoPanner();
      pan.pan.value = (m - 62) / 24;
      env.connect(pan);
      this.send(ctx, pan, 0.8, 0.5);
      for (const o of [body, bell]) {
        o.start(at);
        o.stop(at + length + 0.7);
      }
    });
  }

  private bass(ctx: AudioContext, m: number, t: number, length: number) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz(m);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.22, t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.08, t + 0.4);
    env.gain.exponentialRampToValueAtTime(0.0008, t + length);
    o.connect(f).connect(env);
    this.send(ctx, env, 1, 0.08);
    o.start(t);
    o.stop(t + length + 0.05);
  }

  /** Strings: detuned saws through a soft filter, swelling in and out over the bar. */
  private pad(ctx: AudioContext, notes: number[], t: number, length: number, gain = 0.035) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1500;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + length * 0.4);
    env.gain.linearRampToValueAtTime(gain * 0.6, t + length);
    env.gain.linearRampToValueAtTime(0.0001, t + length + 0.4);
    f.connect(env);
    this.send(ctx, env, 0.7, 0.9);
    for (const m of notes) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + length + 0.5);
      }
    }
  }

  /** The tune: a warm, slightly breathy lead with a slow vibrato, brighter in the bridge. */
  private lead(ctx: AudioContext, m: number, t: number, length: number, bright: boolean) {
    const o = ctx.createOscillator();
    o.type = bright ? 'sawtooth' : 'triangle';
    o.frequency.value = hz(m);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibDepth = ctx.createGain();
    vibDepth.gain.setValueAtTime(0, t);
    vibDepth.gain.linearRampToValueAtTime(hz(m) * 0.006, t + Math.min(0.5, length));
    vib.connect(vibDepth).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = bright ? 2200 : 1700;
    f.Q.value = 0.7;
    const env = ctx.createGain();
    const peak = bright ? 0.07 : 0.11;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.06);
    env.gain.setTargetAtTime(peak * 0.75, t + 0.1, 0.3);
    env.gain.setTargetAtTime(0.0001, t + length * 0.92, 0.12);
    o.connect(f).connect(env);
    this.send(ctx, env, 0.75, 0.6);
    o.start(t);
    vib.start(t);
    o.stop(t + length + 0.8);
    vib.stop(t + length + 0.8);
  }

  private kick(ctx: AudioContext, t: number) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.28, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(env);
    this.send(ctx, env, 1, 0.05);
    o.start(t);
    o.stop(t + 0.32);
  }

  /** A brush swept on the snare: filtered noise with a soft attack. */
  private brush(ctx: AudioContext, t: number, gain: number) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3200;
    f.Q.value = 0.6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0005, t + 0.28);
    src.connect(f).connect(env);
    this.send(ctx, env, 0.8, 0.3);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.3);
  }
}
