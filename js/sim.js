// Core simulation. Deterministic fixed-step; independent of rendering.
import { ITEMS, FLUIDS, RECIPES, BUILDINGS, TECHS, START_RECIPES, PACKS, isFluid } from './data.js';
import { World, ORES, OIL } from './world.js';

export const TICK = 1 / 30;
export const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const SP = 0.25; // belt item spacing in tiles
const DRILL_BUF = 10; // mined items a drill holds before it stops
const DROP_POS = [0.5, 0.375, 0.625, 0.25, 0.75, 0.125, 0.875];
const STEAM_KJ = 30; // energy per unit of steam

export function rotSize(type, rot) {
  const [w, h] = BUILDINGS[type].size;
  return rot & 1 ? [h, w] : [w, h];
}
// Map local (unrotated) coords to rotated offset within the rotated footprint.
export function rotLocal(lx, ly, w, h, rot) {
  switch (rot & 3) {
    case 0: return [lx, ly];
    case 1: return [h - 1 - ly, lx];
    case 2: return [w - 1 - lx, h - 1 - ly];
    default: return [ly, w - 1 - lx];
  }
}

// ---------------- Inventory ----------------
export class Inventory {
  constructor(slots) { this.slots = slots; this.items = {}; }
  usedSlots() { let s = 0; for (const [k, n] of Object.entries(this.items)) s += Math.ceil(n / ITEMS[k].stack); return s; }
  space(id) {
    const st = ITEMS[id]?.stack || 50;
    const have = this.items[id] || 0;
    const free = this.slots - this.usedSlots();
    const partial = have % st ? st - (have % st) : 0;
    return Math.max(0, free * st + partial);
  }
  add(id, n) { const k = Math.min(n, this.space(id)); if (k > 0) this.items[id] = (this.items[id] || 0) + k; return k; }
  remove(id, n) { const h = this.items[id] || 0; const k = Math.min(h, n); if (k) { if (h - k) this.items[id] = h - k; else delete this.items[id]; } return k; }
  count(id) { return this.items[id] || 0; }
  total() { let t = 0; for (const n of Object.values(this.items)) t += n; return t; }
}

// ---------------- Belt lanes ----------------
class Lane {
  constructor(ent, speed, tx, ty, dir) {
    this.ent = ent; this.speed = speed; this.tx = tx; this.ty = ty; this.dir = dir;
    this.items = []; // {id, pos} ascending by pos; pos in [0,1)
    this.out = null; // {lane, mode}
  }
}
function laneInsert(lane, id, pos) {
  const it = lane.items;
  let i = 0;
  while (i < it.length && it[i].pos < pos) i++;
  if (i > 0 && pos - it[i - 1].pos < SP - 1e-6) return false;
  if (i < it.length && it[i].pos - pos < SP - 1e-6) return false;
  const o = { id, pos, m: 0 };
  it.splice(i, 0, o);
  return o;
}
function laneDrop(lane, id) {
  for (const p of DROP_POS) if (laneInsert(lane, id, p)) return true;
  return false;
}

// ---------------- Entities ----------------
let NEXT_ID = 1;

export class Entity {
  constructor(g, type, x, y, rot) {
    this.g = g; this.id = NEXT_ID++; this.type = type; this.def = BUILDINGS[type]; this.kind = this.def.kind;
    this.x = x; this.y = y; this.rot = rot & 3;
    [this.w, this.h] = rotSize(type, rot);
    this.status = 'idle';
    this.active = false;
    this.net = null;
    this.modules = this.def.modules ? new Array(this.def.modules).fill(null) : null;
    this.eff = { speed: 0, prod: 0, energy: 0 };
    if (this.def.burner) { this.fuel = { id: null, n: 0 }; this.heat = 0; }
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get electric() { return !!this.def.power && !this.def.burner; }
  *tiles() { for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) yield [this.x + i, this.y + j]; }
  local(lx, ly) { const [a, b] = rotLocal(lx, ly, this.def.size[0], this.def.size[1], this.rot); return [this.x + a, this.y + b]; }
  speedMult() { return Math.max(0.2, 1 + this.eff.speed); }
  energyMult() { return Math.max(0.2, 1 + this.eff.energy); }
  powerDemand() { return this.active ? this.def.power * this.energyMult() : this.def.power * 0.03; }
  // Returns 0..1 power factor for this tick and consumes fuel for burners.
  energy() {
    if (this.def.burner) {
      const need = this.def.power * this.energyMult() * TICK;
      if (this.heat < need && this.fuel.n > 0) {
        this.fuel.n--; this.heat += ITEMS[this.fuel.id].fuel;
        if (!this.fuel.n) this.fuel.id = null;
      }
      if (this.heat >= need) { this.heat -= need; return 1; }
      return 0;
    }
    return this.net ? this.net.sat : 0;
  }
  noEnergyStatus() { return this.def.burner ? 'no fuel' : 'no power'; }
  fuelWants(id) {
    if (!this.def.burner || !ITEMS[id]?.fuel) return 0;
    if (this.fuel.id && this.fuel.id !== id) return 0;
    return Math.max(0, 10 - this.fuel.n);
  }
  fuelInsert(id, n) {
    const k = Math.min(n, this.fuelWants(id));
    if (k > 0) { this.fuel.id = id; this.fuel.n += k; }
    return k;
  }
  wants(id) { return this.fuelWants(id); }
  insert(id, n) { return this.fuelInsert(id, n); }
  extract() { return null; }
  // Items to return to the player on removal.
  contents() {
    const c = {};
    if (this.fuel?.n) c[this.fuel.id] = this.fuel.n;
    if (this.modules) for (const m of this.modules) if (m) c[m] = (c[m] || 0) + 1;
    return c;
  }
  tick() { }
  save() {
    const s = {};
    if (this.fuel) { s.fuel = this.fuel; s.heat = this.heat; }
    if (this.modules) s.modules = this.modules;
    return s;
  }
  load(s) {
    if (s.fuel) { this.fuel = s.fuel; this.heat = s.heat || 0; }
    if (s.modules) this.modules = s.modules;
  }
}

const lim = (max, id) => Math.max(1, typeof max === 'function' ? max(id) : max);
function addTo(obj, id, n) { obj[id] = (obj[id] || 0) + n; }
function mergeInto(a, b) { for (const [k, v] of Object.entries(b)) if (v > 0) addTo(a, k, v); return a; }

// ----- Belt-like -----
class Belt extends Entity {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.lane = new Lane(this, this.def.speed, x, y, this.rot); }
  lanes() { return [this.lane]; }
  laneAt() { return this.lane; }
  contents() { const c = {}; for (const it of this.lane.items) addTo(c, it.id, 1); return c; }
  save() { return { items: this.lane.items.map(i => [i.id, i.pos]) }; }
  load(s) { if (s.items) this.lane.items = s.items.map(([id, pos]) => ({ id, pos, m: 0 })); }
}
class Underground extends Belt {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.mode = 'in'; this.partner = null; }
  save() { return { ...super.save(), mode: this.mode }; }
  load(s) { super.load(s); if (s.mode) this.mode = s.mode; }
}
class Splitter extends Entity {
  constructor(g, type, x, y, rot) {
    super(g, type, x, y, rot);
    this.lanesArr = [0, 1].map(i => { const [tx, ty] = this.local(i, 0); const l = new Lane(this, this.def.speed, tx, ty, this.rot); l.split = i; return l; });
    this.rr = 0; this.filter = null; this.priority = null; // 'left' | 'right'
    this.outA = null; this.outB = null;
  }
  lanes() { return this.lanesArr; }
  laneAt(x, y) { return this.lanesArr.find(l => l.tx === x && l.ty === y) || this.lanesArr[0]; }
  contents() { const c = {}; for (const l of this.lanesArr) for (const it of l.items) addTo(c, it.id, 1); return c; }
  save() { return { items: this.lanesArr.map(l => l.items.map(i => [i.id, i.pos])), filter: this.filter, priority: this.priority }; }
  load(s) {
    if (s.items) s.items.forEach((arr, i) => { this.lanesArr[i].items = arr.map(([id, pos]) => ({ id, pos, m: 0 })); });
    this.filter = s.filter || null; this.priority = s.priority || null;
  }
}
const BELTLIKE = new Set(['belt', 'underground', 'splitter']);

// ----- Inserter -----
class Inserter extends Entity {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.hand = null; this.phase = 0; this.filter = null; }
  reachTiles() {
    const r = this.def.reach;
    return [this.x - DX[this.rot] * r, this.y - DY[this.rot] * r, this.x + DX[this.rot] * r, this.y + DY[this.rot] * r];
  }
  capacity() { return this.def.stack ? 4 + this.g.bonus.stack : 1; }
  powerDemand() { return this.active ? this.def.power : this.def.power * 0.05; }
  tick(g) {
    const moving = (this.hand && this.phase < 1) || (!this.hand && this.phase > 0);
    this.active = moving;
    if (this.def.burner && this.hand && !this.fuel.n && this.heat < 50 && ITEMS[this.hand.id].fuel) {
      this.fuel.id = this.hand.id; this.fuel.n = 1; this.hand.n--; if (!this.hand.n) this.hand = null;
    }
    if (moving) {
      const e = this.energy();
      if (!e) { this.status = this.noEnergyStatus(); return; }
      const sw = this.def.rate * 2 * TICK * e;
      this.phase = this.hand ? Math.min(1, this.phase + sw) : Math.max(0, this.phase - sw);
      this.status = 'working';
      return;
    }
    const [sx, sy, dx, dy] = this.reachTiles();
    const dst = g.entityAt(dx, dy);
    if (!this.hand) {
      const src = g.entityAt(sx, sy);
      if (!src || !dst || src === dst) { this.status = 'idle'; return; }
      const filt = this.def.filter && this.filter ? this.filter : null;
      const want = (id) => (!filt || id === filt) && g.accepts(dst, dx, dy, id) > 0;
      const cap = this.capacity();
      if (BELTLIKE.has(src.kind)) {
        const lane = src.laneAt(sx, sy);
        for (let i = lane.items.length - 1; i >= 0; i--) {
          const it = lane.items[i];
          if (!want(it.id)) continue;
          lane.items.splice(i, 1);
          this.hand = { id: it.id, n: 1 };
          // stack inserters grab more of the same item
          for (let j = lane.items.length - 1; j >= 0 && this.hand.n < cap; j--) {
            if (lane.items[j].id === it.id) { lane.items.splice(j, 1); this.hand.n++; }
          }
          break;
        }
      } else {
        const r = src.extract(want, (id) => BELTLIKE.has(dst.kind) ? cap : Math.min(cap, dst.wants(id)));
        if (r) this.hand = r;
      }
      this.status = this.hand ? 'working' : 'idle';
    } else {
      if (!dst) { this.status = 'blocked'; return; }
      if (BELTLIKE.has(dst.kind)) {
        if (laneDrop(dst.laneAt(dx, dy), this.hand.id)) this.hand.n--;
      } else {
        this.hand.n -= dst.insert(this.hand.id, this.hand.n);
      }
      if (this.hand.n <= 0) { this.hand = null; this.status = 'working'; }
      else this.status = 'blocked';
    }
  }
  contents() { const c = super.contents(); if (this.hand) addTo(c, this.hand.id, this.hand.n); return c; }
  save() { return { ...super.save(), hand: this.hand, phase: this.phase, filter: this.filter }; }
  load(s) { super.load(s); this.hand = s.hand || null; this.phase = s.phase || 0; this.filter = s.filter || null; }
}

// ----- Chests -----
class Chest extends Entity {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.inv = new Inventory(this.def.slots || 16); this.filter = null; this.target = 50; }
  wants(id) { return id ? this.inv.space(id) : 9999; }
  insert(id, n) { return this.inv.add(id, n); }
  extract(want, max) {
    for (const [id, n] of Object.entries(this.inv.items)) {
      if (n > 0 && want(id)) { const k = this.inv.remove(id, Math.min(n, lim(max, id))); return { id, n: k }; }
    }
    return null;
  }
  contents() { return { ...this.inv.items }; }
  save() { return { items: this.inv.items, filter: this.filter, target: this.target }; }
  load(s) { this.inv.items = s.items || {}; this.filter = s.filter || null; this.target = s.target ?? 50; }
}
class Uplink extends Chest {
  wants() { return 9999; }
  insert(id, n) { this.g.give(id, n); this.status = 'working'; this.flash = 10; return n; }
  extract() { return null; }
  tick() { if (this.flash > 0) this.flash--; else this.status = 'idle'; }
}
class Downlink extends Chest {
  wants() { return 0; }
  insert() { return 0; }
  tick(g) {
    if (!this.filter) { this.status = 'idle'; return; }
    if ((g.tickCount + this.id) % 10) return;
    const have = this.inv.count(this.filter);
    const need = Math.min(this.target, this.inv.space(this.filter) + have) - have;
    if (need > 0) {
      const k = Math.min(need, g.inv[this.filter] || 0);
      if (k > 0) { g.take(this.filter, k); this.inv.add(this.filter, k); }
      this.status = k > 0 || have > 0 ? 'working' : 'no input';
    } else this.status = 'working';
  }
}

// ----- Crafting machines -----
class Crafter extends Entity {
  constructor(g, type, x, y, rot) {
    super(g, type, x, y, rot);
    this.recipe = null; this.inp = {}; this.out = {}; this.fin = {}; this.fout = {};
    this.progress = 0; this.crafting = false; this.prodBar = 0;
  }
  setRecipe(rid) {
    if (rid === this.recipe) return;
    const ret = this.contentsNoSelf();
    this.g.giveAll(ret);
    this.inp = {}; this.out = {}; this.fin = {}; this.fout = {}; this.progress = 0; this.crafting = false;
    this.recipe = rid;
  }
  contentsNoSelf() {
    const c = mergeInto(mergeInto({}, this.inp), this.out);
    if (this.crafting && this.recipe) for (const [k, v] of Object.entries(RECIPES[this.recipe].in)) if (!isFluid(k)) addTo(c, k, v);
    return c;
  }
  contents() { return mergeInto(super.contents(), this.contentsNoSelf()); }
  inLimit(id, need) {
    const r = RECIPES[this.recipe];
    const perSec = (this.def.speed * this.speedMult()) / r.time;
    return need * Math.max(2, Math.ceil(perSec * 2)) ;
  }
  wants(id) {
    const f = this.fuelWants(id); if (f) return f;
    if (!id || !this.recipe) return 0;
    const need = RECIPES[this.recipe].in[id];
    if (!need || isFluid(id)) return 0;
    return Math.max(0, this.inLimit(id, need) - (this.inp[id] || 0));
  }
  insert(id, n) {
    const f = this.fuelInsert(id, n); if (f) return f;
    const k = Math.min(n, this.wants(id));
    if (k > 0) addTo(this.inp, id, k);
    return k;
  }
  extract(want, max) {
    for (const [id, n] of Object.entries(this.out)) {
      if (n > 0 && want(id)) { const k = Math.min(n, lim(max, id)); this.out[id] -= k; if (!this.out[id]) delete this.out[id]; return { id, n: k }; }
    }
    return null;
  }
  fluidPorts() { return this.portNets || []; }
  exchangeFluids(r) {
    if (!this.portNets) return;
    const ports = this.def.ports;
    let outIdx = 0;
    const fouts = Object.keys(r.out).filter(isFluid);
    for (let i = 0; i < ports.length; i++) {
      const net = this.portNets[i]; if (!net) { if (ports[i].io === 'out') outIdx++; continue; }
      if (ports[i].io === 'in') {
        if (!net.fluid || !(net.fluid in r.in)) continue;
        const cap = Math.max(100, r.in[net.fluid] * 2);
        const have = this.fin[net.fluid] || 0;
        const k = Math.min(cap - have, net.amount);
        if (k > 0) { net.amount -= k; this.fin[net.fluid] = have + k; if (net.amount < 1e-6) { net.amount = 0; net.fluid = null; } }
      } else {
        if (!fouts.length) continue;
        const fl = fouts[outIdx % fouts.length]; outIdx++;
        const have = this.fout[fl] || 0;
        if (have <= 0) continue;
        if (net.fluid && net.fluid !== fl) continue;
        const k = Math.min(have, net.cap - net.amount);
        if (k > 0) { net.fluid = fl; net.amount += k; this.fout[fl] = have - k; }
      }
    }
  }
  canStart(r) {
    for (const [k, v] of Object.entries(r.in)) {
      if (isFluid(k)) { if ((this.fin[k] || 0) < v - 1e-6) return false; }
      else if ((this.inp[k] || 0) < v) return false;
    }
    return true;
  }
  outputBlocked(r) {
    for (const [k, v] of Object.entries(r.out)) {
      if (isFluid(k)) { if ((this.fout[k] || 0) > Math.max(100, v * 2)) return true; }
      else if ((this.out[k] || 0) >= Math.max(v * 3, Math.min(ITEMS[k].stack, v * 10))) return true;
    }
    return false;
  }
  tick(g) {
    if (!this.recipe) { this.status = 'no recipe'; this.active = false; return; }
    const r = RECIPES[this.recipe];
    this.exchangeFluids(r);
    if (!this.crafting) {
      if (this.outputBlocked(r)) { this.status = 'output full'; this.active = false; return; }
      if (!this.canStart(r)) { this.status = 'no input'; this.active = false; return; }
      for (const [k, v] of Object.entries(r.in)) {
        if (isFluid(k)) this.fin[k] -= v; else { this.inp[k] -= v; if (!this.inp[k]) delete this.inp[k]; }
        g.stat(k, -v);
      }
      this.crafting = true; this.progress = 0;
    }
    this.active = true;
    const e = this.energy();
    if (!e) { this.status = this.noEnergyStatus(); return; }
    this.status = e < 0.99 ? 'low power' : 'working';
    this.progress += (this.def.speed * this.speedMult() * e * TICK) / r.time;
    if (this.progress >= 1) {
      this.crafting = false; this.progress = 0;
      let mult = 1;
      if (r.prodOk && this.eff.prod > 0) { this.prodBar += this.eff.prod; if (this.prodBar >= 1) { this.prodBar -= 1; mult = 2; } }
      for (const [k, v] of Object.entries(r.out)) {
        if (isFluid(k)) addTo(this.fout, k, v * mult); else addTo(this.out, k, v * mult);
        g.stat(k, v * mult);
      }
    }
  }
  save() { return { ...super.save(), recipe: this.recipe, inp: this.inp, out: this.out, fin: this.fin, fout: this.fout, progress: this.progress, crafting: this.crafting, prodBar: this.prodBar }; }
  load(s) { super.load(s); Object.assign(this, { recipe: s.recipe || null, inp: s.inp || {}, out: s.out || {}, fin: s.fin || {}, fout: s.fout || {}, progress: s.progress || 0, crafting: !!s.crafting, prodBar: s.prodBar || 0 }); }
}

class Furnace extends Crafter {
  smeltFor(id) {
    for (const rid of this.g.unlocked) { const r = RECIPES[rid]; if (r.cat === 'smelt' && r.in[id]) return rid; }
    return null;
  }
  wants(id) {
    const f = this.fuelWants(id); if (f) return f;
    if (!id) return 0;
    if (this.recipe && RECIPES[this.recipe].in[id]) return super.wants(id);
    if (this.recipe && (this.crafting || Object.keys(this.inp).length || Object.keys(this.out).length)) return 0;
    const rid = this.smeltFor(id);
    return rid ? RECIPES[rid].in[id] * 3 : 0;
  }
  insert(id, n) {
    const f = this.fuelInsert(id, n); if (f) return f;
    const k = Math.min(n, this.wants(id));
    if (k <= 0) return 0;
    if (!this.recipe || !RECIPES[this.recipe].in[id]) this.recipe = this.smeltFor(id);
    addTo(this.inp, id, k);
    return k;
  }
  tick(g) {
    if (!this.recipe) { this.status = 'no input'; this.active = false; return; }
    super.tick(g);
  }
}

class Lab extends Entity {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.inv = {}; this.progress = 0; this.unit = null; }
  wants(id) { return id && PACKS.includes(id) ? Math.max(0, 10 - (this.inv[id] || 0)) : 0; }
  insert(id, n) { const k = Math.min(n, this.wants(id)); if (k > 0) addTo(this.inv, id, k); return k; }
  // Inserters can pass data on from one lab to the next.
  extract(want, max) {
    for (const [id, n] of Object.entries(this.inv)) {
      if (n > 0 && want(id)) { const k = Math.min(n, lim(max, id)); this.inv[id] -= k; if (!this.inv[id]) delete this.inv[id]; return { id, n: k }; }
    }
    return null;
  }
  contents() { return mergeInto(super.contents(), this.inv); }
  tick(g) {
    const tid = g.research.current;
    if (!tid) { this.status = 'no research'; this.active = false; return; }
    const t = TECHS[tid];
    if (this.unit !== tid) {
      if (!Object.keys(t.cost).every(p => (this.inv[p] || 0) >= 1)) { this.status = 'no input'; this.active = false; return; }
      for (const p of Object.keys(t.cost)) { this.inv[p]--; g.stat(p, -1); }
      this.unit = tid; this.progress = 0;
    }
    this.active = true;
    const e = this.energy();
    if (!e) { this.status = 'no power'; return; }
    this.status = 'working';
    this.progress += (TICK * this.speedMult() * (1 + g.bonus.lab) * e) / t.time;
    if (this.progress >= 1) { this.unit = null; this.progress = 0; g.researchUnit(tid, 1 + Math.max(0, this.eff.prod)); }
  }
  save() { return { ...super.save(), inv: this.inv, progress: this.progress, unit: this.unit }; }
  load(s) { super.load(s); this.inv = s.inv || {}; this.progress = s.progress || 0; this.unit = s.unit || null; }
}

class Drill extends Entity {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.progress = 0; this.buf = {}; this.prodBar = 0; this.rr = 0; this.computeArea(); }
  computeArea() {
    const a = this.def.area, off = (a - this.def.size[0]) / 2;
    const cx = this.x - off, cy = this.y - off;
    this.area = [];
    for (let j = 0; j < a; j++) for (let i = 0; i < a; i++) {
      const x = cx + i, y = cy + j;
      if (this.g.world.inBounds(x, y)) this.area.push(this.g.world.idx(x, y));
    }
  }
  outTile() { const [w] = this.def.size; return this.local(Math.floor((w - 1) / 2), -1); }
  stored() { let t = 0; for (const n of Object.values(this.buf)) t += n; return t; }
  // Push one item onto whatever sits on the output tile.
  tryOutput(g) {
    const id = Object.keys(this.buf)[0];
    if (!id) return;
    const [ox, oy] = this.outTile();
    const t = g.entityAt(ox, oy);
    if (!t) return;
    const ok = BELTLIKE.has(t.kind) ? (laneDrop(t.laneAt(ox, oy), id) ? 1 : 0) : t.insert(id, 1);
    if (ok) this.take(id, 1);
  }
  take(id, n) { const k = Math.min(n, this.buf[id] || 0); this.buf[id] -= k; if (!this.buf[id]) delete this.buf[id]; return k; }
  // Inserters may pull mined ore straight out of the drill.
  extract(want, max) {
    for (const id of Object.keys(this.buf)) if (want(id)) return { id, n: this.take(id, lim(max, id)) };
    return null;
  }
  tick(g) {
    if (this.stored()) this.tryOutput(g);
    if (this.stored() >= DRILL_BUF) { this.status = 'output full'; this.active = false; return; }
    const W = g.world;
    let ore = -1;
    for (let k = 0; k < this.area.length; k++) {
      const i = this.area[(this.rr + k) % this.area.length];
      if (W.ore[i] && W.ore[i] !== OIL && W.amount[i] > 0) { ore = i; break; }
    }
    if (ore < 0) { this.status = 'depleted'; this.active = false; return; }
    this.active = true;
    const e = this.energy();
    if (!e) { this.status = this.noEnergyStatus(); return; }
    this.status = 'working';
    this.progress += this.def.speed * this.speedMult() * e * TICK;
    if (this.progress >= 1) {
      this.progress -= 1;
      this.rr = (this.rr + 1) % this.area.length;
      const id = ORES[W.ore[ore]];
      W.amount[ore] -= 1;
      if (W.amount[ore] <= 0) { W.amount[ore] = 0; W.ore[ore] = 0; g.emit('tile', ore); }
      let n = 1;
      this.prodBar += g.bonus.mining + Math.max(0, this.eff.prod);
      while (this.prodBar >= 1) { this.prodBar -= 1; n++; }
      addTo(this.buf, id, n);
      g.stat(id, n);
    }
  }
  contents() { return mergeInto(super.contents(), this.buf); }
  save() { return { ...super.save(), progress: this.progress, buf: this.buf, prodBar: this.prodBar }; }
  load(s) {
    super.load(s); this.progress = s.progress || 0; this.prodBar = s.prodBar || 0;
    const b = s.buf;
    this.buf = !b ? {} : b.id ? { [b.id]: b.n } : b; // older saves stored a single {id, n}
  }
}

class Pumpjack extends Entity {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.buf = 0; }
  yield() { const [cx, cy] = [this.x + 1, this.y + 1]; const W = this.g.world; return W.amount[W.idx(cx, cy)] / 100; }
  tick(g) {
    const net = this.portNets?.[0];
    if (net && this.buf > 0 && (!net.fluid || net.fluid === 'crude-oil')) {
      const k = Math.min(this.buf, net.cap - net.amount);
      if (k > 0) { net.fluid = 'crude-oil'; net.amount += k; this.buf -= k; }
    }
    if (this.buf >= 100) { this.status = 'output full'; this.active = false; return; }
    this.active = true;
    const e = this.energy();
    if (!e) { this.status = 'no power'; return; }
    this.status = 'working';
    const amt = 10 * this.yield() * this.speedMult() * e * TICK * (1 + Math.max(0, this.eff.prod) + g.bonus.mining);
    this.buf += amt; g.stat('crude-oil', amt);
  }
  save() { return { ...super.save(), buf: this.buf }; }
  load(s) { super.load(s); this.buf = s.buf || 0; }
}

class OffshorePump extends Entity {
  tick(g) {
    const net = this.portNets?.[0];
    if (!net) { this.status = 'idle'; return; }
    if (net.fluid && net.fluid !== 'water') { this.status = 'blocked'; return; }
    const k = Math.min(this.def.rate * TICK, net.cap - net.amount);
    if (k > 0) { net.fluid = 'water'; net.amount += k; g.stat('water', k); this.status = 'working'; }
    else this.status = 'output full';
  }
}

class Boiler extends Entity {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.water = 0; this.steam = 0; }
  tick(g) {
    const [nw, , ns] = this.portNets || [];
    if (nw && nw.fluid === 'water') { const k = Math.min(200 - this.water, nw.amount); this.water += k; nw.amount -= k; if (nw.amount < 1e-6) { nw.amount = 0; nw.fluid = null; } }
    if (ns && this.steam > 0 && (!ns.fluid || ns.fluid === 'steam')) { const k = Math.min(this.steam, ns.cap - ns.amount); if (k > 0) { ns.fluid = 'steam'; ns.amount += k; this.steam -= k; } }
    const rate = (this.def.power / STEAM_KJ) * TICK; // steam per tick at full power
    const room = 200 - this.steam;
    if (room < rate) { this.status = 'output full'; this.active = false; return; }
    if (this.water < rate) { this.status = 'no water'; this.active = false; return; }
    this.active = true;
    const e = this.energy();
    if (!e) { this.status = 'no fuel'; return; }
    this.status = 'working';
    this.water -= rate; this.steam += rate; g.stat('water', -rate); g.stat('steam', rate);
  }
  save() { return { ...super.save(), water: this.water, steam: this.steam }; }
  load(s) { super.load(s); this.water = s.water || 0; this.steam = s.steam || 0; }
}

class Generator extends Entity {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.steam = 0; this.output = 0; }
  pull() {
    const n = this.portNets?.[0];
    if (n && n.fluid === 'steam') { const k = Math.min(60 - this.steam, n.amount); this.steam += k; n.amount -= k; if (n.amount < 1e-6) { n.amount = 0; n.fluid = null; } }
  }
  capacity() { return Math.min(this.def.power, (this.steam * STEAM_KJ) / TICK); }
  consume(kw) { const s = (kw * TICK) / STEAM_KJ; this.steam = Math.max(0, this.steam - s); this.output = kw; this.g.stat('steam', -s); this.status = kw > 0 ? 'working' : (this.steam > 0 ? 'idle' : 'no input'); }
  save() { return { steam: this.steam }; }
  load(s) { this.steam = s.steam || 0; }
}
class Solar extends Entity { }
class Accumulator extends Entity {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.charge = 0; }
  save() { return { charge: this.charge }; }
  load(s) { this.charge = s.charge || 0; }
}
class Beacon extends Entity {
  powerDemand() { return this.modules.some(Boolean) ? this.def.power : 0; }
  tick() { this.active = this.modules.some(Boolean); this.status = this.active ? (this.net && this.net.sat > 0 ? 'working' : 'no power') : 'idle'; }
}
class Pole extends Entity { }
class Pipe extends Entity { }
class UPipe extends Entity {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.mode = 'in'; this.partner = null; }
  openDir() { return this.mode === 'in' ? (this.rot + 2) & 3 : this.rot; }
  save() { return { mode: this.mode }; }
  load(s) { this.mode = s.mode || 'in'; }
}
class Gate extends Entity {
  constructor(g, type, x, y, rot) { super(g, type, x, y, rot); this.cores = 0; this.charge = 0; }
  wants(id) { return id === 'resonator-core' ? Math.max(0, this.def.need - this.cores) : 0; }
  insert(id, n) { const k = Math.min(n, this.wants(id)); this.cores += k; return k; }
  contents() { return this.cores ? { 'resonator-core': this.cores } : {}; }
  tick(g) {
    if (this.cores < this.def.need) { this.status = 'no input'; this.active = false; return; }
    this.active = true;
    const e = this.energy();
    if (!e) { this.status = 'no power'; return; }
    this.status = 'working';
    this.charge += (TICK * e) / 60;
    if (this.charge >= 1 && !g.won) { g.won = true; g.emit('victory'); }
    this.charge = Math.min(1, this.charge);
  }
  save() { return { cores: this.cores, charge: this.charge }; }
  load(s) { this.cores = s.cores || 0; this.charge = s.charge || 0; }
}

const CLASSES = {
  belt: Belt, underground: Underground, splitter: Splitter, inserter: Inserter, chest: Chest, uplink: Uplink, downlink: Downlink,
  assembler: Crafter, furnace: Furnace, lab: Lab, drill: Drill, pumpjack: Pumpjack, offshore: OffshorePump, boiler: Boiler,
  generator: Generator, solar: Solar, accumulator: Accumulator, beacon: Beacon, pole: Pole, pipe: Pipe, upipe: UPipe, gate: Gate,
};

// ---------------- Networks ----------------
class PowerNet {
  constructor(id) { this.id = id; this.poles = []; this.consumers = []; this.gens = []; this.solars = []; this.accs = []; this.sat = 0; this.demand = 0; this.supply = 0; this.cap = 0; }
}
class FluidNet {
  constructor(id) { this.id = id; this.fluid = null; this.amount = 0; this.cap = 0; this.nodes = 0; }
}

// ---------------- Game ----------------
export class Game {
  constructor(opts = {}) {
    const size = opts.size || 320;
    this.world = new World(size, opts.seed ?? Math.floor(Math.random() * 1e9));
    this.size = size;
    this.occ = new Int32Array(size * size);
    this.ents = new Map();
    this.inv = {};
    this.unlocked = new Set(START_RECIPES);
    this.research = { done: new Set(), current: null, progress: 0, queue: [], levels: {} };
    this.bonus = { mining: 0, lab: 0, craft: 0, stack: 0 };
    this.craftQueue = [];
    this.handMine = null;
    this.ghosts = new Map(); this.ghostOcc = new Int32Array(size * size); this.nextGhost = 1;
    this.tickCount = 0;
    this.time = 0; // seconds
    this.dayLength = 420;
    this.listeners = {};
    this.lanes = []; this.powerNets = []; this.fluidNets = []; this.wires = [];
    this.dirty = { belts: true, power: true, fluids: true, effects: true };
    this.stats = { cur: {}, sec: [], min: [] }; // per-second ring and per-10s ring
    this.won = false;
    this.totals = {};
    this.flags = {};
    this.objectiveIdx = 0;
    if (!opts.empty) this.giveAll({ 'iron-plate': 30, 'burner-drill': 3, 'stone-furnace': 3, 'coal': 20, 'stone': 10, 'iron-chest': 2 });
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, a, b) { for (const f of this.listeners[ev] || []) f(a, b); }

  // ----- inventory helpers -----
  give(id, n) { if (n > 0) { this.inv[id] = (this.inv[id] || 0) + n; this.emit('inv'); } }
  giveAll(obj) { for (const [k, v] of Object.entries(obj)) if (v > 0 && !isFluid(k)) this.inv[k] = (this.inv[k] || 0) + v; this.emit('inv'); }
  take(id, n) { const h = this.inv[id] || 0; const k = Math.min(h, n); if (k) { if (h - k > 0) this.inv[id] = h - k; else delete this.inv[id]; this.emit('inv'); } return k; }
  has(id, n = 1) { return (this.inv[id] || 0) >= n; }

  stat(id, n) { const c = this.stats.cur; const s = c[id] || (c[id] = [0, 0]); if (n > 0) { s[0] += n; this.totals[id] = (this.totals[id] || 0) + n; } else s[1] -= n; }

  get sun() { const t = (this.time % this.dayLength) / this.dayLength; return Math.max(0, Math.min(1, Math.cos((t - 0.25) * Math.PI * 2) * 1.6 + 0.35)); }

  entityAt(x, y) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
    const id = this.occ[y * this.size + x];
    return id ? this.ents.get(id) : null;
  }
  accepts(ent, x, y, id) {
    if (BELTLIKE.has(ent.kind)) return 1;
    return ent.wants(id);
  }

  // ----- placement -----
  canPlace(type, x, y, rot, ignoreGhosts = true) {
    const def = BUILDINGS[type];
    const [w, h] = rotSize(type, rot);
    const W = this.world;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const tx = x + i, ty = y + j;
      if (!W.inBounds(tx, ty)) return { ok: false, reason: 'Out of bounds' };
      if (W.water[W.idx(tx, ty)]) return { ok: false, reason: 'Cannot build on water' };
      if (this.occ[W.idx(tx, ty)]) return { ok: false, reason: 'Space occupied' };
      if (!ignoreGhosts && this.ghostOcc[W.idx(tx, ty)]) return { ok: false, reason: 'Ghost present' };
    }
    if (def.kind === 'offshore') {
      const fx = x + DX[rot & 3], fy = y + DY[rot & 3];
      if (!W.isWater(fx, fy)) return { ok: false, reason: 'Arrow must point at water' };
    }
    if (def.kind === 'pumpjack') {
      const i = W.idx(x + 1, y + 1);
      if (W.ore[i] !== OIL) return { ok: false, reason: 'Center must be on an oil seep' };
    }
    if (def.kind === 'drill') {
      const a = def.area, off = (a - def.size[0]) / 2;
      let found = false;
      for (let j = 0; j < a && !found; j++) for (let i = 0; i < a; i++) {
        const tx = x - off + i, ty = y - off + j;
        if (W.inBounds(tx, ty)) { const k = W.idx(tx, ty); if (W.ore[k] && W.ore[k] !== OIL) { found = true; break; } }
      }
      if (!found) return { ok: false, reason: 'No minable ore in area' };
    }
    return { ok: true };
  }

  // Replace a belt with another tier or rotation in place, keeping items.
  fastReplace(type, x, y, rot) {
    const e = this.entityAt(x, y);
    if (!e) return null;
    const nd = BUILDINGS[type];
    if (e.kind === 'belt' && nd.kind === 'belt' && e.x === x && e.y === y) {
      if (e.type === type && e.rot === (rot & 3)) return null;
      if (e.type !== type && !this.has(type)) return { ok: false, reason: 'Missing ' + nd.name };
      const items = e.lane.items;
      const oldType = e.type;
      this.removeEntity(e, false);
      if (oldType !== type) { this.take(type, 1); this.give(oldType, 1); }
      const ne = this.createEntity(type, x, y, rot);
      ne.lane.items = items;
      return { ok: true, ent: ne };
    }
    return null;
  }

  // Player-initiated placement: consumes an item.
  place(type, x, y, rot, opts = {}) {
    const fr = this.fastReplace(type, x, y, rot);
    if (fr) return fr;
    if (!opts.free && !this.has(type)) return { ok: false, reason: 'No ' + BUILDINGS[type].name + ' in inventory' };
    const c = this.canPlace(type, x, y, rot);
    if (!c.ok) return c;
    if (!opts.free) this.take(type, 1);
    const e = this.createEntity(type, x, y, rot, opts);
    this.flags['placed:' + type] = true;
    return { ok: true, ent: e };
  }

  createEntity(type, x, y, rot, opts = {}) {
    const def = BUILDINGS[type];
    const Cls = CLASSES[def.kind] || Entity;
    const e = new Cls(this, type, x, y, rot);
    if (opts.id) { e.id = opts.id; NEXT_ID = Math.max(NEXT_ID, opts.id + 1); }
    this.ents.set(e.id, e);
    for (const [tx, ty] of e.tiles()) {
      const i = ty * this.size + tx;
      this.occ[i] = e.id;
      const gid = this.ghostOcc[i];
      if (gid) this.removeGhost(gid);
    }
    if ((e.kind === 'underground' || e.kind === 'upipe') && !opts.noPair) this.pairTunnel(e, opts.mode);
    else if (opts.mode) e.mode = opts.mode;
    this.markDirty(e);
    this.emit('add', e);
    return e;
  }

  pairTunnel(e, forced) {
    const range = e.def.range;
    // An entrance looks forward for an unpaired exit; otherwise look backward for an unpaired entrance.
    const sgn = forced === 'in' ? 1 : -1;
    const want = forced === 'in' ? 'out' : 'in';
    for (let d = 1; d < range; d++) {
      const o = this.entityAt(e.x + sgn * DX[e.rot] * d, e.y + sgn * DY[e.rot] * d);
      if (o && o.type === e.type && o.rot === e.rot) {
        if (o.mode === want && !o.partner) { e.mode = forced === 'in' ? 'in' : 'out'; e.partner = o.id; o.partner = e.id; this.emit('update', o); return; }
        break; // first matching tunnel piece blocks the search
      }
    }
    e.mode = forced || 'in';
  }

  markDirty(e) {
    if (BELTLIKE.has(e.kind)) this.dirty.belts = true;
    if (e.kind === 'pole' || e.electric || e.kind === 'generator' || e.kind === 'solar' || e.kind === 'accumulator' || e.kind === 'beacon') this.dirty.power = true;
    if (e.def.ports || e.kind === 'pipe' || e.kind === 'upipe') this.dirty.fluids = true;
    if (e.modules || e.kind === 'beacon') this.dirty.effects = true;
  }

  removeEntity(e, refund = true) {
    if (!this.ents.has(e.id)) return;
    if (refund) { this.giveAll(e.contents()); this.give(e.type, 1); }
    for (const [tx, ty] of e.tiles()) this.occ[ty * this.size + tx] = 0;
    this.ents.delete(e.id);
    if (e.partner) { const p = this.ents.get(e.partner); if (p) { p.partner = null; if (p.mode === 'out') { p.mode = 'in'; } this.emit('update', p); } }
    this.markDirty(e);
    this.emit('remove', e);
  }

  rotateEntity(e) {
    if (e.kind === 'underground' || e.kind === 'upipe') {
      // flip direction of a tunnel pair
      const p = e.partner && this.ents.get(e.partner);
      for (const t of p ? [e, p] : [e]) { t.rot = (t.rot + 2) & 3; t.mode = t.mode === 'in' ? 'out' : 'in'; if (t.lane) { t.lane.dir = t.rot; } this.emit('update', t); }
      this.markDirty(e);
      return;
    }
    const [w, h] = rotSize(e.type, e.rot + 1);
    if (w !== h) {
      // non-square: re-place if footprint allows
      const st = { save: e.save(), rot: (e.rot + 1) & 3 };
      for (const [tx, ty] of e.tiles()) this.occ[ty * this.size + tx] = 0;
      const ok = this.canPlace(e.type, e.x, e.y, st.rot).ok;
      for (const [tx, ty] of e.tiles()) this.occ[ty * this.size + tx] = e.id;
      if (!ok) return false;
      this.removeEntity(e, false);
      const ne = this.createEntity(e.type, e.x, e.y, st.rot, { id: e.id });
      ne.load(st.save);
      return true;
    }
    e.rot = (e.rot + 1) & 3;
    if (e.lane) e.lane.dir = e.rot;
    if (e.lanesArr) { e.lanesArr.forEach((l, i) => { const [tx, ty] = e.local(i, 0); l.tx = tx; l.ty = ty; l.dir = e.rot; }); }
    this.markDirty(e);
    this.emit('update', e);
    return true;
  }

  // ----- ghosts / blueprints -----
  addGhost(g) {
    const [w, h] = rotSize(g.type, g.rot);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const tx = g.x + i, ty = g.y + j;
      if (!this.world.inBounds(tx, ty) || this.occ[ty * this.size + tx] || this.ghostOcc[ty * this.size + tx]) return false;
    }
    if (!this.canPlace(g.type, g.x, g.y, g.rot).ok) return false;
    g.id = this.nextGhost++;
    this.ghosts.set(g.id, g);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.ghostOcc[(g.y + j) * this.size + g.x + i] = g.id;
    this.emit('ghosts');
    return true;
  }
  removeGhost(id) {
    const g = this.ghosts.get(id);
    if (!g) return;
    const [w, h] = rotSize(g.type, g.rot);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (g.y + j) * this.size + g.x + i;
      if (this.ghostOcc[k] === id) this.ghostOcc[k] = 0;
    }
    this.ghosts.delete(id);
    this.emit('ghosts');
  }
  buildGhosts(max = 4) {
    let built = 0;
    for (const g of this.ghosts.values()) {
      if (built >= max) break;
      if (!this.has(g.type)) continue;
      const id = g.id;
      // clear ghost occupancy before placing
      this.removeGhost(id);
      const r = this.place(g.type, g.x, g.y, g.rot, { mode: g.mode });
      if (r.ok) { built++; applySettings(r.ent, g.settings); }
      else if (r.reason !== 'Missing') { /* blocked — drop ghost */ }
    }
  }

  // ----- network rebuilds -----
  rebuildBelts() {
    const lanes = [];
    for (const e of this.ents.values()) if (BELTLIKE.has(e.kind)) for (const l of e.lanes()) lanes.push(l);
    const target = (tx, ty, d) => {
      const e = this.entityAt(tx, ty);
      if (!e) return null;
      if (e.kind === 'belt') {
        if (e.rot === ((d + 2) & 3)) return null;
        if (e.rot === d) return { lane: e.lane, mode: 0 };
        return { lane: e.lane, mode: this.hasStraightFeeder(e) ? 1 : 0 };
      }
      if (e.kind === 'underground') return e.mode === 'in' && e.rot === d ? { lane: e.lane, mode: 0 } : null;
      if (e.kind === 'splitter') return e.rot === d ? { lane: e.laneAt(tx, ty), mode: 0 } : null;
      return null;
    };
    for (const e of this.ents.values()) {
      if (e.kind === 'belt') e.lane.out = target(e.x + DX[e.rot], e.y + DY[e.rot], e.rot);
      else if (e.kind === 'underground') {
        if (e.mode === 'in') { const p = e.partner && this.ents.get(e.partner); e.lane.out = p ? { lane: p.lane, mode: 0 } : null; }
        else e.lane.out = target(e.x + DX[e.rot], e.y + DY[e.rot], e.rot);
      } else if (e.kind === 'splitter') {
        const [a, b] = e.lanesArr;
        e.outA = target(a.tx + DX[e.rot], a.ty + DY[e.rot], e.rot);
        e.outB = target(b.tx + DX[e.rot], b.ty + DY[e.rot], e.rot);
        a.out = b.out = null;
      }
    }
    // Downstream-first order via iterative DFS post-order.
    const seen = new Set(), order = [];
    const outsOf = (l) => {
      if (l.split !== undefined) { const s = l.ent; return [s.outA?.lane, s.outB?.lane].filter(Boolean); }
      return l.out ? [l.out.lane] : [];
    };
    for (const root of lanes) {
      if (seen.has(root)) continue;
      const stack = [[root, 0]]; seen.add(root);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const outs = outsOf(top[0]);
        if (top[1] < outs.length) {
          const n = outs[top[1]++];
          if (!seen.has(n)) { seen.add(n); stack.push([n, 0]); }
        } else { order.push(top[0]); stack.pop(); }
      }
    }
    this.lanes = order;
    this.emit('belts');
  }
  hasStraightFeeder(e) {
    const f = this.entityAt(e.x - DX[e.rot], e.y - DY[e.rot]);
    if (!f || f.rot !== e.rot) return false;
    return f.kind === 'belt' || f.kind === 'splitter' || (f.kind === 'underground' && f.mode === 'out');
  }

  rebuildPower() {
    const poles = [], others = [];
    for (const e of this.ents.values()) {
      e.net = null;
      if (e.kind === 'pole') poles.push(e);
    }
    // union-find poles
    const parent = poles.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    this.wires = [];
    for (let i = 0; i < poles.length; i++) {
      const a = poles[i];
      const cands = [];
      for (let j = i + 1; j < poles.length; j++) {
        const b = poles[j];
        const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        if (d <= Math.min(a.def.reach, b.def.reach)) cands.push([d, j]);
      }
      cands.sort((p, q) => p[0] - q[0]);
      for (const [, j] of cands.slice(0, 4)) {
        const ri = find(i), rj = find(j);
        // draw a wire to the nearest poles, and to any pole that joins a separate network
        if (ri !== rj || this.wires.length < 1e5) this.wires.push([a, poles[j]]);
        parent[ri] = rj;
      }
      for (const [, j] of cands.slice(4)) { const ri = find(i), rj = find(j); if (ri !== rj) { this.wires.push([a, poles[j]]); parent[ri] = rj; } }
    }
    const nets = new Map();
    poles.forEach((p, i) => {
      const r = find(i);
      if (!nets.has(r)) nets.set(r, new PowerNet(nets.size + 1));
      const net = nets.get(r); net.poles.push(p); p.net = net;
    });
    // coverage
    for (const p of poles) {
      const s = p.def.supply;
      const x0 = Math.floor(p.cx - p.w / 2 - s), x1 = Math.ceil(p.cx + p.w / 2 + s) - 1;
      const y0 = Math.floor(p.cy - p.h / 2 - s), y1 = Math.ceil(p.cy + p.h / 2 + s) - 1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const e = this.entityAt(x, y);
        if (!e || e.net || e.kind === 'pole') continue;
        const k = e.kind;
        if (e.electric || k === 'generator' || k === 'solar' || k === 'accumulator') {
          e.net = p.net;
          if (k === 'generator') p.net.gens.push(e);
          else if (k === 'solar') p.net.solars.push(e);
          else if (k === 'accumulator') p.net.accs.push(e);
          else p.net.consumers.push(e);
        }
      }
    }
    this.powerNets = [...nets.values()];
    this.emit('power');
  }

  rebuildFluids() {
    // Preserve contents per node.
    const old = new Map(); // key -> {fluid, amt}
    const share = (net) => net && net.nodes ? net.amount / net.nodes : 0;
    for (const e of this.ents.values()) {
      if (e.fnet) old.set('e' + e.id, { f: e.fnet.fluid, a: share(e.fnet) });
      if (e.portNets) e.portNets.forEach((n, i) => { if (n) old.set('p' + e.id + ':' + i, { f: n.fluid, a: share(n) }); });
    }
    const keys = [], idx = new Map();
    const node = (k) => { if (!idx.has(k)) { idx.set(k, keys.length); keys.push(k); } return idx.get(k); };
    const parent = [];
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    const ensure = (i) => { while (parent.length <= i) parent.push(parent.length); return i; };
    const portWorld = (e, i) => {
      const p = e.def.ports[i];
      const [px, py] = e.local(p.x, p.y);
      const d = (p.dir + e.rot) & 3;
      return { px, py, tx: px + DX[d], ty: py + DY[d], d };
    };
    // nodes
    for (const e of this.ents.values()) {
      e.fnet = null; e.portNets = null;
      if (e.kind === 'pipe' || e.kind === 'upipe') ensure(node('e' + e.id));
      if (e.def.ports) {
        e.portNets = e.def.ports.map(() => null);
        const links = {};
        e.def.ports.forEach((p, i) => {
          const n = ensure(node('p' + e.id + ':' + i));
          if (p.link) { if (links[p.link] !== undefined) union(n, links[p.link]); else links[p.link] = n; }
        });
      }
    }
    // Which node does neighbor tile (tx,ty) offer to something at (fx,fy) coming from direction d?
    const offer = (tx, ty, fx, fy) => {
      const o = this.entityAt(tx, ty);
      if (!o) return -1;
      if (o.kind === 'pipe') return idx.get('e' + o.id);
      if (o.kind === 'upipe') { const od = o.openDir(); return (o.x + DX[od] === fx && o.y + DY[od] === fy) ? idx.get('e' + o.id) : -1; }
      if (o.def.ports) {
        for (let i = 0; i < o.def.ports.length; i++) {
          const w = portWorld(o, i);
          if (w.px === tx && w.py === ty && w.tx === fx && w.ty === fy) return idx.get('p' + o.id + ':' + i);
        }
      }
      return -1;
    };
    for (const e of this.ents.values()) {
      if (e.kind === 'pipe') {
        const me = idx.get('e' + e.id);
        for (let d = 0; d < 4; d++) { const n = offer(e.x + DX[d], e.y + DY[d], e.x, e.y); if (n >= 0) union(me, n); }
      } else if (e.kind === 'upipe') {
        const me = idx.get('e' + e.id);
        const d = e.openDir();
        const n = offer(e.x + DX[d], e.y + DY[d], e.x, e.y); if (n >= 0) union(me, n);
        if (e.partner && this.ents.get(e.partner)) union(me, idx.get('e' + e.partner));
      }
      if (e.def.ports) {
        e.def.ports.forEach((p, i) => {
          const w = portWorld(e, i);
          const o = this.entityAt(w.tx, w.ty);
          if (o && o !== e && o.def.ports) {
            const n = offer(w.tx, w.ty, w.px, w.py);
            if (n >= 0) union(idx.get('p' + e.id + ':' + i), n);
          }
        });
      }
    }
    // Build nets
    const nets = new Map();
    const getNet = (k) => {
      const r = find(idx.get(k));
      if (!nets.has(r)) nets.set(r, new FluidNet(nets.size + 1));
      const n = nets.get(r); n.nodes++; n.cap += 100;
      const o = old.get(k);
      if (o && o.f && o.a > 0) { (n._mix ||= {})[o.f] = (n._mix[o.f] || 0) + o.a; }
      return n;
    };
    for (const e of this.ents.values()) {
      if (e.kind === 'pipe' || e.kind === 'upipe') e.fnet = getNet('e' + e.id);
      if (e.portNets) e.portNets = e.portNets.map((_, i) => getNet('p' + e.id + ':' + i));
    }
    for (const n of nets.values()) {
      if (n._mix) {
        let best = null, ba = 0;
        for (const [f, a] of Object.entries(n._mix)) if (a > ba) { best = f; ba = a; }
        n.fluid = best; n.amount = Math.min(ba, n.cap);
        delete n._mix;
      }
    }
    this.fluidNets = [...nets.values()];
    this.emit('fluids');
  }

  rebuildEffects() {
    const beacons = [];
    for (const e of this.ents.values()) {
      if (!e.modules) continue;
      e.eff = { speed: 0, prod: 0, energy: 0 };
      if (e.kind === 'beacon') { beacons.push(e); continue; }
      for (const m of e.modules) if (m) addEff(e.eff, ITEMS[m].module, 1);
    }
    for (const b of beacons) {
      if (!b.modules.some(Boolean)) continue;
      const r = b.def.range;
      const seen = new Set();
      for (let y = b.y - r; y < b.y + b.h + r; y++) for (let x = b.x - r; x < b.x + b.w + r; x++) {
        const e = this.entityAt(x, y);
        if (!e || seen.has(e) || !e.modules || e.kind === 'beacon') continue;
        seen.add(e);
        for (const m of b.modules) if (m) addEff(e.eff, ITEMS[m].module, 0.5, true);
      }
    }
  }

  // ----- power solve -----
  tickPower() {
    const sun = this.sun;
    for (const net of this.powerNets) {
      let demand = 0;
      for (const c of net.consumers) demand += c.powerDemand();
      let genCap = 0;
      for (const g of net.gens) { g.pull(); genCap += g.capacity(); }
      const solar = net.solars.length * 60 * sun;
      const avail = genCap + solar;
      let accFlow = 0; // + charging, - discharging
      if (avail >= demand) {
        net.sat = demand > 0 ? 1 : 1;
        let surplus = avail - demand;
        for (const a of net.accs) {
          const room = (a.def.capacity - a.charge) / TICK;
          const c = Math.min(a.def.rate, room, surplus);
          if (c > 0) { a.charge += c * TICK; surplus -= c; accFlow += c; }
        }
      } else {
        let deficit = demand - avail;
        for (const a of net.accs) {
          const c = Math.min(a.def.rate, a.charge / TICK, deficit);
          if (c > 0) { a.charge -= c * TICK; deficit -= c; accFlow -= c; }
        }
        net.sat = demand > 0 ? Math.max(0, (demand - deficit) / demand) : 1;
      }
      const used = Math.min(avail, demand + Math.max(0, accFlow));
      const fromGen = Math.max(0, used - solar);
      const frac = genCap > 0 ? Math.min(1, fromGen / genCap) : 0;
      for (const g of net.gens) g.consume(g.capacity() * frac);
      net.demand = demand; net.supply = Math.min(demand, avail - Math.max(0, accFlow)) ; net.cap = avail; net.acc = accFlow;
      net.solarOut = Math.min(solar, used);
      for (const a of net.accs) a.status = accFlow > 0 ? 'working' : accFlow < 0 ? 'low power' : 'idle';
      for (const s of net.solars) s.status = sun > 0.05 ? 'working' : 'idle';
    }
  }

  // ----- research -----
  techCount(id) {
    const t = TECHS[id];
    if (t.infinite) return Math.floor(t.count * Math.pow(1.5, this.research.levels[id] || 0));
    return t.count;
  }
  techAvailable(id) {
    const t = TECHS[id];
    if (this.research.done.has(id) && !t.infinite) return false;
    return t.prereq.every(p => this.research.done.has(p));
  }
  setResearch(id) {
    if (!id) { this.research.current = null; this.research.queue = []; this.emit('research'); return; }
    // queue missing prerequisites first (topological order)
    const order = [];
    const visit = (t) => {
      if (order.includes(t) || (this.research.done.has(t) && !TECHS[t].infinite)) return;
      for (const p of TECHS[t].prereq) if (!this.research.done.has(p)) visit(p);
      order.push(t);
    };
    visit(id);
    if (this.research.current && order[0] === this.research.current) { this.research.queue = order.slice(1); }
    else {
      if (this.research.current !== order[0]) this.research.progress = 0;
      this.research.current = order[0]; this.research.queue = order.slice(1);
    }
    this.emit('research');
  }
  enqueueResearch(id) {
    const order = [];
    const visit = (t) => {
      if (order.includes(t) || this.research.queue.includes(t) || t === this.research.current || (this.research.done.has(t) && !TECHS[t].infinite)) return;
      for (const p of TECHS[t].prereq) if (!this.research.done.has(p)) visit(p);
      order.push(t);
    };
    visit(id);
    if (!this.research.current) { this.setResearch(id); return; }
    this.research.queue.push(...order);
    this.emit('research');
  }
  researchUnit(id, n) {
    if (this.research.current !== id) return;
    this.research.progress += n;
    if (this.research.progress >= this.techCount(id)) this.completeTech(id);
  }
  completeTech(id) {
    const t = TECHS[id];
    if (t.infinite) this.research.levels[id] = (this.research.levels[id] || 0) + 1;
    this.research.done.add(id);
    for (const u of t.unlocks) this.unlocked.add(u);
    this.applyEffects(t, 1);
    this.research.progress = 0;
    this.research.current = null;
    while (this.research.queue.length) {
      const n = this.research.queue.shift();
      if (this.techAvailable(n)) { this.research.current = n; break; }
    }
    if (!this.research.current && t.infinite) this.research.current = id;
    this.emit('tech', id);
    this.emit('research');
  }
  applyEffects(t, mult) {
    for (const ef of t.effects) {
      if (ef.type === 'mining-prod') this.bonus.mining += ef.value * mult;
      if (ef.type === 'lab-speed') this.bonus.lab += ef.value * mult;
      if (ef.type === 'craft-speed') this.bonus.craft += ef.value * mult;
      if (ef.type === 'stack-bonus') this.bonus.stack += ef.value * mult;
    }
  }

  // ----- hand crafting -----
  handRecipeFor(item) {
    if (this.unlocked.has(item) && RECIPES[item]?.hand && RECIPES[item].out[item]) return item;
    for (const rid of this.unlocked) { const r = RECIPES[rid]; if (r.hand && r.out[item]) return rid; }
    return null;
  }
  // Plan crafting `times` of recipe rid, including missing intermediates. Returns steps or null.
  planCraft(rid, times) {
    const inv = { ...this.inv };
    const steps = [];
    const missing = {};
    const need = (item, qty, depth) => {
      const have = inv[item] || 0;
      const take = Math.min(have, qty);
      inv[item] = have - take; qty -= take;
      if (qty <= 0) return true;
      const sub = depth < 8 ? this.handRecipeFor(item) : null;
      if (!sub) { missing[item] = (missing[item] || 0) + qty; return false; }
      const r = RECIPES[sub];
      const t = Math.ceil(qty / r.out[item]);
      let ok = true;
      for (const [k, v] of Object.entries(r.in)) ok = need(k, v * t, depth + 1) && ok;
      steps.push({ rid: sub, n: t });
      inv[item] = (inv[item] || 0) + r.out[item] * t - qty;
      return ok;
    };
    const r = RECIPES[rid];
    let ok = true;
    for (const [k, v] of Object.entries(r.in)) ok = need(k, v * times, 0) && ok;
    steps.push({ rid, n: times });
    return ok ? { steps } : { missing };
  }
  craft(rid, times = 1) {
    if (!RECIPES[rid]?.hand || !this.unlocked.has(rid)) return { ok: false, reason: 'Cannot hand-craft' };
    const p = this.planCraft(rid, times);
    if (!p.steps) return { ok: false, missing: p.missing };
    for (const s of p.steps) {
      const last = this.craftQueue[this.craftQueue.length - 1];
      if (last && last.rid === s.rid && last.progress === 0 && this.craftQueue.length > 1) last.n += s.n;
      else this.craftQueue.push({ rid: s.rid, n: s.n, progress: 0, started: false });
    }
    this.emit('craft');
    return { ok: true };
  }
  cancelCraft(i) {
    const q = this.craftQueue[i];
    if (!q) return;
    if (q.started) { this.giveAll(RECIPES[q.rid].in); }
    this.craftQueue.splice(i, 1);
    this.emit('craft');
  }
  tickCraft() {
    const q = this.craftQueue[0];
    if (!q) return;
    const r = RECIPES[q.rid];
    if (!q.started) {
      for (const [k, v] of Object.entries(r.in)) if (!this.has(k, v)) {
        // try re-plan this step
        this.craftQueue.shift();
        const p = this.planCraft(q.rid, q.n);
        if (p.steps) { this.craftQueue.unshift(...p.steps.map(s => ({ rid: s.rid, n: s.n, progress: 0, started: false }))); }
        this.emit('craft');
        return;
      }
      for (const [k, v] of Object.entries(r.in)) this.take(k, v);
      q.started = true;
    }
    q.progress += (TICK * (1 + this.bonus.craft)) / r.time;
    if (q.progress >= 1) {
      for (const [k, v] of Object.entries(r.out)) { this.give(k, v); this.stat(k, v); }
      q.n--; q.progress = 0; q.started = false;
      if (q.n <= 0) this.craftQueue.shift();
      this.emit('craft');
    }
  }

  tickHandMine() {
    const m = this.handMine;
    if (!m) return;
    const W = this.world, i = W.idx(m.x, m.y);
    if (!W.ore[i] || W.ore[i] === OIL || W.amount[i] <= 0) { this.handMine = null; this.emit('handmine'); return; }
    m.progress += TICK * 0.8;
    if (m.progress >= 1) {
      m.progress = 0;
      const id = ORES[W.ore[i]];
      W.amount[i]--;
      if (W.amount[i] <= 0) { W.amount[i] = 0; W.ore[i] = 0; this.emit('tile', i); }
      this.give(id, 1); this.stat(id, 1);
      this.flags.mined = true;
    }
  }

  // ----- main tick -----
  tick() {
    if (this.dirty.belts) { this.dirty.belts = false; this.rebuildBelts(); }
    if (this.dirty.power) { this.dirty.power = false; this.rebuildPower(); }
    if (this.dirty.fluids) { this.dirty.fluids = false; this.rebuildFluids(); }
    if (this.dirty.effects) { this.dirty.effects = false; this.rebuildEffects(); }

    this.tickPower();
    for (const e of this.ents.values()) e.tick(this);
    this.tickBelts();
    this.tickCraft();
    this.tickHandMine();
    if (this.tickCount % 6 === 0 && this.ghosts.size) this.buildGhosts(2);
    if (!this.research.current && this.research.queue.length) {
      const n = this.research.queue.shift(); if (this.techAvailable(n)) this.research.current = n; this.emit('research');
    }

    this.tickCount++;
    this.time += TICK;
    if (this.tickCount % 30 === 0) this.rollStats();
  }

  tickBelts() {
    for (const L of this.lanes) {
      const items = L.items, n = items.length;
      if (!n) continue;
      const d = L.speed * TICK;
      const front = items[n - 1];
      let tgt = null, limit;
      if (L.split !== undefined) limit = 1;
      else {
        tgt = L.out;
        if (!tgt) limit = 1 - SP / 2;
        else if (tgt.mode === 0) limit = tgt.lane.items.length ? 1 + tgt.lane.items[0].pos - SP : 2;
        else limit = 1;
      }
      const p0 = front.pos;
      front.pos = Math.min(front.pos + d, Math.max(front.pos, limit));
      front.m = front.pos - p0; // movement this tick, for render interpolation
      let moved = false;
      if (front.pos >= 1) {
        if (L.split !== undefined) {
          const s = L.ent;
          const A = s.outA, B = s.outB;
          let cands;
          if (s.filter) cands = front.id === s.filter ? [A] : [B];
          else if (s.priority === 'left') cands = [A, B];
          else if (s.priority === 'right') cands = [B, A];
          else cands = s.rr ? [B, A] : [A, B];
          for (const c of cands) {
            if (!c) continue;
            const p = c.mode === 0 ? front.pos - 1 : 0.5;
            const o = laneInsert(c.lane, front.id, Math.min(p, 0.5));
            if (o) { o.m = front.m; moved = true; if (!s.filter && !s.priority) s.rr ^= 1; break; }
          }
        } else if (tgt) {
          const p = tgt.mode === 0 ? front.pos - 1 : 0.5;
          const o = laneInsert(tgt.lane, front.id, p);
          if (o) { o.m = tgt.mode === 0 ? front.m : 0; moved = true; }
        }
        if (moved) items.pop();
        else front.pos = 1;
      }
      let lim = moved ? front.pos : front.pos;
      for (let i = items.length - (moved ? 1 : 2); i >= 0; i--) {
        const it = items[i];
        const q0 = it.pos;
        it.pos = Math.min(it.pos + d, Math.max(it.pos, lim - SP));
        it.m = it.pos - q0;
        lim = it.pos;
      }
    }
  }

  rollStats() {
    const s = this.stats;
    s.sec.push(s.cur);
    if (s.sec.length > 60) s.sec.shift();
    s.cur = {};
    if (this.tickCount % 300 === 0) {
      // aggregate last 10 seconds into minute ring
      const agg = {};
      for (const b of s.sec.slice(-10)) for (const [k, v] of Object.entries(b)) { const a = agg[k] || (agg[k] = [0, 0]); a[0] += v[0]; a[1] += v[1]; }
      s.min.push(agg);
      if (s.min.length > 60) s.min.shift();
    }
  }
  // per-minute rates over the given window ('1m' or '10m')
  rates(win = '1m') {
    const out = {};
    const src = win === '1m' ? this.stats.sec : this.stats.min;
    const secs = win === '1m' ? src.length : src.length * 10;
    for (const b of src) for (const [k, v] of Object.entries(b)) { const a = out[k] || (out[k] = [0, 0]); a[0] += v[0]; a[1] += v[1]; }
    const f = secs ? 60 / secs : 0;
    for (const a of Object.values(out)) { a[0] *= f; a[1] *= f; }
    return out;
  }

  // ----- save / load -----
  serialize() {
    const ents = [];
    for (const e of this.ents.values()) ents.push({ id: e.id, t: e.type, x: e.x, y: e.y, r: e.rot, p: e.partner || 0, s: e.save() });
    return {
      v: 1, world: this.world.serialize(), ents, inv: this.inv,
      research: { done: [...this.research.done], current: this.research.current, progress: this.research.progress, queue: this.research.queue, levels: this.research.levels },
      craftQueue: this.craftQueue.filter(q => !q.started || true), time: this.time, tick: this.tickCount,
      ghosts: [...this.ghosts.values()], won: this.won, totals: this.totals, flags: this.flags, objectiveIdx: this.objectiveIdx,
    };
  }
  static deserialize(data) {
    const g = new Game({ size: data.world.size, seed: data.world.seed, empty: true });
    g.world.restore(data.world);
    g.inv = data.inv || {};
    for (const id of data.research.done) {
      g.research.done.add(id);
      for (const u of TECHS[id].unlocks) g.unlocked.add(u);
    }
    g.research.levels = data.research.levels || {};
    for (const id of g.research.done) {
      const t = TECHS[id];
      g.applyEffects(t, t.infinite ? (g.research.levels[id] || 1) : 1);
    }
    g.research.current = data.research.current; g.research.progress = data.research.progress; g.research.queue = data.research.queue || [];
    g.craftQueue = (data.craftQueue || []).map(q => ({ ...q, started: q.started }));
    g.time = data.time || 0; g.tickCount = data.tick || 0;
    g.won = !!data.won; g.totals = data.totals || {}; g.flags = data.flags || {}; g.objectiveIdx = data.objectiveIdx || 0;
    for (const s of data.ents) {
      const e = g.createEntity(s.t, s.x, s.y, s.r, { id: s.id, mode: s.s?.mode, noPair: true });
      e.load(s.s || {});
      e.partner = s.p || null;
    }
    for (const gh of data.ghosts || []) { delete gh.id; g.addGhost(gh); }
    g.dirty = { belts: true, power: true, fluids: true, effects: true };
    return g;
  }
}

function addEff(eff, m, mult, beacon = false) {
  eff.speed += (m.speed || 0) * mult;
  eff.energy += (m.energy || 0) * mult;
  if (!beacon) eff.prod += (m.prod || 0) * mult; // beacons cannot transmit productivity
}

// Copy user-configurable settings (recipe, filters) onto an entity.
export function entitySettings(e) {
  const s = {};
  if (e.recipe && e.kind !== 'furnace') s.recipe = e.recipe;
  if (e.filter) s.filter = e.filter;
  if (e.priority) s.priority = e.priority;
  if (e.kind === 'downlink') s.target = e.target;
  if (e.mode) s.mode = e.mode;
  return s;
}
export function applySettings(e, s) {
  if (!s || !e) return;
  if (s.recipe && e.setRecipe && e.g.unlocked.has(s.recipe)) e.setRecipe(s.recipe);
  if (s.filter !== undefined && 'filter' in e) e.filter = s.filter;
  if (s.priority !== undefined && 'priority' in e) e.priority = s.priority;
  if (s.target !== undefined && e.kind === 'downlink') e.target = s.target;
}

export { BELTLIKE, laneDrop };
