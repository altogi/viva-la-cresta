// One ride down the Cresta: "Rider on the ice", the bell, the start, the ride itself with the
// chase camera, then the finish, or a fall in slow motion and the disqualification.

import { LINE } from '../career/lines';
import * as THREE from 'three';
import { Controls } from '../input/controls';
import { RideSim, type StartStyle } from '../sim/physics';
import { RIDERS, TOBOGGANS } from '../sim/rider';
import { LOOKS } from '../render/riderLooks';
import { loadSelection, type Selection } from './selection';
import { surfaceAt } from '../sim/surface';
import type { Track } from '../sim/track';
import { SPLITS, autopilotInput, runOutInput, type Policy } from '../sim/autopilot';
import type { World } from '../render/world';
import type { Terrain } from '../render/terrain';
import { RiderModel } from '../render/riderModel';
import { Ragdoll } from '../render/ragdoll';
import { FallDebris } from '../render/particles';
import type { Crowd } from '../render/crowd';
import type { WeatherView } from '../render/weather';
import { STEINBOCK_S, type Steinbock } from '../render/steinbock';
import { junctionTerrace } from '../render/places';
import { PADDING, type Padding } from '../render/padding';
import { adjust, Lag, MOODS, reverse, rollMoods, WEATHER, weatherFor, type Mood, type Weather } from './conditions';
import { groundHeight } from '../render/ground';
import { toThree } from '../render/util';
import type { Sound } from '../audio/sound';
import type { Coach } from './coach';

export interface RideSetup {
  startS: number;
  start: StartStyle;
  label: string;
  steps?: number;
  /** A ride in a career: its own banner line, an optional coach, and where the result goes. */
  career?: {
    /** Under "Run Clear!", e.g. "The Curzon Cup · Course 2 of 3". */
    title: string;
    /** A race course: a fall disqualifies. */
    race?: boolean;
    /** The rider's first ride from Top: a crowd turns out for it. */
    firstTop?: boolean;
    /** The career's best from this start on any toboggan, to beat for a Hello Hello (null: none yet). */
    best?: number | null;
    /** The day's weather (announced in the hub as the day began). */
    weather?: Weather | null;
    /** No luck, good or bad, for beginners (the first rides, and learning the flat-top or Top). */
    noLuck?: boolean;
    coach?: Coach;
    /** Extra lines on the fall card (advice after a first fall). */
    fallLines?: (kind: string, zone: string) => string[];
    /** Called when the rider leaves the ride: the result, or null if they quit before the end. */
    onDone: (result: RideResult | null) => void;
  };
}

export interface RideResult {
  time: number | null;
  fall: { kind: string; zone: string } | null;
  /** Finish speed, mph. */
  speed: number;
  /** The line through Shuttlecock: u (m) and speed (m/s) at each sample (see career/lines). */
  line: number[];
}

type Stage = 'ready' | 'countdown' | 'live' | 'runout' | 'celebrate' | 'falling' | 'replay' | 'done';

/** What the replay needs to redraw the rider at a moment of the ride. */
interface Snapshot {
  t: number;
  s: number;
  u: number;
  v: number;
  w: number;
  posture: number;
  steer: number;
  rakeLeft: number;
  rakeRight: number;
  mount: number;
  runPhase: number;
  /** How far the rider has slid past the toboggan on the finish mat (m). */
  slidOff: number;
}

/** The ride plays a little quicker than real time, for fun; displayed times stay real. */
export const GAME_SPEED = 1.35;

const REPLAY_BEFORE = 2.2; // seconds of riding shown before the fall
const REPLAY_SPEED = 0.5;
type Cam = 'chase' | 'helmet';

const MPH = 2.23694;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const FALL_TEXT: Record<string, string> = {
  'fly-out': 'flew out over the lip',
  'over-wall': 'went over the wall',
  crash: 'came down the wall too hard and lost the toboggan',
  wall: 'hit the wall too squarely and lost the toboggan',
  steinbock: 'ran into a Steinbock standing on the ice',
};

export class RideMode {
  private sim!: RideSim;
  private model!: RiderModel;
  private result: RideResult | null = null;
  private readonly powderDue = [0, 0];
  private readonly rakePos = new THREE.Vector3();
  private setup!: RideSetup;
  private stage: Stage = 'ready';
  private stageTime = 0;
  /** Bankina hits so far this ride, to knock once per hit. */
  private bankHits = 0;
  private cam: Cam = 'chase';
  private runPhase = 0;
  /** Seconds since diving onto the toboggan (for the jump-on animation). */
  private mountTime = 0;
  private wasRunning = false;
  private history: Snapshot[] = [];
  /** This ride's line through Shuttlecock, and the next distance down the run to sample it at. */
  private line: number[] = [];
  private nextLineS = LINE.from;
  private fallTime = 0;
  private readonly fallPoint = new THREE.Vector3();
  private readonly closeUpSide = new THREE.Vector3();
  private replayModel: RiderModel | null = null;
  private replayClock = 0;
  /** Seconds the flyover camera has been circling (only advances during the replay). */
  private orbitTime = 0;
  private readonly controls: Controls;
  private readonly ragdoll: Ragdoll;
  private readonly debris: FallDebris;
  /** Whether the ground where the rider fell is straw (beyond Shuttlecock's lip). */
  private fallOnStraw = false;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly riderPos = new THREE.Vector3();
  /** Visitors beside the run, who react to falls. */
  crowd: Crowd | null = null;
  /** The day's weather on screen. */
  weatherView: WeatherView | null = null;
  /** The loose padded mats beyond Shuttlecock's straw. */
  padding: Padding | null = null;
  /** The Steinbock that wanders onto the ice after Shuttlecock one ride in two hundred. */
  steinbock: Steinbock | null = null;
  /** Debug: always have him there (?steinbock). */
  alwaysSteinbock = false;
  private steinbockOut = false;
  /** The hangover's slow hands (no lag otherwise). */
  private lag = new Lag(0);
  /** The Arbeiters' curse: the controls the wrong way round. */
  private reversed = false;
  /** This ride's own luck, good or bad. */
  moods: Mood[] = [];
  /** Where the rider celebrates by the finish hut, once in (null until then). */
  private finishSpot: ReturnType<Crowd['finishSpot']> | null = null;
  /** This ride beat a best that already stood: Hello Hello! */
  private hello = false;

  /** Where the rider is now, for the visitors to watch (null when not on the ice). */
  get riderPosition(): THREE.Vector3 | null {
    return this.stage === 'live' || this.stage === 'runout' || this.stage === 'countdown' ? this.riderPos : null;
  }
  private readonly riderVel = new THREE.Vector3();
  private snap = true;
  private fallCamPos = new THREE.Vector3();
  private simClock = 0;
  private readonly lastStride = { t: -1 };
  /** Who is riding, on what. */
  selection: Selection = loadSelection();
  /** Debug: let a bot ride instead of the player (?autopilot=good). */
  autopilot: Policy | null = null;
  onExit: () => void = () => {};
  /** The music should change: a fall (or a fresh start after one). */
  onMusic: () => void = () => {};

  /** On the ice after a fall (its song plays), until the next ride. */
  get fallen() {
    if (this.left) return false;
    return this.stage === 'falling' || this.stage === 'replay' || (this.stage === 'done' && this.sim.state.phase === 'fallen');
  }

  constructor(
    private readonly world: World,
    private readonly track: Track,
    terrain: Terrain,
    private readonly sound: Sound,
  ) {
    this.controls = new Controls($('zones'));
    this.controls.onTap = (zone) => {
      if (zone === 'run') this.sound.step();
    };
    // Ground for tumbling bodies and debris: the track's ice, banks and straw where they are, else the hillside.
    const groundAt = (x: number, z: number) => groundHeight(track, terrain, x, z);
    this.ragdoll = new Ragdoll(world.scene, groundAt);
    this.debris = new FallDebris(groundAt);
    world.scene.add(this.debris.group);
    // The red padding beyond Shuttlecock's straw stops riders who fly out.
    this.ragdoll.constrain = (pos, vel) => {
      if (!this.fallOnStraw) return;
      const { station } = terrain.distanceToTrack(pos.x, -pos.z);
      if (!station) return;
      // Into the padded mats beyond Shuttlecock's straw: they take the blow, and move.
      if (this.padding?.collide(pos, vel, 0.25, 40) && this.stage === 'falling' && Math.hypot(vel.x, vel.z) > 2) {
        this.debris.burst(pos.clone(), vel.clone().multiplyScalar(-0.3), true, 0.5);
      }
      // And the board wall behind them stops anything that gets past.
      const pts = track.crossSection(station.s);
      const lateral = (pos.x - station.pos[0]) * station.left[0] + (-pos.z - station.pos[1]) * station.left[1];
      const side = this.sim.state.fall?.side === 'left' ? 1 : -1;
      const pad = (side > 0 ? pts[pts.length - 1].y : pts[0].y) + side * (PADDING.fence - 0.2);
      if (side * (lateral - pad) > 0) {
        const push = lateral - pad;
        pos.x -= station.left[0] * push;
        pos.z += station.left[1] * push;
        // The padding absorbs the sideways and forward speed; the rider still drops into the straw.
        if (this.stage === 'falling' && Math.hypot(vel.x, vel.z) > 3) this.debris.burst(pos.clone(), vel.clone().multiplyScalar(-0.3), true, 0.6);
        vel.x *= 0.15;
        vel.z *= 0.15;
      }
    };
    this.ragdoll.onImpact = (at, velocity, index) => {
      // Only live impacts kick up debris, not the replay.
      if (this.stage !== 'falling') return;
      this.debris.burst(at, velocity, this.fallOnStraw, index === 0 ? 1 : 0.5);
      if (index === 0) this.sound.thud();
    };
    $('ride-banner').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stage === 'ready') this.countdown();
      else if (this.stage === 'replay') this.endReplay();
    });
    window.addEventListener('keydown', (e) => {
      if (this.stage === 'ready' && !this.luckPending && (e.code === 'Space' || e.code === 'Enter')) this.countdown();
    });
    $('ride-again').addEventListener('click', () => this.begin(this.setup));
    $('ride-menu').addEventListener('click', () => this.exit());
    $('ride-replay').addEventListener('click', () => this.startReplay());
    $('ride-quit').addEventListener('click', () => this.exit());
    $('ride-cam').addEventListener('click', () => {
      this.cam = this.cam === 'chase' ? 'helmet' : 'chase';
      $('ride-cam').textContent = this.cam === 'chase' ? 'Chase' : 'Helmet';
      this.applyCam();
    });
  }

  begin(setup: RideSetup) {
    this.setup = setup;
    this.left = false;
    this.padding?.reset();
    this.crowd?.populate();
    this.crowd?.endFinish();
    // A fresh start: whatever played for the last fall stops.
    queueMicrotask(() => this.onMusic());
    // A rider's first ride from Top (in a career, or the first ever in free rides) draws a crowd.
    let firstTop = false;
    if (setup.startS < 4) {
      if (setup.career) firstTop = !!setup.career.firstTop;
      else {
        try {
          firstTop = !localStorage.getItem('vlc-rode-top');
          localStorage.setItem('vlc-rode-top', '1');
        } catch {
          /* storage unavailable: no occasion */
        }
      }
    }
    this.crowd?.topEvent(firstTop);
    this.finishSpot = null;
    this.hello = false;
    this.ragdoll.clear();
    this.replayModel?.root.removeFromParent();
    this.replayModel = null;
    this.history = [];
    this.line = [];
    this.nextLineS = LINE.from;
    if (this.model) this.model.root.removeFromParent();
    const { rider, toboggan } = this.selection;
    this.model = new RiderModel(LOOKS[rider], toboggan);
    this.world.scene.add(this.model.root);
    this.bankHits = 0;
    // The day's weather (free rides: the same all of today) and this ride's own luck.
    const weather = setup.career ? setup.career.weather ?? null : freeRideWeather();
    this.weatherView?.set(weather);
    this.moods = setup.career?.noLuck ? [] : rollMoods();
    // One ride in two hundred, a Steinbock on the ice below Shuttlecock (only for rides that get there).
    this.steinbockOut = !!this.steinbock && setup.startS < STEINBOCK_S && (this.alwaysSteinbock || Math.random() < 0.005);
    if (this.steinbock) {
      if (this.steinbockOut) {
        this.steinbock.place();
        this.world.scene.add(this.steinbock.root);
      } else this.steinbock.root.removeFromParent();
    }
    const adjusted = adjust(RIDERS[rider], TOBOGGANS[toboggan], weather, this.moods);
    this.lag = new Lag(adjusted.lag);
    this.reversed = adjusted.reversed;
    this.sim = new RideSim(this.track, adjusted.rider, adjusted.toboggan, {
      startS: setup.startS,
      start: setup.start,
      steps: setup.steps,
      splitsAt: SPLITS,
      rakeGrip: adjusted.rakeGrip,
      bankBoost: adjusted.bankBoost,
    });
    this.controls.reset(false);
    this.controls.setRunning(false);
    this.stage = 'ready';
    this.applyCam();
    this.stageTime = 0;
    this.snap = true;
    this.mountTime = 0;
    this.wasRunning = false;
    this.runPhase = 0;
    document.body.classList.add('riding');
    $('ride-card').hidden = true;
    const hint = setup.start === 'running' ? 'Tap to start · then tap RUN to run' : 'Tap to start · lying start';
    // Free rides announce the day's weather here; a career did so as the day began.
    const notes = weather && !setup.career ? [`<b>${WEATHER[weather].title}.</b> ${WEATHER[weather].text}`] : [];
    const line = `${setup.career ? `${setup.career.title}<br>${hint}` : hint}${notes.map((n) => `<span class="ride-note">${n}</span>`).join('')}`;
    const showBanner = () => {
      if (firstTop) this.banner('Top is good!', `Your first ride from Top: everyone has come to watch.<br>${line}`);
      else this.banner('Run Clear!', line);
    };
    // Any luck, good or bad, is told first: the start waits until it's been read.
    if (this.moods.length) {
      this.banner('', '');
      this.luckPending = true;
      this.tellLuck(0, () => {
        this.luckPending = false;
        showBanner();
      });
    } else showBanner();
    this.result = null;
    // In a career the card leads on; there's no riding again straight away.
    $('ride-again').hidden = !!setup.career;
    $('ride-menu').textContent = setup.career ? 'Continue' : 'Menu';
    if (setup.career?.coach) setup.career.coach.ready();
    this.placeRider();
  }

  /** Helmet view: hide your own helmet and let the camera get close to the toboggan. */
  private applyCam() {
    const helmet = this.cam === 'helmet' && (this.stage === 'live' || this.stage === 'runout');
    if (this.model) this.model.head.visible = !helmet;
    this.world.camera.near = helmet ? 0.03 : 0.1;
    // A moderately wider lens through the visor; much wider stretches a tall phone screen.
    this.world.camera.fov = helmet ? 68 : 62;
    this.world.camera.updateProjectionMatrix();
  }

  private countdown() {
    this.sound.start();
    this.stage = 'countdown';
    this.stageTime = 0;
    this.banner('', '');
    this.crowd?.signalStart(this.setup.startS);
  }

  /** The rider has left the ride (Continue or Menu): the fall's song is over. */
  private left = false;

  private exit() {
    // Leave the camera as the menu and viewer expect it (no helmet lens).
    this.stage = 'done';
    this.left = true;
    this.onMusic();
    this.cam = 'chase';
    $('ride-cam').textContent = 'Chase';
    this.applyCam();
    this.ragdoll.clear();
    this.replayModel?.root.removeFromParent();
    this.replayModel = null;
    this.model?.root.removeFromParent();
    document.body.classList.remove('riding');
    this.sound.update({ speed: 0, posture: 0, rake: 0, riding: false });
    this.setup.career?.coach?.hide();
    const career = this.setup.career;
    if (career) career.onDone(this.result ?? (this.sim.state.fall ? { time: null, fall: { kind: this.sim.state.fall.kind, zone: this.sim.state.fall.zone }, speed: 0, line: this.line.slice() } : null));
    else this.onExit();
  }

  /** A window for each piece of the rider's luck, in turn, then `done`. */
  private tellLuck(i: number, done: () => void) {
    if (i >= this.moods.length) return done();
    const mood = MOODS[this.moods[i]];
    $('modal-title').textContent = mood.title;
    $('modal-body').innerHTML = `<p class="luck-text">${mood.text}</p>`;
    const ok = document.createElement('button');
    ok.className = 'primary';
    ok.textContent = 'Okay';
    ok.addEventListener('click', () => {
      $('modal').hidden = true;
      this.tellLuck(i + 1, done);
    });
    $('modal-buttons').replaceChildren(ok);
    $('modal').hidden = false;
  }

  /** The rider's luck is on screen: the start waits. */
  private luckPending = false;

  private banner(title: string, hint: string) {
    const el = $('ride-banner');
    el.hidden = !title;
    $('ride-banner-title').textContent = title;
    $('ride-banner-hint').innerHTML = hint;
  }

  update(realDt: number) {
    this.stageTime += realDt;
    let dt = realDt;
    if (this.stage === 'countdown' && this.stageTime > 1.1) {
      this.sound.bell();
      this.controls.read(0); // strides before the bell don't count
      this.simClock = 0;
      this.lastStride.t = -1;
      this.sim.release();
      this.crowd?.cheerTop();
      this.stage = 'live';
      this.stageTime = 0;
      this.applyCam();
      this.controls.setRunning(this.sim.state.phase === 'running');
    }
    if (this.stage === 'live' || this.stage === 'runout') dt = realDt * GAME_SPEED * (this.setup.career?.coach?.timeScale ?? 1);
    if (this.stage === 'falling') dt = realDt * (this.stageTime < 2.4 ? 0.3 : 1);

    if (this.stage === 'live') {
      this.simClock += dt;
      const input = this.autopilot
        ? autopilotInput(this.track, this.sim, this.autopilot, this.simClock, this.lastStride)
        : this.lag.apply(this.reversed ? reverse(this.controls.read(dt)) : this.controls.read(dt), dt);
      this.sim.update(dt, input);
      // Into the Steinbock: he's about a metre long across the run, and the rider comes off.
      if (this.steinbockOut && this.steinbock?.root.visible && Math.abs(this.sim.state.s - STEINBOCK_S) < 0.9 && Math.abs(this.sim.state.u - this.steinbock.u) < 0.6) {
        this.sim.hitSteinbock();
        this.steinbock.flee();
      }
      this.setup.career?.coach?.update({ stage: this.stage, s: this.sim.state.s, steer: input.steer, knives: input.knives, rake: Math.max(input.rakeLeft, input.rakeRight) }, realDt);
      const st = this.sim.state;
      // Legs keep pace with the ground covered: one stride every ~1.7 m.
      if (st.phase === 'running') this.runPhase += (st.v * dt * Math.PI) / 1.7;
      if (this.wasRunning && st.phase !== 'running') this.mountTime = 0;
      this.wasRunning = st.phase === 'running';
      this.mountTime += dt;
      this.record();
      if (st.phase !== 'running') this.controls.setRunning(false);
      if (st.phase === 'fallen') this.startFall();
      else if (st.phase === 'finished') {
        // Through the finish contacts: ride the run-out up to Celerina for the player.
        this.stage = 'runout';
        this.stageTime = 0;
      }
    } else if (this.stage === 'runout') {
      this.sim.update(dt, runOutInput(this.track, this.sim));
      if (this.sim.state.stopped) this.celebrate();
    } else if (this.stage === 'celebrate') {
      if (this.stageTime > 2.8) this.finish();
    }

    const riding = this.stage === 'live' || this.stage === 'runout';
    this.debris.update(this.stage === 'falling' || riding ? dt : realDt * REPLAY_SPEED);
    if (this.stage === 'falling') {
      this.ragdoll.update(dt);
      if (this.stageTime > 3.2) this.startReplay();
    } else if (this.stage === 'replay') {
      this.updateReplay(realDt);
    } else if (!(this.stage === 'done' && this.sim.state.phase === 'fallen')) {
      this.placeRider();
      if (riding) this.sprayRakes(dt);
    }
    this.padding?.update(realDt * (this.stage === 'falling' && this.stageTime < 2.4 ? 0.3 : 1));
    if (this.steinbockOut) this.steinbock?.update(realDt, this.stage === 'live' || this.stage === 'runout' ? this.sim.state.s : null);
    this.updateCamera(realDt);
    this.updateHud();
    const st = this.sim.state;
    // A knock and a shake each time the toboggan hits a bankina (and loses speed to it).
    if (st.bankHits > this.bankHits) {
      this.sound.knock();
      navigator.vibrate?.(35);
    }
    this.bankHits = st.bankHits;
    this.sound.update({
      speed: this.stage === 'falling' || st.stopped ? 0 : st.v,
      posture: st.posture,
      rake: (this.sim.input.rakeLeft + this.sim.input.rakeRight) / 2,
      riding: st.phase === 'riding' || st.phase === 'finished',
    });
  }

  /** Raking boots throw up a spray of ice powder, more the harder and faster they bite. */
  private sprayRakes(dt: number) {
    const st = this.sim.state;
    if (st.phase !== 'riding' && st.phase !== 'finished') return;
    if (st.v < 1.5 || st.stopped) return;
    const rakes = [this.sim.input.rakeLeft, this.sim.input.rakeRight];
    if (rakes[0] < 0.05 && rakes[1] < 0.05) return;
    this.model.root.updateMatrixWorld(true);
    rakes.forEach((rake, side) => {
      if (rake < 0.05) return;
      this.powderDue[side] += rake * Math.min(st.v, 30) * dt * 15;
      const count = Math.floor(this.powderDue[side]);
      this.powderDue[side] -= count;
      if (count > 0) this.debris.spray(this.model.rakeWorld(side, this.rakePos), this.riderVel, count);
    });
  }

  /** The key for this rider's best time on this toboggan from this start. */
  private bestKey() {
    return `vlc-best-${this.selection.rider}-${this.selection.toboggan}-${this.setup.label}`;
  }

  private storedBest(): number | null {
    if (this.setup.career) return this.setup.career.best ?? null;
    try {
      return Number(localStorage.getItem(this.bestKey())) || null;
    } catch {
      return null; // storage unavailable: no personal best
    }
  }

  /**
   * Came to rest at Celerina: then up by the finish hut among the riders already in, on their feet,
   * arms raised, to applause. On a Hello Hello everyone there celebrates with them.
   */
  private celebrate() {
    this.stage = 'celebrate';
    this.stageTime = 0;
    this.applyCam();
    const best = this.storedBest();
    this.hello = best !== null && this.sim.state.finishTime! < best;
    this.finishSpot = this.crowd?.finishSpot() ?? null;
    this.crowd?.celebrateFinish(this.hello);
    // Cut straight to the hut.
    this.snap = !!this.finishSpot;
    this.sound.applause();
    navigator.vibrate?.([20, 60, 20]);
  }

  private snapshot(): Snapshot {
    const st = this.sim.state;
    const input = this.sim.input;
    return {
      t: this.simClock,
      s: st.s,
      u: st.u,
      v: st.v,
      w: st.w,
      posture: st.posture,
      steer: input.steer,
      rakeLeft: input.rakeLeft,
      rakeRight: input.rakeRight,
      mount: this.mountFor(st.phase),
      runPhase: this.runPhase,
      slidOff: st.tobogganS === null ? 0 : st.s - st.tobogganS,
    };
  }

  private record() {
    this.history.push(this.snapshot());
    const st = this.sim.state;
    while (st.s >= this.nextLineS && this.nextLineS <= LINE.to) {
      this.line.push(Math.round(st.u * 100) / 100, Math.round(Math.hypot(st.v, st.w) * 10) / 10);
      this.nextLineS += LINE.step;
    }
    while (this.history.length && this.history[0].t < this.simClock - REPLAY_BEFORE - 0.5) this.history.shift();
  }

  private placeRider() {
    const celebrating = this.stage === 'celebrate' || (this.stage === 'done' && this.sim.state.phase === 'finished');
    if (celebrating && this.finishSpot) {
      // By the finish hut, cheering, the toboggan beside them. Their body stands 0.62 m to the
      // left of the model's origin and a little behind it.
      const { at, heading } = this.finishSpot;
      const root = this.model.root;
      root.matrixAutoUpdate = false;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      root.matrix.compose(at.clone().add(new THREE.Vector3(0.25, 0, 0.62).applyQuaternion(q)), q, new THREE.Vector3(1, 1, 1));
      root.matrixWorldNeedsUpdate = true;
      this.riderPos.copy(at);
      this.riderVel.set(0, 0, 0);
      this.model.toboggan.position.x = 0;
      this.model.setHelmet(false);
      this.model.setPose({ posture: 0, steer: 0, rakeLeft: 0, rakeRight: 0, mount: 1, runPhase: 0, cheer: 1, cheerTime: performance.now() / 1000 });
      return;
    }
    const cheer = celebrating ? Math.min(1, this.stageTime / 0.8) : 0;
    this.placeModel(this.model, this.snapshot(), { cheer: this.stage === 'done' ? 1 : cheer, cheerTime: performance.now() / 1000 });
  }

  /** Pose a rider model from track coordinates; updates riderPos and riderVel. */
  private placeModel(model: RiderModel, snap: Snapshot, extra: { cheer: number; cheerTime: number } = { cheer: 0, cheerTime: 0 }) {
    const s = Math.min(snap.s, this.track.length);
    const frame = this.track.frame(s);
    const sp = surfaceAt(this.track.section(s), snap.u);
    toThree(this.track.toWorld(frame, sp.y, sp.z), this.riderPos);
    const up = toThree([
      frame.left[0] * sp.ny + frame.up[0] * sp.nz,
      frame.left[1] * sp.ny + frame.up[1] * sp.nz,
      frame.left[2] * sp.ny + frame.up[2] * sp.nz,
    ]).normalize();
    const across = toThree([
      frame.left[0] * sp.ty + frame.up[0] * sp.tz,
      frame.left[1] * sp.ty + frame.up[1] * sp.tz,
      frame.left[2] * sp.ty + frame.up[2] * sp.tz,
    ]);
    const forward = toThree(frame.forward);
    this.riderVel.copy(forward).multiplyScalar(snap.v).addScaledVector(across, snap.w);
    // Yaw the toboggan towards its actual direction of travel.
    const heading = forward.clone().multiplyScalar(Math.max(snap.v, 0.5)).addScaledVector(across, snap.w).normalize();
    const right = new THREE.Vector3().crossVectors(heading, up).normalize();
    heading.crossVectors(up, right).normalize();
    const root = model.root;
    root.matrixAutoUpdate = false;
    root.matrix.makeBasis(heading, up, right).setPosition(this.riderPos);
    root.matrixWorldNeedsUpdate = true;
    // On the finish mat the toboggan has stopped; the rider has slid on ahead of it.
    model.toboggan.position.x = -snap.slidOff;
    model.setPose({
      posture: snap.posture,
      steer: snap.steer,
      rakeLeft: snap.rakeLeft,
      rakeRight: snap.rakeRight,
      mount: snap.mount,
      runPhase: snap.runPhase,
      cheer: extra.cheer,
      cheerTime: extra.cheerTime,
    });
  }

  private mountFor(phase: string): number {
    if (this.setup.start !== 'running') return 1;
    if (phase === 'running' || phase === 'waiting') return 0;
    return Math.min(1, this.mountTime / 0.45);
  }

  private startFall() {
    this.model.contactShadow.visible = false;
    this.stage = 'falling';
    this.onMusic();
    this.applyCam();
    this.stageTime = 0;
    this.sound.fallBells();
    const fallen = this.sim.state.fall!;
    const sec = this.track.section(fallen.s);
    this.fallOnStraw = (fallen.side === 'left' ? sec.runoffLeft : sec.runoffRight) === 'straw';
    navigator.vibrate?.([30, 40, 60]);
    const root = this.model.root;
    root.matrixAutoUpdate = true;
    root.matrix.decompose(root.position, root.quaternion, root.scale);
    root.updateMatrixWorld(true);
    this.ragdoll.start(
      [
        { object: this.model.body, radius: 0.25, kick: 2.2 },
        { object: this.model.toboggan, radius: 0.08, kick: 0.8 },
      ],
      this.riderVel,
      Math.floor(this.sim.state.s * 100) + 7,
    );
    // Close-up from the inside of the run, following the tumble.
    const st = this.sim.state;
    this.fallTime = this.simClock;
    this.fallPoint.copy(this.riderPos);
    // A gasp from the path, and the visitors nearby run for it.
    this.sound.gasp();
    this.crowd?.scare(this.fallPoint);
    const frame = this.track.frame(Math.min(st.s, this.track.length));
    const side = st.fall?.side === 'left' ? -1 : 1;
    this.closeUpSide.copy(toThree([frame.left[0] * side, frame.left[1] * side, 0])).normalize();
    this.fallCamPos.copy(this.fallPoint).addScaledVector(this.closeUpSide, 4.5).add(new THREE.Vector3(0, 1.8, 0));
    this.snap = true;
  }

  /** Replay the last seconds before the fall and the tumble, from a camera circling overhead. */
  private startReplay() {
    $('ride-card').hidden = true;
    this.stage = 'replay';
    this.stageTime = 0;
    this.orbitTime = 0;
    this.replayClock = Math.max(this.history[0]?.t ?? this.fallTime, this.fallTime - REPLAY_BEFORE);
    if (!this.replayModel) {
      this.replayModel = new RiderModel(LOOKS[this.selection.rider], this.selection.toboggan);
      this.world.scene.add(this.replayModel.root);
    }
    this.banner('Replay', 'Tap to skip');
    $('ride-banner').classList.add('replay');
  }

  private updateReplay(realDt: number) {
    this.replayClock += realDt * REPLAY_SPEED;
    this.orbitTime += realDt;
    const model = this.replayModel!;
    if (this.replayClock < this.fallTime) {
      const snap = this.historyAt(this.replayClock);
      model.root.visible = true;
      this.ragdoll.setVisible(false);
      this.placeModel(model, snap);
    } else {
      model.root.visible = false;
      this.ragdoll.setVisible(true);
      this.ragdoll.showAt(this.replayClock - this.fallTime);
      if (this.replayClock - this.fallTime > this.ragdoll.duration + 0.4) this.endReplay();
    }
  }

  /** The rider's state at time t, blended between the recorded frames either side. */
  private historyAt(t: number): Snapshot {
    const h = this.history;
    let i = h.findIndex((x) => x.t >= t);
    if (i < 0) return h[h.length - 1];
    if (i === 0) return h[0];
    const a = h[i - 1];
    const b = h[i];
    const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
    const mix = (x: number, y: number) => x + (y - x) * k;
    return {
      t,
      s: mix(a.s, b.s),
      u: mix(a.u, b.u),
      v: mix(a.v, b.v),
      w: mix(a.w, b.w),
      posture: mix(a.posture, b.posture),
      steer: mix(a.steer, b.steer),
      rakeLeft: mix(a.rakeLeft, b.rakeLeft),
      rakeRight: mix(a.rakeRight, b.rakeRight),
      mount: mix(a.mount, b.mount),
      runPhase: mix(a.runPhase, b.runPhase),
      slidOff: mix(a.slidOff, b.slidOff),
    };
  }

  private endReplay() {
    this.replayModel!.root.visible = false;
    this.ragdoll.setVisible(true);
    this.ragdoll.showAt(this.ragdoll.duration);
    $('ride-banner').classList.remove('replay');
    this.banner('', '');
    const fall = this.sim.state.fall!;
    this.result = { time: null, fall: { kind: fall.kind, zone: fall.zone }, speed: 0, line: this.line.slice() };
    this.card(`Fall at ${fall.zone}`, `You ${FALL_TEXT[fall.kind]}.${this.setup.career?.race ? ' Disqualified.' : ''}`, this.setup.career?.fallLines?.(fall.kind, fall.zone) ?? []);
    $('ride-replay').hidden = false;
    this.stage = 'done';
  }

  private finish() {
    this.stage = 'done';
    const st = this.sim.state;
    const time = st.finishTime!;
    const best = this.storedBest();
    try {
      if (!best || time < best) localStorage.setItem(this.bestKey(), time.toFixed(2));
    } catch {
      /* storage unavailable: no personal best */
    }
    // "Hello Hello!" only when beating a best that already stood.
    const beaten = this.hello;
    this.result = { time, fall: null, speed: (st.finishSpeed ?? 0) * MPH, line: this.line.slice() };
    const lines: string[] = [];
    if (beaten) lines.push(`New best · previous ${best!.toFixed(2)}`);
    else if (best) lines.push(`Best ${best.toFixed(2)}`);
    lines.push(`Top speed ${(st.topSpeed * MPH).toFixed(1)} mph`);
    const speed = ((st.finishSpeed ?? 0) * MPH).toFixed(1);
    const who = `${RIDERS[this.selection.rider].name} · ${TOBOGGANS[this.selection.toboggan].name} · ${this.setup.label}`;
    this.card(beaten ? 'Hello Hello!' : 'Welcome to Celerina!', who, lines, `${time.toFixed(2)}<small>s</small> ${speed}<small>mph</small>`);
    $('ride-replay').hidden = true;
  }

  private card(title: string, subtitle: string, lines: string[], time = '') {
    $('ride-card-title').textContent = title;
    $('ride-card-time').innerHTML = time;
    $('ride-card').classList.toggle('message', !!time);
    $('ride-card-subtitle').textContent = subtitle;
    $('ride-card-lines').replaceChildren(...lines.map((l) => Object.assign(document.createElement('div'), { textContent: l })));
    $('ride-card').hidden = false;
  }

  private updateCamera(dt: number) {
    const cam = this.world.camera;
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();
    const st = this.sim.state;
    if (this.stage === 'falling') {
      // Close-up from the run side of the fall, turning to follow the tumbling rider.
      const focus = this.ragdoll.focus() ?? this.fallPoint;
      desiredPos.copy(this.fallPoint).addScaledVector(this.closeUpSide, 5).add(new THREE.Vector3(0, 2.4, 0));
      desiredLook.copy(focus);
    } else if (this.stage === 'replay' || (this.stage === 'done' && st.phase === 'fallen')) {
      // Fly over the fall: circle above it, watching the rider.
      const angle = Math.atan2(this.closeUpSide.z, this.closeUpSide.x) + this.orbitTime * 0.28;
      desiredPos.copy(this.fallPoint).add(new THREE.Vector3(Math.cos(angle) * 12, 8.5, Math.sin(angle) * 12));
      const subject = this.replayModel?.root.visible ? this.riderPos : this.ragdoll.focus();
      desiredLook.copy(subject ?? this.fallPoint);
    } else if (this.stage === 'celebrate' || (this.stage === 'done' && st.phase === 'finished')) {
      if (this.finishSpot) {
        // In front of the rider by the finish hut, the riders gathered round them.
        desiredPos.copy(this.finishSpot.camera);
        desiredLook.copy(this.finishSpot.look);
      } else {
        // In front of the rider at Celerina, a little to the side, as they celebrate.
        const s = Math.min(st.s, this.track.length);
        const back = this.track.frame(Math.max(0, s - 7));
        toThree(this.track.toWorld(back, -2.5, 2.2), desiredPos);
        desiredLook.copy(this.riderPos).add(new THREE.Vector3(0, 0.9, 0));
      }
    } else if (this.stage === 'ready' || this.stage === 'countdown') {
      const s0 = this.setup.startS;
      if (s0 > 4) {
        // Junction: from across the run, the start line, the starter and the riders getting ready
        // on the terrace by the hut, the walkway beyond.
        const side = junctionTerrace(this.track).side;
        toThree(this.track.toWorld(this.track.frame(s0 + 4), -side * 5.5, 4.8), desiredPos);
        toThree(this.track.toWorld(this.track.frame(s0 - 2.5), side * 2.8, 0.9), desiredLook);
      } else {
        // Top: from a little way down the run looking back up: rider, start and hut.
        const below = this.track.frame(s0 + 11);
        toThree(this.track.toWorld(below, -1.6, 2.4), desiredPos);
        const behind = this.track.frame(Math.max(0, s0 - 4));
        toThree(this.track.toWorld(behind, 1.5, 1.6), desiredLook);
        desiredLook.addScaledVector(toThree(this.track.frame(0).forward), -6);
      }
    } else {
      const s = Math.min(st.s, this.track.length);
      const sp = surfaceAt(this.track.section(s), st.u);
      if (this.cam === 'chase') {
        const sBack = Math.max(0, s - 5.5);
        const back = this.track.frame(sBack);
        const spBack = surfaceAt(this.track.section(sBack), st.u);
        const p = this.track.toWorld(back, spBack.y * 0.7, 1.9 + spBack.z * 0.8);
        const extra = 5.5 - (s - sBack);
        toThree([p[0] - back.forward[0] * extra, p[1] - back.forward[1] * extra, p[2] - back.forward[2] * extra], desiredPos);
        const ahead = this.track.frame(Math.min(this.track.length, s + 4));
        toThree(this.track.toWorld(ahead, sp.y * 0.8, 0.35 + sp.z), desiredLook);
      } else {
        // Through the visor: at the rider's eyes, half-rolling with them on the banks, looking
        // along the run with the toboggan's nose and the gloves at the bottom of a wide view.
        this.model.root.updateMatrixWorld(true);
        const eyes = this.model.head.getWorldPosition(new THREE.Vector3());
        const m = this.model.root.matrix;
        const fwd = new THREE.Vector3().setFromMatrixColumn(m, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(m, 1);
        cam.position.copy(eyes).addScaledVector(fwd, 0.17).addScaledVector(up, 0.04);
        cam.up.set(0, 1, 0).lerp(up, 0.45).normalize();
        const ahead = this.track.frame(Math.min(this.track.length, s + 14));
        cam.lookAt(toThree(this.track.toWorld(ahead, sp.y * 0.6, sp.z * 0.6 - 0.4)));
        this.camPos.copy(cam.position);
        this.world.followSun(this.riderPos);
        return;
      }
    }
    const k = this.snap ? 1 : 1 - Math.exp(-dt * 9);
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, this.snap ? 1 : 1 - Math.exp(-dt * 12));
    this.snap = false;
    cam.position.copy(this.camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.camLook);
    this.world.followSun(this.riderPos);
  }

  private updateHud() {
    const st = this.sim.state;
    $('ride-zone').textContent = this.track.zoneName(Math.min(st.s, this.track.length));
    $('ride-time').textContent = (st.finishTime ?? st.time ?? 0).toFixed(2);
    $('ride-mph').textContent = (st.v * MPH).toFixed(0);
    $('ride-posture').textContent = st.posture > 0.5 ? 'KNIVES' : 'FORWARD';
    $('ride-posture').classList.toggle('on-knives', st.posture > 0.5);
    $('zones').classList.toggle('active', this.stage === 'live');
  }
}

/** Free rides: today's weather, the same all day. */
export function freeRideWeather(): Weather | null {
  const d = new Date();
  return weatherFor(`free-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
}
