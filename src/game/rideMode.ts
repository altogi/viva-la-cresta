// One ride down the Cresta: "Rider on the ice", the bell, the start, the ride itself with the
// chase camera, then the finish, or a fall in slow motion and the disqualification.

import * as THREE from 'three';
import { Controls } from '../input/controls';
import { RideSim, type StartStyle } from '../sim/physics';
import { ADELAIDE, TRADITIONAL } from '../sim/rider';
import { surfaceAt } from '../sim/surface';
import type { Track } from '../sim/track';
import { SPLITS, autopilotInput, type Policy } from '../sim/autopilot';
import { TRACK_LENGTH } from '../track/cresta';
import type { World } from '../render/world';
import type { Terrain } from '../render/terrain';
import { RiderModel } from '../render/riderModel';
import { Ragdoll } from '../render/ragdoll';
import { toThree } from '../render/util';
import type { Sound } from '../audio/sound';

export interface RideSetup {
  startS: number;
  start: StartStyle;
  label: string;
  steps?: number;
}

type Stage = 'ready' | 'countdown' | 'live' | 'falling' | 'done';
type Cam = 'chase' | 'helmet';

const MPH = 2.23694;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const FALL_TEXT: Record<string, string> = {
  'fly-out': 'flew out over the lip',
  'over-wall': 'went over the wall',
  crash: 'came down the wall too hard and lost the toboggan',
};

export class RideMode {
  private sim!: RideSim;
  private model!: RiderModel;
  private setup!: RideSetup;
  private stage: Stage = 'ready';
  private stageTime = 0;
  private cam: Cam = 'chase';
  private runPhase = 0;
  private readonly controls: Controls;
  private readonly ragdoll: Ragdoll;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly riderPos = new THREE.Vector3();
  private readonly riderVel = new THREE.Vector3();
  private snap = true;
  private fallCamPos = new THREE.Vector3();
  private simClock = 0;
  private readonly lastStride = { t: -1 };
  /** Debug: let a bot ride instead of the player (?autopilot=good). */
  autopilot: Policy | null = null;
  onExit: () => void = () => {};

  constructor(
    private readonly world: World,
    private readonly track: Track,
    private readonly terrain: Terrain,
    private readonly sound: Sound,
  ) {
    this.controls = new Controls($('zones'));
    this.controls.onTap = (zone) => {
      if (zone === 'run') this.sound.step();
    };
    this.ragdoll = new Ragdoll(world.scene, (x, z) => terrain.height(x, -z));
    $('ride-banner').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stage === 'ready') this.countdown();
    });
    window.addEventListener('keydown', (e) => {
      if (this.stage === 'ready' && (e.code === 'Space' || e.code === 'Enter')) this.countdown();
    });
    $('ride-again').addEventListener('click', () => this.begin(this.setup));
    $('ride-menu').addEventListener('click', () => this.exit());
    $('ride-quit').addEventListener('click', () => this.exit());
    $('ride-cam').addEventListener('click', () => {
      this.cam = this.cam === 'chase' ? 'helmet' : 'chase';
      $('ride-cam').textContent = this.cam === 'chase' ? 'Chase' : 'Helmet';
    });
  }

  begin(setup: RideSetup) {
    this.setup = setup;
    this.ragdoll.clear();
    if (this.model) this.model.root.removeFromParent();
    this.model = new RiderModel();
    this.world.scene.add(this.model.root);
    this.sim = new RideSim(this.track, ADELAIDE, TRADITIONAL, {
      startS: setup.startS,
      start: setup.start,
      steps: setup.steps,
      splitsAt: SPLITS,
    });
    this.controls.reset(false);
    this.controls.setRunning(false);
    this.stage = 'ready';
    this.stageTime = 0;
    this.snap = true;
    document.body.classList.add('riding');
    $('ride-card').hidden = true;
    this.banner('Rider on the ice', setup.start === 'running' ? 'Tap to start · then tap RUN to run' : 'Tap to start · lying start');
    this.placeRider();
  }

  private countdown() {
    this.sound.start();
    this.stage = 'countdown';
    this.stageTime = 0;
    this.banner('', '');
  }

  private exit() {
    this.ragdoll.clear();
    this.model?.root.removeFromParent();
    document.body.classList.remove('riding');
    this.sound.update({ speed: 0, posture: 0, rake: 0, riding: false });
    this.onExit();
  }

  private banner(title: string, hint: string) {
    const el = $('ride-banner');
    el.hidden = !title;
    $('ride-banner-title').textContent = title;
    $('ride-banner-hint').textContent = hint;
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
      this.stage = 'live';
      this.stageTime = 0;
      this.controls.setRunning(this.sim.state.phase === 'running');
    }
    if (this.stage === 'falling') dt = realDt * (this.stageTime < 2.4 ? 0.3 : 1);

    if (this.stage === 'live') {
      this.simClock += dt;
      const input = this.autopilot
        ? autopilotInput(this.track, this.sim, this.autopilot, this.simClock, this.lastStride)
        : this.controls.read(dt);
      this.sim.update(dt, input);
      const st = this.sim.state;
      if (st.phase === 'running') this.runPhase += input.runTaps * Math.PI;
      if (st.phase !== 'running') this.controls.setRunning(false);
      if (st.phase === 'fallen') this.startFall();
      else if (st.phase === 'finished' && this.stageTime > 0 && st.s > TRACK_LENGTH + 8) this.finish();
    } else if (this.stage === 'done' && this.sim.state.phase === 'finished') {
      this.sim.update(dt, this.controls.read(dt));
    }

    if (this.stage === 'falling') {
      this.ragdoll.update(dt);
      if (this.stageTime > 3.4 && $('ride-card').hidden) this.showFallCard();
    } else {
      this.placeRider();
    }
    this.updateCamera(realDt);
    this.updateHud();
    const st = this.sim.state;
    this.sound.update({
      speed: this.stage === 'falling' ? 0 : st.v,
      posture: st.posture,
      rake: (this.sim.input.rakeLeft + this.sim.input.rakeRight) / 2,
      riding: st.phase === 'riding' || st.phase === 'finished',
    });
  }

  /** Rider position and orientation from the simulation's track coordinates. */
  private placeRider() {
    const st = this.sim.state;
    const s = Math.min(st.s, TRACK_LENGTH);
    const frame = this.track.frame(s);
    const sp = surfaceAt(this.track.section(s), st.u);
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
    this.riderVel.copy(forward).multiplyScalar(st.v).addScaledVector(across, st.w);
    // Yaw the toboggan towards its actual direction of travel.
    const heading = forward.clone().multiplyScalar(Math.max(st.v, 0.5)).addScaledVector(across, st.w).normalize();
    const right = new THREE.Vector3().crossVectors(heading, up).normalize();
    heading.crossVectors(up, right).normalize();
    const root = this.model.root;
    root.matrixAutoUpdate = false;
    root.matrix.makeBasis(heading, up, right).setPosition(this.riderPos);
    root.matrixWorldNeedsUpdate = true;
    const input = this.sim.input;
    this.model.setPose({
      posture: st.posture,
      steer: input.steer,
      rakeLeft: input.rakeLeft,
      rakeRight: input.rakeRight,
      running: st.phase === 'running' || (st.phase === 'waiting' && this.setup.start === 'running'),
      runPhase: this.runPhase,
    });
  }

  private startFall() {
    this.stage = 'falling';
    this.stageTime = 0;
    this.sound.thud();
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
    // A spectator's view of the fall from the inside of the run, looking across the ice.
    const st = this.sim.state;
    const frame = this.track.frame(Math.max(0, st.s - 10));
    const side = st.fall?.side === 'left' ? -1 : 1;
    const x = frame.pos[0] + frame.left[0] * side * 8;
    const y = frame.pos[1] + frame.left[1] * side * 8;
    this.fallCamPos.set(x, Math.max(this.terrain.height(x, y), frame.pos[2]) + 4, -y);
  }

  private showFallCard() {
    const fall = this.sim.state.fall!;
    this.card(`Fall at ${fall.zone}`, `You ${FALL_TEXT[fall.kind]}. Disqualified.`, []);
    this.stage = 'done';
  }

  private finish() {
    this.stage = 'done';
    const st = this.sim.state;
    const time = st.finishTime!;
    const key = `vlc-best-${this.setup.label}`;
    let best: number | null = null;
    try {
      best = Number(localStorage.getItem(key)) || null;
      if (!best || time < best) localStorage.setItem(key, time.toFixed(2));
    } catch {
      /* storage unavailable: no personal best */
    }
    const lines = [`Top speed ${(st.topSpeed * MPH).toFixed(1)} mph`];
    if (best && time >= best) lines.push(`Best ${best.toFixed(2)}`);
    else if (best) lines.push(`New best! (was ${best.toFixed(2)})`);
    this.card(time.toFixed(2), this.setup.label, lines);
  }

  private card(title: string, subtitle: string, lines: string[]) {
    $('ride-card-title').textContent = title;
    $('ride-card-subtitle').textContent = subtitle;
    $('ride-card-lines').replaceChildren(...lines.map((l) => Object.assign(document.createElement('div'), { textContent: l })));
    $('ride-card').hidden = false;
  }

  private updateCamera(dt: number) {
    const cam = this.world.camera;
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();
    const st = this.sim.state;
    if (this.stage === 'falling' || (this.stage === 'done' && st.phase === 'fallen')) {
      desiredPos.copy(this.fallCamPos);
      desiredLook.copy(this.ragdoll.focus() ?? this.riderPos);
    } else {
      const s = Math.min(st.s, TRACK_LENGTH);
      const sp = surfaceAt(this.track.section(s), st.u);
      if (this.cam === 'chase') {
        const sBack = Math.max(0, s - 5.5);
        const back = this.track.frame(sBack);
        const spBack = surfaceAt(this.track.section(sBack), st.u);
        const p = this.track.toWorld(back, spBack.y * 0.7, 1.9 + spBack.z * 0.8);
        const extra = 5.5 - (s - sBack);
        toThree([p[0] - back.forward[0] * extra, p[1] - back.forward[1] * extra, p[2] - back.forward[2] * extra], desiredPos);
        const ahead = this.track.frame(Math.min(TRACK_LENGTH, s + 4));
        toThree(this.track.toWorld(ahead, sp.y * 0.8, 0.35 + sp.z), desiredLook);
      } else {
        const here = this.track.frame(Math.min(TRACK_LENGTH, s + 0.8));
        toThree(this.track.toWorld(here, sp.y, sp.z + 0.5), desiredPos);
        const ahead = this.track.frame(Math.min(TRACK_LENGTH, s + 18));
        toThree(this.track.toWorld(ahead, sp.y * 0.5, 0.4), desiredLook);
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
    $('ride-zone').textContent = this.track.zoneName(Math.min(st.s, TRACK_LENGTH));
    $('ride-time').textContent = (st.finishTime ?? st.time ?? 0).toFixed(2);
    $('ride-mph').textContent = (st.v * MPH).toFixed(0);
    $('ride-posture').textContent = st.posture > 0.5 ? 'KNIVES' : 'FORWARD';
    $('ride-posture').classList.toggle('on-knives', st.posture > 0.5);
    $('zones').classList.toggle('active', this.stage === 'live');
  }
}
