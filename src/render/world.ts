// Renderer, scene, sky and winter light.

import * as THREE from 'three';
import { colors } from './util';

export interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  /** Keep the shadow map centred on what the camera is looking at. */
  followSun(target: THREE.Vector3): void;
  resize(): void;
}

/** Low winter sun from the south-south-west. */
const SUN_DIRECTION = new THREE.Vector3(-0.35, 0.55, 0.75).normalize();

export function createWorld(canvas: HTMLCanvasElement): World {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = colors.skyHorizon.clone();
  scene.fog = new THREE.Fog(colors.skyHorizon, 600, 10000);
  scene.add(buildSky());

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 14000);

  scene.add(new THREE.HemisphereLight('#d6e9ff', '#8d9db3', 1.4));
  const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45;
  sc.right = 45;
  sc.top = 45;
  sc.bottom = -45;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.3;
  scene.add(sun, sun.target);

  const followSun = (target: THREE.Vector3) => {
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(SUN_DIRECTION, 200);
  };

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  return { renderer, scene, camera, sun, followSun, resize };
}

function buildSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(12000, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: colors.skyTop.clone() },
      horizon: { value: colors.skyHorizon.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float t = pow(clamp(vDir.y, 0.0, 1.0), 0.55);
        gl_FragColor = vec4(mix(horizon, top, t), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.onBeforeRender = (_r, _s, camera) => sky.position.copy(camera.position);
  return sky;
}
