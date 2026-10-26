// Choosing who rides and on what: three rider cards with their strengths, a toboggan switch,
// and the chosen rider shown in 3D beside their toboggan at the Top.

import * as THREE from 'three';
import { RIDERS, TOBOGGANS, type RiderId, type RiderStats, type TobogganId } from '../sim/rider';
import type { Track } from '../sim/track';
import type { World } from '../render/world';
import { RiderModel } from '../render/riderModel';
import { LOOKS } from '../render/riderLooks';
import { toThree } from '../render/util';
import { saveSelection, type Selection } from './selection';

const PROFILES: Record<RiderId, { flag: string; line: string; bio: string }> = {
  maximilian: {
    flag: 'Germany · 20',
    line: 'Light, lanky, quick',
    bio: 'Lives his best life, curing Drakula hangovers at the run. Long arms steer hard and long legs make a powerful running start, but there is little weight to carry speed.',
  },
  adelaide: {
    flag: 'England · 25',
    line: 'The all-rounder',
    bio: 'Loves a cold plunge and the family retreat to St Moritz. Middle of the field in weight and agility: no weakness to hide.',
  },
  remo: {
    flag: 'Switzerland · 50',
    line: 'Heavy, fast, hard to stop',
    bio: 'Burly, bearded, rides all season and loves a beer after. A rocket on the straights, but slow to shift and slow to stop: plan Shuttlecock early.',
  },
};

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
  private readonly spot = new THREE.Vector3();
  private readonly heading: number;
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
        <div class="rider-name">${r.name}</div>
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
    this.preview = new RiderModel(LOOKS[this.selection.rider], this.selection.toboggan);
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
    this.preview?.setPose({ posture: 0, steer: 0, rakeLeft: 0, rakeRight: 0, mount: 1, runPhase: 0, cheer: 1, cheerTime: this.time * 0.35 });
    // From a little way down the run, looking back up at the rider with the Top hut behind,
    // swaying gently; aimed low so the rider sits in the open top third above the cards.
    const a = this.heading - 0.35 + Math.sin(this.time * 0.25) * 0.25;
    const cam = this.world.camera;
    cam.position.set(this.spot.x + Math.cos(a) * 7.5, this.spot.y + 1.4, this.spot.z - Math.sin(a) * 7.5);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.spot.x, this.spot.y - 1.5, this.spot.z);
    this.world.followSun(this.spot);
  }
}
