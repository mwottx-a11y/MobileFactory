// three.js renderer: terrain, instanced building parts, belts, items, I/O markers, overlays.
import * as THREE from '../vendor/three.module.js';
import { ITEMS, FLUIDS, BUILDINGS, RECIPES } from './data.js';
import { ORES, OIL } from './world.js';
import { DX, DY, rotSize, BELTLIKE } from './sim.js';
import { iconCanvas } from './icons.js';

const ORE_COLORS = { 'iron-ore': '#6f86a3', 'copper-ore': '#c96c35', 'coal': '#2a2a2e', 'stone': '#ad9c7c', 'quartz': '#ddd6f7', 'bauxite': '#b04d24', 'crude-oil': '#1a1220' };
const STATUS_COLORS = {
  'working': '#46e05a', 'idle': '#e6c84a', 'no input': '#e6c84a', 'no recipe': '#8a8f99', 'no research': '#8a8f99', 'depleted': '#8a8f99',
  'no power': '#ff4040', 'no fuel': '#ff4040', 'no water': '#ff4040', 'low power': '#ff9a3a', 'output full': '#ff9a3a', 'blocked': '#ff9a3a',
};
// The I/O colour language used everywhere: cyan = goes in, orange = comes out.
export const IN_COLOR = '#2fd0ff', OUT_COLOR = '#ff8a1f';

const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpM3 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
const tmpE = new THREE.Euler(), tmpC = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0), X_AXIS = new THREE.Vector3(1, 0, 0);
const ONE = new THREE.Vector3(1, 1, 1);

// ---------- Geometry kit ----------
function roundedBox(b = 0.07) {
  const h = 0.5 - b, r = 0.05;
  const s = new THREE.Shape();
  s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h); s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r); s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1 - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 3 });
  g.translate(0, 0, -(1 - 2 * b) / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}
function arrowGeo() {
  // flat arrow lying on XZ, pointing -Z (local "front"), ~1 unit long
  const s = new THREE.Shape();
  s.moveTo(0, 0.5); s.lineTo(0.42, 0.02); s.lineTo(0.17, 0.02); s.lineTo(0.17, -0.5);
  s.lineTo(-0.17, -0.5); s.lineTo(-0.17, 0.02); s.lineTo(-0.42, 0.02); s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}
let _ring;
function ringGeoCached() { return _ring || (_ring = new THREE.RingGeometry(0.4, 0.5, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2)); }

// ---------- Instanced pool with free list ----------
class Pool {
  constructor(scene, geo, mat, cap = 512, shadow = true) {
    this.scene = scene; this.geo = geo; this.mat = mat; this.cap = cap; this.hw = 0; this.free = []; this.shadow = shadow;
    this.make(cap);
  }
  make(cap) {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.count = this.hw;
    m.castShadow = this.shadow; m.receiveShadow = this.shadow;
    if (this.mesh) {
      m.instanceMatrix.array.set(this.mesh.instanceMatrix.array.subarray(0, this.hw * 16));
      m.instanceColor.array.set(this.mesh.instanceColor.array.subarray(0, this.hw * 3));
      for (const [k, a] of Object.entries(this.extra || {})) {
        const na = new THREE.InstancedBufferAttribute(new Float32Array(cap * a.itemSize), a.itemSize);
        na.array.set(a.array.subarray(0, this.hw * a.itemSize)); na.setUsage(THREE.DynamicDrawUsage);
        this.geo.setAttribute(k, na); this.extra[k] = na;
      }
      m.renderOrder = this.mesh.renderOrder;
      this.scene.remove(this.mesh); this.mesh.dispose();
    }
    this.mesh = m; this.cap = cap;
    this.scene.add(m);
  }
  addAttr(name, size) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute(name, a);
    (this.extra ||= {})[name] = a;
  }
  alloc() {
    if (this.free.length) return this.free.pop();
    if (this.hw >= this.cap) this.make(this.cap * 2);
    const i = this.hw++;
    this.mesh.count = this.hw;
    return i;
  }
  release(i) { tmpM.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, tmpM); this.free.push(i); this.dirty = true; }
  set(i, m) { this.mesh.setMatrixAt(i, m); this.dirty = true; }
  color(i, c) { this.mesh.setColorAt(i, c); this.cdirty = true; }
  flush() {
    if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; }
    if (this.cdirty) { this.mesh.instanceColor.needsUpdate = true; this.cdirty = false; }
    if (this.edirty) { for (const a of Object.values(this.extra)) a.needsUpdate = true; this.edirty = false; }
  }
}

// Streaming pool rewritten every frame (items on belts).
class Stream {
  constructor(scene, geo, mat, cap = 4096) { this.scene = scene; this.geo = geo; this.mat = mat; this.n = 0; this.make(cap); }
  make(cap) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.frustumCulled = false; m.count = 0; m.castShadow = true;
    this.mesh = m; this.cap = cap; this.scene.add(m);
  }
  begin() { this.n = 0; }
  push(x, y, z, ry, s, c) {
    if (this.n >= this.cap) return;
    const a = this.mesh.instanceMatrix.array, o = this.n * 16;
    const cs = Math.cos(ry) * s, sn = Math.sin(ry) * s;
    a[o] = cs; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0;
    a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = cs; a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
    const ca = this.mesh.instanceColor.array, co = this.n * 3;
    ca[co] = c.r; ca[co + 1] = c.g; ca[co + 2] = c.b;
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    if (this.n >= this.cap) this.make(this.cap * 2);
  }
}

// ---------- Building models ----------
// Local frame: origin at the footprint centre (unrotated), +x east, +y up, +z south. Front = -z.
// Part: { g, s:[sx,sy,sz], p:[x,y,z], c, r?:[ex,ey,ez], a?: 'spin'|'orbit'|'bob'|'glow'|'arm'|'claw', lamp?, unlit?, spd? }
const C = {
  plate: '#30353c', plateEdge: '#454c55', steel: '#8e99a5', steelDk: '#5d6670', iron: '#aab4be', brass: '#c9a24a', copper: '#c27a48',
  stone: '#b5a487', stoneDk: '#8c7c62', rust: '#8a6a52', blue: '#3e6fb0', blueLt: '#6a9ad8', glass: '#9ad6f5', white: '#e4e8ec',
  red: '#c44a3c', yellow: '#e2b23a', dark: '#24282e', wood: '#8b6542', ceramic: '#e8e2d4',
};
const P = {
  box: (s, p, c, x = {}) => ({ g: 'box', s, p, c, ...x }),
  cyl: (s, p, c, x = {}) => ({ g: 'cyl', s, p, c, ...x }),
  sph: (s, p, c, x = {}) => ({ g: 'sph', s, p, c, ...x }),
  cone: (s, p, c, x = {}) => ({ g: 'cone', s, p, c, ...x }),
  tor: (s, p, c, x = {}) => ({ g: 'tor', s, p, c, ...x }),
};
const HORIZ_X = [0, 0, Math.PI / 2]; // cylinder lying along x
const HORIZ_Z = [Math.PI / 2, 0, 0]; // cylinder lying along z
// Flat arrow decal pointing in local direction d (0 = front/-z, 1 = +x, 2 = +z, 3 = -x).
const arrow = (x, y, z, d, color, size = 0.4) => ({ g: 'arrow', s: [size, 1, size], p: [x, y, z], r: [0, -d * Math.PI / 2, 0], c: color });
const PORT_H = { 'assembler-2': 1.55, 'assembler-3': 1.55, 'chem-plant': 1.2, 'refinery': 1.5, 'boiler': 1.6, 'steam-engine': 1.45, 'pumpjack': 1.0, 'offshore-pump': 1.05 };
export const tierColor = (t) => t === 1 ? '#e0b43a' : t === 2 ? '#e0533f' : '#3f93e0';

function basePlate(w, h, Q) {
  Q.push(P.box([w - 0.04, 0.1, h - 0.04], [0, 0.05, 0], C.plate));
  Q.push(P.box([w - 0.24, 0.04, h - 0.24], [0, 0.11, 0], C.plateEdge));
}

export function partsFor(type, mode) {
  const d = BUILDINGS[type];
  const [w, h] = d.size;
  const hw = w / 2, hh = h / 2;
  const Q = [];
  const lamp = (y = 1, x = hw - 0.28, z = -hh + 0.28) => Q.push({ g: 'sph', s: [0.2, 0.2, 0.2], p: [x, y, z], lamp: true });
  switch (d.kind) {
    case 'drill': {
      const elec = type === 'electric-drill';
      const ox = elec ? 0 : -0.5; // output column (matches the simulation's output tile)
      basePlate(w, h, Q);
      if (elec) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) Q.push(P.box([0.32, 0.95, 0.32], [sx * 1.08, 0.55, sz * 1.08], C.steelDk));
        Q.push(P.box([2.3, 0.62, 2.3], [0, 0.55, 0.05], C.blue));
        Q.push(P.box([2.36, 0.1, 2.36], [0, 0.9, 0.05], C.steelDk));
        Q.push(P.box([1.5, 0.3, 1.5], [0, 1.1, 0.1], C.blueLt));
        Q.push(P.cyl([1.05, 0.42, 1.05], [0, 1.45, 0.1], C.brass, { a: 'spin', spd: 1.4 }));
        Q.push(P.box([1.4, 0.12, 0.18], [0, 1.72, 0.1], C.dark, { a: 'spin', spd: 1.4 }));
        Q.push(P.box([0.18, 0.12, 1.4], [0, 1.72, 0.1], C.dark, { a: 'spin', spd: 1.4 }));
        Q.push(P.cyl([0.28, 0.5, 0.28], [0, 2.0, 0.1], C.iron));
        for (const sx of [-1, 1]) Q.push(P.cyl([0.42, 0.9, 0.42], [sx * 1.2, 0.55, 0.55], C.copper, { r: HORIZ_Z }));
      } else {
        Q.push(P.box([1.7, 0.62, 1.55], [0.05, 0.42, 0.12], C.rust));
        Q.push(P.box([1.76, 0.08, 1.6], [0.05, 0.76, 0.12], C.steelDk));
        Q.push(P.box([0.45, 0.3, 0.08], [0.45, 0.45, hh - 0.04], '#ff7a22', { a: 'glow' }));
        Q.push(P.cyl([0.24, 0.85, 0.24], [0.55, 1.15, 0.5], C.dark));
        Q.push(P.cyl([0.3, 0.06, 0.3], [0.55, 1.6, 0.5], C.steelDk));
        for (const sx of [-0.32, 0.32]) Q.push(P.box([0.1, 0.9, 0.1], [ox + sx, 1.1, 0.3], C.steelDk));
        Q.push(P.box([0.82, 0.1, 0.14], [ox, 1.56, 0.3], C.steelDk));
        Q.push(P.cyl([0.55, 0.16, 0.55], [ox, 1.56, 0.3], C.brass, { r: HORIZ_X, a: 'spin', spd: 2 }));
      }
      // raised output signpost (same language as fluid ports) so it reads even from behind the drill
      const H = elec ? 2.15 : 1.75, sz = -hh + 0.22;
      Q.push(P.cyl([0.07, H - 0.4, 0.07], [ox, 0.4 + (H - 0.4) / 2, sz], C.steelDk));
      Q.push(P.cyl([0.5, 0.06, 0.5], [ox, H, sz], OUT_COLOR, { unlit: true }));
      Q.push(arrow(ox, H + 0.035, sz, 0, '#ffffff', 0.36));
      // output chute with an arrow on it
      const cz = -hh - 0.02;
      Q.push(P.box([0.62, 0.22, 0.5], [ox, 0.32, cz + 0.2], C.steelDk));
      Q.push(P.box([0.5, 0.06, 0.62], [ox, 0.2, cz + 0.05], C.dark));
      Q.push(arrow(ox, 0.44, cz + 0.2, 0, OUT_COLOR, 0.42));
      lamp(elec ? 1.0 : 0.95, hw - 0.25, hh - 0.25);
      break;
    }
    case 'pumpjack':
      basePlate(w, h, Q);
      Q.push(P.cyl([0.7, 0.35, 0.7], [0, 0.3, 0], C.steelDk));
      Q.push(P.box([0.16, 1.5, 0.16], [-0.3, 0.95, 0.3], C.steel, { r: [0, 0, -0.2] }));
      Q.push(P.box([0.16, 1.5, 0.16], [0.3, 0.95, 0.3], C.steel, { r: [0, 0, 0.2] }));
      Q.push({ g: 'box', s: [0.22, 0.22, 2.5], p: [0, 1.75, 0.2], c: C.red, a: 'bob' });
      Q.push({ g: 'box', s: [0.35, 0.55, 0.3], p: [0, 1.6, -1.05], c: C.red, a: 'bob' });
      Q.push(P.box([0.7, 0.45, 0.5], [0, 0.4, 1.0], C.dark));
      Q.push(P.cyl([0.16, 1.0, 0.16], [0, 0.75, -1.05], C.iron));
      lamp(0.5, hw - 0.3, hh - 0.3);
      break;
    case 'offshore':
      Q.push(P.box([0.86, 0.22, 0.86], [0, 0.12, 0.05], C.plate));
      Q.push(P.cyl([0.5, 0.55, 0.5], [0, 0.48, 0.12], C.blue));
      Q.push(P.cyl([0.56, 0.06, 0.56], [0, 0.78, 0.12], C.steelDk));
      Q.push(P.cyl([0.22, 0.85, 0.22], [0, 0.18, -0.62], C.steel, { r: [0.9, 0, 0] }));
      Q.push(arrow(0, 0.25, -0.3, 2, IN_COLOR, 0.28));
      break;
    case 'furnace': {
      if (type === 'electric-furnace') {
        basePlate(w, h, Q);
        Q.push(P.box([2.5, 0.95, 2.5], [0, 0.6, 0], C.white));
        Q.push(P.box([2.56, 0.12, 2.56], [0, 0.18, 0], C.steelDk));
        Q.push(P.box([1.8, 0.14, 1.8], [0, 1.12, 0], C.steelDk));
        Q.push(P.tor([1.4, 1.4, 1.4], [0, 1.22, 0], '#3aa0ff', { r: HORIZ_Z, a: 'glow' }));
        Q.push(P.tor([0.9, 0.9, 0.9], [0, 1.22, 0], '#3aa0ff', { r: HORIZ_Z, a: 'glow' }));
        Q.push(P.box([1.0, 0.35, 0.06], [0, 0.55, -1.26], '#ff8a2a', { a: 'glow' }));
        for (const sx of [-1, 1]) Q.push(P.box([0.08, 0.5, 1.6], [sx * 1.26, 0.6, 0], C.steelDk));
      } else {
        const st = type === 'stone-furnace';
        basePlate(w, h, Q);
        Q.push(P.box([1.76, 0.9, 1.76], [0, 0.58, 0], st ? C.stone : C.steelDk));
        Q.push(P.box([1.82, 0.12, 1.82], [0, 0.32, 0], st ? C.stoneDk : C.dark));
        Q.push(P.box([1.82, 0.12, 1.82], [0, 0.78, 0], st ? C.stoneDk : C.brass));
        Q.push(P.box([1.4, 0.1, 1.4], [0, 1.07, 0], st ? C.stoneDk : C.dark));
        Q.push(P.box([1.0, 0.04, 1.0], [0, 1.13, 0], '#ff7a22', { a: 'glow' }));
        Q.push(P.box([0.75, 0.38, 0.06], [0, 0.48, -0.89], '#ff7a22', { a: 'glow' }));
        Q.push(P.cyl([0.3, 0.7, 0.3], [0.55, 1.4, 0.55], st ? C.stoneDk : C.dark));
      }
      lamp(type === 'electric-furnace' ? 1.2 : 1.15);
      break;
    }
    case 'assembler': {
      if (type === 'chem-plant') {
        basePlate(w, h, Q);
        Q.push(P.box([2.6, 0.3, 2.6], [0, 0.28, 0], '#566a5e'));
        Q.push(P.cyl([0.95, 1.1, 0.95], [-0.62, 1.0, 0.3], '#d8c65a'));
        Q.push(P.sph([0.95, 0.55, 0.95], [-0.62, 1.55, 0.3], '#d8c65a'));
        Q.push(P.cyl([0.95, 1.1, 0.95], [0.62, 1.0, 0.3], '#6cc486'));
        Q.push(P.sph([0.95, 0.55, 0.95], [0.62, 1.55, 0.3], '#6cc486'));
        Q.push(P.box([1.6, 0.1, 0.1], [0, 1.25, -0.55], C.steel));
        Q.push(P.cyl([0.55, 0.55, 0.55], [0, 0.75, -0.6], C.steelDk));
        Q.push(P.box([0.5, 0.08, 0.12], [0, 1.08, -0.6], C.white, { a: 'spin', spd: 3 }));
        for (const sx of [-1, 1]) Q.push(P.cyl([0.12, 0.9, 0.12], [sx * 0.62, 0.9, -0.55], C.steel));
      } else if (type === 'refinery') {
        basePlate(w, h, Q);
        Q.push(P.box([4.6, 0.4, 4.6], [0, 0.3, 0], '#6b5e55'));
        Q.push(P.cyl([1.15, 3.2, 1.15], [-1.25, 2.0, 0.6], C.iron));
        for (const y of [1.0, 1.8, 2.6, 3.4]) Q.push(P.tor([1.25, 1.25, 1.25], [-1.25, y, 0.6], C.steelDk, { r: HORIZ_Z }));
        Q.push(P.cyl([0.95, 2.5, 0.95], [0.3, 1.7, 1.0], '#b9b1a5'));
        Q.push(P.sph([0.95, 0.5, 0.95], [0.3, 2.95, 1.0], '#b9b1a5'));
        Q.push(P.cyl([0.75, 1.8, 0.75], [1.45, 1.35, 0.3], '#a39a8e'));
        Q.push(P.box([4.0, 0.7, 1.2], [0, 0.85, -1.3], '#7a6b62'));
        Q.push(P.box([4.1, 0.1, 1.3], [0, 1.25, -1.3], C.steelDk));
        Q.push(P.cyl([0.22, 1.2, 0.22], [1.6, 1.8, -1.6], C.dark));
        Q.push(P.cone([0.3, 0.45, 0.3], [1.6, 2.6, -1.6], '#ff9a3a', { a: 'glow' }));
      } else {
        const tc = type === 'assembler-1' ? '#a2a04e' : type === 'assembler-2' ? '#4f86c0' : '#c0644f';
        basePlate(w, h, Q);
        Q.push(P.box([2.6, 0.7, 2.6], [0, 0.48, 0], '#59616b'));
        Q.push(P.box([2.66, 0.14, 2.66], [0, 0.22, 0], tc));
        Q.push(P.box([2.66, 0.14, 2.66], [0, 0.86, 0], tc));
        for (const sx of [-1, 1]) Q.push(P.box([0.06, 0.32, 1.7], [sx * 1.31, 0.52, 0], C.glass));
        Q.push(P.box([1.7, 0.32, 0.06], [0, 0.52, 1.31], C.glass));
        Q.push(P.box([2.1, 0.16, 2.1], [0, 1.0, 0], '#40464e'));
        Q.push(P.cyl([1.3, 0.12, 1.3], [0, 1.12, 0], '#8b949e', { a: 'spin', spd: 0.8 }));
        Q.push(P.cyl([0.36, 0.4, 0.36], [0, 1.35, 0], C.steelDk));
        Q.push(P.box([1.05, 0.12, 0.16], [0.4, 1.55, 0], C.yellow, { a: 'orbit', pv: [0, 0], spd: 1.2 }));
        Q.push(P.box([0.14, 0.3, 0.14], [0.88, 1.42, 0], C.dark, { a: 'orbit', pv: [0, 0], spd: 1.2 }));
      }
      lamp(type === 'refinery' ? 0.85 : 1.05);
      break;
    }
    case 'lab':
      basePlate(w, h, Q);
      Q.push(P.box([2.5, 0.35, 2.5], [0, 0.28, 0], C.white));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) Q.push(P.cyl([0.2, 0.9, 0.2], [sx * 0.95, 0.85, sz * 0.95], C.steel));
      Q.push(P.sph([1.7, 1.25, 1.7], [0, 0.9, 0], '#7fc8f5'));
      Q.push(P.sph([0.5, 0.5, 0.5], [0, 1.25, 0], '#fff2a0', { a: 'glow' }));
      Q.push(P.tor([2.3, 2.3, 2.3], [0, 1.35, 0], C.brass, { r: [Math.PI / 2 - 0.35, 0, 0], a: 'orbit', pv: [0, 0], spd: 0.8 }));
      lamp(0.55);
      break;
    case 'belt': break;
    case 'underground': {
      const tc = tierColor(d.tier);
      const entr = mode !== 'out';
      const z = entr ? -0.18 : 0.18;
      Q.push(P.box([0.94, 0.52, 0.62], [0, 0.3, z], tc));
      Q.push(P.box([0.98, 0.1, 0.66], [0, 0.6, z], C.dark));
      Q.push(P.box([0.7, 0.34, 0.04], [0, 0.24, entr ? 0.14 : -0.14], '#0d0f12'));
      Q.push(arrow(0, 0.66, z, 0, entr ? IN_COLOR : OUT_COLOR, 0.4));
      break;
    }
    case 'splitter': {
      const tc = tierColor(d.tier);
      Q.push(P.box([1.94, 0.46, 0.42], [0, 0.3, -0.02], tc));
      Q.push(P.box([1.98, 0.1, 0.46], [0, 0.56, -0.02], C.dark));
      Q.push(P.box([0.1, 0.5, 0.9], [0, 0.3, 0], C.dark));
      for (const sx of [-0.5, 0.5]) Q.push(arrow(sx, 0.62, -0.02, 0, OUT_COLOR, 0.36));
      break;
    }
    case 'inserter': {
      const c = { 'burner-inserter': '#9a6a3a', 'long-inserter': '#d0473a', 'fast-inserter': '#3d84d6', 'filter-inserter': '#9152d6', 'stack-inserter': '#3dba76' }[type] || '#dcb43a';
      Q.push(arrow(0, 0.03, 0.31, 0, IN_COLOR, 0.3));
      Q.push(arrow(0, 0.03, -0.31, 0, OUT_COLOR, 0.3));
      Q.push(P.cyl([0.44, 0.1, 0.44], [0, 0.07, 0], C.dark));
      Q.push(P.cyl([0.3, 0.16, 0.3], [0, 0.2, 0], c));
      Q.push(P.cyl([0.14, 0.38, 0.14], [0, 0.45, 0], C.steel));
      Q.push({ g: 'box', s: [0.1, 0.09, d.reach * 0.92], p: [0, 0.66, 0], c, a: 'arm' });
      Q.push({ g: 'box', s: [0.22, 0.14, 0.1], p: [0, 0.6, 0], c: C.dark, a: 'claw' });
      break;
    }
    case 'chest': case 'uplink': case 'downlink': {
      const c = type === 'iron-chest' ? '#9aa3ab' : type === 'steel-chest' ? '#5d6670' : type === 'uplink-chest' ? '#2f8fa6' : '#a63a8e';
      Q.push(P.box([0.8, 0.5, 0.8], [0, 0.27, 0], c));
      Q.push(P.box([0.84, 0.12, 0.84], [0, 0.56, 0], C.dark));
      for (const sx of [-0.25, 0.25]) Q.push(P.box([0.07, 0.62, 0.86], [sx, 0.3, 0], type === 'steel-chest' ? C.brass : C.steelDk));
      Q.push(P.box([0.14, 0.14, 0.04], [0, 0.42, -0.41], C.brass));
      if (d.kind !== 'chest') {
        const gc = d.kind === 'uplink' ? '#66ffff' : '#ff77ff';
        Q.push(P.cyl([0.22, 0.12, 0.22], [0, 0.66, 0], gc, { a: 'glow' }));
        Q.push(P.cone([0.3, 0.3, 0.3], [0, 0.95, 0], gc, { unlit: true, r: d.kind === 'uplink' ? [0, 0, 0] : [Math.PI, 0, 0] }));
      }
      break;
    }
    case 'pole':
      if (type === 'substation') {
        Q.push(P.box([1.6, 0.25, 1.6], [0, 0.13, 0], C.plate));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) Q.push(P.box([0.14, 2.2, 0.14], [sx * 0.55, 1.3, sz * 0.55], C.steel));
        Q.push(P.box([1.3, 0.12, 1.3], [0, 2.35, 0], C.steelDk));
        Q.push(P.box([0.7, 0.7, 0.7], [0, 0.7, 0], '#4a6e8c'));
        for (const sx of [-0.5, 0.5]) Q.push(P.cyl([0.12, 0.25, 0.12], [sx, 2.52, 0], C.ceramic));
      } else {
        const med = type === 'pole-medium', tall = med ? 2.6 : 2.0;
        Q.push(P.cyl([med ? 0.2 : 0.18, tall, med ? 0.2 : 0.18], [0, tall / 2, 0], med ? C.steel : C.wood));
        Q.push(P.box([0.9, 0.08, 0.1], [0, tall - 0.18, 0], med ? C.steelDk : '#6a4b30'));
        for (const sx of [-0.38, 0.38]) Q.push(P.cyl([0.09, 0.14, 0.09], [sx, tall - 0.08, 0], C.ceramic));
      }
      break;
    case 'pipe': case 'upipe': break;
    case 'boiler':
      basePlate(w, h, Q);
      Q.push(P.cyl([1.05, 2.5, 1.05], [0, 0.78, 0.2], '#a5713e', { r: HORIZ_X }));
      for (const x of [-0.9, 0, 0.9]) Q.push(P.tor([1.12, 1.12, 1.12], [x, 0.78, 0.2], C.steelDk, { r: [0, Math.PI / 2, 0] }));
      Q.push(P.box([0.9, 0.45, 0.35], [0, 0.4, 0.75], C.dark));
      Q.push(P.box([0.5, 0.22, 0.04], [0, 0.4, 0.94], '#ff7a22', { a: 'glow' }));
      Q.push(P.cyl([0.26, 1.0, 0.26], [0.85, 1.55, 0.45], C.dark));
      lamp(1.35, hw - 0.3, hh - 0.25);
      break;
    case 'generator':
      basePlate(w, h, Q);
      Q.push(P.cyl([0.9, 2.5, 0.9], [-0.45, 0.66, 0], C.steel, { r: HORIZ_Z }));
      for (const z of [-0.9, 0.9]) Q.push(P.tor([0.96, 0.96, 0.96], [-0.45, 0.66, z], C.steelDk));
      Q.push(P.box([0.5, 0.5, 1.5], [0.35, 0.4, 0], C.steelDk));
      Q.push(P.cyl([1.55, 0.2, 1.55], [0.85, 0.95, 0.15], C.iron, { r: HORIZ_X, a: 'spin', spd: 3 }));
      Q.push(P.box([0.1, 0.22, 1.35], [0.85, 0.95, 0.15], C.dark, { r: HORIZ_X, a: 'spin', spd: 3 }));
      lamp(1.15, -hw + 0.3, hh - 0.3);
      break;
    case 'solar': {
      const tilt = [-0.22, 0, 0];
      Q.push(P.box([w - 0.1, 0.12, h - 0.1], [0, 0.06, 0], C.plate));
      Q.push(P.box([0.2, 0.5, 0.2], [0, 0.35, 0], C.steelDk));
      Q.push(P.box([w - 0.2, 0.08, h - 0.2], [0, 0.62, 0], C.steel, { r: tilt }));
      Q.push(P.box([w - 0.35, 0.05, h - 0.35], [0, 0.67, 0], '#1d3d86', { r: tilt }));
      for (const x of [-0.45, 0.45]) Q.push(P.box([0.03, 0.06, h - 0.35], [x, 0.69, 0], '#8fb4ff', { r: tilt }));
      Q.push(P.box([w - 0.35, 0.06, 0.03], [0, 0.69, 0], '#8fb4ff', { r: tilt }));
      break;
    }
    case 'accumulator':
      basePlate(w, h, Q);
      for (const sx of [-0.42, 0.42]) {
        Q.push(P.cyl([0.62, 1.1, 0.62], [sx, 0.7, 0], C.steel));
        Q.push(P.cyl([0.66, 0.1, 0.66], [sx, 1.28, 0], C.dark));
        Q.push(P.cyl([0.64, 0.2, 0.64], [sx, 0.55, 0], '#ffd23f', { a: 'glow' }));
      }
      break;
    case 'beacon':
      basePlate(w, h, Q);
      Q.push(P.box([2.0, 0.5, 2.0], [0, 0.35, 0], '#3c434c'));
      Q.push(P.cyl([0.3, 1.7, 0.3], [0, 1.4, 0], C.steel));
      Q.push(P.cone([1.8, 0.35, 1.8], [0, 2.15, 0], '#a8d4ff', { a: 'spin', spd: 0.7 }));
      Q.push(P.sph([0.42, 0.42, 0.42], [0, 2.5, 0], '#66ffff', { a: 'glow' }));
      lamp(0.7);
      break;
    case 'gate':
      basePlate(w, h, Q);
      Q.push(P.cyl([6.2, 0.4, 6.2], [0, 0.3, 0], '#3a4049'));
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        Q.push(P.box([0.5, 3.2, 0.5], [Math.cos(a) * 2.7, 2.0, Math.sin(a) * 2.7], C.steel));
        Q.push(P.sph([0.3, 0.3, 0.3], [Math.cos(a) * 2.7, 3.7, Math.sin(a) * 2.7], '#ffe680', { a: 'glow' }));
      }
      Q.push(P.tor([5.6, 5.6, 5.6], [0, 3.5, 0], C.iron, { r: HORIZ_Z, a: 'orbit', pv: [0, 0], spd: 0.4 }));
      Q.push(P.tor([3.6, 3.6, 3.6], [0, 2.0, 0], '#ffe680', { r: [Math.PI / 2, 0, 0], a: 'glow' }));
      Q.push(P.sph([1.5, 1.5, 1.5], [0, 2.0, 0], '#ffd23f', { a: 'glow' }));
      lamp(0.6);
      break;
  }
  // fluid ports: steel stub + coloured flange + arrow (cyan into the machine, orange out of it)
  for (const p of d.ports || []) {
    const lx = p.x - hw + 0.5, lz = p.y - hh + 0.5;
    const ex = DX[p.dir], ez = DY[p.dir];
    const col = p.io === 'in' ? IN_COLOR : OUT_COLOR;
    const r = p.dir % 2 ? HORIZ_X : HORIZ_Z;
    Q.push(P.cyl([0.34, 0.26, 0.34], [lx + ex * 0.4, 0.32, lz + ez * 0.4], C.steelDk, { r }));
    Q.push(P.cyl([0.44, 0.06, 0.44], [lx + ex * 0.5, 0.32, lz + ez * 0.5], col, { r, unlit: true }));
    Q.push(arrow(lx + ex * 0.15, d.kind === 'offshore' ? 0.25 : 0.15, lz + ez * 0.15, p.io === 'in' ? (p.dir + 2) & 3 : p.dir, col, 0.34));
    // raised signpost so the port reads from any camera angle, even on the far side of a tall machine
    const H = PORT_H[type] || 1.3, sx = lx + ex * 0.36, sz = lz + ez * 0.36;
    Q.push(P.cyl([0.06, H - 0.3, 0.06], [sx, 0.3 + (H - 0.3) / 2, sz], C.steelDk));
    Q.push(P.cyl([0.46, 0.06, 0.46], [sx, H, sz], col, { unlit: true }));
    Q.push(arrow(sx, H + 0.035, sz, p.io === 'in' ? (p.dir + 2) & 3 : p.dir, '#ffffff', 0.32));
  }
  return Q;
}

function rotLocalFor(type, lx, ly, rot) {
  const [w, h] = BUILDINGS[type].size;
  switch (rot & 3) {
    case 0: return [lx, ly];
    case 1: return [h - 1 - ly, lx];
    case 2: return [w - 1 - lx, h - 1 - ly];
    default: return [ly, w - 1 - lx];
  }
}
// Tiles a building reads from (cyan) or writes to (orange), for highlighting.
export function ioTiles(type, x, y, rot) {
  const d = BUILDINGS[type];
  const out = [];
  const local = (lx, ly) => { const [a, b] = rotLocalFor(type, lx, ly, rot); return [x + a, y + b]; };
  if (d.kind === 'inserter') {
    out.push({ x: x - DX[rot] * d.reach, y: y - DY[rot] * d.reach, c: IN_COLOR });
    out.push({ x: x + DX[rot] * d.reach, y: y + DY[rot] * d.reach, c: OUT_COLOR });
  } else if (d.kind === 'drill') {
    const [ox, oy] = local(Math.floor((d.size[0] - 1) / 2), -1);
    out.push({ x: ox, y: oy, c: OUT_COLOR });
  } else if (d.kind === 'offshore') {
    out.push({ x: x + DX[rot], y: y + DY[rot], c: IN_COLOR });
  } else if (d.kind === 'splitter') {
    for (let i = 0; i < 2; i++) { const [lx, ly] = local(i, 0); out.push({ x: lx + DX[rot], y: ly + DY[rot], c: OUT_COLOR }, { x: lx - DX[rot], y: ly - DY[rot], c: IN_COLOR }); }
  }
  for (const p of d.ports || []) {
    const [px, py] = local(p.x, p.y);
    const dd = (p.dir + rot) & 3;
    out.push({ x: px + DX[dd], y: py + DY[dd], c: p.io === 'in' ? IN_COLOR : OUT_COLOR });
  }
  return out;
}

// ---------- Textures ----------
function chevronTexture(color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#202226'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#2d3035'; x.fillRect(10, 0, 108, 128);
  x.fillStyle = '#25282c'; for (let i = 0; i < 8; i++) x.fillRect(10, i * 16, 108, 2);
  x.strokeStyle = color; x.lineWidth = 9; x.lineCap = 'round'; x.lineJoin = 'round';
  for (const oy of [0, 64]) { x.beginPath(); x.moveTo(36, 46 + oy); x.lineTo(64, 20 + oy); x.lineTo(92, 46 + oy); x.stroke(); }
  x.fillStyle = color; x.fillRect(0, 0, 8, 128); x.fillRect(120, 0, 8, 128);
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(8, 0, 3, 128); x.fillRect(117, 0, 3, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- Recipe icon atlas ----------
class IconAtlas {
  constructor() {
    this.N = 16; this.S = 64;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.N * this.S;
    this.ctx = this.canvas.getContext('2d');
    this.slots = new Map();
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
  }
  slot(id) {
    if (this.slots.has(id)) return this.slots.get(id);
    const k = this.slots.size;
    const cx = k % this.N, cy = Math.floor(k / this.N);
    const x = this.ctx;
    x.save(); x.translate(cx * this.S, cy * this.S);
    x.fillStyle = 'rgba(16,19,24,0.85)'; x.beginPath(); x.arc(32, 32, 30, 0, 7); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.4)'; x.lineWidth = 2.5; x.stroke();
    x.drawImage(iconCanvas(id), 11, 11, 42, 42);
    x.restore();
    const uv = [cx / this.N, 1 - (cy + 1) / this.N];
    this.slots.set(id, uv);
    this.tex.needsUpdate = true;
    return uv;
  }
}

// ---------- Renderer ----------
export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.1;
    this.r.shadowMap.enabled = true; this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1b1f24');
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 600);
    this.target = new THREE.Vector3();
    this.dist = 28; this.pitch = 0.95;
    this.hemi = new THREE.HemisphereLight('#dfe8ff', '#5a4c38', 1.5);
    this.sunL = new THREE.DirectionalLight('#fff1dc', 2.2);
    this.sunL.castShadow = true;
    this.sunL.shadow.mapSize.set(2048, 2048);
    this.sunL.shadow.bias = -0.0004; this.sunL.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sunL, this.sunL.target);
    this.mats = {
      std: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.25 }),
      glow: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      decal: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      ghost: new THREE.MeshBasicMaterial({ color: '#5aa0ff', transparent: true, opacity: 0.35, depthWrite: false }),
    };
    this.geos = {
      box: roundedBox(0.07),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
      sph: new THREE.SphereGeometry(0.5, 28, 18),
      cone: new THREE.ConeGeometry(0.5, 1, 32),
      tor: new THREE.TorusGeometry(0.5, 0.04, 10, 56),
      arrow: arrowGeo(),
      cube: new THREE.BoxGeometry(1, 1, 1),
      plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    };
    this.pools = {};
    for (const g of ['box', 'cyl', 'sph', 'cone', 'tor']) {
      this.pools[g] = new Pool(this.scene, this.geos[g], this.mats.std, g === 'box' ? 4096 : 1024, true);
      this.pools[g + '!'] = new Pool(this.scene, this.geos[g], this.mats.glow, 256, false);
    }
    this.pools['arrow!'] = new Pool(this.scene, this.geos.arrow, this.mats.decal, 1024, false);
    // belts
    const beltGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.07, 0);
    this.beltTex = {}; this.beltPools = {};
    for (const t of [1, 2, 3]) {
      this.beltTex[t] = chevronTexture(tierColor(t));
      const m = new THREE.MeshStandardMaterial({ map: this.beltTex[t], roughness: 0.8, metalness: 0.1 });
      this.beltPools[t] = new Pool(this.scene, beltGeo, m, 1024, false);
      this.beltPools[t].mesh.receiveShadow = true;
    }
    const im = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.3 });
    this.itemStreams = {
      flat: new Stream(this.scene, new THREE.BoxGeometry(0.34, 0.08, 0.34), im),
      chunk: new Stream(this.scene, new THREE.DodecahedronGeometry(0.17), im),
      block: new Stream(this.scene, new THREE.BoxGeometry(0.26, 0.22, 0.26), im),
      cylr: new Stream(this.scene, new THREE.CylinderGeometry(0.14, 0.14, 0.28, 12), im),
    };
    this.itemInfo = {};
    for (const [id, it] of Object.entries(ITEMS)) {
      const s = it.shape;
      const bucket = ['plate', 'wafer', 'chip', 'frame', 'module'].includes(s) ? 'flat' : ['ore', 'crystal', 'powder', 'blob'].includes(s) ? 'chunk' : ['pack', 'battery', 'core'].includes(s) ? 'cylr' : 'block';
      this.itemInfo[id] = { bucket, color: new THREE.Color(it.color) };
    }
    // floating recipe icons (billboards tilted to face the fixed-pitch camera)
    this.atlas = new IconAtlas();
    const iconMat = new THREE.MeshBasicMaterial({ map: this.atlas.tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    iconMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aSlot;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * 0.0625 + aSlot;\n#endif');
    };
    this.iconPool = new Pool(this.scene, new THREE.PlaneGeometry(1, 1), iconMat, 256, false);
    this.iconPool.addAttr('aSlot', 2);
    this.iconPool.mesh.renderOrder = 10;
    this.showIcons = true;

    this.partCache = {};
    this.animated = new Set(); this.lamped = new Set(); this.inserters = new Set(); this.iconed = new Set();
    this.overlay = new THREE.Group(); this.scene.add(this.overlay);
    this.selGroup = new THREE.Group(); this.scene.add(this.selGroup);
    this.wireLines = null; this.grid = null;
    this.ghostPool = new Pool(this.scene, this.geos.cube, this.mats.ghost, 256, false);
    this.ghostSlots = [];
    this.time = 0;
    this.setGame(game);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setGame(g) {
    if (this.game) {
      for (const e of this.game.ents.values()) this.removeEnt(e);
      this.scene.remove(this.terrain, this.rocks);
    }
    this.game = g;
    this.buildTerrain();
    for (const e of g.ents.values()) this.addEnt(e);
    g.on('add', (e) => this.addEnt(e));
    g.on('remove', (e) => this.removeEnt(e));
    g.on('update', (e) => { this.removeEnt(e); this.addEnt(e); });
    g.on('tile', (i) => this.tileChanged(i));
    g.on('power', () => this.rebuildWires());
    g.on('fluids', () => this.rebuildPipes());
    g.on('ghosts', () => { this.ghostsDirty = true; });
    this.rebuildWires();
    this.ghostsDirty = true;
    const c = g.size / 2;
    this.target.set(c - 4, 0, c - 3);
  }
  setShadows(on) { this.r.shadowMap.enabled = on; this.sunL.castShadow = on; this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
  setIcons(on) { this.showIcons = on; this.iconPool.mesh.visible = on; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ----- terrain -----
  buildTerrain() {
    const g = this.game, W = g.world, S = W.size, T = 6;
    const c = document.createElement('canvas'); c.width = S * T; c.height = S * T;
    this.tctx = c.getContext('2d');
    this.T = T;
    const img = this.tctx.createImageData(S * T, S * T);
    const oreRGB = {};
    for (const [k, v] of Object.entries(ORE_COLORS)) { const cc = new THREE.Color(v); oreRGB[k] = [cc.r * 255, cc.g * 255, cc.b * 255]; }
    this.oreRGB = oreRGB;
    for (let ty = 0; ty < S; ty++) for (let tx = 0; tx < S; tx++) {
      const i = W.idx(tx, ty);
      for (let py = 0; py < T; py++) for (let px = 0; px < T; px++) this.tilePixel(i, tx, ty, px, py, img.data, ((ty * T + py) * S * T + tx * T + px) * 4);
    }
    this.tctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 8;
    this.terrainTex = tex;
    const geo = new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2).translate(S / 2, 0, S / 2);
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
    // ore rocks, two per tile
    let n = 0;
    for (let i = 0; i < S * S; i++) if (W.ore[i] && W.ore[i] !== OIL) n++;
    this.rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.7, metalness: 0.15, flatShading: true }), Math.max(1, n * 2));
    this.rocks.frustumCulled = false; this.rocks.castShadow = true; this.rocks.receiveShadow = true;
    this.rockIdx = new Int32Array(S * S).fill(-1);
    let k = 0;
    const rnd = (a) => { const s = Math.sin(a * 12.9898) * 43758.5453; return s - Math.floor(s); };
    for (let i = 0; i < S * S; i++) {
      if (!W.ore[i] || W.ore[i] === OIL) continue;
      const tx = i % S, ty = (i / S) | 0;
      this.rockIdx[i] = k;
      for (let j = 0; j < 2; j++) {
        const sc = (j ? 0.45 : 0.7) + Math.min(1.2, W.amount[i] / 1500) * 0.5;
        tmpV.set(tx + 0.2 + rnd(i + j * 31) * 0.6, 0.04, ty + 0.2 + rnd(i + 7 + j * 17) * 0.6);
        tmpQ.setFromEuler(tmpE.set(rnd(i + 5) * 0.6, rnd(i + 3 + j) * 6, 0));
        tmpS.set(sc, sc * 0.65, sc);
        this.rocks.setMatrixAt(k, tmpM.compose(tmpV, tmpQ, tmpS));
        this.rocks.setColorAt(k, tmpC.set(ORE_COLORS[ORES[W.ore[i]]]).multiplyScalar(1.1 + rnd(i + j) * 0.25));
        k++;
      }
    }
    this.rocks.count = k;
    this.scene.add(this.rocks);
  }
  tilePixel(i, tx, ty, px, py, d, o) {
    const W = this.game.world;
    const hsh = ((tx * 73856093) ^ (ty * 19349663) ^ (px * 83492791) ^ (py * 2654435761)) >>> 0;
    const n = (hsh % 1000) / 1000;
    let r, g, b;
    if (W.water[i]) {
      const v = W.shade[i] / 255;
      r = 28 + v * 12; g = 66 + v * 22 + n * 5; b = 112 + v * 28 + n * 8;
    } else {
      const s = W.shade[i] / 255;
      r = 78 + s * 28 + n * 7; g = 86 + s * 24 + n * 7; b = 56 + s * 12 + n * 4;
      const ore = W.ore[i];
      if (ore) {
        const oc = this.oreRGB[ORES[ore]];
        if (ore === OIL) {
          const dx = px - (this.T - 1) / 2, dy = py - (this.T - 1) / 2, rr = dx * dx + dy * dy;
          if (rr < this.T * this.T * 0.2) { r = oc[0] + n * 15; g = oc[1] + n * 10; b = oc[2] + n * 20; if (rr < 1.5) { r += 40; g += 30; b += 50; } }
        } else {
          const m = n > 0.5 ? 0.6 : 0.3;
          r = r * (1 - m) + oc[0] * m; g = g * (1 - m) + oc[1] * m; b = b * (1 - m) + oc[2] * m;
        }
      }
    }
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
  tileChanged(i) {
    const W = this.game.world, S = W.size, T = this.T;
    const tx = i % S, ty = (i / S) | 0;
    const img = this.tctx.createImageData(T, T);
    for (let py = 0; py < T; py++) for (let px = 0; px < T; px++) this.tilePixel(i, tx, ty, px, py, img.data, (py * T + px) * 4);
    this.tctx.putImageData(img, tx * T, ty * T);
    this.terrainDirty = true;
    const k = this.rockIdx[i];
    if (k >= 0) { tmpM.makeScale(0, 0, 0); this.rocks.setMatrixAt(k, tmpM); this.rocks.setMatrixAt(k + 1, tmpM); this.rocks.instanceMatrix.needsUpdate = true; this.rockIdx[i] = -1; }
  }

  // ----- entities -----
  baseMatrix(e, out) {
    tmpV.set(e.x + e.w / 2, 0, e.y + e.h / 2);
    tmpQ.setFromAxisAngle(Y_AXIS, -e.rot * Math.PI / 2);
    return out.compose(tmpV, tmpQ, ONE);
  }
  partMatrix(base, p, angle, out) {
    if (p.r) tmpQ.setFromEuler(tmpE.set(p.r[0], p.r[1], p.r[2])); else tmpQ.identity();
    tmpS.set(p.s[0], p.s[1], p.s[2]);
    if (angle && p.a === 'orbit') {
      // rotate around a vertical axis through the pivot (local coords)
      const [px, pz] = p.pv || [0, 0];
      tmpV.set(p.p[0] - px, p.p[1], p.p[2] - pz);
      tmpM2.compose(tmpV, tmpQ, tmpS);
      tmpM3.makeRotationY(angle).setPosition(px, 0, pz);
      tmpM2.premultiply(tmpM3);
      return out.multiplyMatrices(base, tmpM2);
    }
    if (angle) tmpQ.multiply(tmpQ2.setFromAxisAngle(Y_AXIS, angle)); // spin about the part's own axis
    tmpV.set(p.p[0], p.p[1], p.p[2]);
    tmpM2.compose(tmpV, tmpQ, tmpS);
    return out.multiplyMatrices(base, tmpM2);
  }
  poolFor(p) {
    if (p.g === 'arrow') return this.pools['arrow!'];
    return this.pools[p.g + (p.a === 'glow' || p.lamp || p.unlit ? '!' : '')];
  }
  addEnt(e) {
    if (e._r) this.removeEnt(e);
    const R = { slots: [], base: new THREE.Matrix4(), phase: Math.random() * 6 };
    e._r = R;
    this.baseMatrix(e, R.base);
    if (BELTLIKE.has(e.kind)) {
      const pool = this.beltPools[e.def.tier];
      for (const l of e.lanes()) {
        const i = pool.alloc();
        tmpV.set(l.tx + 0.5, 0, l.ty + 0.5);
        tmpQ.setFromAxisAngle(Y_AXIS, -l.dir * Math.PI / 2);
        pool.set(i, tmpM.compose(tmpV, tmpQ, ONE)); pool.color(i, tmpC.set('#ffffff'));
        R.slots.push({ pool, i });
      }
    }
    if (e.kind === 'pipe' || e.kind === 'upipe') { this.addPipeParts(e); return; }
    const key = e.type + (e.mode === 'out' ? ':out' : '');
    const parts = this.partCache[key] || (this.partCache[key] = partsFor(e.type, e.mode));
    for (const p of parts) {
      const pool = this.poolFor(p);
      const i = pool.alloc();
      this.partMatrix(R.base, p, 0, tmpM);
      if (p.a === 'arm' || p.a === 'claw') tmpM.makeScale(0, 0, 0);
      pool.set(i, tmpM);
      pool.color(i, tmpC.set(p.lamp ? '#888' : p.c));
      const slot = { pool, i, p };
      R.slots.push(slot);
      if (p.lamp) { R.lamp = slot; this.lamped.add(e); }
      if (p.a === 'glow') { (R.glows ||= []).push(slot); this.lamped.add(e); }
      if (p.a === 'spin' || p.a === 'orbit' || p.a === 'bob') { (R.anim ||= []).push(slot); this.animated.add(e); }
      if (p.a === 'arm') { R.arm = slot; this.inserters.add(e); }
      if (p.a === 'claw') R.claw = slot;
    }
    if (['assembler', 'furnace', 'drill', 'pumpjack', 'offshore', 'inserter', 'splitter', 'downlink'].includes(e.kind)) this.iconed.add(e);
    R.icon = null;
  }
  removeEnt(e) {
    const R = e._r;
    if (!R) return;
    for (const s of R.slots) s.pool.release(s.i);
    if (R.iconSlot !== undefined) this.iconPool.release(R.iconSlot);
    this.animated.delete(e); this.lamped.delete(e); this.inserters.delete(e); this.iconed.delete(e);
    e._r = null;
  }
  // What should float above this entity: recipe output, ore type, filter item…
  iconFor(e) {
    if (e.kind === 'assembler' || e.kind === 'furnace') return e.recipe ? Object.keys(RECIPES[e.recipe].out)[0] : null;
    if (e.kind === 'drill') {
      const W = this.game.world;
      for (const i of e.area) if (W.ore[i] && W.ore[i] !== OIL) return ORES[W.ore[i]];
      return null;
    }
    if (e.kind === 'pumpjack') return 'crude-oil';
    if (e.kind === 'offshore') return 'water';
    if (e.kind === 'inserter' || e.kind === 'splitter' || e.kind === 'downlink') return e.filter || null;
    return null;
  }
  updateIcon(e) {
    const R = e._r; if (!R) return;
    const id = this.iconFor(e);
    if (id === R.icon) return;
    R.icon = id;
    const pool = this.iconPool;
    if (!id) { if (R.iconSlot !== undefined) { pool.release(R.iconSlot); R.iconSlot = undefined; } return; }
    if (R.iconSlot === undefined) R.iconSlot = pool.alloc();
    const small = e.w === 1 && e.h === 1;
    const m = Math.min(e.w, e.h);
    const size = small ? 0.5 : m >= 5 ? 1.15 : m >= 3 ? 0.82 : 0.66;
    const top = { drill: e.w > 2 ? 2.7 : 2.3, assembler: e.type === 'refinery' ? 4.2 : e.type === 'chem-plant' ? 2.3 : 2.1, furnace: 1.75, inserter: 1.05, splitter: 1.05, downlink: 1.4, pumpjack: 2.4, offshore: 1.6 }[e.kind] || 2;
    tmpV.set(e.x + e.w / 2, top, e.y + e.h / 2);
    tmpQ.setFromAxisAngle(X_AXIS, -this.pitch);
    tmpS.set(size, size, size);
    pool.set(R.iconSlot, tmpM.compose(tmpV, tmpQ, tmpS));
    const [u, v] = this.atlas.slot(id);
    const a = pool.extra.aSlot; a.array[R.iconSlot * 2] = u; a.array[R.iconSlot * 2 + 1] = v; pool.edirty = true;
  }

  addPipeParts(e) {
    const R = e._r;
    const pc = e.kind === 'upipe' ? '#6c7886' : '#9aa6b2';
    const cp = this.pools.cyl, sp = this.pools.sph;
    const i = sp.alloc();
    tmpV.set(e.x + 0.5, 0.32, e.y + 0.5); tmpS.set(0.36, 0.36, 0.36);
    sp.set(i, tmpM.compose(tmpV, tmpQ.identity(), tmpS)); sp.color(i, tmpC.set(pc));
    R.hub = { pool: sp, i }; R.slots.push(R.hub);
    const dirs = e.kind === 'upipe' ? [e.openDir()] : [0, 1, 2, 3];
    for (const d of dirs) {
      if (e.kind === 'pipe' && !this.pipeConnects(e, d)) continue;
      tmpQ.setFromEuler(tmpE.set(d % 2 ? 0 : Math.PI / 2, 0, d % 2 ? Math.PI / 2 : 0));
      const j = cp.alloc();
      tmpV.set(e.x + 0.5 + DX[d] * 0.25, 0.32, e.y + 0.5 + DY[d] * 0.25); tmpS.set(0.26, 0.5, 0.26);
      cp.set(j, tmpM.compose(tmpV, tmpQ, tmpS)); cp.color(j, tmpC.set(pc));
      R.slots.push({ pool: cp, i: j, seg: true });
      const f = cp.alloc();
      tmpV.set(e.x + 0.5 + DX[d] * 0.47, 0.32, e.y + 0.5 + DY[d] * 0.47); tmpS.set(0.34, 0.05, 0.34);
      cp.set(f, tmpM.compose(tmpV, tmpQ, tmpS)); cp.color(f, tmpC.set('#5d6670'));
      R.slots.push({ pool: cp, i: f });
    }
    if (e.kind === 'upipe') {
      const bp = this.pools.box, ap = this.pools['arrow!'];
      const j = bp.alloc();
      tmpV.set(e.x + 0.5, 0.2, e.y + 0.5); tmpS.set(0.72, 0.4, 0.72);
      bp.set(j, tmpM.compose(tmpV, tmpQ.identity(), tmpS)); bp.color(j, tmpC.set('#4a525c'));
      R.slots.push({ pool: bp, i: j });
      const k = ap.alloc();
      tmpV.set(e.x + 0.5, 0.42, e.y + 0.5); tmpQ.setFromAxisAngle(Y_AXIS, -e.rot * Math.PI / 2); tmpS.set(0.4, 1, 0.4);
      ap.set(k, tmpM.compose(tmpV, tmpQ, tmpS)); ap.color(k, tmpC.set(e.mode === 'in' ? IN_COLOR : OUT_COLOR));
      R.slots.push({ pool: ap, i: k });
    }
    this.lamped.add(e);
  }
  pipeConnects(e, d) {
    const o = this.game.entityAt(e.x + DX[d], e.y + DY[d]);
    if (!o) return false;
    if (o.kind === 'pipe') return true;
    if (o.kind === 'upipe') { const od = o.openDir(); return o.x + DX[od] === e.x && o.y + DY[od] === e.y; }
    if (o.def.ports) {
      for (const p of o.def.ports) {
        const [px, py] = o.local(p.x, p.y);
        const pd = (p.dir + o.rot) & 3;
        if (px === e.x + DX[d] && py === e.y + DY[d] && px + DX[pd] === e.x && py + DY[pd] === e.y) return true;
      }
    }
    return false;
  }
  rebuildPipes() {
    for (const e of this.game.ents.values()) if (e.kind === 'pipe' || e.kind === 'upipe') { this.removeEnt(e); this.addEnt(e); }
  }
  rebuildWires() {
    if (this.wireLines) { this.scene.remove(this.wireLines); this.wireLines.geometry.dispose(); }
    const pts = [];
    const top = (p) => p.type === 'substation' ? 2.52 : p.type === 'pole-medium' ? 2.52 : 1.92;
    for (const [a, b] of this.game.wires) {
      // gently sagging wire
      const ax = a.cx, az = a.cy, bx = b.cx, bz = b.cy, ha = top(a), hb = top(b);
      const sag = 0.04 * Math.hypot(bx - ax, bz - az);
      let px = ax, py = ha, pz = az;
      for (let k = 1; k <= 6; k++) {
        const t = k / 6, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ha + (hb - ha) * t - sag * 4 * t * (1 - t);
        pts.push(px, py, pz, x, y, z); px = x; py = y; pz = z;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.wireLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#e0a868', transparent: true, opacity: 0.85 }));
    this.wireLines.frustumCulled = false;
    this.scene.add(this.wireLines);
  }
  rebuildGhosts() {
    for (const i of this.ghostSlots) this.ghostPool.release(i);
    this.ghostSlots = [];
    for (const g of this.game.ghosts.values()) {
      const [w, h] = rotSize(g.type, g.rot);
      const i = this.ghostPool.alloc();
      tmpV.set(g.x + w / 2, 0.4, g.y + h / 2); tmpS.set(w - 0.1, 0.8, h - 0.1);
      this.ghostPool.set(i, tmpM.compose(tmpV, tmpQ.identity(), tmpS));
      this.ghostPool.color(i, tmpC.set(this.game.has(g.type) ? '#7fd0ff' : '#ff9a7a'));
      this.ghostSlots.push(i);
    }
  }

  // ----- overlays -----
  // Translucent copy of a building used for placement previews.
  ghostModel(type, rot, mode, ok) {
    const grp = new THREE.Group();
    const d = BUILDINGS[type];
    const tint = new THREE.Color(ok ? '#9fffc0' : '#ff7070');
    if (d.kind === 'belt' || d.kind === 'pipe' || d.kind === 'upipe') {
      const pipe = d.kind !== 'belt';
      const m = new THREE.Mesh(pipe ? this.geos.sph : this.geos.plane, new THREE.MeshBasicMaterial({ color: pipe ? '#9aa6b2' : tierColor(d.tier), transparent: true, opacity: 0.6, depthWrite: false }));
      if (pipe) { m.scale.set(0.42, 0.42, 0.42); m.position.y = 0.32; } else m.position.y = 0.08;
      grp.add(m);
      if (d.kind !== 'pipe') {
        const a = new THREE.Mesh(this.geos.arrow, new THREE.MeshBasicMaterial({ color: d.kind === 'upipe' ? (mode === 'out' ? OUT_COLOR : IN_COLOR) : '#ffffff', transparent: true, opacity: 0.95, depthWrite: false }));
        a.scale.set(0.55, 1, 0.55); a.position.y = pipe ? 0.6 : 0.1; grp.add(a);
      }
    } else {
      if (d.kind === 'underground' || d.kind === 'splitter') {
        for (let i = 0; i < d.size[0]; i++) {
          const m = new THREE.Mesh(this.geos.plane, new THREE.MeshBasicMaterial({ color: tierColor(d.tier), transparent: true, opacity: 0.45, depthWrite: false }));
          m.position.set(i - (d.size[0] - 1) / 2, 0.08, 0); grp.add(m);
        }
      }
      for (const p of partsFor(type, mode)) {
        const geo = p.g === 'arrow' ? this.geos.arrow : this.geos[p.g];
        const col = new THREE.Color(p.lamp ? '#888' : p.c);
        const solid = p.g === 'arrow' || p.unlit;
        if (!solid) col.lerp(tint, 0.3);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: solid ? 0.95 : 0.6, depthWrite: false }));
        this.partMatrix(new THREE.Matrix4(), p, 0, m.matrix);
        if (p.a === 'arm' || p.a === 'claw') {
          // show the arm reaching forward
          const L = d.reach * 0.92;
          m.matrix.compose(new THREE.Vector3(0, p.p[1], p.a === 'arm' ? -L / 2 : -L), new THREE.Quaternion(), new THREE.Vector3(...p.s));
        }
        m.matrixAutoUpdate = false;
        if (solid) m.renderOrder = 2;
        grp.add(m);
      }
    }
    if (!ok) {
      const [w, h] = d.size;
      const x = new THREE.Mesh(this.geos.cube, new THREE.MeshBasicMaterial({ color: '#ff3a3a', transparent: true, opacity: 0.25, depthWrite: false }));
      x.scale.set(w, 0.12, h); x.position.y = 0.06; grp.add(x);
    }
    grp.rotation.y = -rot * Math.PI / 2;
    return grp;
  }
  tileMarks(list, grp, y = 0.025) {
    for (const t of list) {
      const m = new THREE.Mesh(this.geos.plane, new THREE.MeshBasicMaterial({ color: t.c, transparent: true, opacity: 0.28, depthWrite: false }));
      m.position.set(t.x + 0.5, y, t.y + 0.5); m.scale.set(0.94, 1, 0.94); m.renderOrder = 3;
      grp.add(m);
      const r = new THREE.Mesh(ringGeoCached(), new THREE.MeshBasicMaterial({ color: t.c, transparent: true, opacity: 0.9, depthWrite: false }));
      r.position.set(t.x + 0.5, y + 0.06, t.y + 0.5); r.scale.set(1.3, 1, 1.3); r.renderOrder = 3;
      grp.add(r);
    }
  }
  // Preview of buildings to be placed. list: [{type, x, y, rot, ok, area?, mode?}]
  setPreview(list) {
    this.clearGroup(this.overlay);
    if (!list || !list.length) return;
    list.forEach((it, idx) => {
      const [w, h] = rotSize(it.type, it.rot);
      const g = this.ghostModel(it.type, it.rot, it.mode, it.ok);
      g.position.set(it.x + w / 2, 0, it.y + h / 2);
      this.overlay.add(g);
      if (idx === list.length - 1) {
        this.tileMarks(ioTiles(it.type, it.x, it.y, it.rot), this.overlay);
        if (it.area) {
          const ar = new THREE.Mesh(this.geos.plane, new THREE.MeshBasicMaterial({ color: it.areaColor || '#ffe066', transparent: true, opacity: 0.1, depthWrite: false }));
          ar.position.set(it.area[0] + it.area[2] / 2, 0.02, it.area[1] + it.area[3] / 2); ar.scale.set(it.area[2], 1, it.area[3]);
          this.overlay.add(ar);
        }
      }
    });
  }
  setRect(r, color = '#ff5a5a') {
    if (this.rectMesh) { this.scene.remove(this.rectMesh); this.rectMesh = null; }
    if (!r) return;
    const m = new THREE.Mesh(this.geos.cube, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
    m.position.set(r.x + r.w / 2, 0.5, r.y + r.h / 2); m.scale.set(r.w, 1, r.h);
    this.rectMesh = m; this.scene.add(m);
  }
  setSelection(e, tile) {
    this.clearGroup(this.selGroup);
    let x, y, w, h;
    if (e) ({ x, y, w, h } = e); else if (tile) { [x, y] = tile; w = h = 1; } else return;
    // corner brackets around the selection
    const mat = new THREE.MeshBasicMaterial({ color: '#ffe066', toneMapped: false });
    const L = Math.min(0.5, Math.max(0.25, Math.min(w, h) * 0.3)), T = 0.08, Y = 0.05;
    for (const [cx, cz, sx, sz] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      const a = new THREE.Mesh(this.geos.cube, mat); a.scale.set(L, 0.05, T); a.position.set(cx + sx * L / 2, Y, cz + sz * T / 2); this.selGroup.add(a);
      const b = new THREE.Mesh(this.geos.cube, mat); b.scale.set(T, 0.05, L); b.position.set(cx + sx * T / 2, Y, cz + sz * L / 2); this.selGroup.add(b);
    }
    if (e) {
      this.tileMarks(ioTiles(e.type, e.x, e.y, e.rot), this.selGroup, 0.03);
      const area = this.rangeOf(e);
      if (area) {
        const r = new THREE.Mesh(this.geos.plane, new THREE.MeshBasicMaterial({ color: e.kind === 'pole' ? '#5ab0ff' : '#ffe066', transparent: true, opacity: 0.1, depthWrite: false }));
        r.position.set(area[0] + area[2] / 2, 0.02, area[1] + area[3] / 2); r.scale.set(area[2], 1, area[3]);
        this.selGroup.add(r);
      }
    }
  }
  rangeOf(e) {
    const d = e.def;
    if (d.kind === 'pole') { const s = d.supply; return [e.x - s, e.y - s, e.w + 2 * s, e.h + 2 * s]; }
    if (d.kind === 'drill') { const off = (d.area - d.size[0]) / 2; return [e.x - off, e.y - off, d.area, d.area]; }
    if (d.kind === 'beacon') { const r = d.range; return [e.x - r, e.y - r, e.w + 2 * r, e.h + 2 * r]; }
    return null;
  }
  clearGroup(g) {
    g.traverse(c => { if (c.material) c.material.dispose?.(); });
    while (g.children.length) g.remove(g.children[0]);
  }
  setGrid(on) {
    if (on && !this.grid) {
      const S = this.game.size;
      const g = new THREE.GridHelper(S, S, '#000000', '#000000');
      g.position.set(S / 2, 0.015, S / 2);
      g.material.transparent = true; g.material.opacity = 0.14; g.material.depthWrite = false;
      this.grid = g; this.scene.add(g);
    }
    if (this.grid) this.grid.visible = on;
  }

  // ----- camera -----
  updateCamera() {
    const S = this.game.size;
    this.target.x = Math.max(0, Math.min(S, this.target.x));
    this.target.z = Math.max(0, Math.min(S, this.target.z));
    this.dist = Math.max(8, Math.min(140, this.dist));
    const p = this.pitch;
    this.camera.position.set(this.target.x, this.target.y + this.dist * Math.sin(p), this.target.z + this.dist * Math.cos(p));
    this.camera.lookAt(this.target);
    // shadow frustum follows the view
    const ext = Math.round(Math.min(70, this.dist * 0.95 + 6));
    const cam = this.sunL.shadow.camera;
    if (cam.right !== ext) { cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext; cam.near = 1; cam.far = 200; cam.updateProjectionMatrix(); }
    this.sunL.position.set(this.target.x - 28, 55, this.target.z + 12);
    this.sunL.target.position.copy(this.target);
  }
  screenToWorld(px, py) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((px - rect.left) / rect.width) * 2 - 1, -((py - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const t = -ray.ray.origin.y / ray.ray.direction.y;
    if (!isFinite(t) || t < 0) return null;
    return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
  }
  screenToTile(px, py) { const w = this.screenToWorld(px, py); return w ? [Math.floor(w.x), Math.floor(w.z), w.x, w.z] : null; }
  worldToScreen(x, z) {
    const v = new THREE.Vector3(x, 0, z).project(this.camera);
    return [(v.x + 1) / 2 * window.innerWidth, (1 - v.y) / 2 * window.innerHeight];
  }

  // ----- frame -----
  frame(dt, alpha) {
    const g = this.game;
    this.time += dt;
    this.updateCamera();
    const sun = g.sun;
    this.hemi.intensity = 0.55 + sun * 1.0;
    this.sunL.intensity = 0.25 + sun * 2.2;
    this.scene.background.setRGB(0.05 + sun * 0.05, 0.06 + sun * 0.06, 0.09 + sun * 0.06);

    for (const t of [1, 2, 3]) this.beltTex[t].offset.y -= BUILDINGS['belt-' + t].speed * dt;
    if (this.terrainDirty && (this.time - (this.lastTerrain || 0)) > 1) { this.terrainTex.needsUpdate = true; this.terrainDirty = false; this.lastTerrain = this.time; }
    if (this.ghostsDirty || (g.ghosts.size && Math.floor(this.time * 2) !== this._gt)) { this._gt = Math.floor(this.time * 2); this.rebuildGhosts(); this.ghostsDirty = false; }

    for (const e of this.animated) {
      const R = e._r; if (!R || !R.anim) continue;
      const working = e.status === 'working';
      if (working) R.phase += dt * 2.5;
      for (const s of R.anim) {
        if (s.p.a === 'bob') {
          // walking beam pivots on top of the samson post (local z = 0.2)
          tmpQ.setFromAxisAngle(X_AXIS, Math.sin(R.phase * 0.8) * 0.28);
          tmpS.set(s.p.s[0], s.p.s[1], s.p.s[2]);
          tmpM2.compose(tmpV.set(0, 0, s.p.p[2] - 0.2), tmpQ, tmpS);
          tmpM3.makeTranslation(s.p.p[0], s.p.p[1], 0.2).multiply(tmpM2);
          s.pool.set(s.i, tmpM.multiplyMatrices(R.base, tmpM3));
        } else if (working) {
          s.pool.set(s.i, this.partMatrix(R.base, s.p, R.phase * (s.p.spd || 1), tmpM));
        }
      }
    }
    if (Math.floor(this.time * 4) !== this._lt) {
      this._lt = Math.floor(this.time * 4);
      for (const e of this.lamped) {
        const R = e._r; if (!R) continue;
        if (R.lamp) R.lamp.pool.color(R.lamp.i, tmpC.set(STATUS_COLORS[e.status] || '#888'));
        if (R.hub) {
          const n = e.fnet;
          const c = n && n.fluid ? tmpC.set(FLUIDS[n.fluid].color).lerp(new THREE.Color('#9aa6b2'), 0.4 - 0.3 * Math.min(1, n.amount / Math.max(1, n.cap))) : tmpC.set(e.kind === 'upipe' ? '#6c7886' : '#9aa6b2');
          R.hub.pool.color(R.hub.i, c);
          for (const s of R.slots) if (s.seg) s.pool.color(s.i, c);
        }
        if (R.glows) {
          const on = e.status === 'working' || (e.kind === 'beacon' && e.active) || (e.kind === 'accumulator' && e.charge > 1);
          for (const s of R.glows) s.pool.color(s.i, tmpC.set(on ? s.p.c : '#2a2c30'));
        }
      }
      if (this.showIcons) for (const e of this.iconed) this.updateIcon(e);
    }
    // inserter arms
    const items = this.itemStreams;
    for (const s of Object.values(items)) s.begin();
    for (const e of this.inserters) {
      const R = e._r; if (!R) continue;
      const L = e.def.reach * 0.92;
      const ang = Math.PI * (1 - e.phase);
      const p = R.arm.p;
      tmpQ.setFromAxisAngle(Y_AXIS, ang);
      tmpV.set(-Math.sin(ang) * (L / 2), p.p[1], -Math.cos(ang) * (L / 2)); tmpS.set(p.s[0], p.s[1], p.s[2]);
      tmpM2.compose(tmpV, tmpQ, tmpS);
      R.arm.pool.set(R.arm.i, tmpM.multiplyMatrices(R.base, tmpM2));
      const lx = -Math.sin(ang) * L, lz = -Math.cos(ang) * L;
      if (R.claw) {
        const cp = R.claw.p;
        tmpV.set(lx, cp.p[1], lz); tmpS.set(cp.s[0], cp.s[1], cp.s[2]);
        tmpM2.compose(tmpV, tmpQ, tmpS);
        R.claw.pool.set(R.claw.i, tmpM.multiplyMatrices(R.base, tmpM2));
      }
      if (e.hand) {
        const info = this.itemInfo[e.hand.id];
        const r = -e.rot * Math.PI / 2, c = Math.cos(r), sn = Math.sin(r);
        const wx = e.x + 0.5 + lx * c + lz * sn, wz = e.y + 0.5 - lx * sn + lz * c;
        items[info.bucket].push(wx, 0.45, wz, 0, 0.85, info.color);
      }
    }
    // belt items
    const viewR = this.dist * 1.6 + 10;
    for (const L of g.lanes) {
      if (!L.items.length) continue;
      const cx = L.tx + 0.5, cz = L.ty + 0.5;
      if (Math.abs(cx - this.target.x) > viewR || Math.abs(cz - this.target.z) > viewR) continue;
      const dx = DX[L.dir], dz = DY[L.dir];
      const ry = -L.dir * Math.PI / 2;
      for (const it of L.items) {
        const info = this.itemInfo[it.id];
        const o = it.pos - (it.m || 0) * (1 - alpha) - 0.5;
        items[info.bucket].push(cx + dx * o, 0.17, cz + dz * o, ry, 1, info.color);
      }
    }
    for (const s of Object.values(items)) s.end();
    for (const p of Object.values(this.pools)) p.flush();
    for (const p of Object.values(this.beltPools)) p.flush();
    this.iconPool.flush(); this.ghostPool.flush();
    this.r.render(this.scene, this.camera);
  }
}
