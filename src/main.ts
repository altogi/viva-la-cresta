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
import { Crowd, setPeopleTemplates } from './render/crowd';
import { RIDERS, TOBOGGANS } from './sim/rider';
import { Viewer } from './viewer/viewer';
import { freeRideWeather, RideMode, type RideSetup } from './game/rideMode';
import { WeatherView } from './render/weather';
import { Steinbock } from './render/steinbock';
import { Padding } from './render/padding';
import { recordDescent, type DescentFrame } from './viewer/descent';
import { Sound } from './audio/sound';
import { Music } from './audio/music';
import { POLICIES } from './sim/autopilot';
import { createTuningPanel } from './ui/tuning';

/** Extra Blender models (public/models/<name>.glb) the scenery uses. */
const MODELS: string[] = ['town', 'balloon', 'riders', 'junction', 'bridges', 'props', 'people', 'tophut', 'steinbock'];

// New versions: look for one every few minutes and whenever the app comes back to the foreground
// (a phone's home-screen app may stay open for days). One that's found installs, and the page
// reloads into it, as soon as the rider is off the ice (never mid-ride).
let updateReady = false;
const installUpdate = () => {
  if (updateReady && !document.body.classList.contains('riding')) void updateSW(true);
};
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateReady = true;
    installUpdate();
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => void registration.update().catch(() => {});
    window.setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});
// Leaving the ice is when a waiting update goes in.
new MutationObserver(installUpdate).observe(document.body, { attributes: true, attributeFilter: ['class'] });

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
if (debug) document.body.classList.add('debug');

const RIDES: Record<string, RideSetup> = {
  'junction-running': { startS: JUNCTION_S, start: 'running', steps: 7, label: 'Junction · running start' },
  'top-running': { startS: 0, start: 'running', steps: 7, label: 'Top · running start' },
};

// Let the loading screen paint, fetch the Blender models, then build the scene.
setTimeout(() => void start(), 50);

async function start() {
  const t0 = performance.now();
  const lap = (label: string) => debug && console.info(`${label}: ${(performance.now() - t0).toFixed(0)} ms`);
  const assets = await loadAssets(MODELS);
  for (const id of ['maximilian', 'adelaide', 'remo']) {
    const body = assets.models.riders?.getObjectByName(`rider_${id}`);
    if (body) RiderModel.templates[id] = body;
  }
  setPeopleTemplates(assets.models.people);
  lap('models');
  const world = createWorld(document.getElementById('scene') as HTMLCanvasElement);
  const track = new Track();
  const trackMesh = buildTrackMesh(track);
  const terrain = new Terrain(track);
  world.scene.add(trackMesh, terrain.mesh, buildScenery(track, terrain, assets));
  lap('scene');

  // The ghost rider behind the menu and in the viewer wears the chosen rider's kit.
  let chosen = loadSelection();
  let ghostModel = new RiderModel(LOOKS[chosen.rider], chosen.toboggan);
  let ghost = ghostModel.root;
  world.scene.add(ghost);
  const viewer = new Viewer(world, track, terrain, ghost);
  viewer.setRider(ghost, ghostModel);
  // The title's descent: a real ride by the autopilot, recorded once per rider and toboggan.
  const recordings = new Map<string, DescentFrame[]>();
  const record = (sel: Selection) => {
    const key = `${sel.rider}-${sel.toboggan}`;
    if (!recordings.has(key)) recordings.set(key, recordDescent(track, RIDERS[sel.rider], TOBOGGANS[sel.toboggan]));
    viewer.setRecording(recordings.get(key)!);
  };
  record(chosen);
  const sound = new Sound();
  const ride = new RideMode(world, track, terrain, sound);
  const crowd = new Crowd(track, terrain);
  if (debug) Object.assign(window, { crowd });
  world.scene.add(crowd.group);
  ride.crowd = crowd;
  const padding = new Padding(track, terrain);
  world.scene.add(padding.group);
  ride.padding = padding;
  if (assets.models.steinbock) ride.steinbock = new Steinbock(assets.models.steinbock, track);
  ride.alwaysSteinbock = params.has('steinbock');
  const weather = new WeatherView(world);
  ride.weatherView = weather;
  weather.set(freeRideWeather());
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
  /** Called on every change of mode (the music plays off the ice). */
  let onMode: (() => void) | null = null;
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
    onMode?.();
  };
  const setGhost = (sel: Selection) => {
    ghost.removeFromParent();
    ghostModel = new RiderModel(LOOKS[sel.rider], sel.toboggan);
    ghost = ghostModel.root;
    world.scene.add(ghost);
    viewer.setRider(ghost, ghostModel);
    record(sel);
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
  // Phones only let sound start from a touch, and pause it again after a call, the lock screen or
  // a switch of app: any touch, click or key anywhere wakes it.
  // Music in the menus and between rides (not on the ice), unless turned off.
  const music = new Music(() => sound.musicContext());
  let musicOn = true;
  try {
    musicOn = localStorage.getItem('vlc-music') !== 'off';
  } catch {
    /* storage unavailable: music on */
  }
  const musicButton = document.getElementById('music-toggle')!;
  const updateMusic = () => {
    musicButton.classList.toggle('off', !musicOn);
    musicButton.setAttribute('aria-label', musicOn ? 'Music off' : 'Music on');
    // Off the ice, Shuttlecock; on it, silence, until a fall brings in Straw.
    if (!musicOn) music.stop();
    else if (mode !== 'ride') music.play('shuttlecock');
    else if (ride.fallen) music.play('straw');
    else music.stop();
  };
  ride.onMusic = () => updateMusic();
  // The phone locked, or the player switched app or tab: everything stops, and picks up on return
  // (a suspended page's audio would otherwise drift and break up).
  const hide = () => {
    music.stop(true);
    sound.sleep();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hide();
    else {
      sound.start();
      updateMusic();
    }
  });
  window.addEventListener('pagehide', hide);
  onMode = updateMusic;
  musicButton.addEventListener('click', (e) => {
    e.stopPropagation();
    musicOn = !musicOn;
    try {
      localStorage.setItem('vlc-music', musicOn ? 'on' : 'off');
    } catch {
      /* not remembered */
    }
    updateMusic();
  });
  for (const type of ['pointerdown', 'touchend', 'click', 'keydown'])
    document.addEventListener(
      type,
      () => {
        sound.start();
        updateMusic();
      },
      { capture: true, passive: true },
    );
  // The theme from the moment the title appears: browsers that allow sound before a first touch
  // play it at once; the rest hold it until the first tap or key, when it starts straight away.
  sound.start();
  updateMusic();
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
    weather.update(dt);
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
