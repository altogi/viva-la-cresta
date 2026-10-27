import './style.css';
import * as THREE from 'three';
import { registerSW } from 'virtual:pwa-register';
import { Track } from './sim/track';
import { JUNCTION_S } from './track/cresta';
import { createWorld } from './render/world';
import { buildTrackMesh } from './render/trackMesh';
import { Terrain } from './render/terrain';
import { buildScenery } from './render/scenery';
import { loadAssets } from './render/assets';
import { RiderModel } from './render/riderModel';
import { LOOKS } from './render/riderLooks';
import { loadSelection, type Selection } from './game/selection';
import { SelectMode } from './game/selectMode';
import { CareerMode } from './game/careerMode';
import { clearBadgeBackground } from './ui/badge';
import { Crowd } from './render/crowd';
import { RIDERS, TOBOGGANS } from './sim/rider';
import { Viewer } from './viewer/viewer';
import { RideMode, type RideSetup } from './game/rideMode';
import { Sound } from './audio/sound';
import { POLICIES } from './sim/autopilot';
import { createTuningPanel } from './ui/tuning';

/** Extra Blender models (public/models/<name>.glb) the scenery uses. */
const MODELS: string[] = ['town', 'balloon'];

registerSW({ immediate: true });

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
if (debug) document.body.classList.add('debug');

const RIDES: Record<string, RideSetup> = {
  'junction-lying': { startS: JUNCTION_S, start: 'lying', label: 'Junction · lying start' },
  'junction-running': { startS: JUNCTION_S, start: 'running', steps: 7, label: 'Junction · running start' },
  'top-lying': { startS: 0, start: 'lying', label: 'Top · lying start' },
  'top-running': { startS: 0, start: 'running', steps: 7, label: 'Top · running start' },
};

// Let the loading screen paint, fetch the Blender models, then build the scene.
setTimeout(() => void start(), 50);

async function start() {
  const t0 = performance.now();
  const lap = (label: string) => debug && console.info(`${label}: ${(performance.now() - t0).toFixed(0)} ms`);
  const assets = await loadAssets(MODELS);
  lap('models');
  const world = createWorld(document.getElementById('scene') as HTMLCanvasElement);
  const track = new Track();
  const trackMesh = buildTrackMesh(track);
  const terrain = new Terrain(track);
  world.scene.add(trackMesh, terrain.mesh, buildScenery(track, terrain, assets));
  lap('scene');

  // The ghost rider behind the menu and in the viewer wears the chosen rider's kit.
  let chosen = loadSelection();
  let ghost = new RiderModel(LOOKS[chosen.rider], chosen.toboggan).root;
  world.scene.add(ghost);
  const viewer = new Viewer(world, track, terrain, ghost);
  const sound = new Sound();
  const ride = new RideMode(world, track, terrain, sound);
  const crowd = new Crowd(track, terrain);
  world.scene.add(crowd.group);
  ride.crowd = crowd;
  if (debug) {
    Object.assign(window, { world, track, viewer, ride, crowd });
    createTuningPanel();
  }
  const bot = params.get('autopilot');
  if (bot && POLICIES[bot]) ride.autopilot = POLICIES[bot];

  const select = new SelectMode(world, track, chosen);
  if (debug) Object.assign(window, { select });
  const showChoice = (sel: Selection) => {
    document.getElementById('menu-rider')!.textContent = `${RIDERS[sel.rider].name} · ${TOBOGGANS[sel.toboggan].name}`;
  };
  showChoice(chosen);

  type Mode = 'intro' | 'saves' | 'hub' | 'menu' | 'ride' | 'viewer' | 'select';
  let mode: Mode = 'intro';
  /** Where the track viewer goes back to. */
  let viewerReturn: Mode = 'saves';
  const setMode = (next: Mode) => {
    if (mode === 'select' && next !== 'select') select.close();
    mode = next;
    document.body.classList.toggle('in-menu', next === 'menu');
    document.body.classList.toggle('viewing', next === 'viewer');
    document.body.classList.toggle('selecting', next === 'select');
    for (const screen of ['intro', 'saves', 'hub']) document.body.classList.toggle(`screen-${screen}`, next === screen);
    // The rider flies down the run behind the menus.
    const attract = next === 'menu' || next === 'intro' || next === 'saves' || next === 'hub';
    ghost.visible = attract || next === 'viewer';
    viewer.setAttract(attract);
  };
  const setGhost = (sel: Selection) => {
    ghost.removeFromParent();
    ghost = new RiderModel(LOOKS[sel.rider], sel.toboggan).root;
    world.scene.add(ghost);
    viewer.setRider(ghost);
  };

  // The career: intro, saved games, hub, races.
  const career = new CareerMode(
    ride,
    select,
    (screen) => setMode(screen),
    (sel) => setGhost(sel),
  );
  if (debug) Object.assign(window, { career });
  for (const img of document.querySelectorAll<HTMLImageElement>('.badge, .badge-small')) clearBadgeBackground(img);
  document.getElementById('intro')!.addEventListener('click', () => sound.start());
  document.getElementById('new-game')!.addEventListener('click', () => sound.start());

  // Free ride: any start, any rider, outside the career.
  const freeRideDone = (sel: Selection) => {
    chosen = sel;
    ride.selection = sel;
    showChoice(sel);
    setGhost(sel);
    setMode('menu');
  };
  document.getElementById('free-ride')!.addEventListener('click', () => {
    sound.start();
    ride.selection = chosen;
    setGhost(chosen);
    setMode('menu');
  });
  document.getElementById('menu-back')!.addEventListener('click', () => career.saves());
  document.getElementById('open-select')!.addEventListener('click', () => {
    sound.start();
    select.onDone = freeRideDone;
    setMode('select');
    select.open();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-ride]')) {
    button.addEventListener('click', () => {
      sound.start();
      setMode('ride');
      ride.begin(RIDES[button.dataset.ride!]);
    });
  }
  document.getElementById('open-viewer')!.addEventListener('click', () => ((viewerReturn = 'menu'), setMode('viewer')));
  document.getElementById('saves-viewer')!.addEventListener('click', () => ((viewerReturn = 'saves'), setMode('viewer')));
  document.getElementById('viewer-close')!.addEventListener('click', () => (viewerReturn === 'saves' ? career.saves() : setMode(viewerReturn)));
  ride.onExit = () => setMode('menu');
  if (params.has('viewer')) setMode('viewer');
  else if (params.has('free')) setMode('menu');
  else career.intro();

  const clock = new THREE.Clock();
  const fps = document.getElementById('fps')!;
  let frames = 0;
  let fpsTime = 0;
  world.renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (mode === 'ride') ride.update(dt);
    else if (mode === 'select') select.update(dt);
    else viewer.update(dt);
    crowd.update(dt, mode === 'ride' ? ride.riderPosition : null);
    world.renderer.render(world.scene, world.camera);
    if (debug) {
      frames++;
      fpsTime += dt;
      if (fpsTime > 0.5) {
        const info = world.renderer.info.render;
        fps.textContent = `${(frames / fpsTime).toFixed(0)} fps · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`;
        frames = 0;
        fpsTime = 0;
      }
    }
  });
  document.body.classList.add('ready');
}
