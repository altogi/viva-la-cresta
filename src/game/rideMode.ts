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
import { trackSurfaceHeight } from '../render/trackMesh';
import { Ragdoll } from '../render/ragdoll';
import { FallDebris } from '../render/particles';
import { toThree } from '../render/util';
import type { Sound } from '../audio/sound';

export interface RideSetup {
  startS: number;
  start: StartStyle;
  label: string;
  steps?: number;
}

type Stage = 'ready' | 'countdown' | 'live' | 'falling' | 'replay' | 'done';

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
};

export class RideMode {
  private sim!: RideSim;
  private model!: RiderModel;
  private setup!: RideSetup;
  private stage: Stage = 'ready';
  private stageTime = 0;
  private cam: Cam = 'chase';
  private runPhase = 0;
  /** Seconds since diving onto the toboggan (for the jump-on animation). */
  private mountTime = 0;
  private wasRunning = false;
  private history: Snapshot[] = [];
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
    terrain: Terrain,
    private readonly sound: Sound,
  ) {
    this.controls = new Controls($('zones'));
    this.controls.onTap = (zone) => {
      if (zone === 'run') this.sound.step();
    };
    // Ground for tumbling bodies and debris: the track's ice, banks and straw where they are, else the hillside.
    const groundAt = (x: number, z: number) => {
      const y = -z;
      const ground = terrain.height(x, y);
      const { station } = terrain.distanceToTrack(x, y);
      if (!station) return ground;
      const lateral = (x - station.pos[0]) * station.left[0] + (y - station.pos[1]) * station.left[1];
      const h = trackSurfaceHeight(track, station.s, lateral);
      return h === null ? ground : Math.max(ground, station.pos[2] + h);
    };
    this.ragdoll = new Ragdoll(world.scene, groundAt);
    this.debris = new FallDebris(groundAt);
    world.scene.add(this.debris.group);
    // The red padding beyond Shuttlecock's straw stops riders who fly out.
    this.ragdoll.constrain = (pos, vel) => {
      if (!this.fallOnStraw) return;
      const { station } = terrain.distanceToTrack(pos.x, -pos.z);
      if (!station) return;
      const pts = track.crossSection(station.s);
      const lateral = (pos.x - station.pos[0]) * station.left[0] + (-pos.z - station.pos[1]) * station.left[1];
      const side = this.sim.state.fall?.side === 'left' ? 1 : -1;
      const pad = (side > 0 ? pts[pts.length - 1].y : pts[0].y) + side * 8.3;
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
      if (this.stage === 'ready' && (e.code === 'Space' || e.code === 'Enter')) this.countdown();
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
    this.ragdoll.clear();
    this.replayModel?.root.removeFromParent();
    this.replayModel = null;
    this.history = [];
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
    this.applyCam();
    this.stageTime = 0;
    this.snap = true;
    this.mountTime = 0;
    this.wasRunning = false;
    this.runPhase = 0;
    document.body.classList.add('riding');
    $('ride-card').hidden = true;
    this.banner('Rider on the ice', setup.start === 'running' ? 'Tap to start · then tap RUN to run' : 'Tap to start · lying start');
    this.placeRider();
  }

  /** Helmet view: hide your own helmet and let the camera get close to the toboggan. */
  private applyCam() {
    const helmet = this.cam === 'helmet' && (this.stage === 'live' || this.stage === 'done');
    if (this.model) this.model.head.visible = !helmet;
    this.world.camera.near = helmet ? 0.03 : 0.1;
    this.world.camera.fov = helmet ? 82 : 62;
    this.world.camera.updateProjectionMatrix();
  }

  private countdown() {
    this.sound.start();
    this.stage = 'countdown';
    this.stageTime = 0;
    this.banner('', '');
  }

  private exit() {
    this.ragdoll.clear();
    this.replayModel?.root.removeFromParent();
    this.replayModel = null;
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
      this.applyCam();
      this.controls.setRunning(this.sim.state.phase === 'running');
    }
    if (this.stage === 'live' || this.stage === 'done') dt = realDt * GAME_SPEED;
    if (this.stage === 'falling') dt = realDt * (this.stageTime < 2.4 ? 0.3 : 1);

    if (this.stage === 'live') {
      this.simClock += dt;
      const input = this.autopilot
        ? autopilotInput(this.track, this.sim, this.autopilot, this.simClock, this.lastStride)
        : this.controls.read(dt);
      this.sim.update(dt, input);
      const st = this.sim.state;
      // Legs keep pace with the ground covered: one stride every ~1.7 m.
      if (st.phase === 'running') this.runPhase += (st.v * dt * Math.PI) / 1.7;
      if (this.wasRunning && st.phase !== 'running') this.mountTime = 0;
      this.wasRunning = st.phase === 'running';
      this.mountTime += dt;
      this.record();
      if (st.phase !== 'running') this.controls.setRunning(false);
      if (st.phase === 'fallen') this.startFall();
      else if (st.phase === 'finished' && this.stageTime > 0 && st.s > TRACK_LENGTH + 8) this.finish();
    } else if (this.stage === 'done' && this.sim.state.phase === 'finished') {
      this.sim.update(dt, this.controls.read(dt));
    }

    this.debris.update(this.stage === 'falling' ? dt : realDt * REPLAY_SPEED);
    if (this.stage === 'falling') {
      this.ragdoll.update(dt);
      if (this.stageTime > 3.2) this.startReplay();
    } else if (this.stage === 'replay') {
      this.updateReplay(realDt);
    } else if (!(this.stage === 'done' && this.sim.state.phase === 'fallen')) {
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
    };
  }

  private record() {
    this.history.push(this.snapshot());
    while (this.history.length && this.history[0].t < this.simClock - REPLAY_BEFORE - 0.5) this.history.shift();
  }

  private placeRider() {
    this.placeModel(this.model, this.snapshot());
  }

  /** Pose a rider model from track coordinates; updates riderPos and riderVel. */
  private placeModel(model: RiderModel, snap: Snapshot) {
    const s = Math.min(snap.s, TRACK_LENGTH);
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
    model.setPose({
      posture: snap.posture,
      steer: snap.steer,
      rakeLeft: snap.rakeLeft,
      rakeRight: snap.rakeRight,
      mount: snap.mount,
      runPhase: snap.runPhase,
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
    const frame = this.track.frame(Math.min(st.s, TRACK_LENGTH));
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
      this.replayModel = new RiderModel();
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
      const snap = this.history.find((h) => h.t >= this.replayClock) ?? this.history[this.history.length - 1];
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

  private endReplay() {
    this.replayModel!.root.visible = false;
    this.ragdoll.setVisible(true);
    this.ragdoll.showAt(this.ragdoll.duration);
    $('ride-banner').classList.remove('replay');
    this.banner('', '');
    const fall = this.sim.state.fall!;
    this.card(`Fall at ${fall.zone}`, `You ${FALL_TEXT[fall.kind]}. Disqualified.`, []);
    $('ride-replay').hidden = false;
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
    $('ride-replay').hidden = true;
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
    } else if (this.stage === 'ready' || this.stage === 'countdown') {
      // The start, seen from a little way down the run looking back up: rider, start and hut.
      const s0 = this.setup.startS;
      const below = this.track.frame(s0 + 11);
      toThree(this.track.toWorld(below, -1.6, 2.4), desiredPos);
      const behind = this.track.frame(Math.max(0, s0 - 4));
      toThree(this.track.toWorld(behind, 1.5, 1.6), desiredLook);
      if (s0 < 4) desiredLook.addScaledVector(toThree(this.track.frame(0).forward), -6);
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
        // Through the visor: at the rider's eyes, half-rolling with them on the banks, looking
        // along the run with the toboggan's nose and the gloves at the bottom of a wide view.
        this.model.root.updateMatrixWorld(true);
        const eyes = this.model.head.getWorldPosition(new THREE.Vector3());
        const m = this.model.root.matrix;
        const fwd = new THREE.Vector3().setFromMatrixColumn(m, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(m, 1);
        cam.position.copy(eyes).addScaledVector(fwd, 0.17).addScaledVector(up, 0.04);
        cam.up.set(0, 1, 0).lerp(up, 0.45).normalize();
        const ahead = this.track.frame(Math.min(TRACK_LENGTH, s + 14));
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
    $('ride-zone').textContent = this.track.zoneName(Math.min(st.s, TRACK_LENGTH));
    $('ride-time').textContent = (st.finishTime ?? st.time ?? 0).toFixed(2);
    $('ride-mph').textContent = (st.v * MPH).toFixed(0);
    $('ride-posture').textContent = st.posture > 0.5 ? 'KNIVES' : 'FORWARD';
    $('ride-posture').classList.toggle('on-knives', st.posture > 0.5);
    $('zones').classList.toggle('active', this.stage === 'live');
  }
}
