// Renderer, scene, sky and winter light.

import * as THREE from 'three';

export interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  /** Keep the shadow map centred on what the camera is looking at. */
  followSun(target: THREE.Vector3): void;
  resize(): void;
}

/**
 * Winter sun from the south-south-west, about 45 degrees up: low enough for long winter shadows on
 * the snow, high enough that a rider up a steep bank throws theirs close by, not metres down the wall.
 */
const SUN_DIRECTION = new THREE.Vector3(-0.35, 0.82, 0.75).normalize();

export function createWorld(canvas: HTMLCanvasElement): World {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = HAZE.clone();
  // Alpine haze, light: the mountains stand crisp in the dry winter air, only the farthest paling.
  scene.fog = new THREE.Fog(HAZE, 2500, 30000);
  const sky = buildSky();
  sky.name = 'sky';
  scene.add(sky);
  // The sky lights everything a little (reflections, the blue cast in shadow).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  const envSky = buildSky();
  envSky.onBeforeRender = () => {};
  skyScene.add(envSky);
  scene.environment = pmrem.fromScene(skyScene, 0.02).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 16000);

  scene.add(new THREE.HemisphereLight('#cfe3ff', '#8796ab', 0.75));
  const sun = new THREE.DirectionalLight('#fff3e2', 3.0);
  sun.castShadow = true;
  // A wide shadow area, so houses and trees ahead are shaded well before the rider reaches them.
  const big = renderer.capabilities.maxTextureSize >= 8192;
  sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048);
  const sc = sun.shadow.camera;
  const reach = big ? 70 : 50;
  sc.left = -reach;
  sc.right = reach;
  sc.top = reach;
  sc.bottom = -reach;
  sc.near = 1;
  sc.far = 400;
  // Small biases keep the rider's thin shadow; the track itself doesn't cast, so no acne to hide.
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const ahead = new THREE.Vector3();
  const followSun = (target: THREE.Vector3) => {
    // Centred a little ahead of the target, where the camera looks: what's coming is shaded first.
    camera.getWorldDirection(ahead);
    ahead.y = 0;
    if (ahead.lengthSq() > 1e-6) ahead.normalize().multiplyScalar(reach * 0.55);
    sun.target.position.copy(target).add(ahead);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIRECTION, 200);
  };

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  // Follow the canvas's real size (window resizes, rotation, browser toolbars showing or hiding).
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(canvas);
  resize();
  return { renderer, scene, camera, sun, followSun, resize };
}

/** The horizon's haze, which the fog fades to. */
const HAZE = new THREE.Color('#c9d8ea');

/**
 * A clear winter sky over the Engadin: deep blue overhead, paling to a hazy horizon, thin cirrus
 * drawn out in streaks, and a glow round the low sun.
 */
function buildSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(15000, 48, 24);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color('#1f56c4') },
      mid: { value: new THREE.Color('#5a8fdc') },
      horizon: { value: HAZE.clone() },
      sunDir: { value: SUN_DIRECTION.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 mid;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int k = 0; k < 5; k++) { v += a * noise(p); p = p * 2.07 + 13.1; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, zenith, smoothstep(0.15, 0.85, h));
        // Cirrus: streaks of thin cloud, stretched along one direction, fading near the horizon.
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.12);
          uv = mat2(0.8, -0.6, 0.6, 0.8) * uv;
          float c = fbm(uv * vec2(0.55, 2.4) + vec2(3.0, 1.0));
          c = smoothstep(0.52, 0.85, c) * smoothstep(0.02, 0.3, d.y) * 0.75;
          col = mix(col, vec3(0.97, 0.98, 1.0), c);
        }
        // The sun: a soft glow and a bright core.
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.92, 0.8) * (pow(s, 12.0) * 0.18 + pow(s, 900.0) * 3.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.onBeforeRender = (_r, _s, camera) => sky.position.copy(camera.position);
  return sky;
}
