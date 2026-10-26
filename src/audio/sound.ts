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

  /** The crowd gasps at a fall: a rising "ooh" from many voices over a sharp intake of breath. */
  gasp() {
    const ctx = this.ctx;
    if (!ctx || this.playSample('gasp', 0.9)) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.32;
    out.connect(this.master);
    // Two vowel formants for "oh".
    const formants = [450, 820].map((f, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = f;
      filter.Q.value = 5;
      const g = ctx.createGain();
      g.gain.value = i ? 0.6 : 1;
      filter.connect(g).connect(out);
      return filter;
    });
    for (let v = 0; v < 18; v++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const pitch = (v % 2 ? 210 : 120) * (0.85 + Math.random() * 0.4);
      const start = t + Math.random() * 0.12;
      osc.frequency.setValueAtTime(pitch * 0.9, start);
      osc.frequency.linearRampToValueAtTime(pitch * 1.15, start + 0.35);
      osc.frequency.linearRampToValueAtTime(pitch * 0.85, start + 1.4);
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 4 + Math.random() * 3;
      const depth = ctx.createGain();
      depth.gain.value = pitch * 0.02;
      vibrato.connect(depth).connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.09, start + 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, start + 1.5 + Math.random() * 0.4);
      osc.connect(g);
      for (const f of formants) g.connect(f);
      osc.start(start);
      vibrato.start(start);
      osc.stop(start + 2);
      vibrato.stop(start + 2);
    }
    // The intake of breath.
    this.burst(1600, 0.35, 0.35, 'bandpass');
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

  /** The crowd at the finish: a few seconds of applause and cheering. */
  applause() {
    const ctx = this.ctx;
    if (!ctx || this.playSample('applause', 0.8)) return;
    const duration = 3.2;
    const rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.ceil(rate * duration), rate);
    const data = buffer.getChannelData(0);
    // Hundreds of short claps at random times, swelling then fading.
    for (let c = 0; c < 420; c++) {
      const start = Math.floor(Math.random() * (duration - 0.05) * rate);
      const len = Math.floor(rate * (0.008 + Math.random() * 0.01));
      const amp = 0.25 + Math.random() * 0.4;
      for (let i = 0; i < len && start + i < data.length; i++) data[start + i] += (Math.random() * 2 - 1) * amp * (1 - i / len) ** 2;
    }
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      data[i] *= Math.min(1, t / 0.3) * Math.min(1, (duration - t) / 1.2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1700;
    filter.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.55;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }

  /** A crunching stride in the snow. */
  step() {
    this.burst(1400, 0.07, 0.25, 'bandpass');
  }

  /** The thud of a fall. */
  thud() {
    this.burst(180, 0.35, 0.9, 'lowpass');
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
