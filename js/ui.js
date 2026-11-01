// DOM user interface: HUD, panels, research tree, stats, planner.
import { ITEMS, FLUIDS, RECIPES, BUILDINGS, TECHS, PACKS, isFluid, nameOf, colorOf } from './data.js';
import { ORES, OIL } from './world.js';
import { BELTLIKE, holdCap } from './sim.js';
import { iconURL, iconImg, techIcon } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function fmt(n) {
  if (n === undefined || n === null || isNaN(n)) return '0';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k';
  if (a >= 100 || Number.isInteger(n)) return Math.round(n).toString();
  return n.toFixed(a >= 10 ? 1 : 2);
}
const fmtW = (kw) => kw >= 1000 ? (kw / 1000).toFixed(kw >= 1e4 ? 0 : 1) + ' MW' : Math.round(kw) + ' kW';
const chip = (id, n, cls = '') => `<span class="chip ${cls}" data-item="${id}" title="${esc(nameOf(id))}">${iconImg(id)}<b>${n !== undefined ? fmt(n) : ''}</b></span>`;

const STATUS_TEXT = {
  'working': ['Working', 'ok'], 'idle': ['Idle', 'warn'], 'no input': ['Waiting for input', 'warn'], 'no recipe': ['No recipe set', 'mute'],
  'no research': ['No research selected', 'mute'], 'depleted': ['Resource depleted', 'mute'], 'no power': ['No power', 'bad'], 'no fuel': ['Out of fuel', 'bad'],
  'no water': ['No water', 'bad'], 'low power': ['Low power', 'warn'], 'output full': ['Output full', 'warn'], 'blocked': ['Blocked', 'warn'],
};

function category(id) {
  const it = ITEMS[id];
  if (it.place) {
    const k = BUILDINGS[id].kind;
    if (['belt', 'underground', 'splitter', 'inserter', 'chest', 'uplink', 'downlink', 'pipe', 'upipe', 'pole'].includes(k)) return 'Logistics';
    if (['boiler', 'generator', 'solar', 'accumulator'].includes(k)) return 'Power';
    return 'Production';
  }
  if (PACKS.includes(id)) return 'Science';
  if (it.module) return 'Modules';
  return 'Intermediates';
}
const CATS = ['Logistics', 'Production', 'Power', 'Intermediates', 'Science', 'Modules'];

export const OBJECTIVES = [
  { t: 'Place a Burner Drill on iron ore', h: 'Tap 🔨 Build, choose Burner Drill, then tap on iron ore (blue-grey rocks). Use ⟳ to rotate — the arrow shows where ore comes out.', done: g => g.flags['placed:burner-drill'] },
  { t: 'Fuel it and mine 10 iron ore', h: 'Switch to 👆 Inspect, tap the drill and press "Add fuel". Coal is fuel. Place a Stone Furnace on the drill\'s output so ore drops straight in.', done: g => (g.totals['iron-ore'] || 0) >= 10 },
  { t: 'Smelt 20 iron plates', h: 'Furnaces pick their recipe from whatever arrives. Fuel the furnace too, then collect plates from it (Inspect → Take).', done: g => (g.totals['iron-plate'] || 0) >= 20 },
  { t: 'Mine 50 coal', h: 'Put drills on coal. Two coal drills facing each other refuel one another indefinitely. Tap an ore tile to mine by hand in a pinch.', done: g => (g.totals['coal'] || 0) >= 50 },
  { t: 'Generate electricity', h: 'Offshore Pump on a shore (arrow into water) → pipe → Boiler side port. Steam Engine on the Boiler\'s top port. Fuel the boiler and connect consumers with Utility Poles.', done: g => g.powerNets.some(n => n.gens.some(x => x.output > 0)) },
  { t: 'Research Automation', h: 'Craft a Lab and Kinetic Data. Power the lab, insert data (Inspect → Fill), then choose Automation in 🔬 Research.', done: g => g.research.done.has('automation') },
  { t: 'Automate Kinetic Data', h: 'An Assembler set to Kinetic Data, fed copper plates and gears by inserters. Chain: drill → furnace → inserter → assembler.', done: g => [...g.ents.values()].some(e => e.recipe === 'data-kinetic' && e.kind === 'assembler' && e.status === 'working') },
  { t: 'Research Logistic Data', h: 'Queue it in 🔬 Research. Prerequisites are queued automatically.', done: g => g.research.done.has('logistic-data') },
  { t: 'Produce 10 Logistic Data / min', h: 'Check 📊 Stats for live rates. The Planner tab tells you how many machines a target rate needs.', done: g => (g.rates('1m')['data-logistic']?.[0] || 0) >= 10 },
  { t: 'Research Oil Processing', h: 'Oil seeps are dark spots. Pumpjack → Refinery → petroleum gas + tar. Plan for the tar!', done: g => g.research.done.has('oil-processing') },
  { t: 'Make 100 plastic bars', h: 'Chemical Plant: petroleum gas + coal. Fluid inputs on top, outputs at the bottom.', done: g => (g.totals['plastic'] || 0) >= 100 },
  { t: 'Research Chemical Data', h: 'Needs engines, advanced circuits and sulfur. A long chain — consider Uplink chests to feed your inventory.', done: g => g.research.done.has('chemical-data') },
  { t: 'Research Structural Data', h: 'Aluminium, lightweight frames and concrete. Bauxite lies far to the north-west.', done: g => g.research.done.has('structural-data') },
  { t: 'Research Quantum Data', h: 'Photonic chips need processors, fiber and silicon. Modules and beacons will help hugely now.', done: g => g.research.done.has('quantum-data') },
  { t: 'Research Resonance Theory', h: 'A thousand units of all five data types. Scale up!', done: g => g.research.done.has('resonance') },
  { t: 'Activate the Resonance Gate', h: 'Build the Gate, power it with 5 MW and deliver 50 Resonator Cores.', done: g => g.won },
];

export class UI {
  constructor(app) {
    this.app = app;
    this.sheet = $('#sheet'); this.body = $('#sheet .sheet-body'); this.title = $('#sheet .sheet-title');
    this.panel = null; this.panelData = null; this.holdUntil = 0;
    this.recent = [];
    this.craftCat = 'Ready'; this.craftTab = 'craft'; this.statWin = '1m'; this.statTab = 'items';
    this.sel = null;
    $('#sheet .close').onclick = () => this.closePanel();
    this.sheet.addEventListener('pointerdown', () => { this.holdUntil = performance.now() + 700; });
    this.sheet.addEventListener('click', (e) => this.onClick(e));
    this.sheet.addEventListener('change', (e) => this.onChange(e));
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-open]');
      if (b) this.toggle(b.dataset.open);
      const t = e.target.closest('[data-tool]');
      if (t) this.app.toolButton(t.dataset.tool);
    });
    $('#hotbar').addEventListener('click', (e) => { const s = e.target.closest('[data-hot]'); if (s) this.hotbarPick(+s.dataset.hot); });
    $('#craftq').addEventListener('click', (e) => { const s = e.target.closest('[data-q]'); if (s) this.app.game.cancelCraft(+s.dataset.q); });
    $('#objective').addEventListener('click', () => $('#objective').classList.toggle('open'));
    $('#actionbar').addEventListener('click', (e) => { const b = e.target.closest('[data-ab]'); if (b) this.app.actionBar(b.dataset.ab); });
    $('#modal').addEventListener('click', (e) => this.onModalClick(e));
    setInterval(() => this.tick(), 250);
    this.bindGame();
  }
  bindGame() {
    const g = this.app.game;
    g.on('inv', () => { this.invDirty = true; });
    g.on('craft', () => { this.queueDirty = true; });
    g.on('tech', (id) => this.toast(`Research complete: <b>${esc(TECHS[id].name)}</b>`, 'good'));
    g.on('victory', () => this.victory());
  }

  // ---------- toasts / modals ----------
  toast(html, cls = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + cls; d.innerHTML = html;
    $('#toasts').appendChild(d);
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3100);
    while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  }
  modal(html, handlers = {}) {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card">${html}</div>`;
    m.hidden = false;
    this.modalHandlers = handlers;
  }
  closeModal() { $('#modal').hidden = true; this.modalHandlers = null; }
  onModalClick(e) {
    if (e.target.id === 'modal') { this.closeModal(); return; }
    const b = e.target.closest('[data-m]');
    if (!b) return;
    const h = this.modalHandlers?.[b.dataset.m];
    if (h) h(b.dataset.v, b); else this.closeModal();
  }
  confirm(text, yes) {
    this.modal(`<p>${text}</p><div class="row end"><button data-m="no" class="btn">Cancel</button><button data-m="yes" class="btn primary">OK</button></div>`,
      { yes: () => { this.closeModal(); yes(); }, no: () => this.closeModal() });
  }
  pickItem(title, ids, cb, allowNone = true) {
    const html = `<h3>${esc(title)}</h3><div class="grid">${allowNone ? `<button class="cell" data-m="pick" data-v=""><span class="none">∅</span><small>None</small></button>` : ''}${ids.map(id => `<button class="cell" data-m="pick" data-v="${id}">${iconImg(id)}<small>${esc(nameOf(id))}</small></button>`).join('')}</div>`;
    this.modal(html, { pick: (v) => { this.closeModal(); cb(v || null); } });
  }
  victory() {
    const t = this.app.game.time;
    this.modal(`<div class="victory"><img src="${iconURL('resonance-gate')}"><h2>Resonance Achieved</h2><p>The Gate hums to life after ${Math.floor(t / 3600)}h ${Math.floor(t / 60) % 60}m of play. Your factory has reached the stars.</p><p>Deep Mining remains repeatable — keep optimising.</p><div class="row end"><button class="btn primary" data-m="ok">Continue</button></div></div>`);
  }

  // ---------- panels ----------
  panelOpen() { return !this.sheet.hidden; }
  toggle(name) { if (this.panel === name && this.panelOpen()) this.closePanel(); else this.openPanel(name); }
  openPanel(name, data) {
    this.panel = name; this.panelData = data;
    this.sheet.hidden = false;
    this.sheet.className = 'sheet sheet-' + name;
    this.renderPanel(true);
    document.querySelectorAll('[data-open]').forEach(b => b.classList.toggle('active', b.dataset.open === name));
  }
  closePanel() {
    this.sheet.hidden = true; this.panel = null;
    this.app.renderer.setSelection(null);
    this.sel = null;
    document.querySelectorAll('[data-open]').forEach(b => b.classList.remove('active'));
  }
  renderPanel(first) {
    const fn = this['p_' + this.panel];
    if (!fn) return;
    const scroll = this.body.scrollTop;
    const r = fn.call(this, this.panelData, first);
    if (r === false) return; // panel handles its own DOM
    if (typeof r === 'object') { this.title.innerHTML = r.title; if (r.html !== this._lastHtml || first) { this.body.innerHTML = r.html; this._lastHtml = r.html; } }
    if (!first) this.body.scrollTop = scroll;
    if (r?.after) r.after();
  }

  tick() {
    const g = this.app.game;
    this.updateHud();
    if (this.panelOpen() && performance.now() > this.holdUntil && !['research', 'help', 'menu', 'blueprints'].includes(this.panel)) {
      if (this.panel === 'entity' && !g.ents.has(this.panelData?.id)) { this.closePanel(); return; }
      this.renderPanel(false);
    }
    // objectives
    const o = OBJECTIVES[g.objectiveIdx];
    if (o && o.done(g)) {
      g.objectiveIdx++;
      this.toast(`✔ Objective complete: ${esc(o.t)}`, 'good');
      this.objDirty = true;
    }
  }

  updateHud() {
    const g = this.app.game;
    // research mini
    const t = g.research.current && TECHS[g.research.current];
    const rm = $('#research-mini');
    if (t) {
      const p = g.research.progress / g.techCount(g.research.current);
      rm.innerHTML = `<img src="${techIcon(t)}"><div class="rm-txt"><span>${esc(t.name)}${g.research.queue.length ? ` <i>+${g.research.queue.length}</i>` : ''}</span><div class="bar"><div style="width:${(p * 100).toFixed(1)}%"></div></div></div>`;
    } else rm.innerHTML = `<span class="rm-none">🔬 Choose research</span>`;
    // power mini: largest network
    let best = null;
    for (const n of g.powerNets) if (!best || n.consumers.length > best.consumers.length) best = n;
    const pm = $('#power-mini');
    if (best && (best.gens.length || best.solars.length || best.consumers.length)) {
      const sat = best.sat;
      pm.className = sat >= 0.99 ? 'ok' : sat > 0.5 ? 'warn' : 'bad';
      pm.innerHTML = `⚡ ${fmtW(best.demand)} <small>/ ${fmtW(best.cap + (best.acc < 0 ? -best.acc : 0))}</small>`;
      pm.hidden = false;
    } else pm.hidden = true;
    $('#speed-mini').textContent = this.app.paused ? '⏸' : this.app.speed > 1 ? `${this.app.speed}×` : '';
    // day/night
    $('#clock').textContent = g.sun > 0.5 ? '☀' : g.sun > 0.05 ? '⛅' : '☾';
    // objective
    const o = OBJECTIVES[g.objectiveIdx];
    const ob = $('#objective');
    if (o) {
      const html = `<div class="ob-t"><span>🎯</span> ${esc(o.t)}</div><div class="ob-h">${esc(o.h)}</div>`;
      if (ob._h !== html) { ob.innerHTML = html; ob._h = html; }
      ob.hidden = false;
    } else ob.hidden = true;
    if (this.invDirty) { this.invDirty = false; this.renderHotbar(); }
    if (this.queueDirty || g.craftQueue.length) { this.queueDirty = false; this.renderQueue(); }
  }

  noteBuild(type) {
    this.recent = [type, ...this.recent.filter(t => t !== type)].slice(0, 9);
    this.renderHotbar();
  }
  renderHotbar() {
    const g = this.app.game;
    // fill with recent, then other buildings in inventory
    const list = [...this.recent];
    for (const id of Object.keys(g.inv)) if (ITEMS[id]?.place && !list.includes(id) && list.length < 9) list.push(id);
    this.hot = list;
    $('#hotbar').innerHTML = list.map((id, i) => `<button class="hot ${this.app.buildType === id && this.app.tool === 'build' ? 'sel' : ''} ${g.inv[id] ? '' : 'empty'}" data-hot="${i}">${iconImg(id)}<b>${fmt(g.inv[id] || 0)}</b></button>`).join('');
  }
  hotbarPick(i) {
    const id = this.hot?.[i];
    if (!id) return;
    if (!this.app.game.has(id)) {
      const r = this.app.game.craft(id, 1);
      if (!r.ok) { this.toast(`No ${esc(nameOf(id))} — ${r.missing ? 'missing ' + Object.keys(r.missing).map(nameOf).join(', ') : 'cannot craft'}`, 'bad'); return; }
      this.toast(`Crafting ${esc(nameOf(id))}…`);
    }
    this.app.setBuild(id);
  }
  renderQueue() {
    const g = this.app.game;
    $('#craftq').innerHTML = g.craftQueue.slice(0, 6).map((q, i) => {
      const r = RECIPES[q.rid]; const o = Object.keys(r.out)[0];
      return `<button class="qi" data-q="${i}">${iconImg(o)}<b>${q.n}</b>${i === 0 ? `<div class="qbar" style="width:${(q.progress * 100).toFixed(0)}%"></div>` : ''}</button>`;
    }).join('') + (g.craftQueue.length > 6 ? `<span class="qmore">+${g.craftQueue.length - 6}</span>` : '');
  }

  onChange(e) {
    const t = e.target;
    if (t.dataset.act) this.act(t.dataset.act, t.dataset.v ?? t.value, t);
  }
  onClick(e) {
    const b = e.target.closest('[data-act]');
    if (b && b.tagName !== 'SELECT' && b.tagName !== 'INPUT') { this.act(b.dataset.act, b.dataset.v, b); return; }
    const it = e.target.closest('[data-item]');
    if (it) this.showRecipeInfo(it.dataset.item);
  }

  act(a, v, el) {
    const app = this.app, g = app.game;
    const e = this.panelData && g.ents.get(this.panelData.id);
    switch (a) {
      // craft
      case 'cat': this.craftCat = v; break;
      case 'ctab': this.craftTab = v; break;
      case 'csel': this.craftSel = v; break;
      case 'craft': {
        const [rid, n] = v.split(':');
        let times = n === 'max' ? this.maxCraftable(rid) : +n;
        if (times <= 0) times = 1;
        const r = g.craft(rid, times);
        if (!r.ok) this.toast(r.missing ? 'Missing ' + Object.entries(r.missing).map(([k, q]) => `${fmt(q)} ${iconImg(k)} ${esc(nameOf(k))} — ${this.howToGet(k)}`).join('<br>') : r.reason, 'bad');
        else this.toast(`${iconImg(Object.keys(RECIPES[rid].out)[0])} Crafting ${times}× ${esc(RECIPES[rid].name)}`);
        if (this.panel === 'craft') { this.refreshCraft(true); return; }
        break;
      }
      case 'cancelq': g.cancelCraft(+v); if (this.panel === 'craft') { this.refreshCraft(true); return; } break;
      case 'iteminfo': this.showRecipeInfo(v); return;
      case 'usebuild': app.setBuild(v); this.closePanel(); return;
      case 'buildpick': {
        if (!g.has(v)) {
          const r = g.craft(v, 1);
          if (!r.ok) { this.toast('Missing: ' + Object.entries(r.missing || {}).map(([k, q]) => `${fmt(q)} ${esc(nameOf(k))}`).join(', '), 'bad'); return; }
          this.toast(`Crafting ${esc(nameOf(v))}…`);
        }
        app.setBuild(v); this.closePanel(); return;
      }
      // research
      case 'tsel': this.techSel = v; this.renderTechDetail(); return;
      case 'tnow': g.setResearch(v); this.renderResearchCards(); this.renderTechDetail(); return;
      case 'tq': g.enqueueResearch(v); this.renderResearchCards(); this.renderTechDetail(); return;
      case 'tclear': g.setResearch(null); this.renderResearchCards(); this.renderTechDetail(); return;
      // stats
      case 'swin': this.statWin = v; break;
      case 'stab': this.statTab = v; break;
      case 'plan-item': this.planItem = v || null; break;
      case 'plan-rate': this.planRate = Math.max(0.1, +v || 60); break;
      case 'plan-pick': this.pickItem('Plan production of…', this.plannable(), (id) => { if (id) { this.planItem = id; this.renderPanel(true); } }, false); return;
      // entity
      case 'fuel': if (e) this.addFuel(e); break;
      case 'fill': if (e) this.fillFromInv(e); break;
      case 'take': if (e) this.app.collect(e); break;
      case 'takeone': if (e) this.takeOne(e, v); break;
      case 'rotate': if (e) { g.rotateEntity(e); this.app.renderer.setSelection(g.ents.get(e.id)); } break;
      case 'pickup': if (e) { g.removeEntity(e); this.closePanel(); return; } break;
      case 'recipe': if (e) this.pickRecipe(e); return;
      case 'mod': if (e) this.pickModule(e, +v); return;
      case 'filter': if (e) this.pickItem('Filter item', this.knownItems(), (id) => { e.filter = id; this.renderPanel(true); }); return;
      case 'prio': if (e) { e.priority = v || null; } break;
      case 'target': if (e) { e.target = Math.max(0, Math.min(e.inv.slots * ITEMS[e.filter || 'iron-plate'].stack, +v)); } break;
      case 'flush': if (e?.fnet) { e.fnet.amount = 0; e.fnet.fluid = null; } break;
      case 'mine': {
        const [x, y] = this.panelData.tile;
        g.handMine = g.handMine && g.handMine.x === x && g.handMine.y === y ? null : { x, y, progress: 0 };
        break;
      }
      case 'cancelghost': g.removeGhost(+v); this.closePanel(); return;
      // menu
      case 'save': app.save(); this.toast('Game saved'); return;
      case 'export': this.exportSave(); return;
      case 'import': this.importSave(); return;
      case 'newgame': this.confirm('Start a new game? Your current factory will be lost unless exported.', () => app.newGame(+($('#seed-in')?.value) || undefined)); return;
      case 'speed': app.speed = +v; break;
      case 'grid': app.settings.grid = !app.settings.grid; app.applySettings(); break;
      case 'set': app.settings[v] = !app.settings[v]; app.applySettings(); break;
      case 'help': this.openPanel('help'); return;
      case 'bpuse': app.useBlueprint(+v); this.closePanel(); return;
      case 'bpdel': app.blueprints.splice(+v, 1); app.saveBlueprints(); break;
      case 'bpsave': app.saveCurrentBlueprint(); break;
    }
    this.renderPanel(true);
  }

  // ----- craft panel -----
  maxCraftable(rid) {
    let lo = 0, hi = 500;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.app.game.planCraft(rid, m).steps) lo = m; else hi = m - 1; }
    return lo;
  }
  // How the player gets an item they can't hand-craft yet.
  howToGet(id) {
    if (['iron-ore', 'copper-ore', 'coal', 'stone', 'quartz', 'bauxite'].includes(id)) return 'mine it (tap ore, or build a drill)';
    const rid = this.recipeFor(id);
    if (!rid) return 'not available yet';
    const r = RECIPES[rid];
    if (!this.app.game.unlocked.has(rid)) return 'locked — research it first';
    return { smelt: 'smelt it in a furnace', chem: 'make it in a Chemical Plant', refine: 'make it in an Oil Refinery', 'craft-fluid': 'make it in an Assembler II', craft: 'craft it' }[r.cat];
  }
  craftRows(list) {
    const g = this.app.game;
    return list.map(rid => {
      const r = RECIPES[rid], o = Object.keys(r.out)[0];
      const n = this.maxCraftable(rid);
      const ings = Object.entries(r.in).map(([k, v]) => {
        const have = g.inv[k] || 0;
        const cls = have >= v ? '' : (this.app.game.planCraft(this.recipeFor(k) || k, 1).steps && this.recipeFor(k) && RECIPES[this.recipeFor(k)].hand ? 'auto' : 'short');
        return `<span class="chip ${cls}" data-item="${k}" title="${esc(nameOf(k))}: have ${have}">${iconImg(k)}<b>${v}</b></span>`;
      }).join('');
      const out = r.out[o] > 1 ? ` <small>×${r.out[o]}</small>` : '';
      return `<div class="crow ${n ? '' : 'none'}">${iconImg(o)}<div class="cinfo"><span class="cname">${esc(r.name)}${out} <small>· have ${fmt(g.inv[o] || 0)}${n ? ` · can make ${n >= 500 ? '500+' : n}` : ''}</small></span><span class="cings">${ings}</span></div>
        <div class="cbtns"><button data-act="craft" data-v="${rid}:1">+1</button><button data-act="craft" data-v="${rid}:5">+5</button></div></div>`;
    }).join('');
  }
  machineRows(list) {
    return list.map(rid => {
      const r = RECIPES[rid], o = Object.keys(r.out).find(k => ITEMS[k]) || Object.keys(r.out)[0];
      const where = { smelt: 'Furnace', chem: 'Chemical Plant', refine: 'Oil Refinery', 'craft-fluid': 'Assembler II+' }[r.cat];
      return `<div class="crow none" data-item="${o}">${iconImg(o)}<div class="cinfo"><span class="cname">${esc(r.name)}</span><span class="cings">${Object.entries(r.in).map(([k, v]) => chip(k, v)).join('')}</span></div><span class="cmach">needs a<br>${where}</span></div>`;
    }).join('');
  }
  craftQueueHtml() {
    const g = this.app.game;
    return g.craftQueue.map((q, i) => {
      const o = Object.keys(RECIPES[q.rid].out)[0];
      return `<button class="qi" data-act="cancelq" data-v="${i}" title="Cancel">${iconImg(o)}<b>${q.n}</b>${i === 0 ? `<div class="qbar" style="width:${(q.progress * 100).toFixed(0)}%"></div>` : ''}</button>`;
    }).join('');
  }
  craftListHtml() {
    const g = this.app.game;
    const hand = [...g.unlocked].filter(r => RECIPES[r].hand);
    const outCat = (rid) => category(Object.keys(RECIPES[rid].out).find(k => ITEMS[k]) || 'iron-plate');
    const q = (this.craftQuery || '').trim().toLowerCase();
    let list, machines = [];
    if (q) {
      list = hand.filter(r => RECIPES[r].name.toLowerCase().includes(q));
      machines = [...g.unlocked].filter(r => !RECIPES[r].hand && RECIPES[r].name.toLowerCase().includes(q));
    } else if (this.craftCat === 'Ready') {
      list = hand.filter(r => g.planCraft(r, 1).steps);
    } else {
      list = hand.filter(r => outCat(r) === this.craftCat);
      machines = [...g.unlocked].filter(r => !RECIPES[r].hand && outCat(r) === this.craftCat);
    }
    let h = list.length ? this.craftRows(list) : `<p class="mute small pad">${this.craftCat === 'Ready' && !q ? 'Nothing can be crafted from what you carry. Mine ore by tapping it, or collect plates from a furnace (long-press it).' : 'No matching recipes.'}</p>`;
    if (machines.length) h += `<h4>Made in machines</h4>` + this.machineRows(machines);
    return h;
  }
  p_craft(_, first) {
    const g = this.app.game;
    const tabs = `<div class="tabs"><button data-act="ctab" data-v="craft" class="${this.craftTab === 'craft' ? 'on' : ''}">Crafting</button><button data-act="ctab" data-v="inv" class="${this.craftTab === 'inv' ? 'on' : ''}">Inventory</button></div>`;
    if (this.craftTab === 'inv') {
      const ids = Object.keys(g.inv).filter(k => g.inv[k] > 0).sort((a, b) => CATS.indexOf(category(a)) - CATS.indexOf(category(b)));
      return { title: '🎒 Inventory', html: tabs + `<div class="grid inv">${ids.map(id => `<button class="cell" data-act="${ITEMS[id].place ? 'usebuild' : 'iteminfo'}" data-v="${id}" title="${esc(nameOf(id))}">${iconImg(id)}<b>${fmt(g.inv[id])}</b></button>`).join('') || '<p class="mute">Empty</p>'}</div><p class="mute small">Tap a building to place it; tap anything else to see how it's made.</p>` };
    }
    if (first) {
      if (!this.craftCat) this.craftCat = 'Ready';
      const cats = ['Ready', ...CATS];
      this.title.innerHTML = '🛠 Crafting';
      this.body.innerHTML = tabs + `<div class="craft-top"><input id="craft-search" type="search" placeholder="Search recipes…" value="${esc(this.craftQuery || '')}" autocomplete="off"></div>
        <div class="cq" id="craft-q"></div>
        <div class="tabs small">${cats.map(c => `<button data-act="cat" data-v="${c}" class="${c === this.craftCat ? 'on' : ''}">${c === 'Ready' ? '✓ Ready' : c}</button>`).join('')}</div>
        <div class="clist" id="craft-list"></div>
        <div class="clegend"><span><i style="background:var(--line)"></i>have it</span><span><i style="background:#8a7a2a"></i>crafted automatically</span><span><i style="background:var(--bad)"></i>missing</span></div>
        <p class="mute small">Intermediate parts are crafted for you. Tap any ingredient to see how it's made. Tap a queued item above to cancel it.</p>`;
      this._lastHtml = null;
      const inp = $('#craft-search');
      inp.addEventListener('input', () => { this.craftQuery = inp.value; this.refreshCraft(true); });
    }
    this.refreshCraft(first);
    return false;
  }
  refreshCraft(force) {
    const ql = $('#craft-q'), cl = $('#craft-list');
    if (!cl) return;
    const now = performance.now();
    if (!force && now - (this._craftT || 0) < 480) return; // the planner runs per row; keep phones cool
    this._craftT = now;
    const qh = this.craftQueueHtml();
    if (ql._h !== qh) { ql.innerHTML = qh; ql._h = qh; }
    const lh = this.craftListHtml();
    if (force || cl._h !== lh) { cl.innerHTML = lh; cl._h = lh; }
  }

  // ----- build panel -----
  p_build() {
    const g = this.app.game;
    const ids = Object.keys(BUILDINGS).filter(id => g.unlocked.has(id) || g.inv[id]);
    let html = '';
    for (const c of ['Logistics', 'Production', 'Power']) {
      const l = ids.filter(id => category(id) === c);
      if (!l.length) continue;
      html += `<h4>${c}</h4><div class="grid">${l.map(id => {
        const n = g.inv[id] || 0;
        const can = n || g.planCraft(id, 1).steps;
        return `<button class="cell ${can ? '' : 'dim'} ${this.app.buildType === id ? 'sel' : ''}" data-act="buildpick" data-v="${id}" title="${esc(BUILDINGS[id].name)}">${iconImg(id)}<b>${n ? fmt(n) : (can ? '+' : '')}</b><small>${esc(BUILDINGS[id].name)}</small></button>`;
      }).join('')}</div>`;
    }
    return { title: '🔨 Build', html: html + `<p class="mute small pad">Drag to place lines (belts and pipes turn corners). Two fingers pan & zoom. "+" crafts one first.</p>` };
  }

  // ----- research panel -----
  layoutTech() {
    if (this.techLayout) return this.techLayout;
    const depth = {};
    const dep = (id) => depth[id] ?? (depth[id] = TECHS[id].prereq.length ? 1 + Math.max(...TECHS[id].prereq.map(dep)) : 0);
    Object.keys(TECHS).forEach(dep);
    const cols = [];
    for (const [id, d] of Object.entries(depth)) (cols[d] ||= []).push(id);
    const row = {};
    cols.forEach((col, ci) => {
      if (ci > 0) col.sort((a, b) => avg(a) - avg(b));
      col.forEach((id, i) => { row[id] = i; });
      // relax rows to be near parents
      let last = -1;
      col.forEach((id) => { const want = ci ? Math.round(avg(id)) : row[id]; row[id] = Math.max(last + 1, want); last = row[id]; });
    });
    function avg(id) { const p = TECHS[id].prereq; return p.length ? p.reduce((s, q) => s + (row[q] ?? 0), 0) / p.length : 0; }
    const CW = 176, RH = 74, PAD = 12;
    const pos = {};
    let maxR = 0;
    cols.forEach((col, ci) => col.forEach(id => { pos[id] = [PAD + ci * CW, PAD + row[id] * RH]; maxR = Math.max(maxR, row[id]); }));
    return (this.techLayout = { pos, w: PAD * 2 + cols.length * CW, h: PAD * 2 + (maxR + 1) * RH, CW, RH });
  }
  p_research(_, first) {
    if (!first) return false;
    const L = this.layoutTech();
    this.title.innerHTML = '🔬 Research';
    this.body.innerHTML = `<div class="rq" id="rq"></div><div class="tree-wrap" id="treewrap"><div class="tree" style="width:${L.w}px;height:${L.h}px"><svg width="${L.w}" height="${L.h}" id="treesvg"></svg><div id="treecards"></div></div></div><div class="tdetail" id="tdetail"></div>`;
    this._lastHtml = null;
    this.renderResearchCards();
    this.renderTechDetail();
    const g = this.app.game;
    const focus = g.research.current || Object.keys(TECHS).find(t => g.techAvailable(t));
    if (focus) { const [x, y] = L.pos[focus]; const w = $('#treewrap'); w.scrollLeft = x - w.clientWidth / 2 + 80; w.scrollTop = y - w.clientHeight / 2 + 30; }
    return false;
  }
  techState(id) {
    const g = this.app.game;
    if (g.research.current === id) return 'cur';
    if (g.research.done.has(id) && !TECHS[id].infinite) return 'done';
    if (g.research.queue.includes(id)) return 'queued';
    if (g.techAvailable(id)) return 'avail';
    return 'locked';
  }
  renderResearchCards() {
    const L = this.layoutTech(), g = this.app.game;
    const svg = $('#treesvg'), cards = $('#treecards');
    if (!svg) return;
    let lines = '';
    for (const [id, t] of Object.entries(TECHS)) {
      const [x1, y1] = L.pos[id];
      for (const p of t.prereq) {
        const [x0, y0] = L.pos[p];
        const done = g.research.done.has(p);
        lines += `<path d="M${x0 + 150},${y0 + 30} C${x0 + 166},${y0 + 30} ${x1 - 16},${y1 + 30} ${x1},${y1 + 30}" class="${done ? 'ldone' : ''}"/>`;
      }
    }
    svg.innerHTML = lines;
    cards.innerHTML = Object.entries(TECHS).map(([id, t]) => {
      const [x, y] = L.pos[id];
      const st = this.techState(id);
      const prog = st === 'cur' ? g.research.progress / g.techCount(id) : 0;
      const lvl = t.infinite && g.research.levels[id] ? ` ${g.research.levels[id] + 1}` : '';
      return `<button class="tcard ${st} ${this.techSel === id ? 'sel' : ''}" style="left:${x}px;top:${y}px" data-act="tsel" data-v="${id}"><img src="${techIcon(t)}"><span class="tn">${esc(t.name)}${lvl}</span><span class="tp">${Object.keys(t.cost).map(p => `<i style="background:${colorOf(p)}"></i>`).join('')}</span>${st === 'cur' ? `<div class="tbar" style="width:${prog * 100}%"></div>` : ''}</button>`;
    }).join('');
    const q = [g.research.current, ...g.research.queue].filter(Boolean);
    $('#rq').innerHTML = q.length ? `<span class="mute small">Queue:</span>${q.map(id => `<button class="qchip" data-act="tsel" data-v="${id}"><img src="${techIcon(TECHS[id])}">${esc(TECHS[id].name)}</button>`).join('')}<button class="btn tiny" data-act="tclear">Clear</button>` : `<span class="mute small">Nothing queued — pick a glowing technology.</span>`;
  }
  renderTechDetail() {
    const d = $('#tdetail'); if (!d) return;
    const id = this.techSel, g = this.app.game;
    if (!id) { d.innerHTML = `<p class="mute small">Tap a technology for details. Researching a locked tech queues its prerequisites automatically.</p>`; return; }
    const t = TECHS[id], st = this.techState(id);
    const cnt = g.techCount(id);
    const unl = t.unlocks.map(u => chip(Object.keys(RECIPES[u].out)[0])).join('');
    const eff = t.effects.map(e => `<span class="eff">${{ 'mining-prod': 'Mining productivity', 'lab-speed': 'Research speed', 'craft-speed': 'Hand-craft speed', 'stack-bonus': 'Stack inserter capacity' }[e.type]} +${e.type === 'stack-bonus' ? e.value : Math.round(e.value * 100) + '%'}</span>`).join('');
    d.innerHTML = `<div class="dt"><img src="${techIcon(t)}" class="ic"><div><b>${esc(t.name)}</b><small>${esc(t.desc || '')}</small></div></div>
      <div class="row wrap"><span class="mute small">Cost: ${cnt} ×</span>${Object.keys(t.cost).map(p => chip(p, 1)).join('')}<span class="mute small">· ${t.time}s each</span></div>
      ${t.prereq.length ? `<div class="row wrap"><span class="mute small">Requires:</span>${t.prereq.map(p => `<button class="qchip ${g.research.done.has(p) ? 'ok' : ''}" data-act="tsel" data-v="${p}">${esc(TECHS[p].name)}</button>`).join('')}</div>` : ''}
      ${unl || eff ? `<div class="row wrap"><span class="mute small">Unlocks:</span>${unl}${eff}</div>` : ''}
      <div class="row">${st === 'done' ? '<span class="ok">✔ Researched</span>' : st === 'cur' ? `<span class="ok">Researching… ${fmt(g.research.progress)}/${cnt}</span>` : `<button class="btn primary" data-act="tnow" data-v="${id}">Research now</button><button class="btn" data-act="tq" data-v="${id}">Add to queue</button>`}</div>`;
  }

  // ----- stats panel -----
  p_stats() {
    const g = this.app.game;
    const tabs = `<div class="tabs">${[['items', 'Production'], ['power', 'Power'], ['planner', 'Planner']].map(([k, n]) => `<button data-act="stab" data-v="${k}" class="${this.statTab === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    let html = tabs;
    if (this.statTab === 'items') {
      const rates = g.rates(this.statWin);
      const rows = Object.entries(rates).filter(([, v]) => v[0] > 0.01 || v[1] > 0.01).sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]));
      const max = Math.max(1, ...rows.map(([, v]) => Math.max(v[0], v[1])));
      html += `<div class="tabs small"><button data-act="swin" data-v="1m" class="${this.statWin === '1m' ? 'on' : ''}">Last minute</button><button data-act="swin" data-v="10m" class="${this.statWin === '10m' ? 'on' : ''}">Last 10 min</button></div>`;
      html += `<table class="stats"><tr><th></th><th>Made /min</th><th>Used /min</th></tr>${rows.map(([id, [p, c]]) => `<tr><td>${iconImg(id)}<span>${esc(nameOf(id))}</span></td><td><div class="sbar p" style="width:${(p / max) * 100}%"></div><b>${fmt(p)}</b></td><td><div class="sbar c" style="width:${(c / max) * 100}%"></div><b>${fmt(c)}</b></td></tr>`).join('')}</table>`;
      if (!rows.length) html += `<p class="mute pad">No production yet.</p>`;
    } else if (this.statTab === 'power') {
      const nets = g.powerNets.filter(n => n.consumers.length || n.gens.length || n.solars.length);
      html += nets.length ? nets.map((n, i) => {
        const acc = n.accs.reduce((s, a) => s + a.charge, 0), accCap = n.accs.reduce((s, a) => s + a.def.capacity, 0);
        return `<div class="pnet"><b>Network ${i + 1}</b> <span class="${n.sat >= 0.99 ? 'ok' : n.sat > 0.5 ? 'warn' : 'bad'}">${Math.round(n.sat * 100)}% satisfied</span>
        <div class="kv"><span>Demand</span><b>${fmtW(n.demand)}</b><span>Generation capacity</span><b>${fmtW(n.cap)}</b><span>Steam engines</span><b>${n.gens.length}</b><span>Solar panels</span><b>${n.solars.length} (${fmtW(n.solarOut || 0)})</b><span>Accumulators</span><b>${n.accs.length ? `${fmt(acc / 1000)} / ${fmt(accCap / 1000)} MJ` : '—'}</b><span>Consumers</span><b>${n.consumers.length}</b></div></div>`;
      }).join('') : `<p class="mute pad">No power networks.</p>`;
      html += `<p class="mute small pad">Daylight: ${Math.round(g.sun * 100)}%. A day lasts ${Math.round(g.dayLength / 60)} minutes.</p>`;
    } else html += this.plannerHtml();
    return { title: '📊 Statistics', html };
  }
  plannable() {
    const g = this.app.game; const s = new Set();
    for (const rid of g.unlocked) for (const o of Object.keys(RECIPES[rid].out)) s.add(o);
    return [...s].filter(x => ITEMS[x]);
  }
  bestMachine(cat) {
    const g = this.app.game;
    const cands = Object.entries(BUILDINGS).filter(([id, b]) => b.cats?.includes(cat) && g.unlocked.has(id));
    cands.sort((a, b) => b[1].speed - a[1].speed);
    return cands[0]?.[0] || Object.entries(BUILDINGS).find(([, b]) => b.cats?.includes(cat))?.[0];
  }
  recipeFor(item) {
    const g = this.app.game;
    if (g.unlocked.has(item) && RECIPES[item]?.out[item]) return item;
    for (const rid of g.unlocked) if (RECIPES[rid].out[item]) return rid;
    for (const [rid, r] of Object.entries(RECIPES)) if (r.out[item]) return rid;
    return null;
  }
  plannerHtml() {
    const item = this.planItem || 'data-kinetic';
    const rate = this.planRate || 60;
    const raw = {}, byp = {};
    const rows = [];
    const visit = (id, perMin, depth) => {
      const RAW = ['iron-ore', 'copper-ore', 'coal', 'stone', 'quartz', 'bauxite', 'water', 'crude-oil'];
      const rid = RAW.includes(id) ? null : this.recipeFor(id);
      if (!rid || depth > 12) { raw[id] = (raw[id] || 0) + perMin; return; }
      const r = RECIPES[rid];
      const m = this.bestMachine(r.cat);
      const speed = BUILDINGS[m]?.speed || 1;
      const crafts = perMin / r.out[id];
      const machines = crafts / ((60 / r.time) * speed);
      rows.push({ depth, id, rid, m, machines, perMin });
      for (const [o, n] of Object.entries(r.out)) if (o !== id) byp[o] = (byp[o] || 0) + n * crafts;
      for (const [k, v] of Object.entries(r.in)) visit(k, v * crafts, depth + 1);
    };
    visit(item, rate, 0);
    // aggregate rows by recipe for the summary
    const agg = {};
    for (const r of rows) { const a = agg[r.rid] || (agg[r.rid] = { ...r, machines: 0, perMin: 0 }); a.machines += r.machines; a.perMin += r.perMin; a.depth = Math.min(a.depth, r.depth); }
    const list = Object.values(agg).sort((a, b) => a.depth - b.depth);
    return `<div class="planner"><div class="row wrap"><button class="btn" data-act="plan-pick">${iconImg(item)} ${esc(nameOf(item))} ▾</button><label class="small">at <input type="number" min="0.1" step="any" value="${rate}" data-act="plan-rate" class="num"> /min</label></div>
      <table class="stats plan"><tr><th>Product</th><th>/min</th><th>Machines</th></tr>${list.map(r => `<tr><td style="padding-left:${6 + r.depth * 10}px">${iconImg(r.id)}<span>${esc(nameOf(r.id))}</span></td><td><b>${fmt(r.perMin)}</b></td><td>${iconImg(r.m)}<b>${r.machines.toFixed(2)}</b></td></tr>`).join('')}</table>
      <h4>Raw resources /min</h4><div class="ings">${Object.entries(raw).map(([k, v]) => chip(k, v)).join('')}</div>
      ${Object.keys(byp).length ? `<h4>By-products /min</h4><div class="ings">${Object.entries(byp).map(([k, v]) => chip(k, v)).join('')}</div>` : ''}
      <p class="mute small">Uses the fastest unlocked machine for each step, no modules. Electric drills mine 30 ore/min; a basic belt carries 450 items/min.</p></div>`;
  }

  // ----- menu / help -----
  p_menu() {
    const app = this.app;
    return { title: '☰ Menu', html: `<div class="menu">
      <button class="btn wide" data-act="save">💾 Save now</button>
      <div class="row"><button class="btn" data-act="export">⬆ Export save</button><button class="btn" data-act="import">⬇ Import save</button></div>
      <h4>Game speed</h4><div class="row">${[1, 2, 4].map(s => `<button class="btn ${app.speed === s ? 'primary' : ''}" data-act="speed" data-v="${s}">${s}×</button>`).join('')}</div>
      <h4>Display</h4><div class="row"><button class="btn ${app.settings.grid ? 'primary' : ''}" data-act="grid">Grid overlay</button><button class="btn ${app.settings.icons ? 'primary' : ''}" data-act="set" data-v="icons">Recipe icons</button><button class="btn ${app.settings.shadows ? 'primary' : ''}" data-act="set" data-v="shadows">Shadows</button></div><p class="mute small">Turn shadows off if the game stutters on your phone.</p>
      <h4>Blueprints</h4><div class="row"><button class="btn" data-open="blueprints">📐 Blueprint library (${app.blueprints.length})</button></div>
      <h4>New game</h4><div class="row"><input id="seed-in" class="num" placeholder="seed (optional)"><button class="btn danger" data-act="newgame">Start over</button></div>
      <div class="row"><button class="btn wide" data-act="help">❓ How to play</button></div>
      <p class="mute small">Seed ${app.game.world.seed} · Playtime ${Math.floor(app.game.time / 3600)}h ${Math.floor(app.game.time / 60) % 60}m · autosaves every minute</p></div>` };
  }
  p_blueprints() {
    const app = this.app;
    return { title: '📐 Blueprints', html: `${app.blueprint ? `<div class="row"><button class="btn primary" data-act="bpsave">Save current blueprint (${app.blueprint.ents.length} entities)</button></div>` : '<p class="mute small">Use ✂ Copy to select an area — it becomes your current blueprint.</p>'}
      ${app.blueprints.map((b, i) => `<div class="bprow"><div class="bpicons">${[...new Set(b.ents.map(e => e.type))].slice(0, 6).map(t => iconImg(t)).join('')}</div><span>${esc(b.name)} <small class="mute">${b.w}×${b.h}</small></span><button class="btn tiny primary" data-act="bpuse" data-v="${i}">Use</button><button class="btn tiny danger" data-act="bpdel" data-v="${i}">✕</button></div>`).join('') || '<p class="mute small">No saved blueprints yet.</p>'}` };
  }
  p_help() {
    return { title: '❓ How to play', html: `<div class="help">
      <p><b>Goal:</b> grow from a few burner drills to a sprawling automated factory, research all five data types, and activate the <b>Resonance Gate</b>.</p>
      <h4>Controls</h4>
      <ul><li><b>Inspect 👆</b>: drag to pan, tap a building to configure it, tap ore to mine by hand.</li>
      <li><b>Take items</b>: long-press any building to grab its output. Keep holding and slide across a row of furnaces to collect them all.</li>
      <li><b>Build 🔨</b>: tap to position a ghost, then tap the ghost again (or ✓ Place) to build. Drag <i>from the ghost</i> to stretch it into a line; belts and pipes turn corners. Dragging anywhere else pans. Nothing is built until you confirm.</li>
      <li><b>⟳</b> rotates. <b>Two fingers</b> pan and zoom in any tool (mouse: right-drag / wheel; mouse clicks place directly).</li>
      <li><b>Remove 🗑 / Copy ✂</b>: tap a building to select it, drag from the selection to grow the box, then confirm. Items are refunded.</li>
      <li><b>Paste 📋</b>: tap where it goes, then ✓ Place. Missing items become ghosts that build themselves once you have them.</li>
      <li><b>Crafting 🛠</b>: "Ready" lists everything you can make right now. Each row shows its ingredients: grey = you have it, gold = crafted automatically, red = missing (tap it to see how it's made).</li>
      <li>Keyboard: WASD pan, R rotate, Enter confirm, Esc cancel, E craft, T research, P stats, B build, X/C/V tools, 1–9 hotbar, Space pause.</li></ul>
      <h4>Mechanics</h4>
      <ul><li>Drills and inserters output toward the arrow. Inserters take from behind and drop in front, only what the target needs.</li>
      <li>Every machine holds up to <b>two full stacks</b> of each ingredient and of fuel — handy for hand-feeding with "Fill from inventory". Inserters only keep a small working supply topped up, so one belt can feed a long row of machines fairly.</li>
      <li>Furnaces choose a recipe from their input. Assemblers need a recipe set.</li>
      <li>Burner machines need fuel (coal, tar, solid fuel). Electric ones need a Utility Pole covering them, linked to generators.</li>
      <li><b>Arrow colours:</b> <span style="color:#2fd0ff">cyan</span> marks where things go in, <span style="color:#ff8a1f">orange</span> where they come out — on inserters, drill chutes, tunnels, splitters and every fluid port. Selecting or placing a building also highlights the exact tiles it reads from and writes to.</li>
      <li>Status lights: <span class="ok">green</span> working, <span class="warn">yellow</span> waiting, <span class="bad">red</span> no power/fuel, orange output full.</li>
      <li>Pipes join everything adjacent; each network holds a single fluid. Keep different fluids apart, or cross with Pipe Tunnels. Fluid ports have raised markers: cyan inputs, orange outputs.</li>
      <li>Splitters balance belts; set a filter or priority to sort. Belts side-load when they meet another belt from the side.</li>
      <li>Modules: Speed (faster, hungrier), Productivity (free extra output, intermediates only), Efficiency (less power). Beacons share half their module effect with neighbours (no productivity).</li>
      <li>Uplink chests send items straight to your inventory; Downlink chests pull from it. Use them to automate your own building supply.</li>
      <li>The <b>Planner</b> (📊) computes machine counts and raw needs for any target rate.</li></ul></div>` };
  }
  exportSave() {
    const s = JSON.stringify(this.app.game.serialize());
    const b64 = btoa(unescape(encodeURIComponent(s)));
    this.modal(`<h3>Export save</h3><textarea readonly class="ta">${b64}</textarea><div class="row end"><button class="btn" data-m="copy">Copy</button><button class="btn primary" data-m="ok">Close</button></div>`,
      { copy: () => { const ta = $('.modal-card .ta'); Promise.resolve(navigator.clipboard?.writeText(b64)).then(() => this.toast('Copied')).catch(() => { ta.select(); this.toast('Press copy on the selected text'); }); }, ok: () => this.closeModal() });
  }
  importSave() {
    this.modal(`<h3>Import save</h3><textarea class="ta" id="imp"></textarea><div class="row end"><button class="btn" data-m="no">Cancel</button><button class="btn primary" data-m="go">Load</button></div>`,
      { go: () => { try { const s = decodeURIComponent(escape(atob($('#imp').value.trim()))); this.app.loadData(JSON.parse(s)); this.closeModal(); this.toast('Save loaded'); } catch (err) { this.toast('Invalid save data', 'bad'); } }, no: () => this.closeModal() });
  }

  // ----- entity panel -----
  knownItems() {
    const g = this.app.game; const s = new Set(Object.keys(g.inv));
    for (const rid of g.unlocked) for (const o of Object.keys(RECIPES[rid].out)) s.add(o);
    for (const o of ORES) if (o && ITEMS[o]) s.add(o);
    return [...s].filter(x => ITEMS[x]).sort((a, b) => CATS.indexOf(category(a)) - CATS.indexOf(category(b)));
  }
  openEntity(e) {
    this.sel = e;
    this.app.renderer.setSelection(e);
    this.openPanel('entity', { id: e.id });
  }
  openTile(x, y) {
    this.app.renderer.setSelection(null, [x, y]);
    this.openPanel('tile', { tile: [x, y] });
  }
  p_tile(d) {
    const g = this.app.game, W = g.world, [x, y] = d.tile, i = W.idx(x, y);
    const gid = g.ghostOcc[i];
    if (gid) {
      const gh = g.ghosts.get(gid);
      return { title: `👻 Ghost: ${esc(BUILDINGS[gh.type].name)}`, html: `<p>${g.has(gh.type) ? 'Will be built shortly.' : `Waiting for a <b>${esc(BUILDINGS[gh.type].name)}</b> in your inventory.`}</p><div class="row"><button class="btn" data-act="buildpick" data-v="${gh.type}">Craft / build</button><button class="btn danger" data-act="cancelghost" data-v="${gid}">Cancel ghost</button></div>` };
    }
    if (W.water[i]) return { title: '🌊 Water', html: '<p>Place an Offshore Pump on the shore with its arrow pointing into the water.</p>' };
    const ore = W.ore[i];
    if (!ore) return { title: 'Ground', html: `<p class="mute">Empty ground (${x}, ${y}).</p>` };
    const id = ORES[ore];
    if (ore === OIL) return { title: `${iconImg('crude-oil')} Oil seep`, html: `<p>Yield: <b>${Math.round(W.amount[i])}%</b> — a Pumpjack here produces ${fmt(10 * W.amount[i] / 100 * 60)} crude oil/min. Seeps never run dry.</p>` };
    const mining = g.handMine && g.handMine.x === x && g.handMine.y === y;
    return { title: `${iconImg(id)} ${esc(nameOf(id))}`, html: `<p>Remaining in tile: <b>${fmt(W.amount[i])}</b></p>
      <div class="row"><button class="btn ${mining ? 'danger' : 'primary'}" data-act="mine">${mining ? 'Stop mining' : '⛏ Mine by hand'}</button></div>
      ${mining ? `<div class="bar big"><div style="width:${g.handMine.progress * 100}%"></div></div>` : ''}<p class="mute small">Hand mining is slow (≈48/min). Drills are the way forward.</p>` };
  }
  p_entity(d) {
    const g = this.app.game, e = g.ents.get(d.id);
    if (!e) return { title: '', html: '' };
    const def = e.def;
    const [stT, stC] = STATUS_TEXT[e.status] || [e.status, 'mute'];
    let h = `<div class="status ${stC}">● ${stT}</div>`;
    const tk = takeable(e), tkKeys = Object.keys(tk);
    if (tkKeys.length) h += `<div class="take-top"><button class="btn take" data-act="take">⇡ Take all</button>${tkKeys.map(k => `<button class="chip" data-act="takeone" data-v="${k}" title="Take ${esc(nameOf(k))}">${iconImg(k)}<b>${fmt(tk[k])}</b></button>`).join('')}</div>`;
    const flow = ioHint(e);
    if (flow) h += `<p class="flow small">${flow}</p>`;
    else if (def.desc) h += `<p class="mute small">${esc(def.desc)}</p>`;
    // recipe
    if (e.kind === 'assembler') {
      const r = e.recipe && RECIPES[e.recipe];
      h += `<div class="row"><button class="btn recipe" data-act="recipe">${r ? iconImg(Object.keys(r.out)[0]) + ' ' + esc(r.name) : 'Choose recipe…'} ▾</button></div>`;
    }
    if (e.kind === 'furnace' && e.recipe) h += `<div class="row mute small">Smelting: ${iconImg(Object.keys(RECIPES[e.recipe].out)[0])} ${esc(RECIPES[e.recipe].name)}</div>`;
    if ((e.kind === 'assembler' || e.kind === 'furnace') && e.recipe) {
      const r = RECIPES[e.recipe];
      const spd = def.speed * e.speedMult();
      const perMin = (60 / r.time) * spd;
      h += `<div class="io"><div>${Object.entries(r.in).map(([k, v]) => chip(k, isFluid(k) ? (e.fin[k] || 0) : (e.inp[k] || 0), ((isFluid(k) ? e.fin[k] : e.inp[k]) || 0) >= v ? '' : 'short') + `<small class="per">${v}</small>`).join('')}</div><span class="arrow">→</span><div>${Object.entries(r.out).map(([k, v]) => chip(k, isFluid(k) ? (e.fout[k] || 0) : (e.out[k] || 0)) + `<small class="per">${v}</small>`).join('')}</div></div>`;
      h += `<div class="bar big"><div style="width:${(e.progress * 100).toFixed(0)}%"></div></div>`;
      h += `<p class="mute small">${fmt(perMin)} crafts/min at speed ${fmt(spd)}${e.eff.prod > 0 && r.prodOk ? ` · +${Math.round(e.eff.prod * 100)}% productivity` : ''}</p>`;
      h += `<p class="mute small">Holds up to two stacks of each ingredient${def.burner ? ' and of fuel' : ''} (Fill from inventory). Inserters keep a smaller working supply topped up so a belt feeds a whole row evenly.</p>`;
    }
    if (e.kind === 'drill') {
      const W = g.world; let left = 0, types = {};
      for (const i of e.area) if (W.ore[i] && W.ore[i] !== OIL) { left += W.amount[i]; types[ORES[W.ore[i]]] = 1; }
      h += `<div class="row wrap">${Object.keys(types).map(t => chip(t)).join('')}<span class="small">${fmt(left)} ore remaining</span></div>`;
      const held = Object.entries(e.buf);
      h += `<div class="row wrap"><span class="small mute">Output buffer</span>${held.map(([k, v]) => chip(k, v)).join('') || '<span class="mute small">empty</span>'}<span class="mute small">/ 10</span></div>`;
      h += `<div class="bar big"><div style="width:${(e.progress * 100).toFixed(0)}%"></div></div><p class="mute small">${fmt(def.speed * e.speedMult() * 60 * (1 + g.bonus.mining + Math.max(0, e.eff.prod)))} ore/min${g.bonus.mining ? ` (incl. +${Math.round(g.bonus.mining * 100)}% mining productivity)` : ''}</p>`;
    }
    if (e.kind === 'pumpjack') h += `<p>Yield ${Math.round(e.yield() * 100)}% → ${fmt(10 * e.yield() * 60 * e.speedMult())} crude/min</p>`;
    if (e.kind === 'lab') {
      h += `<div class="ings">${PACKS.map(p => chip(p, e.inv[p] || 0)).join('')}</div>`;
      const t = g.research.current && TECHS[g.research.current];
      h += t ? `<p class="small">Researching <b>${esc(t.name)}</b> · ${fmt(g.research.progress)}/${g.techCount(g.research.current)}</p><div class="bar big"><div style="width:${e.progress * 100}%"></div></div>` : `<div class="row"><button class="btn primary" data-open="research">Choose research</button></div>`;
    }
    if (e.kind === 'boiler') h += `<div class="ings">${chip('water', e.water)}${chip('steam', e.steam)}</div>`;
    if (e.kind === 'generator') h += `<p>Output <b>${fmtW(e.output)}</b> of ${fmtW(def.power)} · steam buffer ${fmt(e.steam)}</p>`;
    if (e.kind === 'solar') h += `<p>Output ${fmtW(60 * g.sun)} (daylight ${Math.round(g.sun * 100)}%)</p>`;
    if (e.kind === 'accumulator') h += `<p>Charge ${fmt(e.charge / 1000)} / ${fmt(def.capacity / 1000)} MJ</p><div class="bar big"><div style="width:${e.charge / def.capacity * 100}%"></div></div>`;
    if (e.kind === 'gate') h += `<div class="ings">${chip('resonator-core', e.cores)}</div><p>Cores ${e.cores}/${def.need} · Resonance ${Math.round(e.charge * 100)}%</p><div class="bar big"><div style="width:${e.charge * 100}%"></div></div>`;
    // fuel
    if (def.burner) {
      h += `<div class="row">${e.fuel.n ? chip(e.fuel.id, e.fuel.n) + `<span class="mute small">/ ${holdCap(e.fuel.id)}</span>` : '<span class="bad small">No fuel</span>'}<button class="btn" data-act="fuel">🔥 Add fuel</button></div>`;
    }
    // modules
    if (e.modules) {
      h += `<div class="row"><span class="small mute">Modules</span>${e.modules.map((m, i) => `<button class="slot" data-act="mod" data-v="${i}">${m ? iconImg(m) : '+'}</button>`).join('')}</div>`;
      if (e.eff.speed || e.eff.prod || e.eff.energy) h += `<p class="mute small">Speed ${pct(e.eff.speed)} · Productivity ${pct(e.eff.prod)} · Energy ${pct(e.eff.energy)}</p>`;
    }
    // electric
    if (e.electric && e.kind !== 'pole') h += e.net ? `<p class="mute small">Power: ${fmtW(e.powerDemand())} · network ${Math.round(e.net.sat * 100)}%</p>` : `<p class="bad small">Not connected — place a Utility Pole nearby.</p>`;
    // chests
    if (e.inv && e.kind !== 'lab') {
      const items = Object.entries(e.inv.items);
      h += `<div class="ings">${items.map(([k, v]) => chip(k, v)).join('') || '<span class="mute small">Empty</span>'}</div><p class="mute small">${e.inv.usedSlots()}/${e.inv.slots} slots</p>`;
    }
    if (e.kind === 'downlink') {
      h += `<div class="row"><span class="small">Request</span><button class="btn" data-act="filter">${e.filter ? iconImg(e.filter) + ' ' + esc(nameOf(e.filter)) : 'Choose item…'}</button><label class="small">keep <input class="num" type="number" value="${e.target}" data-act="target"></label></div>`;
    }
    // inserter
    if (e.kind === 'inserter') {
      h += `<div class="row">${e.hand ? `Holding ${chip(e.hand.id, e.hand.n)}` : '<span class="mute small">Empty hand</span>'}${e.def.stack ? `<span class="mute small">capacity ${e.capacity()}</span>` : ''}</div>`;
      if (def.filter) h += `<div class="row"><span class="small">Filter</span><button class="btn" data-act="filter">${e.filter ? iconImg(e.filter) + ' ' + esc(nameOf(e.filter)) : 'Any item'}</button></div>`;
    }
    if (e.kind === 'splitter') {
      h += `<div class="row"><span class="small">Filter → left</span><button class="btn" data-act="filter">${e.filter ? iconImg(e.filter) + ' ' + esc(nameOf(e.filter)) : 'None'}</button></div>`;
      h += `<div class="row"><span class="small">Output priority</span>${[['', 'Even'], ['left', 'Left'], ['right', 'Right']].map(([v, n]) => `<button class="btn tiny ${(e.priority || '') === v ? 'primary' : ''}" data-act="prio" data-v="${v}">${n}</button>`).join('')}</div>`;
    }
    if (BELTLIKE.has(e.kind)) {
      const c = e.contents();
      h += `<div class="ings">${Object.entries(c).map(([k, v]) => chip(k, v)).join('') || '<span class="mute small">No items</span>'}</div>`;
      h += `<p class="mute small">${fmt(def.speed * 4 * 60)} items/min${e.kind === 'underground' ? ` · ${e.mode === 'in' ? 'entrance' : 'exit'}${e.partner ? '' : ' (unpaired)'}` : ''}</p>`;
    }
    // fluids
    if (e.kind === 'pipe' || e.kind === 'upipe') {
      const n = e.fnet;
      h += n ? `<div class="row">${n.fluid ? chip(n.fluid, n.amount) : '<span class="mute">Empty</span>'}<span class="mute small">capacity ${fmt(n.cap)} · ${n.nodes} segments</span></div><div class="row"><button class="btn danger" data-act="flush">Flush network</button></div>` : '';
      if (e.kind === 'upipe') h += `<p class="mute small">${e.mode === 'in' ? 'Entrance' : 'Exit'}${e.partner ? '' : ' (unpaired)'}</p>`;
    }
    if (e.portNets && e.kind !== 'boiler') {
      const fl = e.portNets.map((n, i) => n && n.fluid ? `${def.ports[i].io === 'in' ? '⇢' : '⇠'} ${chip(n.fluid, n.amount)}` : '').filter(Boolean);
      if (fl.length) h += `<div class="row wrap"><span class="small mute">Ports</span>${fl.join('')}</div>`;
    }
    if (e.kind === 'pole') {
      const n = e.net;
      h += n ? `<div class="kv"><span>Demand</span><b>${fmtW(n.demand)}</b><span>Capacity</span><b>${fmtW(n.cap)}</b><span>Satisfaction</span><b>${Math.round(n.sat * 100)}%</b><span>Machines</span><b>${n.consumers.length}</b><span>Generators</span><b>${n.gens.length + n.solars.length}</b></div>` : '';
    }
    // actions
    const acts = [];
    if (e.kind === 'assembler' || e.kind === 'furnace' || e.kind === 'lab' || e.kind === 'gate') acts.push(`<button class="btn" data-act="fill">⇣ Fill from inventory</button>`);
    acts.push(`<button class="btn" data-act="rotate">⟳ Rotate</button>`);
    acts.push(`<button class="btn danger" data-act="pickup">✋ Pick up</button>`);
    h += `<div class="row wrap actions">${acts.join('')}</div>`;
    if (tkKeys.length || e.out || e.buf) h += `<p class="mute small">Tip: long-press a building on the map to take its output without opening this panel. Keep holding and slide across a row of machines to collect them all.</p>`;
    return { title: `${iconImg(e.type)} ${esc(def.name)}`, html: h };
  }
  pickRecipe(e) {
    const g = this.app.game;
    const ids = [...g.unlocked].filter(r => e.def.cats.includes(RECIPES[r].cat));
    ids.sort((a, b) => CATS.indexOf(category(Object.keys(RECIPES[a].out).find(k => ITEMS[k]) || 'iron-plate')) - CATS.indexOf(category(Object.keys(RECIPES[b].out).find(k => ITEMS[k]) || 'iron-plate')));
    const html = `<h3>Recipe for ${esc(e.def.name)}</h3><div class="rlist">${ids.map(rid => {
      const r = RECIPES[rid];
      return `<button class="rrow ${e.recipe === rid ? 'sel' : ''}" data-m="pick" data-v="${rid}"><span class="rin">${Object.entries(r.in).map(([k, v]) => chip(k, v)).join('')}</span><span class="arrow">→</span><span class="rout">${Object.entries(r.out).map(([k, v]) => chip(k, v)).join('')}</span><small>${r.time}s</small></button>`;
    }).join('')}</div>`;
    this.modal(html, { pick: (v) => { e.setRecipe(v); this.closeModal(); this.renderPanel(true); } });
  }
  pickModule(e, i) {
    const g = this.app.game;
    if (e.modules[i]) { g.give(e.modules[i], 1); e.modules[i] = null; g.dirty.effects = true; this.renderPanel(true); return; }
    const mods = Object.keys(g.inv).filter(k => ITEMS[k]?.module && g.inv[k] > 0);
    if (!mods.length) { this.toast('No modules in inventory', 'bad'); return; }
    this.pickItem('Insert module', mods, (id) => {
      if (!id) return;
      if (id.startsWith('prod') && e.kind === 'beacon') { this.toast('Beacons cannot transmit productivity', 'bad'); return; }
      if (g.take(id, 1)) { e.modules[i] = id; g.dirty.effects = true; }
      this.renderPanel(true);
    }, false);
  }
  addFuel(e, quiet) {
    const g = this.app.game;
    const fuels = Object.keys(g.inv).filter(k => ITEMS[k]?.fuel && (!e.fuel.id || e.fuel.id === k)).sort((a, b) => ITEMS[b].fuel - ITEMS[a].fuel);
    if (!fuels.length) { if (!quiet) this.toast('No fuel in inventory — mine some coal', 'bad'); return 0; }
    const id = fuels[0];
    const k = e.fuelInsert(id, g.inv[id]);
    g.take(id, k);
    if (!k && !quiet) this.toast(`Fuel is full (${holdCap(id)} ${esc(nameOf(id))})`);
    return k;
  }
  fillFromInv(e) {
    const g = this.app.game;
    let any = 0;
    const ids = e.kind === 'lab' ? PACKS : e.kind === 'gate' ? ['resonator-core'] : e.recipe ? Object.keys(RECIPES[e.recipe].in) : Object.keys(g.inv).filter(k => e.room(k) > 0 && !ITEMS[k]?.fuel);
    for (const id of ids) {
      if (isFluid(id) || !g.inv[id]) continue;
      const k = e.insert(id, Math.min(e.room(id), g.inv[id]));
      if (k) { g.take(id, k); any += k; }
    }
    if (e.def.burner) any += this.addFuel(e, true);
    if (!any) this.toast('Nothing to insert — it is full, or you carry none of its ingredients', 'bad');
  }
  takeOne(e, id) {
    const g = this.app.game;
    let n = 0;
    if (e.out?.[id]) { n += e.out[id]; delete e.out[id]; }
    if (e.kind === 'drill' && e.buf[id]) { n += e.buf[id]; delete e.buf[id]; }
    if (e.inv?.items?.[id] && e.kind !== 'uplink') { n += e.inv.items[id]; delete e.inv.items[id]; }
    if (n) { g.give(id, n); this.toast(`${iconImg(id)} +${n} ${esc(nameOf(id))}`, 'good'); }
  }
  showRecipeInfo(id) {
    const g = this.app.game;
    const rid = this.recipeFor(id);
    if (!rid) { this.toast(esc(nameOf(id)) + ' is a raw resource'); return; }
    const r = RECIPES[rid];
    const where = r.cat === 'smelt' ? 'Furnace' : r.cat === 'chem' ? 'Chemical Plant' : r.cat === 'refine' ? 'Oil Refinery' : r.cat === 'craft-fluid' ? 'Assembler II+' : 'Assembler or by hand';
    const tech = Object.entries(TECHS).find(([, t]) => t.unlocks.includes(rid));
    this.modal(`<h3>${iconImg(id)} ${esc(nameOf(id))}</h3><div class="io"><div>${Object.entries(r.in).map(([k, v]) => chip(k, v)).join('')}</div><span class="arrow">→</span><div>${Object.entries(r.out).map(([k, v]) => chip(k, v)).join('')}</div></div><p class="small">${r.time}s · made in ${where}${g.unlocked.has(rid) ? '' : ` · <span class="bad">locked</span>${tech ? ` (${esc(tech[1].name)})` : ''}`}</p><div class="row end"><button class="btn primary" data-m="ok">OK</button></div>`);
  }
}
const IN_ = '<b class="cin">cyan</b>', OUT_ = '<b class="cout">orange</b>';
// Plain-language description of how a building connects, using the in-world colour markers.
function ioHint(e) {
  const k = e.kind, ports = e.def.ports;
  const fluid = ports ? ` Pipes attach only at its marked ports: ${IN_} in, ${OUT_} out.` : '';
  switch (k) {
    case 'inserter': return `Takes from the ${IN_} tile behind it, drops onto the ${OUT_} tile in front${e.def.reach > 1 ? ' (2 tiles reach)' : ''}. Only moves items the target can use.`;
    case 'drill': return `Mines the highlighted area and drops ore on the ${OUT_} tile: a belt, chest, furnace, or another burner drill (as fuel). It holds up to 10 ore, and inserters can also pull ore out from any side.`;
    case 'furnace': return `Feed ore and fuel with inserters from any side; another inserter takes the plates out. The recipe follows whatever ore arrives.`;
    case 'assembler': return `Inserters feed ingredients from any side and take products out.${fluid}`;
    case 'lab': return `Inserters feed data from any side, and can pass data on from one lab to the next.`;
    case 'boiler': return `Water enters at the ${IN_} side ports (and passes through to the next boiler); steam leaves at the ${OUT_} top port. Insert fuel from any side.`;
    case 'generator': return `Steam enters at either ${IN_} port and passes through, so engines can be chained end to end.`;
    case 'offshore': return `Draws from the water its ${IN_} arrow faces; water leaves at the ${OUT_} port behind.`;
    case 'pumpjack': return `Crude oil leaves at the ${OUT_} port.`;
    case 'belt': return `Carries items toward its arrows. Feeding into a belt's side merges onto it.`;
    case 'underground': return e.mode === 'in' ? `Tunnel entrance (${IN_}): items dive under and reappear at the paired exit.` : `Tunnel exit (${OUT_}): items surface here and continue forward.`;
    case 'splitter': return `Takes two belts from behind (${IN_}) and shares items across both outputs (${OUT_}).`;
    case 'chest': return `Inserters can put items in or take them out from any side.`;
    case 'uplink': return `Anything inserted goes straight into your inventory.`;
    case 'downlink': return `Pulls the chosen item from your inventory; inserters take it out.`;
    default: return null;
  }
}
// What a building holds that the player can take: products and storage, never fuel or ingredients.
function takeable(e) {
  const t = {};
  const add = (k, v) => { if (v > 0) t[k] = (t[k] || 0) + v; };
  if (e.out) for (const [k, v] of Object.entries(e.out)) add(k, v);
  if (e.kind === 'drill') for (const [k, v] of Object.entries(e.buf)) add(k, v);
  if (e.inv?.items && e.kind !== 'uplink') for (const [k, v] of Object.entries(e.inv.items)) add(k, v);
  return t;
}
function pct(v) { return (v > 0 ? '+' : '') + Math.round(v * 100) + '%'; }
