import { Game, TICK, rotSize, applySettings } from './sim.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { Input, makeBlueprint, rotateBlueprint } from './input.js';
import { BUILDINGS, validateData, nameOf } from './data.js';
import { iconURL } from './icons.js';

const SAVE_KEY = 'resonance-factory-save-v1';
const BP_KEY = 'resonance-factory-blueprints';
const SET_KEY = 'resonance-factory-settings';

class App {
  constructor() {
    const errs = validateData();
    if (errs.length) console.warn('Data errors', errs);
    this.tool = 'inspect'; this.buildType = null; this.rot = 0;
    this.speed = 1; this.paused = false;
    this.blueprint = null; this.pasteAnchor = null; this.pasteLocked = false;
    this.pending = null; // touch: a positioned-but-unconfirmed action (ghost, selection or paste)
    this.pointer = 'touch'; // last pointer type, so the action bar can give the right hint
    this.blueprints = load(BP_KEY, []);
    this.settings = { grid: false, shadows: true, icons: true, ...load(SET_KEY, {}) };
    let game = null;
    const saved = load(SAVE_KEY, null);
    if (saved) { try { game = Game.deserialize(saved); } catch (e) { console.error('Load failed', e); } }
    this.game = game || new Game({});
    this.renderer = new Renderer(document.getElementById('c'), this.game);
    this.ui = new UI(this);
    this.input = new Input(this);
    this.applySettings();
    this.ui.renderHotbar();
    this.updateToolbar();
    if (!saved) setTimeout(() => this.ui.openPanel('help'), 400);
    this.last = performance.now(); this.acc = 0;
    requestAnimationFrame((t) => this.loop(t));
    setInterval(() => this.save(), 60000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    window.addEventListener('pagehide', () => this.save());
    window.app = this;
  }

  loop(t) {
    const dt = Math.min(0.25, (t - this.last) / 1000);
    this.last = t;
    if (!this.paused) {
      this.acc += dt * this.speed;
      let n = 0;
      const maxSteps = 4 * this.speed;
      while (this.acc >= TICK && n < maxSteps) { this.game.tick(); this.acc -= TICK; n++; }
      if (n >= maxSteps) this.acc = 0; // fall behind gracefully
    }
    this.renderer.frame(dt, this.acc / TICK);
    requestAnimationFrame((tt) => this.loop(tt));
  }

  // ----- tools -----
  setTool(t) {
    this.tool = t;
    this.pending = null;
    if (t !== 'paste') { this.pasteLocked = false; }
    this.renderer.setGrid(this.settings.grid || t === 'build' || t === 'paste');
    this.input.updatePreview();
    this.updateToolbar();
    this.ui.renderHotbar();
  }
  setBuild(type) {
    this.buildType = type; this.setTool('build');
  }
  toolButton(t) {
    if (t === 'rotate') { this.rotate(); return; }
    if (t === 'build') { this.ui.toggle('build'); return; }
    if (t === this.tool && t !== 'inspect') { this.setTool('inspect'); return; }
    if (t === 'paste' && !this.blueprint) { if (this.blueprints.length) this.ui.openPanel('blueprints'); else this.ui.toast('Copy an area first with ✂', 'bad'); return; }
    if (this.ui.panelOpen() && (this.ui.panel === 'entity' || this.ui.panel === 'tile')) this.ui.closePanel();
    this.setTool(this.tool === t && t !== 'inspect' ? 'inspect' : t);
  }
  rotate() {
    if (this.tool === 'paste' && this.blueprint) { this.blueprint = rotateBlueprint(this.blueprint); }
    else if (this.tool === 'inspect' && this.ui.panel === 'entity' && this.ui.panelData) {
      const e = this.game.ents.get(this.ui.panelData.id); if (e) this.game.rotateEntity(e);
    } else this.rot = (this.rot + 1) & 3;
    this.input.updatePreview();
    this.updateToolbar();
  }
  togglePause() { this.paused = !this.paused; }
  updateToolbar() {
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === this.tool || (b.dataset.tool === 'build' && this.tool === 'build')));
    const rb = document.querySelector('[data-tool=rotate] .rot-arrow');
    if (rb) rb.style.transform = `rotate(${this.rot * 90}deg)`;
    document.body.dataset.mode = this.tool;
    this.renderActionBar();
  }

  // The bar above the toolbar always says what the current tool will do, and offers the confirm button.
  renderActionBar() {
    const bar = document.getElementById('actionbar');
    const t = this.tool, P = this.pending, mouse = this.pointer === 'mouse';
    let h = '';
    const img = (id) => `<img class="ic" src="${iconURL(id)}" alt="">`;
    if (t === 'build' && this.buildType) {
      const have = this.game.inv[this.buildType] || 0;
      h = `<span class="ab-label">${img(this.buildType)}<span>${nameOf(this.buildType)} <small>×${have}</small></span></span>`;
      if (P) {
        const n = this.input.pendingList().length;
        h += `<button data-ab="confirm" class="primary">✓ Place${n > 1 ? ' ' + n : ''}</button><button data-ab="rot" title="Rotate">⟳</button><button data-ab="clear" title="Cancel">✕</button>`;
      } else {
        h += `<span class="ab-hint">${mouse ? 'Click to place · drag for a line' : 'Tap to position · drag to pan'}</span><button data-ab="rot" title="Rotate">⟳</button><button data-ab="exit">Done</button>`;
      }
    } else if (t === 'remove' || t === 'copy') {
      const rm = t === 'remove';
      h = `<span class="ab-label">${rm ? '🗑 Remove' : '✂ Copy'}</span>`;
      if (P) {
        const n = this.entitiesIn(this.input.pendingRect()).size;
        h += `<button data-ab="confirm" class="${rm ? 'danger' : 'blue'}">${rm ? 'Remove' : 'Copy'} ${n}</button><button data-ab="clear">✕</button>`;
      } else {
        h += `<span class="ab-hint">${mouse ? 'Click or drag a box' : 'Tap a building · drag from it to grow the box'}</span><button data-ab="exit">Done</button>`;
      }
    } else if (t === 'paste') {
      h = `<span class="ab-label">📋 Paste</span>`;
      h += this.pasteAnchor ? `<button data-ab="confirm" class="primary">✓ Place</button>` : `<span class="ab-hint">Tap where it goes</span>`;
      h += `<button data-ab="rot">⟳</button><button data-ab="lib" title="Blueprint library">📐</button><button data-ab="exit">✕</button>`;
    }
    bar.hidden = !h;
    if (bar._h !== h) { bar.innerHTML = h; bar._h = h; }
  }
  actionBar(a) {
    if (a === 'confirm') this.confirmPending();
    else if (a === 'rot') this.rotate();
    else if (a === 'clear') { this.pending = null; this.input.updatePreview(); this.renderActionBar(); }
    else if (a === 'exit') this.setTool('inspect');
    else if (a === 'lib') this.ui.openPanel('blueprints');
  }
  setPending(tile) {
    const t = this.tool;
    if (t === 'build') this.pending = { start: tile, end: tile, axis: null };
    else if (t === 'remove' || t === 'copy') {
      const e = this.game.entityAt(tile[0], tile[1]);
      this.pending = e ? { base: { x: e.x, y: e.y, w: e.w, h: e.h }, end: tile } : { base: { x: tile[0], y: tile[1], w: 1, h: 1 }, end: tile };
    } else if (t === 'paste') { this.setPasteAnchor(tile); this.pending = true; }
    this.input.updatePreview(); this.renderActionBar();
  }
  confirmPending() {
    const t = this.tool;
    if (t === 'paste') { this.pasteAction('place'); return; }
    if (!this.pending) return;
    if (t === 'build' && !this.placeMany(this.input.pendingList())) return; // keep the ghost so it can be moved
    else if (t === 'remove') this.removeRect(this.input.pendingRect());
    else if (t === 'copy') { this.copyRect(this.input.pendingRect()); return; }
    this.pending = null;
    this.input.updatePreview(); this.renderActionBar();
  }
  entitiesIn(r) {
    const set = new Set();
    if (!r) return set;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const e = this.game.entityAt(x, y); if (e) set.add(e); }
    return set;
  }

  // Take everything a building has produced or stores (not its fuel or ingredients).
  collect(e, quiet) {
    const got = {};
    const add = (k, v) => { if (v > 0) got[k] = (got[k] || 0) + v; };
    if (e.out) for (const k of Object.keys(e.out)) { add(k, e.out[k]); delete e.out[k]; }
    if (e.kind === 'drill') { for (const [k, v] of Object.entries(e.buf)) add(k, v); e.buf = {}; }
    if (e.inv?.items && e.kind !== 'uplink') { for (const [k, v] of Object.entries(e.inv.items)) add(k, v); e.inv.items = {}; }
    const keys = Object.keys(got);
    if (keys.length) {
      this.game.giveAll(got);
      this.ui.toast(keys.map(k => `<img class="ic" src="${iconURL(k)}" alt=""> +${got[k]} ${nameOf(k)}`).join(' &nbsp; '), 'good');
    } else if (!quiet) this.ui.toast(`${e.def.name} has nothing to take`);
    return got;
  }

  inspectTile([x, y]) {
    const e = this.game.entityAt(x, y);
    if (e) this.ui.openEntity(e);
    else this.ui.openTile(x, y);
  }

  placeMany(list) {
    const g = this.game;
    let ok = 0, last = null;
    // tunnels: place entrance before exit
    for (const it of list) {
      const r = g.place(it.type, it.x, it.y, it.rot, { mode: it.mode });
      if (r.ok) { ok++; if (r.ent) applySettings(r.ent, it.settings); }
      else last = r.reason;
    }
    if (ok) this.ui.noteBuild(list[0].type);
    if (!ok && last) this.ui.toast(last, 'bad');
    else if (ok < list.length && last && list.length > 1) this.ui.toast(`Placed ${ok}/${list.length} — ${last}`);
    this.updateToolbar();
    if (!g.has(this.buildType) && this.tool === 'build') {
      // try auto-crafting more of what we're building
      const r = g.craft(this.buildType, 1);
      if (r.ok) this.ui.toast(`Out of ${nameOf(this.buildType)} — crafting more…`);
    }
    return ok;
  }
  removeRect(r, single) {
    const g = this.game;
    const set = new Set();
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const e = g.entityAt(x, y); if (e) set.add(e);
      const gid = g.ghostOcc[y * g.size + x]; if (gid) g.removeGhost(gid);
    }
    const doit = () => { for (const e of set) g.removeEntity(e); if (set.size > 1) this.ui.toast(`Removed ${set.size} entities`); };
    if (set.size > 25) this.ui.confirm(`Remove ${set.size} entities? Items are refunded.`, doit); else doit();
  }
  copyRect(r) {
    const bp = makeBlueprint(this.game, r);
    if (!bp) { this.ui.toast('Nothing to copy there', 'bad'); return; }
    this.blueprint = bp;
    this.pasteAnchor = null; this.pasteLocked = false;
    this.setTool('paste');
    this.ui.toast(`Copied ${bp.ents.length} entities — tap to position, then ✓`);
  }
  useBlueprint(i) {
    const b = this.blueprints[i];
    if (!b) return;
    this.blueprint = JSON.parse(JSON.stringify(b));
    this.pasteAnchor = null; this.pasteLocked = false;
    this.setTool('paste');
  }
  saveCurrentBlueprint() {
    if (!this.blueprint) return;
    const counts = {};
    for (const e of this.blueprint.ents) counts[e.type] = (counts[e.type] || 0) + 1;
    const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const name = `${BUILDINGS[main].name} block ${this.blueprint.w}×${this.blueprint.h}`;
    this.blueprints.unshift({ ...this.blueprint, name });
    this.saveBlueprints();
    this.ui.toast('Blueprint saved');
  }
  saveBlueprints() { store(BP_KEY, this.blueprints.slice(0, 40)); }
  setPasteAnchor([x, y]) {
    if (!this.blueprint) return;
    this.pasteAnchor = [x - Math.floor(this.blueprint.w / 2), y - Math.floor(this.blueprint.h / 2)];
  }
  pasteAction(a) {
    if (a === 'rot') { this.rotate(); return; }
    if (a === 'cancel') { this.setTool('inspect'); return; }
    if (a === 'lib') { this.ui.openPanel('blueprints'); return; }
    if (a === 'place') {
      if (!this.pasteAnchor) { this.ui.toast('Tap where to place the blueprint', 'bad'); return; }
      const g = this.game, [ax, ay] = this.pasteAnchor;
      const ents = [...this.blueprint.ents].sort((p, q) => (p.mode === 'out') - (q.mode === 'out'));
      let built = 0, ghosts = 0, blocked = 0;
      for (const en of ents) {
        const x = ax + en.dx, y = ay + en.dy;
        if (g.has(en.type)) {
          const r = g.place(en.type, x, y, en.rot, { mode: en.mode });
          if (r.ok) { built++; applySettings(r.ent, en.settings); continue; }
          if (r.reason !== 'Space occupied') { blocked++; continue; }
          blocked++; continue;
        }
        if (g.addGhost({ type: en.type, x, y, rot: en.rot, mode: en.mode, settings: en.settings })) ghosts++; else blocked++;
      }
      this.ui.toast(`Built ${built}${ghosts ? `, ${ghosts} ghosts waiting for items` : ''}${blocked ? `, ${blocked} blocked` : ''}`);
      this.input.updatePreview(); this.renderActionBar();
    }
  }

  // ----- persistence -----
  save() {
    try { store(SAVE_KEY, this.game.serialize()); } catch (e) { console.error(e); this.ui?.toast('Save failed: ' + e.message, 'bad'); }
  }
  loadData(data) {
    const g = Game.deserialize(data);
    this.swapGame(g);
  }
  newGame(seed) {
    const g = new Game({ seed });
    this.swapGame(g);
    this.save();
    this.ui.closePanel();
  }
  swapGame(g) {
    this.game = g;
    this.renderer.setGame(g);
    this.ui.bindGame();
    this.ui.recent = [];
    this.ui.renderHotbar();
    this.setTool('inspect');
  }
  applySettings() {
    try { store(SET_KEY, this.settings); } catch { }
    this.renderer.setGrid(this.settings.grid || this.tool === 'build');
    if (this.renderer.r.shadowMap.enabled !== this.settings.shadows) this.renderer.setShadows(this.settings.shadows);
    this.renderer.setIcons(this.settings.icons);
  }
}

// iOS Safari pinch-zooms the whole page unless its proprietary gesture events are cancelled.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

function load(k, def) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : def; } catch { return def; } }
function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { throw e; } }

// Boot; inside an artifact viewer, keep the running factory across page updates.
const hot = window.claude?.hot;
const start = (data) => {
  if (data?.save) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data.save)); } catch { } }
  const app = new App();
  hot?.snapshot?.(() => ({ save: app.game.serialize() }));
};
if (hot?.ready) hot.ready(start); else start(hot?.data ?? {});
