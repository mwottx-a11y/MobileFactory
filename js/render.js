// three.js renderer: terrain, instanced buildings, belts, items, overlays.
import * as THREE from '../vendor/three.module.js';
import { ITEMS, FLUIDS, BUILDINGS } from './data.js';
import { ORES, OIL } from './world.js';
import { DX, DY, TICK, rotSize, rotLocal, BELTLIKE } from './sim.js';

const ORE_COLORS = { 'iron-ore': '#6f86a3', 'copper-ore': '#c96c35', 'coal': '#232326', 'stone': '#ad9c7c', 'quartz': '#ddd6f7', 'bauxite': '#b04d24', 'crude-oil': '#1a1220' };
const STATUS_COLORS = {
  'working': '#46e05a', 'idle': '#e6c84a', 'no input': '#e6c84a', 'no recipe': '#8a8f99', 'no research': '#8a8f99', 'depleted': '#8a8f99',
  'no power': '#ff4040', 'no fuel': '#ff4040', 'no water': '#ff4040', 'low power': '#ff9a3a', 'output full': '#ff9a3a', 'blocked': '#ff9a3a',
};
const col = (hex) => new THREE.Color(hex);
const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0), X_AXIS = new THREE.Vector3(1, 0, 0);
const tmpC = new THREE.Color();
const tmpE = new THREE.Euler(), tmpQ2 = new THREE.Quaternion();

// ---------- Instanced pool with free list ----------
class Pool {
  constructor(scene, geo, mat, cap = 512) {
    this.scene = scene; this.geo = geo; this.mat = mat; this.cap = cap; this.hw = 0; this.free = [];
    this.make(cap);
  }
  make(cap) {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.count = this.hw;
    if (this.mesh) {
      m.instanceMatrix.array.set(this.mesh.instanceMatrix.array.subarray(0, this.hw * 16));
      m.instanceColor.array.set(this.mesh.instanceColor.array.subarray(0, this.hw * 3));
      this.scene.remove(this.mesh); this.mesh.dispose();
    }
    this.mesh = m; this.cap = cap;
    this.scene.add(m);
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
    m.frustumCulled = false; m.count = 0;
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

// ---------- Building part definitions ----------
// Local frame: origin at footprint center (unrotated), +x east, +y up, +z south. Front = -z.
const box = (s, p, c, a) => ({ g: 'box', s, p, c, a });
const cyl = (s, p, c, a) => ({ g: 'cyl', s, p, c, a });
const sph = (s, p, c, a) => ({ g: 'sph', s, p, c, a });

function partsFor(type) {
  const d = BUILDINGS[type];
  const [w, h] = d.size;
  const P = [];
  const hw = w / 2, hh = h / 2;
  const lamp = (y = 1) => ({ g: 'sph', s: [0.22, 0.22, 0.22], p: [hw - 0.3, y, -hh + 0.3], lamp: true });
  switch (d.kind) {
    case 'drill': {
      const elec = type === 'electric-drill';
      P.push(box([w - 0.15, 0.5, h - 0.15], [0, 0.25, 0], elec ? '#3d6aa8' : '#6b6560'));
      P.push(box([w * 0.7, 0.5, h * 0.7], [0, 0.75, 0], elec ? '#5a86c4' : '#857c72'));
      P.push(cyl([w * 0.35, 0.9, w * 0.35], [0, 1.2, 0], '#c9b04a', 'spin'));
      P.push(box([0.5, 0.3, 0.5], [w % 2 ? 0 : -0.5, 0.45, -hh + 0.05], '#2d2d2d'));
      P.push(lamp(1.05));
      if (!elec) P.push(box([0.4, 0.2, 0.4], [-hw + 0.35, 1.0, hh - 0.35], '#ff7a2a', 'glow'));
      break;
    }
    case 'pumpjack':
      P.push(box([w - 0.2, 0.3, h - 0.2], [0, 0.15, 0], '#5a5f66'));
      P.push(box([0.3, 1.4, 0.3], [0, 1.0, 0.5], '#8b9099'));
      P.push(box([0.25, 0.25, 2.4], [0, 1.75, 0], '#d24a3a', 'bob'));
      P.push(cyl([0.5, 0.6, 0.5], [0, 0.5, -0.6], '#3b3f45'));
      P.push(lamp(0.6));
      break;
    case 'offshore':
      P.push(box([0.8, 0.4, 0.8], [0, 0.2, 0], '#3f6d9c'));
      P.push(cyl([0.3, 0.6, 0.3], [0, 0.5, -0.35], '#88a3bd'));
      break;
    case 'furnace': {
      const st = type === 'stone-furnace', el = type === 'electric-furnace';
      const c = st ? '#9c8d77' : el ? '#7b8590' : '#5e666f';
      P.push(box([w - 0.15, 1.0, h - 0.15], [0, 0.5, 0], c));
      P.push(box([w * 0.5, 0.3, 0.1], [0, 0.4, -hh + 0.05], '#ff7a2a', 'glow'));
      P.push(cyl([0.35, 0.7, 0.35], [hw * 0.45, 1.3, hh * 0.4], st ? '#7a6d5c' : '#4a5058'));
      if (el) P.push(box([w * 0.6, 0.15, h * 0.6], [0, 1.07, 0], '#3a8fd6', 'glow'));
      P.push(lamp(1.1));
      break;
    }
    case 'assembler': {
      if (type === 'chem-plant') {
        P.push(box([w - 0.15, 0.4, h - 0.15], [0, 0.2, 0], '#5d6d63'));
        P.push(cyl([1.0, 1.2, 1.0], [-0.55, 1.0, 0.1], '#c9c46a'));
        P.push(cyl([1.0, 1.2, 1.0], [0.55, 1.0, 0.1], '#7cc48d'));
        P.push(cyl([0.5, 0.4, 0.5], [0, 1.6, -0.6], '#d0d0d0', 'spin'));
      } else if (type === 'refinery') {
        P.push(box([w - 0.2, 0.5, h - 0.2], [0, 0.25, 0], '#6b5e55'));
        P.push(cyl([1.1, 3.0, 1.1], [-1.2, 1.9, 0.6], '#b9b2a8'));
        P.push(cyl([0.9, 2.4, 0.9], [0.2, 1.6, 0.9], '#a39a8f'));
        P.push(cyl([0.7, 1.8, 0.7], [1.3, 1.3, 0.4], '#8f877d'));
        P.push(box([3.6, 0.6, 1.0], [0, 0.8, -1.2], '#7a6b62'));
        P.push(cyl([0.25, 0.8, 0.25], [-1.2, 3.8, 0.6], '#ff8a3a', 'glow'));
      } else {
        const c = type === 'assembler-1' ? '#8a8f62' : type === 'assembler-2' ? '#5f86a6' : '#a6705f';
        P.push(box([w - 0.15, 0.6, h - 0.15], [0, 0.3, 0], c));
        P.push(box([w - 0.6, 0.6, h - 0.6], [0, 0.9, 0], '#636a73'));
        P.push(cyl([1.3, 0.15, 1.3], [0, 1.28, 0], '#c9cdd3', 'spin'));
        P.push(box([1.2, 0.12, 0.2], [0, 1.4, 0], '#30343a', 'spin'));
      }
      P.push(lamp(type === 'refinery' ? 0.75 : 1.0));
      break;
    }
    case 'lab':
      P.push(box([w - 0.15, 0.5, h - 0.15], [0, 0.25, 0], '#d6dae0'));
      P.push(sph([1.7, 1.2, 1.7], [0, 0.8, 0], '#7fc6ff'));
      P.push(box([2.2, 0.08, 0.15], [0, 1.15, 0], '#fff3a0', 'spin'));
      P.push(lamp(0.65));
      break;
    case 'belt': break;
    case 'underground':
      P.push(box([0.9, 0.55, 0.55], [0, 0.27, 0], tierColor(d.tier)));
      P.push(box([0.94, 0.12, 0.6], [0, 0.6, 0], '#2b2e33'));
      break;
    case 'splitter':
      P.push(box([1.9, 0.5, 0.35], [0, 0.35, -0.05], tierColor(d.tier)));
      P.push(box([0.2, 0.55, 0.2], [0, 0.3, 0], '#2b2e33'));
      break;
    case 'inserter': {
      const c = type === 'burner-inserter' ? '#7a5a3a' : type === 'long-inserter' ? '#c03a3a' : type === 'fast-inserter' ? '#3a7ad0' : type === 'filter-inserter' ? '#8a4ad0' : type === 'stack-inserter' ? '#3ab070' : '#d8b03a';
      P.push(cyl([0.45, 0.2, 0.45], [0, 0.1, 0], '#3c4047'));
      P.push(cyl([0.18, 0.4, 0.18], [0, 0.4, 0], '#5a5f66'));
      P.push({ g: 'box', s: [0.12, 0.1, d.reach * 0.9], p: [0, 0.62, 0], c, a: 'arm' });
      break;
    }
    case 'chest': case 'uplink': case 'downlink': {
      const c = type === 'iron-chest' ? '#8d949c' : type === 'steel-chest' ? '#5a6068' : type === 'uplink-chest' ? '#3a9ab0' : '#b03a9a';
      P.push(box([0.8, 0.6, 0.8], [0, 0.3, 0], c));
      P.push(box([0.84, 0.1, 0.84], [0, 0.62, 0], '#3a3f45'));
      if (d.kind !== 'chest') P.push(box([0.4, 0.1, 0.4], [0, 0.7, 0], d.kind === 'uplink' ? '#6ff' : '#f6f', 'glow'));
      break;
    }
    case 'pole':
      if (type === 'substation') {
        P.push(box([1.4, 0.3, 1.4], [0, 0.15, 0], '#5a6068'));
        P.push(box([0.6, 2.2, 0.6], [0, 1.3, 0], '#7d848c'));
        P.push(box([1.6, 0.15, 0.15], [0, 2.3, 0], '#3a3f45'));
      } else {
        const tall = type === 'pole-medium' ? 2.6 : 2.0;
        P.push(cyl([0.14, tall, 0.14], [0, tall / 2, 0], type === 'pole-medium' ? '#9aa3ad' : '#8b6a45'));
        P.push(box([0.8, 0.08, 0.08], [0, tall - 0.15, 0], '#3a3f45'));
      }
      break;
    case 'pipe': case 'upipe': break;
    case 'boiler':
      P.push(box([w - 0.15, 0.3, h - 0.15], [0, 0.15, 0], '#6b5e55'));
      P.push({ g: 'cyl', s: [1.0, w - 0.4, 1.0], p: [0, 0.75, 0.15], c: '#a8743f', r: [0, 0, Math.PI / 2] });
      P.push(cyl([0.3, 0.9, 0.3], [0.8, 1.4, 0.3], '#4a4a4a'));
      P.push(box([0.4, 0.25, 0.1], [0, 0.6, hh - 0.08], '#ff7a2a', 'glow'));
      P.push(lamp(1.2));
      break;
    case 'generator':
      P.push(box([w - 0.3, 0.4, h - 0.15], [0, 0.2, 0], '#5e666f'));
      P.push({ g: 'cyl', s: [0.9, h - 0.6, 0.9], p: [-0.35, 0.8, 0], c: '#8b939c', r: [Math.PI / 2, 0, 0] });
      P.push({ g: 'cyl', s: [1.6, 0.25, 1.6], p: [0.75, 0.9, 0.3], c: '#c9cdd3', a: 'spin', r: [0, 0, Math.PI / 2] });
      P.push(lamp(1.0));
      break;
    case 'solar':
      P.push(box([w - 0.1, 0.25, h - 0.1], [0, 0.15, 0], '#3a3f45'));
      P.push(box([w - 0.3, 0.06, h - 0.3], [0, 0.3, 0], '#1d3a7a'));
      break;
    case 'accumulator':
      P.push(box([w - 0.15, 0.25, h - 0.15], [0, 0.12, 0], '#4a4f55'));
      P.push(cyl([0.6, 1.1, 0.6], [-0.4, 0.75, 0], '#7d848c'));
      P.push(cyl([0.6, 1.1, 0.6], [0.4, 0.75, 0], '#7d848c'));
      P.push(box([0.3, 0.15, 0.3], [0, 1.3, 0], '#ffd23f', 'glow'));
      break;
    case 'beacon':
      P.push(box([w - 0.2, 0.5, h - 0.2], [0, 0.25, 0], '#4a4f55'));
      P.push(cyl([0.3, 1.8, 0.3], [0, 1.4, 0], '#8b939c'));
      P.push(cyl([1.6, 0.1, 1.6], [0, 2.1, 0], '#9ad0ff', 'spin'));
      P.push(sph([0.4, 0.4, 0.4], [0, 2.4, 0], '#6ff', 'glow'));
      P.push(lamp(0.6));
      break;
    case 'gate':
      P.push(box([w - 0.2, 0.4, h - 0.2], [0, 0.2, 0], '#3a3f45'));
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        P.push(box([0.5, 3.0, 0.5], [Math.cos(a) * 2.7, 1.9, Math.sin(a) * 2.7], '#9aa3ad'));
      }
      P.push({ g: 'tor', s: [5.6, 5.6, 5.6], p: [0, 3.5, 0], c: '#c0c8d0', a: 'spin', r: [Math.PI / 2, 0, 0] });
      P.push({ g: 'tor', s: [3.6, 3.6, 3.6], p: [0, 2.0, 0], c: '#ffe680', a: 'glow', r: [Math.PI / 2, 0, 0] });
      P.push(sph([1.6, 1.6, 1.6], [0, 2.0, 0], '#ffd23f', 'glow'));
      P.push(lamp(0.6));
      break;
  }
  // fluid port nubs
  for (const p of d.ports || []) {
    const lx = p.x - hw + 0.5, lz = p.y - hh + 0.5;
    const ox = DX[p.dir] * 0.42, oz = DY[p.dir] * 0.42;
    P.push(box([0.32, 0.32, 0.32], [lx + ox, 0.25, lz + oz], p.io === 'in' ? '#4a86c8' : '#c8864a'));
  }
  return P;
}
function tierColor(t) { return t === 1 ? '#d8b03a' : t === 2 ? '#d84a3a' : '#3a8ad8'; }

// ---------- Textures ----------
function chevronTexture(color) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#26282c'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#34373c'; x.fillRect(4, 0, 56, 64);
  x.strokeStyle = color; x.lineWidth = 6; x.lineCap = 'round';
  for (const oy of [0, 32]) { x.beginPath(); x.moveTo(16, 24 + oy); x.lineTo(32, 10 + oy); x.lineTo(48, 24 + oy); x.stroke(); }
  x.fillStyle = color; x.fillRect(0, 0, 4, 64); x.fillRect(60, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- Renderer ----------
export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1b1f24');
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 600);
    this.target = new THREE.Vector3();
    this.dist = 28; this.pitch = 0.95;
    this.hemi = new THREE.HemisphereLight('#dfe8ff', '#4a4030', 1.6);
    this.sunL = new THREE.DirectionalLight('#fff4e0', 1.6);
    this.sunL.position.set(-30, 60, 20);
    this.scene.add(this.hemi, this.sunL, this.sunL.target);
    this.mats = {
      std: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
      glow: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      ghost: new THREE.MeshBasicMaterial({ color: '#5aa0ff', transparent: true, opacity: 0.35, depthWrite: false }),
    };
    this.geos = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
      sph: new THREE.SphereGeometry(0.5, 14, 10),
      tor: new THREE.TorusGeometry(0.5, 0.035, 8, 48),
    };
    this.pools = {
      box: new Pool(this.scene, this.geos.box, this.mats.std, 2048),
      cyl: new Pool(this.scene, this.geos.cyl, this.mats.std, 1024),
      sph: new Pool(this.scene, this.geos.sph, this.mats.std, 512),
      tor: new Pool(this.scene, this.geos.tor, this.mats.std, 16),
      gtor: new Pool(this.scene, this.geos.tor, this.mats.glow, 16),
      gbox: new Pool(this.scene, this.geos.box, this.mats.glow, 512),
      gcyl: new Pool(this.scene, this.geos.cyl, this.mats.glow, 128),
      gsph: new Pool(this.scene, this.geos.sph, this.mats.glow, 512),
    };
    // belts: one pool per tier, each with own scrolling texture
    const beltGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.06, 0);
    this.beltTex = {}; this.beltPools = {};
    for (const t of [1, 2, 3]) {
      this.beltTex[t] = chevronTexture(tierColor(t));
      const m = new THREE.MeshLambertMaterial({ map: this.beltTex[t] });
      this.beltPools[t] = new Pool(this.scene, beltGeo, m, 1024);
    }
    const im = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.itemStreams = {
      flat: new Stream(this.scene, new THREE.BoxGeometry(0.34, 0.08, 0.34), im),
      chunk: new Stream(this.scene, new THREE.DodecahedronGeometry(0.17), im),
      block: new Stream(this.scene, new THREE.BoxGeometry(0.26, 0.22, 0.26), im),
      cylr: new Stream(this.scene, new THREE.CylinderGeometry(0.14, 0.14, 0.28, 8), im),
    };
    this.itemInfo = {};
    for (const [id, it] of Object.entries(ITEMS)) {
      const s = it.shape;
      const bucket = ['plate', 'wafer', 'chip', 'frame', 'module'].includes(s) ? 'flat' : ['ore', 'crystal', 'powder', 'blob'].includes(s) ? 'chunk' : ['pack', 'battery', 'core'].includes(s) ? 'cylr' : 'block';
      this.itemInfo[id] = { bucket, color: new THREE.Color(it.color) };
    }
    this.partCache = {};
    this.animated = new Set();
    this.lamped = new Set();
    this.inserters = new Set();
    this.overlay = new THREE.Group(); this.scene.add(this.overlay);
    this.wireLines = null; this.grid = null;
    this.ghostPool = new Pool(this.scene, this.geos.box, this.mats.ghost, 256);
    this.ghostSlots = [];
    this.time = 0;
    this.setGame(game);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setGame(g) {
    // clear previous
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

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ----- terrain -----
  buildTerrain() {
    const g = this.game, W = g.world, S = W.size, T = 4;
    const c = document.createElement('canvas'); c.width = S * T; c.height = S * T;
    this.tctx = c.getContext('2d');
    this.T = T;
    const img = this.tctx.createImageData(S * T, S * T);
    const d = img.data;
    const oreRGB = {};
    for (const [k, v] of Object.entries(ORE_COLORS)) { const cc = new THREE.Color(v); oreRGB[k] = [cc.r * 255, cc.g * 255, cc.b * 255]; }
    for (let ty = 0; ty < S; ty++) for (let tx = 0; tx < S; tx++) {
      const i = W.idx(tx, ty);
      for (let py = 0; py < T; py++) for (let px = 0; px < T; px++) {
        const o = ((ty * T + py) * S * T + tx * T + px) * 4;
        const [r, gg, b] = this.tilePixel(i, tx, ty, px, py, oreRGB);
        d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    this.tctx.putImageData(img, 0, 0);
    this.oreRGB = oreRGB;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4;
    this.terrainTex = tex;
    const geo = new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2).translate(S / 2, 0, S / 2);
    this.terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    this.scene.add(this.terrain);
    // ore rocks
    let n = 0;
    for (let i = 0; i < S * S; i++) if (W.ore[i] && W.ore[i] !== OIL) n++;
    const rg = new THREE.DodecahedronGeometry(0.22);
    this.rocks = new THREE.InstancedMesh(rg, new THREE.MeshLambertMaterial({ color: '#fff' }), Math.max(1, n));
    this.rocks.frustumCulled = false;
    this.rockIdx = new Int32Array(S * S).fill(-1);
    let k = 0;
    const rnd = (a) => { const s = Math.sin(a * 12.9898) * 43758.5453; return s - Math.floor(s); };
    for (let i = 0; i < S * S; i++) {
      if (!W.ore[i] || W.ore[i] === OIL) continue;
      const tx = i % S, ty = (i / S) | 0;
      const sc = 0.6 + Math.min(1.2, W.amount[i] / 1500) * 0.7;
      tmpV.set(tx + 0.25 + rnd(i) * 0.5, 0.05, ty + 0.25 + rnd(i + 7) * 0.5);
      tmpQ.setFromAxisAngle(Y_AXIS, rnd(i + 3) * 6);
      tmpS.set(sc, sc * 0.7, sc);
      tmpM.compose(tmpV, tmpQ, tmpS);
      this.rocks.setMatrixAt(k, tmpM);
      tmpC.set(ORE_COLORS[ORES[W.ore[i]]]).multiplyScalar(1.15);
      this.rocks.setColorAt(k, tmpC);
      this.rockIdx[i] = k++;
    }
    this.rocks.count = k;
    this.scene.add(this.rocks);
  }
  tilePixel(i, tx, ty, px, py, oreRGB) {
    const W = this.game.world;
    const h = ((tx * 73856093) ^ (ty * 19349663) ^ (px * 83492791) ^ (py * 2654435761)) >>> 0;
    const n = (h % 1000) / 1000;
    if (W.water[i]) {
      const v = W.shade[i] / 255;
      return [30 + v * 12, 70 + v * 20 + n * 6, 120 + v * 25 + n * 10];
    }
    const s = W.shade[i] / 255;
    let r = 74 + s * 30 + n * 10, g = 82 + s * 26 + n * 10, b = 54 + s * 14 + n * 6;
    // subtle grid
    if (px === 0 || py === 0) { r *= 0.93; g *= 0.93; b *= 0.93; }
    const ore = W.ore[i];
    if (ore) {
      const oc = oreRGB[ORES[ore]];
      if (ore === OIL) {
        const dx = px - 1.5, dy = py - 1.5;
        if (dx * dx + dy * dy < 3.5) return [oc[0] + n * 15, oc[1] + n * 10, oc[2] + n * 20];
      }
      const m = n > 0.45 ? 0.75 : 0.35;
      r = r * (1 - m) + oc[0] * m; g = g * (1 - m) + oc[1] * m; b = b * (1 - m) + oc[2] * m;
    }
    return [r, g, b];
  }
  tileChanged(i) {
    const W = this.game.world, S = W.size, T = this.T;
    const tx = i % S, ty = (i / S) | 0;
    const img = this.tctx.createImageData(T, T);
    for (let py = 0; py < T; py++) for (let px = 0; px < T; px++) {
      const [r, g, b] = this.tilePixel(i, tx, ty, px, py, this.oreRGB);
      const o = (py * T + px) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    this.tctx.putImageData(img, tx * T, ty * T);
    this.terrainDirty = true;
    const k = this.rockIdx[i];
    if (k >= 0) { tmpM.makeScale(0, 0, 0); this.rocks.setMatrixAt(k, tmpM); this.rocks.instanceMatrix.needsUpdate = true; this.rockIdx[i] = -1; }
  }

  // ----- entities -----
  baseMatrix(e, out) {
    tmpV.set(e.x + e.w / 2, 0, e.y + e.h / 2);
    tmpQ.setFromAxisAngle(Y_AXIS, -e.rot * Math.PI / 2);
    tmpS.set(1, 1, 1);
    return out.compose(tmpV, tmpQ, tmpS);
  }
  partMatrix(base, p, angle, out) {
    tmpV.set(p.p[0], p.p[1], p.p[2]);
    if (p.r) tmpQ.setFromEuler(tmpE.set(p.r[0], p.r[1], p.r[2])); else tmpQ.identity();
    // spin around the part's own (pre-rotation) Y axis
    if (angle) tmpQ.multiply(tmpQ2.setFromAxisAngle(Y_AXIS, angle));
    tmpS.set(p.s[0], p.s[1], p.s[2]);
    tmpM2.compose(tmpV, tmpQ, tmpS);
    return out.multiplyMatrices(base, tmpM2);
  }
  addEnt(e) {
    if (e._r) this.removeEnt(e);
    const R = { slots: [], base: new THREE.Matrix4() };
    e._r = R;
    this.baseMatrix(e, R.base);
    if (BELTLIKE.has(e.kind)) {
      const pool = this.beltPools[e.def.tier];
      for (const l of e.lanes()) {
        const i = pool.alloc();
        tmpV.set(l.tx + 0.5, 0, l.ty + 0.5);
        tmpQ.setFromAxisAngle(Y_AXIS, -l.dir * Math.PI / 2);
        tmpS.set(1, 1, 1);
        tmpM.compose(tmpV, tmpQ, tmpS);
        pool.set(i, tmpM); pool.color(i, tmpC.set('#ffffff'));
        R.slots.push({ pool, i });
      }
    }
    if (e.kind === 'pipe' || e.kind === 'upipe') { this.addPipeParts(e); return; }
    const parts = this.partCache[e.type] || (this.partCache[e.type] = partsFor(e.type));
    for (const p of parts) {
      const glow = p.a === 'glow' || p.lamp;
      const pool = this.pools[(glow ? 'g' : '') + p.g];
      const i = pool.alloc();
      this.partMatrix(R.base, p, 0, tmpM);
      pool.set(i, tmpM);
      pool.color(i, tmpC.set(p.lamp ? '#888' : p.c));
      const slot = { pool, i, p };
      R.slots.push(slot);
      if (p.lamp) { R.lamp = slot; this.lamped.add(e); }
      if (p.a === 'glow') (R.glows ||= []).push(slot);
      if (p.a && p.a !== 'glow') { (R.anim ||= []).push(slot); this.animated.add(e); }
      if (p.a === 'arm') { R.arm = slot; this.inserters.add(e); }
    }
    if (e.kind === 'underground' && e.mode === 'out') {
      // exit marker: flip hood shading
      const s = R.slots.find(s => s.p && s.p.g === 'box');
      if (s) s.pool.color(s.i, tmpC.set(tierColor(e.def.tier)).multiplyScalar(0.7));
    }
    R.anglePhase = Math.random() * 6;
  }
  removeEnt(e) {
    const R = e._r;
    if (!R) return;
    for (const s of R.slots) s.pool.release(s.i);
    this.animated.delete(e); this.lamped.delete(e); this.inserters.delete(e);
    e._r = null;
  }
  addPipeParts(e) {
    const R = e._r;
    const g = this.game;
    const pc = e.kind === 'upipe' ? '#5e6a78' : '#8a96a3';
    const pool = this.pools.cyl, bp = this.pools.box;
    const i = pool.alloc();
    tmpV.set(e.x + 0.5, 0.3, e.y + 0.5); tmpQ.identity(); tmpS.set(0.42, 0.42, 0.42);
    pool.set(i, tmpM.compose(tmpV, tmpQ, tmpS)); pool.color(i, tmpC.set(pc));
    R.slots.push({ pool, i, hub: true }); R.hub = R.slots[R.slots.length - 1];
    const dirs = e.kind === 'upipe' ? [e.openDir()] : [0, 1, 2, 3];
    for (const d of dirs) {
      if (e.kind === 'pipe' && !this.pipeConnects(e, d)) continue;
      const j = bp.alloc();
      tmpV.set(e.x + 0.5 + DX[d] * 0.3, 0.3, e.y + 0.5 + DY[d] * 0.3);
      tmpS.set(DX[d] ? 0.5 : 0.24, 0.24, DY[d] ? 0.5 : 0.24);
      bp.set(j, tmpM.compose(tmpV, tmpQ.identity(), tmpS)); bp.color(j, tmpC.set(pc));
      R.slots.push({ pool: bp, i: j });
    }
    if (e.kind === 'upipe') {
      const j = bp.alloc();
      tmpV.set(e.x + 0.5, 0.2, e.y + 0.5); tmpS.set(0.7, 0.4, 0.7);
      bp.set(j, tmpM.compose(tmpV, tmpQ.identity(), tmpS)); bp.color(j, tmpC.set('#4a525c'));
      R.slots.push({ pool: bp, i: j });
    }
    this.lamped.add(e);
  }
  pipeConnects(e, d) {
    const g = this.game;
    const o = g.entityAt(e.x + DX[d], e.y + DY[d]);
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
    const top = (p) => p.type === 'substation' ? 2.3 : p.type === 'pole-medium' ? 2.45 : 1.85;
    for (const [a, b] of this.game.wires) pts.push(a.cx, top(a), a.cy, b.cx, top(b), b.cy);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.wireLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#d9a066', transparent: true, opacity: 0.7 }));
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
  // Preview of a building to be placed. list: [{type, x, y, rot, ok}]
  setPreview(list) {
    this.clearGroup(this.overlay);
    if (!list || !list.length) return;
    for (const it of list) {
      const [w, h] = rotSize(it.type, it.rot);
      const m = new THREE.Mesh(this.geos.box, new THREE.MeshBasicMaterial({ color: it.ok ? '#5aff8a' : '#ff5a5a', transparent: true, opacity: 0.35, depthWrite: false }));
      m.position.set(it.x + w / 2, 0.35, it.y + h / 2); m.scale.set(w - 0.05, 0.7, h - 0.05);
      this.overlay.add(m);
      // direction arrow
      const a = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }));
      a.position.set(it.x + w / 2 + DX[it.rot] * (w / 2 - 0.25), 0.8, it.y + h / 2 + DY[it.rot] * (h / 2 - 0.25));
      a.rotation.y = -it.rot * Math.PI / 2;
      this.overlay.add(a);
      if (it.area) {
        const ar = new THREE.Mesh(this.geos.box, new THREE.MeshBasicMaterial({ color: it.areaColor || '#ffffff', transparent: true, opacity: 0.08, depthWrite: false }));
        ar.position.set(it.area[0] + it.area[2] / 2, 0.02, it.area[1] + it.area[3] / 2); ar.scale.set(it.area[2], 0.02, it.area[3]);
        this.overlay.add(ar);
      }
    }
  }
  setRect(r, color = '#ff5a5a') {
    if (this.rectMesh) { this.scene.remove(this.rectMesh); this.rectMesh = null; }
    if (!r) return;
    const m = new THREE.Mesh(this.geos.box, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
    m.position.set(r.x + r.w / 2, 0.5, r.y + r.h / 2); m.scale.set(r.w, 1, r.h);
    this.rectMesh = m; this.scene.add(m);
  }
  setSelection(e, tile) {
    if (this.selMesh) { this.scene.remove(this.selMesh); this.selMesh = null; }
    if (this.rangeMesh) { this.scene.remove(this.rangeMesh); this.rangeMesh = null; }
    let x, y, w, h;
    if (e) ({ x, y, w, h } = e); else if (tile) { [x, y] = tile; w = h = 1; } else return;
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.1, 1.6, h + 0.1));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#ffe066' }));
    m.position.set(x + w / 2, 0.8, y + h / 2);
    this.selMesh = m; this.scene.add(m);
    const area = e && this.rangeOf(e);
    if (area) {
      const r = new THREE.Mesh(this.geos.box, new THREE.MeshBasicMaterial({ color: e.kind === 'pole' ? '#5ab0ff' : '#ffe066', transparent: true, opacity: 0.1, depthWrite: false }));
      r.position.set(area[0] + area[2] / 2, 0.03, area[1] + area[3] / 2); r.scale.set(area[2], 0.03, area[3]);
      this.rangeMesh = r; this.scene.add(r);
    }
  }
  rangeOf(e) {
    const d = e.def;
    if (d.kind === 'pole') { const s = d.supply; return [e.x - s, e.y - s, e.w + 2 * s, e.h + 2 * s]; }
    if (d.kind === 'drill') { const off = (d.area - d.size[0]) / 2; return [e.x - off, e.y - off, d.area, d.area]; }
    if (d.kind === 'beacon') { const r = d.range; return [e.x - r, e.y - r, e.w + 2 * r, e.h + 2 * r]; }
    return null;
  }
  clearGroup(g) { while (g.children.length) { const c = g.children.pop(); c.geometry !== this.geos.box && c.geometry?.dispose?.(); c.material?.dispose?.(); } }
  setGrid(on) {
    if (on && !this.grid) {
      const S = this.game.size;
      const g = new THREE.GridHelper(S, S, '#000000', '#000000');
      g.position.set(S / 2, 0.015, S / 2);
      g.material.transparent = true; g.material.opacity = 0.12; g.material.depthWrite = false;
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
    this.sunL.position.set(this.target.x - 30, 60, this.target.z + 20);
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
    // lighting by time of day
    const sun = g.sun;
    this.hemi.intensity = 0.7 + sun * 0.9;
    this.sunL.intensity = 0.25 + sun * 1.4;
    this.scene.background.setRGB(0.06 + sun * 0.05, 0.07 + sun * 0.06, 0.1 + sun * 0.06);

    for (const t of [1, 2, 3]) this.beltTex[t].offset.y -= BUILDINGS['belt-' + t].speed * dt;
    if (this.terrainDirty && (this.time - (this.lastTerrain || 0)) > 1) { this.terrainTex.needsUpdate = true; this.terrainDirty = false; this.lastTerrain = this.time; }
    if (this.ghostsDirty || (this.game.ghosts.size && Math.floor(this.time * 2) !== this._gt)) { this._gt = Math.floor(this.time * 2); this.rebuildGhosts(); this.ghostsDirty = false; }

    // animations
    for (const e of this.animated) {
      const R = e._r; if (!R || !R.anim) continue;
      const working = e.status === 'working';
      if (working) R.anglePhase += dt * (e.kind === 'drill' ? 4 : e.kind === 'gate' ? 0.6 : 2.5);
      for (const s of R.anim) {
        if (s.p.a === 'arm') continue;
        if (s.p.a === 'bob') {
          const a = Math.sin(R.anglePhase) * 0.35;
          tmpQ.setFromAxisAngle(X_AXIS, a);
          tmpV.set(s.p.p[0], s.p.p[1], s.p.p[2]); tmpS.set(s.p.s[0], s.p.s[1], s.p.s[2]);
          tmpM2.compose(tmpV, tmpQ, tmpS);
          s.pool.set(s.i, tmpM.multiplyMatrices(R.base, tmpM2));
        } else if (working) {
          s.pool.set(s.i, this.partMatrix(R.base, s.p, R.anglePhase, tmpM));
        }
      }
    }
    // status lamps and glows (throttled)
    if (Math.floor(this.time * 4) !== this._lt) {
      this._lt = Math.floor(this.time * 4);
      for (const e of this.lamped) {
        const R = e._r; if (!R) continue;
        if (R.lamp) R.lamp.pool.color(R.lamp.i, tmpC.set(STATUS_COLORS[e.status] || '#888'));
        if (R.hub) {
          const n = e.fnet;
          const c = n && n.fluid ? tmpC.set(FLUIDS[n.fluid].color).lerp(new THREE.Color('#8a96a3'), 0.45 - 0.35 * Math.min(1, n.amount / Math.max(1, n.cap))) : tmpC.set(e.kind === 'upipe' ? '#5e6a78' : '#8a96a3');
          R.hub.pool.color(R.hub.i, c);
        }
      }
      for (const e of this.animated) this.updateGlow(e);
      for (const e of this.lamped) if (!this.animated.has(e)) this.updateGlow(e);
    }
    // inserters
    const items = this.itemStreams;
    for (const s of Object.values(items)) s.begin();
    for (const e of this.inserters) {
      const R = e._r; if (!R) continue;
      const L = e.def.reach * 0.9;
      const ang = Math.PI * (1 - e.phase);
      const p = R.arm.p;
      tmpQ.setFromAxisAngle(Y_AXIS, ang);
      // arm pivots at center, extends toward -z rotated by ang
      const ax = -Math.sin(ang) * (L / 2), az = -Math.cos(ang) * (L / 2);
      tmpV.set(ax, p.p[1], az); tmpS.set(p.s[0], p.s[1], p.s[2]);
      tmpM2.compose(tmpV, tmpQ, tmpS);
      R.arm.pool.set(R.arm.i, tmpM.multiplyMatrices(R.base, tmpM2));
      if (e.hand) {
        const info = this.itemInfo[e.hand.id];
        const lx = -Math.sin(ang) * L, lz = -Math.cos(ang) * L;
        const r = -e.rot * Math.PI / 2, c = Math.cos(r), sn = Math.sin(r);
        const wx = e.x + 0.5 + lx * c + lz * sn, wz = e.y + 0.5 - lx * sn + lz * c;
        items[info.bucket].push(wx, 0.62, wz, 0, 0.9, info.color);
      }
    }
    // belt items
    const v0 = this.camera.position;
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
        items[info.bucket].push(cx + dx * o, 0.16, cz + dz * o, ry, 1, info.color);
      }
    }
    for (const s of Object.values(items)) s.end();
    for (const p of Object.values(this.pools)) p.flush();
    for (const p of Object.values(this.beltPools)) p.flush();
    this.ghostPool.flush();
    if (this.rocks) this.rocks.visible = true;
    this.r.render(this.scene, this.camera);
  }
  updateGlow(e) {
    const R = e._r; if (!R || !R.glows) return;
    const on = e.status === 'working' || (e.kind === 'beacon' && e.active);
    for (const s of R.glows) s.pool.color(s.i, tmpC.set(on ? s.p.c : '#333'));
  }
}
