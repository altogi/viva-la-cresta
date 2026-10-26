// Choosing who rides and on what: three rider cards with their strengths, a toboggan switch,
// and the chosen rider shown in 3D beside their toboggan at the Top.

import * as THREE from 'three';
import { RIDERS, TOBOGGANS, type RiderId, type RiderStats, type TobogganId } from '../sim/rider';
import type { Track } from '../sim/track';
import type { World } from '../render/world';
import { RiderModel, type IdleAction } from '../render/riderModel';
import { LOOKS } from '../render/riderLooks';
import { toThree } from '../render/util';
import { flagUrl } from '../ui/flags';
import { saveSelection, type Selection } from './selection';

const PROFILES: Record<RiderId, { flag: string; line: string; bio: string; action: IdleAction }> = {
  maximilian: {
    flag: 'Germany · 20',
    line: 'Light. Lanky. Lightning off the start.',
    bio: 'Out at Drakula till four, on the ice by nine. Arms like a crane, legs like a gazelle. Not much of him to carry speed.',
    action: 'comb',
  },
  adelaide: {
    flag: 'England · 25',
    line: 'Balanced. Fearless. No weak spots.',
    bio: 'Cold plunge before breakfast, family chalet above the lake. Middle weight, middle agility, maximum nerve.',
    action: 'flirt',
  },
  remo: {
    flag: 'Switzerland · 50',
    line: 'Heavy. Hairy. Hard to stop.',
    bio: 'Rides every day of the season. A rocket on the straights, a nightmare to slow down. Plan Shuttlecock early. Beer after.',
    action: 'burp',
  },
};

/** Seconds between idle gestures, and how long each takes. */
const ACTION_EVERY = 5.5;
const ACTION_LENGTH = 1.9;

const TOBOGGAN_TEXT: Record<TobogganId, string> = {
  traditional: 'Steel frame and sliding cushion. Forgiving. Every rider starts on one.',
  flattop: 'Carbon, flexible, shoulders down when forward. Faster, and very sensitive to every movement.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** 0…1 ratings for the stat bars, relative to the three riders. */
function ratings(r: RiderStats) {
  const range = (v: number, lo: number, hi: number) => Math.max(0.08, Math.min(1, (v - lo) / (hi - lo)));
  return [
    ['Weight', range(r.mass, 60, 108)],
    ['Agility', range(1 / r.transitionTime, 1 / 0.95, 1 / 0.35)],
    ['Steering reach', range(r.reach, 0.8, 1.3)],
    ['Running start', range(r.runSpeed, 7, 9.6)],
  ] as const;
}

/** Vertical field of view for the portrait of the rider. */
const PORTRAIT_FOV = 38;

/** Seconds for one rider to slide out of the frame and the next to slide in. */
const SWAP_TIME = 0.5;

export class SelectMode {
  private preview: RiderModel | null = null;
  /** The rider sliding out while the next slides in. */
  private outgoing: { model: RiderModel; dir: number } | null = null;
  private swap = 1;
  private readonly models = new Map<string, RiderModel>();
  private time = 0;
  private savedFov = 0;
  private height = 0;
  private scrollTarget: number | null = null;
  private readonly anchor = new THREE.Matrix4();
  private readonly spot = new THREE.Vector3();
  private readonly heading: number;
  private readonly ids = Object.keys(RIDERS) as RiderId[];
  onDone: (selection: Selection) => void = () => {};

  constructor(
    private readonly world: World,
    track: Track,
    public selection: Selection,
  ) {
    // Show the rider on the snow platform beside the Top start, by the hut.
    const st = track.frame(0);
    toThree(track.toWorld(st, 4.5, 0), this.spot);
    this.spot.addScaledVector(toThree(st.forward), -3);
    this.heading = track.heading(0);
    this.anchor.compose(this.spot, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading), new THREE.Vector3(1, 1, 1));
    this.buildCards();
    $('select-done').addEventListener('click', () => this.onDone(this.selection));
    for (const b of document.querySelectorAll<HTMLButtonElement>('.select-arrow')) {
      b.addEventListener('click', () => this.step(Number(b.dataset.step)));
    }
    window.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('selecting')) return;
      if (e.key === 'ArrowLeft') this.step(-1);
      else if (e.key === 'ArrowRight') this.step(1);
    });
  }

  private buildCards() {
    const list = $('select-riders');
    const dots = $('select-dots');
    list.replaceChildren();
    dots.replaceChildren();
    for (const id of this.ids) {
      const r = RIDERS[id];
      const p = PROFILES[id];
      const card = document.createElement('div');
      card.className = 'rider-card';
      card.dataset.rider = id;
      card.innerHTML = `
        <div class="rider-name"><img class="flag" src="${flagUrl(LOOKS[id].flag)}" alt="" />${r.name}</div>
        <div class="rider-flag">${p.flag} · ${p.line}</div>
        <div class="rider-bio">${p.bio}</div>
        <div class="rider-stats">${ratings(r)
          .map(([label, v]) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`)
          .join('')}</div>`;
      list.append(card);
      const dot = document.createElement('button');
      dot.dataset.rider = id;
      dot.setAttribute('aria-label', r.name);
      dot.addEventListener('click', () => this.choose({ ...this.selection, rider: id }, true));
      dots.append(dot);
    }
    // Swiping the cards changes the rider as soon as the next card is mostly in view.
    list.addEventListener(
      'scroll',
      () => {
        // While the arrows or dots drive the scroll, its passing positions don't choose anyone.
        if (this.scrollTarget !== null) {
          if (Math.abs(list.scrollLeft - this.scrollTarget) > 2) return;
          this.scrollTarget = null;
        }
        const id = this.ids[Math.round(list.scrollLeft / Math.max(1, list.clientWidth))];
        if (id && id !== this.selection.rider) this.choose({ ...this.selection, rider: id }, false);
      },
      { passive: true },
    );
    // A finger on the cards takes over from any arrow-driven scroll.
    list.addEventListener('pointerdown', () => (this.scrollTarget = null), { passive: true });
    list.addEventListener('touchstart', () => (this.scrollTarget = null), { passive: true });
    // However a scroll ends, the card left in view is the rider.
    list.addEventListener('scrollend', () => {
      // An arrow-driven scroll interrupted by the next one ends early: wait for the real end.
      if (this.scrollTarget !== null && Math.abs(list.scrollLeft - this.scrollTarget) > 2) return;
      this.scrollTarget = null;
      const id = this.ids[Math.round(list.scrollLeft / Math.max(1, list.clientWidth))];
      if (id && id !== this.selection.rider) this.choose({ ...this.selection, rider: id }, false);
    });
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-toboggan]')) {
      button.addEventListener('click', () => this.choose({ ...this.selection, toboggan: button.dataset.toboggan as TobogganId }, false));
    }
  }

  private step(by: number) {
    const i = (this.ids.indexOf(this.selection.rider) + by + this.ids.length) % this.ids.length;
    this.choose({ ...this.selection, rider: this.ids[i] }, true);
  }

  private choose(selection: Selection, scroll: boolean) {
    this.selection = selection;
    saveSelection(selection);
    this.refresh();
    if (scroll) this.scrollToRider('smooth');
  }

  private scrollToRider(behavior: ScrollBehavior) {
    const list = $('select-riders');
    const left = this.ids.indexOf(this.selection.rider) * list.clientWidth;
    this.scrollTarget = Math.abs(list.scrollLeft - left) > 2 ? left : null;
    list.scrollTo({ left, behavior });
  }

  private modelFor(rider: RiderId, toboggan: TobogganId): RiderModel {
    const key = `${rider}-${toboggan}`;
    let model = this.models.get(key);
    if (!model) {
      model = new RiderModel(LOOKS[rider], toboggan, { helmet: false });
      model.root.position.copy(this.spot);
      model.root.rotation.y = this.heading;
      this.models.set(key, model);
    }
    return model;
  }

  private refresh() {
    for (const dot of document.querySelectorAll<HTMLElement>('#select-dots button')) dot.classList.toggle('chosen', dot.dataset.rider === this.selection.rider);
    for (const b of document.querySelectorAll<HTMLElement>('[data-toboggan]')) b.classList.toggle('chosen', b.dataset.toboggan === this.selection.toboggan);
    $('select-toboggan-text').textContent = `${TOBOGGANS[this.selection.toboggan].name}: ${TOBOGGAN_TEXT[this.selection.toboggan]}`;
    // Models are kept once built (and the others are built ahead, a frame at a time).
    const model = this.modelFor(this.selection.rider, this.selection.toboggan);
    if (model === this.preview) return;
    const previous = this.preview;
    this.preview = model;
    this.time = 0;
    this.world.scene.add(model.root);
    if (!previous) return;
    const from = this.ids.indexOf(this.riderOf(previous));
    const to = this.ids.indexOf(this.selection.rider);
    // A rider still sliding out may be the one coming back: only drop it if it isn't.
    if (this.outgoing && this.outgoing.model !== model) this.outgoing.model.root.removeFromParent();
    if (from === to) {
      // Same rider, other toboggan: swap in place.
      previous.root.removeFromParent();
      this.outgoing = null;
      return;
    }
    // The new rider slides in from the side the cards moved, the old one slides out the other way.
    this.outgoing = { model: previous, dir: to > from ? 1 : -1 };
    this.swap = 0;
  }

  private riderOf(model: RiderModel): RiderId {
    for (const [key, m] of this.models) if (m === model) return key.split('-')[0] as RiderId;
    return this.selection.rider;
  }

  open() {
    this.time = 0;
    this.savedFov = this.world.camera.fov;
    this.refresh();
    this.scrollToRider('instant');
  }

  close() {
    this.preview?.root.removeFromParent();
    this.outgoing?.model.root.removeFromParent();
    this.preview = null;
    this.outgoing = null;
    this.swap = 1;
    const cam = this.world.camera;
    cam.clearViewOffset();
    cam.fov = this.savedFov || cam.fov;
    cam.updateProjectionMatrix();
  }

  update(dt: number) {
    this.time += dt;
    const preview = this.preview;
    if (!preview) return;
    // An idle gesture every few seconds (the first one soon after choosing).
    const cycle = (this.time + ACTION_EVERY - 1.2) / ACTION_EVERY;
    const index = Math.floor(cycle);
    const into = (cycle - index) * ACTION_EVERY;
    const acting = into < ACTION_LENGTH && this.swap >= 1;
    const action = PROFILES[this.selection.rider].action;
    preview.setPose({
      posture: 0, steer: 0, rakeLeft: 0, rakeRight: 0, mount: 1, runPhase: 0,
      stand: { time: this.time, action: acting ? action : null, t: into / ACTION_LENGTH },
    });
    this.frame(dt);
    this.slide(dt);
    this.prebuild();
    this.world.followSun(this.spot);
  }

  /** Slide the outgoing rider off and the new one on, across the screen. */
  private slide(dt: number) {
    const preview = this.preview!;
    this.swap = Math.min(1, this.swap + dt / SWAP_TIME);
    const e = this.swap * this.swap * (3 - 2 * this.swap);
    const right = new THREE.Vector3().setFromMatrixColumn(this.world.camera.matrixWorld, 0).setY(0).normalize();
    const dir = this.outgoing?.dir ?? 1;
    const width = 3.2;
    preview.root.position.copy(this.spot).addScaledVector(right, dir * (1 - e) * width);
    if (this.outgoing) {
      this.outgoing.model.root.position.copy(this.spot).addScaledVector(right, -dir * e * width);
      if (this.swap >= 1) {
        this.outgoing.model.root.removeFromParent();
        this.outgoing.model.root.position.copy(this.spot);
        this.outgoing = null;
      }
    }
  }

  /** Build the other riders on this toboggan ahead of time, one per frame, so swiping never stalls. */
  private prebuild() {
    if (this.swap < 1) return;
    const missing = this.ids.find((id) => !this.models.has(`${id}-${this.selection.toboggan}`));
    if (missing) this.modelFor(missing, this.selection.toboggan);
  }

  /**
   * The whole rider and their toboggan, framed in the space the panel leaves: the top half of a
   * phone, or left of the side panel on a wide screen. A slightly low camera, drifting a little.
   */
  private frame(dt: number) {
    const cam = this.world.camera;
    const canvas = this.world.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const side = w >= 760 && w >= h;
    cam.fov = PORTRAIT_FOV;
    if (side) cam.setViewOffset(w, h, 200, 0, w, h);
    else cam.setViewOffset(w, h, 0, h * 0.24, w, h);
    // The visible slice is half the frame tall on a phone, all of it beside the side panel.
    const visible = side ? 1 : 0.5;
    // Ease the framing between riders of different heights.
    const wanted = 1.75 * LOOKS[this.selection.rider].scale + 0.35;
    this.height = this.height ? this.height + (wanted - this.height) * (1 - Math.exp(-dt * 5)) : wanted;
    const height = this.height;
    const tan = Math.tan(THREE.MathUtils.degToRad(PORTRAIT_FOV / 2)) * visible;
    const width = 1.9;
    const dist = Math.max(height / 2 / tan, width / 2 / (tan * Math.min(1, (side ? w - 400 : w) / (h * visible))));
    // Aim between the rider and the toboggan, at mid height.
    const target = new THREE.Vector3(0.1, height / 2 - 0.12, -0.92).applyMatrix4(this.anchor);
    const yaw = 0.42 + Math.sin(this.time * 0.25) * 0.08;
    const local = new THREE.Vector3(Math.cos(yaw) * dist, 0, Math.sin(yaw) * dist).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    cam.position.copy(target).add(local).add(new THREE.Vector3(0, -0.12, 0));
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
  }
}
