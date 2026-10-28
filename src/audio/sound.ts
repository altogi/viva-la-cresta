// Procedural sound: the start bell, runners hissing on the ice (louder and higher with speed), the
// knives scraping, rakes biting, wind at speed, running strides, the thud of a fall, the crowd's gasp
// and applause. Recorded crowd clips are used instead when present (public/sfx/gasp.mp3 and
// public/sfx/applause.mp3); without them, the synthesised versions play.

export interface SoundState {
  speed: number; // m/s
  posture: number; // 0 forward … 1 knives
  rake: number; // 0 … 1, both feet averaged
  riding: boolean;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private runners!: { filter: BiquadFilterNode; gain: GainNode };
  private knives!: { gain: GainNode };
  private rake!: { gain: GainNode };
  private wind!: { filter: BiquadFilterNode; gain: GainNode };
  muted = false;
  private readonly samples = new Map<string, AudioBuffer>();

  /** Must be called from a user gesture (browsers block audio until then). */
  start() {
    playThroughSilentSwitch();
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);
    const noise = this.noiseSource(ctx);
    const chain = (type: BiquadFilterType, freq: number, q: number) => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      noise.connect(filter).connect(gain).connect(this.master);
      return { filter, gain };
    };
    this.runners = chain('bandpass', 900, 0.8);
    this.knives = chain('highpass', 3200, 0.7);
    this.rake = chain('bandpass', 2400, 2.5);
    this.wind = chain('lowpass', 420, 0.5);
    for (const name of ['gasp', 'applause']) void this.loadSample(ctx, name);
  }

  /** Load an optional recorded clip; a missing file just leaves the synthesised sound. */
  private async loadSample(ctx: AudioContext, name: string) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sfx/${name}.mp3`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('audio')) return;
      this.samples.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch {
      // No clip: keep the synthesised version.
    }
  }

  /** Play a loaded clip; false when there isn't one. */
  private playSample(name: string, gain: number): boolean {
    const buffer = this.samples.get(name);
    if (!this.ctx || !buffer) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
    return true;
  }

  /** Silence everything while the page is hidden (the phone locked, another app or tab in front). */
  sleep() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
    silentLoop?.pause();
  }

  /** Phones suspend the audio after an interruption (a call, the screen locking): pick it up again. */
  private wake() {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  /** A limiter for the crowd: loud, but never clipping. */
  private crowdBus(gain: number): GainNode {
    const ctx = this.ctx!;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(this.master);
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(limiter);
    return g;
  }

  /**
   * The crowd gasps at a fall: a sharp, breathy intake, then a rising "oooh!" from many voices.
   * Pitched and filtered to carry on a phone's speaker.
   */
  gasp() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.wake();
    if (this.playSample('gasp', 1)) return;
    const t = ctx.currentTime + 0.12;
    const out = this.crowdBus(2.2);
    // Breath: a burst of airy noise, swelling then falling away.
    const breath = this.noiseSource(ctx);
    const air = ctx.createBiquadFilter();
    air.type = 'bandpass';
    air.frequency.setValueAtTime(1400, t);
    air.frequency.linearRampToValueAtTime(2200, t + 0.25);
    air.Q.value = 0.9;
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0, t);
    airGain.gain.linearRampToValueAtTime(0.5, t + 0.07);
    airGain.gain.exponentialRampToValueAtTime(0.02, t + 0.45);
    airGain.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    breath.connect(air).connect(airGain).connect(out);
    breath.stop(t + 1.5);
    // Voices: "oh" formants, men and women, sliding up in surprise then down.
    const formants = [620, 1100, 2500].map((f, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = f;
      filter.Q.value = 4;
      const g = ctx.createGain();
      g.gain.value = [1, 0.7, 0.25][i];
      filter.connect(g).connect(out);
      return filter;
    });
    for (let v = 0; v < 26; v++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const pitch = (v % 3 === 0 ? 150 : 260) * (0.85 + Math.random() * 0.4);
      const start = t + 0.05 + Math.random() * 0.15;
      osc.frequency.setValueAtTime(pitch, start);
      osc.frequency.linearRampToValueAtTime(pitch * 1.3, start + 0.3);
      osc.frequency.linearRampToValueAtTime(pitch * 0.9, start + 1.5);
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 4 + Math.random() * 3;
      const depth = ctx.createGain();
      depth.gain.value = pitch * 0.025;
      vibrato.connect(depth).connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.16, start + 0.15);
      g.gain.setValueAtTime(0.16, start + 0.45);
      g.gain.exponentialRampToValueAtTime(0.001, start + 1.6 + Math.random() * 0.5);
      osc.connect(g);
      for (const f of formants) g.connect(f);
      osc.start(start);
      vibrato.start(start);
      osc.stop(start + 2.3);
      vibrato.stop(start + 2.3);
    }
  }


  /** The context and the master volume, for the music (null until the first touch starts audio). */
  musicContext(): { ctx: AudioContext; destination: AudioNode } | null {
    return this.ctx ? { ctx: this.ctx, destination: this.master } : null;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  private noiseSource(ctx: AudioContext): AudioBufferSourceNode {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }

  update(s: SoundState) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = 0.06;
    const v = s.riding ? s.speed : 0;
    const speed01 = Math.min(1, v / 32);
    this.runners.gain.gain.setTargetAtTime(0.32 * speed01 * (1 - 0.4 * s.posture), t, k);
    this.runners.filter.frequency.setTargetAtTime(500 + v * 70, t, k);
    this.knives.gain.gain.setTargetAtTime(0.12 * s.posture * Math.min(1, v / 12), t, k);
    const jitter = 0.75 + 0.25 * Math.random();
    this.rake.gain.gain.setTargetAtTime(0.42 * s.rake * Math.min(1, v / 6) * jitter, t, 0.03);
    this.wind.gain.gain.setTargetAtTime(0.35 * speed01 * speed01, t, k);
    this.wind.filter.frequency.setTargetAtTime(250 + v * 20, t, k);
  }

  /** Two strikes of the bell: the signal that a rider has fallen. */
  fallBells() {
    this.bell(0);
    this.bell(0.22);
  }

  /** The start bell: a struck bell with inharmonic partials. */
  bell(delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    for (const [ratio, amp, decay] of [
      [1, 0.35, 2.4],
      [2.76, 0.18, 1.6],
      [5.4, 0.1, 0.9],
      [8.93, 0.06, 0.5],
    ]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 620 * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + decay);
    }
  }

  /**
   * The crowd at the finish: about thirty people clapping, each at their own steady pace and with
   * their own cupped-hands tone, in a little outdoor reverb, swelling then dying away; over it, a
   * few cheers ("bravo!", "woo!") and a whistle or two.
   */
  applause() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.wake();
    if (this.playSample('applause', 0.8)) return;
    const rate = ctx.sampleRate;
    const duration = 5.5;
    const buffer = ctx.createBuffer(2, Math.ceil(rate * duration), rate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const clapLength = Math.floor(rate * 0.045);
    for (let p = 0; p < 30; p++) {
      // One person's clap: a burst of noise through a resonance (the cupped hands), quick decay.
      const centre = 700 + Math.random() * 1700;
      const q = 0.9 + Math.random() * 1.6;
      const clap = new Float32Array(clapLength);
      const w = (2 * Math.PI * centre) / rate;
      const alpha = Math.sin(w) / (2 * q);
      const b0 = alpha / (1 + alpha);
      const a1 = (-2 * Math.cos(w)) / (1 + alpha);
      const a2 = (1 - alpha) / (1 + alpha);
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      const decay = 0.006 + Math.random() * 0.01;
      for (let i = 0; i < clapLength; i++) {
        const t = i / rate;
        const env = Math.min(1, t / 0.0015) * Math.exp(-t / decay);
        const x = (Math.random() * 2 - 1) * env;
        const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        clap[i] = y * 4;
      }
      // Their pace and where they stand (left or right of the listener).
      const pace = 1 / (3.6 + Math.random() * 2.2);
      const pan = Math.random();
      const loud = 0.25 + Math.random() * 0.35;
      let t = Math.random() * 0.35;
      const stop = duration - 0.6 - Math.random() * 1.6;
      while (t < stop) {
        const start = Math.floor(t * rate);
        // The crowd swells in, then thins out at the end.
        const swell = Math.min(1, t / 0.5) * Math.min(1, (stop - t) / 1.2);
        const gain = loud * swell * (0.8 + Math.random() * 0.4);
        for (let i = 0; i < clapLength && start + i < left.length; i++) {
          left[start + i] += clap[i] * gain * (1 - pan * 0.6);
          right[start + i] += clap[i] * gain * (0.4 + pan * 0.6);
        }
        t += pace * (0.9 + Math.random() * 0.2);
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // The space: a short, bright outdoor reverb.
    const verbBuffer = ctx.createBuffer(2, Math.ceil(rate * 0.9), rate);
    for (let c = 0; c < 2; c++) {
      const d = verbBuffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (rate * 0.18)) * 0.5;
    }
    const verb = ctx.createConvolver();
    verb.buffer = verbBuffer;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    const out = this.crowdBus(0.9);
    src.connect(out);
    src.connect(verb).connect(wet).connect(out);
    src.start();
    this.cheers(out);
  }

  /** A few voices over the applause: rising "woo!"s and "bravo!"s, and a whistle or two. */
  private cheers(out: AudioNode) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    for (let v = 0; v < 6; v++) {
      const t = now + 0.2 + Math.random() * 2.2;
      const man = Math.random() < 0.6;
      const base = man ? 150 + Math.random() * 60 : 260 + Math.random() * 90;
      const length = 0.5 + Math.random() * 0.5;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.7, t + length * 0.35);
      osc.frequency.exponentialRampToValueAtTime(base * 1.1, t + length);
      // Vowel formants: "oo" sliding to "ah".
      const voice = ctx.createGain();
      voice.gain.setValueAtTime(0, t);
      voice.gain.linearRampToValueAtTime(0.09, t + 0.05);
      voice.gain.setValueAtTime(0.09, t + length * 0.7);
      voice.gain.exponentialRampToValueAtTime(0.0008, t + length);
      for (const [f0, f1, g] of [[350, 750, 1], [800, 1200, 0.6], [2400, 2600, 0.25]]) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 6;
        bp.frequency.setValueAtTime(f0, t);
        bp.frequency.linearRampToValueAtTime(f1, t + length * 0.5);
        const fg = ctx.createGain();
        fg.gain.value = g;
        osc.connect(bp).connect(fg).connect(voice);
      }
      voice.connect(out);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
    for (let w = 0; w < 2; w++) {
      // A two-finger whistle: up, hold, down.
      const t = now + 0.5 + Math.random() * 2.5;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = 2100 + Math.random() * 700;
      osc.frequency.setValueAtTime(f * 0.8, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.12);
      osc.frequency.setValueAtTime(f, t + 0.5);
      osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.75);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.04);
      g.gain.setValueAtTime(0.06, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.8);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.85);
    }
  }


  /** A crunching stride in the snow. */
  step() {
    this.burst(1400, 0.07, 0.25, 'bandpass');
  }

  /** The thud of a fall. */
  thud() {
    this.burst(180, 0.35, 0.9, 'lowpass');
  }

  /** The toboggan knocking against a bankina: a hard wooden knock and a scrape of ice. */
  knock() {
    this.burst(260, 0.12, 0.8, 'lowpass');
    this.burst(2600, 0.25, 0.3, 'bandpass');
  }

  private burst(freq: number, duration: number, amp: number, type: BiquadFilterType) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = amp;
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }
}

let silentLoop: HTMLAudioElement | null = null;

/**
 * On iPhone, Web Audio stays silent while the ringer switch is on silent, unless the page is
 * playing media. Ask for the playback audio session where Safari supports it, and otherwise keep
 * a silent clip looping in an audio element, which puts the page in the same category.
 */
function playThroughSilentSwitch() {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';
  if (silentLoop) {
    // iOS pauses it when the page is hidden; start it again with the next touch.
    if (silentLoop.paused) void silentLoop.play().catch(() => undefined);
    return;
  }
  // Half a second of silence as an 8 kHz, 8-bit mono WAV.
  const samples = 4000;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, str: string) => [...str].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  silentLoop = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
  silentLoop.loop = true;
  silentLoop.setAttribute('playsinline', '');
  void silentLoop.play().catch(() => undefined);
}
