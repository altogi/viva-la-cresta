// A sculpted head, built in code: an ellipsoid shaped into a face (brow ridge, eye sockets, nose,
// cheekbones, muzzle, jaw and chin), with eyes set in the sockets under lids and lashes, brows,
// lips that grin and open, teeth, ears, and hair and beard grown as shells over the skull.
// Head frame: +X is where the face looks, +Y the crown, +Z the rider's right; metres at scale 1.
// The front of the face is a height field x = surfaceX(y, z), so features are placed exactly on it.

import * as THREE from 'three';
import type { RiderLook } from './riderLooks';

interface FaceShape {
  /** Half depth, height and width of the skull. */
  a: number;
  b: number;
  c: number;
  nose: number;
  noseWidth: number;
  /** Width of the jaw relative to the skull. */
  jaw: number;
  chin: number;
  /** How far the corners of the mouth turn up. */
  grin: number;
  /** Lips parted to show the teeth. */
  teeth: number;
  iris: string;
  lips: string;
  lashes: number;
  brow: number;
  /** Ruddy nose and cheeks. */
  ruddy: number;
}

const SHAPES: Record<RiderLook['id'], FaceShape> = {
  // Long, lean face, a long straight nose, a wide toothy grin.
  maximilian: { a: 0.1, b: 0.117, c: 0.075, nose: 1.12, noseWidth: 0.9, jaw: 0.92, chin: 1.2, grin: 1, teeth: 1, iris: '#3b2a1f', lips: '#b47a70', lashes: 1, brow: 0.0026, ruddy: 0 },
  // Softer, rounder face, a small nose, a bright smile, blue eyes and long lashes.
  adelaide: { a: 0.097, b: 0.111, c: 0.077, nose: 0.78, noseWidth: 0.85, jaw: 0.9, chin: 0.8, grin: 0.9, teeth: 0.9, iris: '#3f78c2', lips: '#c97680', lashes: 1.7, brow: 0.0022, ruddy: 0.2 },
  // Broad and weathered: a big nose, heavy jaw, ruddy from fifty seasons in the sun.
  remo: { a: 0.104, b: 0.118, c: 0.084, nose: 1.25, noseWidth: 1.3, jaw: 1.06, chin: 1, grin: 0.8, teeth: 0.7, iris: '#5a4634', lips: '#a86c60', lashes: 0.8, brow: 0.0042, ruddy: 0.6 },
};

const smoothstep = THREE.MathUtils.smoothstep;
const gauss = (y: number, z: number, cy: number, cz: number, ry: number, rz: number) => Math.exp(-(((y - cy) / ry) ** 2) - ((z - cz) / rz) ** 2);

/** Smooth 3D value noise in [-1, 1]. */
function noise3(x: number, y: number, z: number): number {
  const hash = (i: number, j: number, k: number) => {
    const h = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  const lerp = THREE.MathUtils.lerp;
  const c = (i: number, j: number, k: number) => hash(xi + i, yi + j, zi + k);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}

class HeadShape {
  constructor(readonly f: FaceShape) {}

  /** Lower face narrows to the jaw. */
  widthScale(y: number) {
    return 1 - (1 - this.f.jaw * 0.82) * smoothstep(-0.01, -this.f.b, y);
  }

  /** The lower face sits forward of the skull (jaw and chin). */
  shear(y: number) {
    return y < -0.02 ? (-y - 0.02) * 0.2 : 0;
  }

  nose(y: number, z: number) {
    const f = this.f;
    const top = 0.033, tip = -0.017, bottom = -0.029;
    if (y > top || y < bottom) return 0;
    let h: number, w: number;
    if (y >= tip) {
      const k = (top - y) / (top - tip);
      h = 0.0035 + 0.023 * k ** 1.7;
      w = 0.0055 + 0.0065 * k + 0.003 * k ** 6; // the rounded tip
    } else {
      const k = (y - bottom) / (tip - bottom);
      h = 0.0265 * Math.sqrt(k);
      w = 0.012;
    }
    return h * f.nose * Math.exp(-((z / (w * f.noseWidth)) ** 2));
  }

  /** Relief of the face, out along +X. */
  features(y: number, z: number) {
    const f = this.f;
    const az = Math.abs(z);
    let d = 0;
    d -= 0.0105 * gauss(y, az, 0.012, 0.032, 0.012, 0.016); // eye sockets
    d += 0.0055 * gauss(y, az, 0.036, 0.028, 0.008, 0.03); // brow ridge
    d += this.nose(y, z);
    d += 0.0068 * f.nose * gauss(y, az, -0.021, 0.0125 * f.noseWidth, 0.0065, 0.0065); // nostril wings
    d += 0.0065 * gauss(y, az, -0.004, 0.05, 0.015, 0.015); // cheekbones
    d += 0.0045 * f.grin * gauss(y, az, -0.034, 0.038, 0.011, 0.012); // cheeks lifted by the grin
    d += 0.0085 * gauss(y, z, -0.049, 0, 0.021, 0.03); // muzzle
    d -= 0.0022 * gauss(y, z, -0.071, 0, 0.005, 0.016); // groove under the lip
    d += 0.0085 * f.chin * gauss(y, z, -0.1, 0, 0.014, 0.021); // chin
    d -= 0.003 * gauss(y, az, 0.03, 0.068, 0.02, 0.012); // temples
    return d;
  }

  /** The front of the face: x for a given height and sideways position. */
  surfaceX(y: number, z: number) {
    const f = this.f;
    const zb = z / this.widthScale(y);
    const q = 1 - (y / f.b) ** 2 - (zb / f.c) ** 2;
    return f.a * Math.max(0, q) ** 0.425 + this.shear(y) + this.features(y, z);
  }

  /** The head mesh, from a sphere; returns the per-vertex sphere directions too. */
  geometry(): { geo: THREE.BufferGeometry; dirs: Float32Array } {
    const f = this.f;
    const geo = new THREE.SphereGeometry(1, 160, 120);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const dirs = new Float32Array(pos.array as Float32Array);
    for (let i = 0; i < pos.count; i++) {
      const dx = dirs[i * 3], dy = dirs[i * 3 + 1], dz = dirs[i * 3 + 2];
      const y = f.b * dy;
      const z = f.c * dz * this.widthScale(y);
      // The face is flatter than the skull; the cranium reaches further back.
      let x = dx > 0 ? f.a * dx ** 0.85 : f.a * 1.1 * dx;
      x += this.shear(y);
      x += this.features(y, z) * smoothstep(dx, 0.15, 0.55);
      // The back of the skull rounds out above the neck.
      if (dx < 0) x -= 0.008 * gauss(y, 0, 0.03, 0, 0.06, 1) * -dx;
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    return { geo, dirs };
  }
}

/** A grid surface over u, v in [0, 1], facing +X. `open` gives an optional morph target. */
function grid(nu: number, nv: number, at: (u: number, v: number) => THREE.Vector3, open?: (u: number, v: number) => THREE.Vector3): THREE.BufferGeometry {
  const positions: number[] = [];
  const morph: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      positions.push(...at(i / nu, j / nv).toArray());
      if (open) morph.push(...open(i / nu, j / nv).toArray());
      uvs.push(i / nu, j / nv);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      index.push(a, b, d, a, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mid = (geo.attributes.normal as THREE.BufferAttribute).getX(Math.floor(positions.length / 6));
  if (mid < 0) {
    for (let k = 0; k < index.length; k += 3) [index[k + 1], index[k + 2]] = [index[k + 2], index[k + 1]];
    geo.setIndex(index);
    geo.computeVertexNormals();
  }
  if (open) geo.morphAttributes.position = [new THREE.Float32BufferAttribute(morph, 3)];
  return geo;
}

/**
 * Hair or beard: the head surface pushed out along its normals where `mask` (a signed distance
 * in metres, positive inside) says. The edge is cut smoothly by alpha test on the mask.
 */
function shell(head: THREE.BufferGeometry, dirs: Float32Array, mask: (p: THREE.Vector3, t: number) => number, offset: (p: THREE.Vector3, t: number, inside: number) => number, uv?: (p: THREE.Vector3) => [number, number]): THREE.BufferGeometry {
  const geo = head.clone();
  geo.deleteAttribute('color');
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const uvs = geo.attributes.uv as THREE.BufferAttribute;
  const alpha = new Float32Array(pos.count * 4);
  const near = new Uint8Array(pos.count);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const t = Math.abs(Math.atan2(dirs[i * 3 + 2], dirs[i * 3])) / Math.PI; // 0 at the face, 1 at the back
    const d = mask(p, t);
    near[i] = d > -0.004 ? 1 : 0;
    alpha.set([1, 1, 1, THREE.MathUtils.clamp(0.5 + d / 0.004, 0, 1)], i * 4);
    const o = 0.0007 + offset(p, t, smoothstep(d, 0, 0.012));
    if (uv) uvs.setXY(i, ...uv(p));
    pos.setXYZ(i, p.x + nor.getX(i) * o, p.y + nor.getY(i) * o, p.z + nor.getZ(i) * o);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(alpha, 4));
  const index = geo.index!.array;
  const out: number[] = [];
  for (let k = 0; k < index.length; k += 3) {
    if (near[index[k]] || near[index[k + 1]] || near[index[k + 2]]) out.push(index[k], index[k + 1], index[k + 2]);
  }
  geo.setIndex(out);
  geo.computeVertexNormals();
  return geo;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Fine streaks of hair along the texture's v direction. */
function strandTexture(seed: number): THREE.CanvasTexture {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#b8b8b8';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const x = rand() * 256;
      const l = 140 + rand() * 115;
      g.strokeStyle = `rgba(${l},${l},${l},${0.25 + rand() * 0.5})`;
      g.lineWidth = 0.6 + rand() * 1.6;
      g.beginPath();
      const y0 = rand() * 256 - 128;
      g.moveTo(x, y0);
      g.bezierCurveTo(x + (rand() - 0.5) * 6, y0 + 90, x + (rand() - 0.5) * 6, y0 + 180, x + (rand() - 0.5) * 8, y0 + 300);
      g.stroke();
    }
  }, true);
}

function eyeTexture(iris: string): THREE.CanvasTexture {
  return canvasTexture(256, 128, (g) => {
    const sclera = g.createLinearGradient(0, 0, 256, 0);
    sclera.addColorStop(0, '#e8cfc8');
    sclera.addColorStop(0.3, '#f3efe8');
    sclera.addColorStop(0.7, '#f3efe8');
    sclera.addColorStop(1, '#e8cfc8');
    g.fillStyle = sclera;
    g.fillRect(0, 0, 256, 128);
    const c = new THREE.Color(iris);
    const light = c.clone().lerp(new THREE.Color('#ffffff'), 0.35).getStyle();
    const dark = c.clone().multiplyScalar(0.45).getStyle();
    const grad = g.createRadialGradient(128, 64, 6, 128, 64, 20);
    grad.addColorStop(0, light);
    grad.addColorStop(0.6, c.getStyle());
    grad.addColorStop(0.92, dark);
    grad.addColorStop(1, '#1a1410');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(128, 64, 20, 0, Math.PI * 2);
    g.fill();
    // Fibres of the iris.
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let a = 0; a < Math.PI * 2; a += 0.22) {
      g.beginPath();
      g.moveTo(128 + Math.cos(a) * 8, 64 + Math.sin(a) * 8);
      g.lineTo(128 + Math.cos(a) * 18, 64 + Math.sin(a) * 18);
      g.stroke();
    }
    g.fillStyle = '#080605';
    g.beginPath();
    g.arc(128, 64, 7.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.arc(122, 58, 3.2, 0, Math.PI * 2);
    g.fill();
  });
}

function teethTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 32, (g) => {
    g.fillStyle = '#f2ede2';
    g.fillRect(0, 0, 128, 32);
    g.strokeStyle = 'rgba(120,100,80,0.35)';
    g.lineWidth = 1.2;
    for (const x of [22, 38, 52, 64, 76, 90, 106]) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 32);
      g.stroke();
    }
    const shade = g.createLinearGradient(0, 0, 128, 0);
    shade.addColorStop(0, 'rgba(60,30,20,0.6)');
    shade.addColorStop(0.2, 'rgba(60,30,20,0)');
    shade.addColorStop(0.8, 'rgba(60,30,20,0)');
    shade.addColorStop(1, 'rgba(60,30,20,0.6)');
    g.fillStyle = shade;
    g.fillRect(0, 0, 128, 32);
  });
}

export interface FaceRig {
  group: THREE.Group;
  /** Hair gathered at the back (Adelaide's bun), hidden under the helmet. */
  bun: THREE.Object3D | null;
  express(wink: number, open: number): void;
}

/** Build the head for a rider look, at scale 1 (the caller scales it). */
export function buildFace(look: RiderLook): FaceRig {
  const f = SHAPES[look.id];
  const shape = new HeadShape(f);
  const group = new THREE.Group();
  const skinColor = new THREE.Color(look.skin);
  const { geo, dirs } = shape.geometry();

  // Skin tones: blush on the cheeks, shadow in the sockets and nostrils, a ruddy nose.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const blush = look.cheeks ? 0.55 : 0.22 + f.ruddy * 0.4;
  for (let i = 0; i < pos.count; i++) {
    const front = smoothstep(dirs[i * 3], 0.3, 0.7);
    const y = pos.getY(i), z = pos.getZ(i), az = Math.abs(z);
    const r = 1;
    let g = 1, b = 1;
    const cheek = blush * gauss(y, az, -0.018, 0.046, 0.017, 0.019) * front;
    const nose = f.ruddy * 0.5 * gauss(y, z, -0.012, 0, 0.014, 0.012) * front;
    g -= (cheek + nose) * 0.22;
    b -= (cheek + nose) * 0.24;
    const socket = 0.1 * gauss(y, az, 0.014, 0.034, 0.012, 0.018) * front;
    const nostril = 0.5 * gauss(y, az, -0.0285, 0.0066 * f.noseWidth, 0.0017, 0.0027) * front;
    const shade = 1 - socket - nostril;
    colors.set([r * shade, g * shade, b * shade], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const skin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.58, vertexColors: true });
  group.add(new THREE.Mesh(geo, skin));
  const plainSkin = new THREE.MeshStandardMaterial({ color: skinColor.clone().multiplyScalar(0.96), roughness: 0.6 });

  // Eyes in their sockets, with lids that can wink and lashes along the upper lid.
  const eyeR = 0.0122;
  const eyeMat = new THREE.MeshStandardMaterial({ map: eyeTexture(f.iris), roughness: 0.15 });
  const lashMat = new THREE.MeshStandardMaterial({ color: '#16110e', roughness: 0.8 });
  const upperLids: THREE.Group[] = [];
  const lowerLids: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const ey = 0.0125, ez = side * 0.0325;
    const eye = new THREE.Group();
    eye.position.set(shape.surfaceX(ey, ez) + 0.0028 - eyeR, ey, ez);
    eye.add(new THREE.Mesh(new THREE.SphereGeometry(eyeR, 24, 16), eyeMat));
    eye.rotation.y = -side * 0.08; // a touch of convergence, looking at you
    const lidR = eyeR * 1.13;
    const upper = new THREE.Group();
    upper.add(new THREE.Mesh(new THREE.SphereGeometry(lidR, 24, 10, 0, Math.PI * 2, 0, 1.2), plainSkin));
    const lash = new THREE.Mesh(new THREE.TorusGeometry(lidR * Math.sin(1.2), 0.0009 * f.lashes, 4, 28), lashMat);
    lash.rotation.x = Math.PI / 2;
    lash.position.y = lidR * Math.cos(1.2);
    lash.scale.set(1, 1, 1 + 0.4 * f.lashes);
    upper.add(lash);
    const lower = new THREE.Group();
    lower.add(new THREE.Mesh(new THREE.SphereGeometry(lidR * 0.99, 24, 8, 0, Math.PI * 2, Math.PI - 0.95, 0.95), plainSkin));
    eye.add(upper, lower);
    group.add(eye);
    upperLids.push(upper);
    lowerLids.push(lower);
  }

  // Brows: low and level at the inner ends, a determined look.
  const browMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.beard ?? look.hair.color).multiplyScalar(0.8), roughness: 0.9 });
  for (const side of [-1, 1]) {
    const pts = [[0.03, 0.011], [0.0375, 0.024], [0.041, 0.038], [0.036, 0.052]].map(
      ([y, z]) => new THREE.Vector3(shape.surfaceX(y, side * z) + 0.0018, y, side * z),
    );
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, f.brow, 6), browMat));
  }

  // Mouth: lips curving up into a grin, parted over the teeth; the lower lip and jaw drop open.
  const halfW = 0.0245;
  const gap = 0.0042 * f.teeth;
  const line = (t: number) => -0.0485 + 0.0055 * f.grin * t * t - 0.0012 * f.grin * (1 - t * t);
  const drop = 0.016;
  const lipMat = new THREE.MeshStandardMaterial({ color: f.lips, roughness: 0.5 });
  const onFace = (y: number, z: number, out: number) => new THREE.Vector3(shape.surfaceX(y, z) + out, y, z);
  const across = (u: number) => u * 2 - 1;
  const fullness = (t: number) => Math.sqrt(Math.max(0, 1 - t * t));
  const upperLip = grid(24, 6, (u, v) => {
    const t = across(u);
    const y = line(t) + (gap / 2) * fullness(t) + v * 0.006 * fullness(t) ** 0.8;
    return onFace(y, t * halfW, 0.0011 + 0.0022 * Math.sin(Math.PI * Math.min(1, v * 1.2)) * fullness(t));
  });
  group.add(new THREE.Mesh(upperLip, lipMat));
  const lowerAt = (dropBy: number) => (u: number, v: number) => {
    const t = across(u);
    const y = line(t) - (gap / 2) * fullness(t) - v * 0.0078 * fullness(t) ** 0.8 - dropBy * fullness(t) ** 0.5;
    return onFace(y, t * halfW * (1 - dropBy * 6), 0.0012 + 0.003 * Math.sin(Math.PI * v) * fullness(t) + dropBy * 0.12);
  };
  const lowerLip = new THREE.Mesh(grid(24, 6, lowerAt(0), lowerAt(drop)), lipMat);
  group.add(lowerLip);
  const mouthAt = (dropBy: number) => (u: number, v: number) => {
    const t = across(u) * 0.97;
    const top = line(t) + (gap / 2 + 0.0012) * fullness(t);
    const bottom = line(t) - (gap / 2 + 0.0012) * fullness(t) - dropBy * fullness(t) ** 0.5;
    return onFace(THREE.MathUtils.lerp(bottom, top, v), t * halfW * (1 - dropBy * 5), 0.0006 + dropBy * 0.06);
  };
  const mouth = new THREE.Mesh(grid(20, 4, mouthAt(0), mouthAt(drop)), new THREE.MeshStandardMaterial({ color: '#3b1513', roughness: 0.8 }));
  group.add(mouth);
  const teethMat = new THREE.MeshStandardMaterial({ map: teethTexture(), roughness: 0.3 });
  const upperTeeth = grid(16, 2, (u, v) => {
    const t = across(u) * 0.8;
    const y = THREE.MathUtils.lerp(line(t) - gap * 0.2, line(t) + (gap / 2 + 0.002) * fullness(t), v);
    return onFace(y, t * halfW, 0.0009);
  });
  group.add(new THREE.Mesh(upperTeeth, teethMat));
  const lowerTeethAt = (dropBy: number) => (u: number, v: number) => {
    const t = across(u) * 0.7;
    const base = line(t) - (gap / 2) * fullness(t) - dropBy * fullness(t) ** 0.5;
    return onFace(base + v * (0.0025 + dropBy * 0.15), t * halfW * (1 - dropBy * 5), 0.0007 + dropBy * 0.08);
  };
  const lowerTeeth = new THREE.Mesh(grid(12, 2, lowerTeethAt(0), lowerTeethAt(drop)), teethMat);
  group.add(lowerTeeth);
  const morphing = [lowerLip, mouth, lowerTeeth];

  // Ears: an outer shell with a rolled rim and a hollow, set back on the sides of the head.
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    const outline = new THREE.Shape();
    outline.absellipse(0, 0, 0.0115, 0.0185, 0, Math.PI * 2, false, 0);
    const shellGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 20 });
    ear.add(new THREE.Mesh(shellGeo, plainSkin));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.0028, 6, 20, Math.PI * 1.35), plainSkin);
    rim.scale.set(0.95, 1.5, 1);
    rim.rotation.z = -0.35;
    rim.position.z = 0.005;
    const hollow = new THREE.Mesh(new THREE.SphereGeometry(0.0068, 10, 8).scale(1, 1.4, 0.35), new THREE.MeshStandardMaterial({ color: skinColor.clone().multiplyScalar(0.72), roughness: 0.7 }));
    hollow.position.set(0.001, -0.002, 0.0062);
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.0058, 10, 8), plainSkin);
    lobe.position.set(0.002, -0.017, 0.003);
    ear.add(rim, hollow, lobe);
    // The extrusion faces +Z: turn it outward on each side, leaning back, angled from the head.
    ear.scale.z = side;
    ear.rotation.set(0, side * 0.32, 0.18);
    ear.position.set(-0.004, 0.004, side * (f.c * shape.widthScale(0.004) - 0.004));
    group.add(ear);
  }

  // Hair and beard.
  const hairColor = new THREE.Color(look.hair.color);
  const style = look.hair.style;
  const hairMat = new THREE.MeshStandardMaterial({
    color: hairColor,
    map: strandTexture(style === 'slick' ? 7 : style === 'bun' ? 11 : 23),
    roughness: style === 'slick' ? 0.38 : 0.72,
    metalness: style === 'slick' ? 0.12 : 0,
    vertexColors: true,
    alphaTest: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const front = style === 'slick' ? 0.074 : style === 'bun' ? 0.07 : 0.062;
  const hairline = (t: number, p: THREE.Vector3) => {
    const keys: [number, number][] = [[0, front], [0.14, front - 0.004], [0.26, front - 0.024], [0.33, 0.042], [0.41, 0.03], [0.44, style === 'shaggy' ? -0.01 : 0.012], [0.47, 0.03], [0.56, 0.028], [0.63, -0.025], [1, -0.075]];
    let h = keys[keys.length - 1][1];
    for (let k = 1; k < keys.length; k++) {
      if (t <= keys[k][0]) {
        const [t0, h0] = keys[k - 1];
        const [t1, h1] = keys[k];
        h = h0 + ((h1 - h0) * (t - t0)) / (t1 - t0);
        break;
      }
    }
    if (style === 'shaggy') h += noise3(p.x * 90, p.y * 90, p.z * 90) * 0.006;
    return h;
  };
  // Slicked and pulled-back hair streaks run front to back; shaggy hair falls down the head.
  const backUV = (p: THREE.Vector3): [number, number] => [0.5 + p.z * 4, 0.5 + p.x * 3];
  const hairGeo = shell(
    geo,
    dirs,
    (p, t) => p.y - hairline(t, p),
    (p, t, inside) => {
      const top = smoothstep(p.y, -0.02, 0.12);
      if (style === 'slick') return inside * (0.0042 + 0.0018 * top + 0.0028 * Math.exp(-((t / 0.18) ** 2)) * smoothstep(p.y, 0.05, 0.09));
      if (style === 'bun') return inside * (0.0025 + 0.0025 * top);
      return inside * (0.008 + 0.006 * top + noise3(p.x * 45, p.y * 45, p.z * 45) * 0.005);
    },
    style === 'shaggy' ? undefined : backUV,
  );
  group.add(new THREE.Mesh(hairGeo, hairMat));

  let bun: THREE.Object3D | null = null;
  if (style === 'bun') {
    // A twisted bun high at the back, a band, and loose wisps by the temples.
    const knot = new THREE.Group();
    const bunMat = hairMat.clone();
    bunMat.vertexColors = false;
    bunMat.alphaTest = 0;
    const twist = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0155, 12, 28), bunMat);
    twist.rotation.x = Math.PI / 2;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), bunMat);
    crown.position.y = 0.008;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.0175, 0.0035, 6, 20), new THREE.MeshStandardMaterial({ color: '#1f2f6e', roughness: 0.5 }));
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.013;
    knot.add(twist, crown, band);
    knot.position.set(-0.078, 0.092, 0);
    knot.rotation.z = 0.75;
    group.add(knot);
    bun = knot;
  }

  if (look.beard) {
    // A full beard over the jaw and cheeks, a clear patch round the lips, a heavy moustache.
    const beardMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.beard), map: strandTexture(31), roughness: 0.85, vertexColors: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const beardTop = (t: number) => (t < 0.12 ? -0.031 : t < 0.3 ? -0.031 + ((t - 0.12) / 0.18) * 0.018 : t < 0.45 ? -0.013 + ((t - 0.3) / 0.15) * 0.045 : -1);
    const lipsClear = (p: THREE.Vector3) => ((p.y + 0.049) / 0.0125) ** 2 + (p.z / 0.03) ** 2;
    const beardGeo = shell(
      geo,
      dirs,
      (p, t) => {
        const cheeks = Math.min(beardTop(Math.min(t, 0.449)) - p.y, (0.46 - t) * 0.3);
        const under = Math.min(-0.072 - p.y, (0.66 - t) * 0.25);
        return Math.min(Math.max(cheeks, under), (Math.sqrt(lipsClear(p)) - 1) * 0.012);
      },
      (p, _t, inside) => inside * (0.0085 + 0.012 * smoothstep(p.y, -0.07, -0.125) + noise3(p.x * 60, p.y * 60, p.z * 60) * 0.004),
    );
    group.add(new THREE.Mesh(beardGeo, beardMat));
    const pts = [[-0.051, -0.034], [-0.041, -0.024], [-0.037, -0.01], [-0.0365, 0], [-0.037, 0.01], [-0.041, 0.024], [-0.051, 0.034]].map(
      ([y, z]) => new THREE.Vector3(shape.surfaceX(y, z) + 0.0035, y, z),
    );
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0052, 8), beardMat));
  }

  group.traverse((o) => (o.castShadow = true));

  return {
    group,
    bun,
    express(wink: number, open: number) {
      // A slightly lowered, defiant lid; the left eye winks shut. The lower lids lift in the grin.
      upperLids.forEach((lid, i) => (lid.rotation.z = -0.12 - (i === 0 ? wink * 1.1 : 0) - open * 0.25));
      lowerLids.forEach((lid, i) => (lid.rotation.z = 0.12 * f.grin + (i === 0 ? wink * 0.3 : 0)));
      for (const mesh of morphing) mesh.morphTargetInfluences![0] = open;
    },
  };
}
