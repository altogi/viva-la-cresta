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
import type { Sound } from '../audio/sound';
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

export class SelectMode {
  private preview: RiderModel | null = null;
  private time = 0;
  private lastAction = -1;
  private readonly spot = new THREE.Vector3();
  private readonly heading: number;
  onDone: (selection: Selection) => void = () => {};

  constructor(
    private readonly world: World,
    track: Track,
    public selection: Selection,
    private readonly sound: Sound,
  ) {
    // Show the rider on the snow platform beside the Top start, by the hut.
    const st = track.frame(0);
    toThree(track.toWorld(st, 4.5, 0), this.spot);
    this.spot.addScaledVector(toThree(st.forward), -3);
    this.heading = track.heading(0);
    this.buildCards();
    $('select-done').addEventListener('click', () => this.onDone(this.selection));
  }

  private buildCards() {
    const list = $('select-riders');
    list.replaceChildren();
    for (const id of Object.keys(RIDERS) as RiderId[]) {
      const r = RIDERS[id];
      const p = PROFILES[id];
      const card = document.createElement('button');
      card.className = 'rider-card';
      card.dataset.rider = id;
      card.innerHTML = `
        <div class="rider-name"><img class="flag" src="${flagUrl(LOOKS[id].flag)}" alt="" />${r.name}</div>
        <div class="rider-flag">${p.flag} · ${p.line}</div>
        <div class="rider-bio">${p.bio}</div>
        <div class="rider-stats">${ratings(r)
          .map(([label, v]) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`)
          .join('')}</div>`;
      card.addEventListener('click', () => this.choose({ ...this.selection, rider: id }));
      list.append(card);
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-toboggan]')) {
      button.addEventListener('click', () => this.choose({ ...this.selection, toboggan: button.dataset.toboggan as TobogganId }));
    }
  }

  private choose(selection: Selection) {
    this.selection = selection;
    saveSelection(selection);
    this.refresh();
  }

  private refresh() {
    for (const card of document.querySelectorAll<HTMLElement>('.rider-card')) card.classList.toggle('chosen', card.dataset.rider === this.selection.rider);
    for (const b of document.querySelectorAll<HTMLElement>('[data-toboggan]')) b.classList.toggle('chosen', b.dataset.toboggan === this.selection.toboggan);
    $('select-toboggan-text').textContent = `${TOBOGGANS[this.selection.toboggan].name}: ${TOBOGGAN_TEXT[this.selection.toboggan]}`;
    this.preview?.root.removeFromParent();
    this.preview = new RiderModel(LOOKS[this.selection.rider], this.selection.toboggan, { helmet: false });
    this.time = 0;
    this.lastAction = -1;
    this.preview.root.position.copy(this.spot);
    this.preview.root.rotation.y = this.heading;
    this.world.scene.add(this.preview.root);
  }

  open() {
    this.time = 0;
    this.refresh();
  }

  close() {
    this.preview?.root.removeFromParent();
    this.preview = null;
  }

  update(dt: number) {
    this.time += dt;
    const preview = this.preview;
    if (!preview) return;
    // An idle gesture every few seconds (the first one soon after choosing).
    const cycle = (this.time + ACTION_EVERY - 1.2) / ACTION_EVERY;
    const index = Math.floor(cycle);
    const into = (cycle - index) * ACTION_EVERY;
    const acting = into < ACTION_LENGTH;
    const action = PROFILES[this.selection.rider].action;
    if (acting && index !== this.lastAction) {
      this.lastAction = index;
      if (action === 'burp') this.sound.burp();
    }
    preview.setPose({
      posture: 0, steer: 0, rakeLeft: 0, rakeRight: 0, mount: 1, runPhase: 0,
      stand: { time: this.time, action: acting ? action : null, t: into / ACTION_LENGTH },
    });
    // A close-up: just in front of the rider, a touch below eye level (defiant), the face in the
    // open top third of the screen above the cards.
    preview.root.updateMatrixWorld(true);
    const face = preview.head.getWorldPosition(new THREE.Vector3());
    const forward = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
    const side = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const sway = Math.sin(this.time * 0.3) * 0.25;
    const cam = this.world.camera;
    cam.position.copy(face).addScaledVector(forward, 2.1).addScaledVector(side, 0.35 + sway).add(new THREE.Vector3(0, -0.25, 0));
    cam.up.set(0, 1, 0);
    cam.lookAt(face.clone().add(new THREE.Vector3(0, -0.62, 0)));
    this.world.followSun(this.spot);
  }
}
