// Pointer / touch / keyboard input and build tools.
import { BUILDINGS } from './data.js';
import { rotSize, DX, DY, entitySettings, BELTLIKE } from './sim.js';

const TAP_PX = 10;
const LONG_PRESS_MS = 420;

export class Input {
  constructor(app) {
    this.app = app;
    this.ptrs = new Map();
    this.gesture = null; // {type:'pan'|'pinch'|'line'|'rect'|'paste', ...}
    const c = app.renderer.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e, true));
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e));
  }
  get r() { return this.app.renderer; }
  get g() { return this.app.game; }

  zoomAt(px, py, f) {
    const before = this.r.screenToWorld(px, py);
    this.r.dist *= f;
    this.r.updateCamera();
    const after = this.r.screenToWorld(px, py);
    if (before && after) { this.r.target.x += before.x - after.x; this.r.target.z += before.z - after.z; }
  }

  // Touch tools never act on a single touch: a tap positions a ghost/selection and a second tap
  // (or the ✓ button) confirms. One-finger drags pan unless they start on the pending ghost, which
  // extends it. Mouse input is precise, so it keeps direct click/drag placement.
  isTouchTool(e) { return e.pointerType !== 'mouse' && ['build', 'remove', 'copy', 'paste'].includes(this.app.tool); }

  down(e) {
    this.r.canvas.setPointerCapture?.(e.pointerId);
    this.app.pointer = e.pointerType === 'mouse' ? 'mouse' : 'touch';
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, ts: e.timeStamp, btn: e.button, type: e.pointerType });
    this.clearLongPress();
    if (this.ptrs.size === 2) {
      // switch to pinch; abort single-finger action
      this.cancelGesture();
      const [a, b] = [...this.ptrs.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.gesture = { type: 'pinch', span: Math.hypot(a.x - b.x, a.y - b.y), anchor: this.r.screenToWorld(mx, my) };
      return;
    }
    if (this.ptrs.size > 2) return;
    const tool = this.app.tool;
    const tile = this.r.screenToTile(e.clientX, e.clientY);
    if (!tile) return;
    const pan = () => ({ type: 'pan', anchor: this.r.screenToWorld(e.clientX, e.clientY), btn: e.button, tap: true, start: tile });
    if (e.button === 2 || e.button === 1) { this.gesture = pan(); return; }
    if (this.isTouchTool(e)) {
      this.gesture = this.hitPending(tile) ? { type: 'edit', tap: true, start: tile } : { ...pan(), place: true };
      if (this.gesture.type === 'pan') this.armLongPress(tile);
      return;
    }
    if (tool === 'inspect') { this.gesture = pan(); this.armLongPress(tile); return; }
    // mouse: direct placement
    if (tool === 'build') this.gesture = { type: 'line', start: tile, end: tile, axis: null, tap: true };
    else if (tool === 'remove' || tool === 'copy') this.gesture = { type: 'rect', start: tile, end: tile, tap: true };
    else if (tool === 'paste') { this.gesture = { type: 'paste', tap: true }; this.app.setPasteAnchor(tile); }
    this.updatePreview();
  }

  // Long-press a building to take its output; keep holding and slide to sweep across several.
  // The decision uses event timestamps (when the finger actually moved or lifted), so a janky
  // frame can't turn a quick tap into a collect. The timer only shows that the hold registered.
  armLongPress(tile) {
    this.lpTimer = setTimeout(() => {
      const G = this.gesture;
      const e = G && G.type === 'pan' && G.tap && this.g.entityAt(tile[0], tile[1]);
      if (e) { G.lpShown = true; this.r.setSelection(e); }
    }, LONG_PRESS_MS);
  }
  clearLongPress() { clearTimeout(this.lpTimer); }
  startCollect(G, p) {
    const e = this.g.entityAt(G.start[0], G.start[1]);
    if (!e) return false;
    this.gesture = { type: 'collect', seen: new Set([e.id]) };
    this.app.collect(e);
    this.r.setSelection(e);
    return true;
  }

  move(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) { this.hover(e); return; }
    p.x = e.clientX; p.y = e.clientY;
    const G = this.gesture;
    if (!G) return;
    if (G.tap && Math.hypot(p.x - p.sx, p.y - p.sy) > TAP_PX) {
      // a drag that starts after a long hold sweeps-collects instead of panning
      if (G.type === 'pan' && e.timeStamp - p.ts >= LONG_PRESS_MS && this.startCollect(G, p)) return;
      G.tap = false;
      if (G.type === 'pan') { this.clearLongPress(); if (G.lpShown) this.r.setSelection(null); }
    }
    if (G.type === 'pinch' && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const span = Math.hypot(a.x - b.x, a.y - b.y);
      if (span > 10 && G.span > 10) this.r.dist *= G.span / span;
      G.span = span;
      this.r.updateCamera();
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const now = this.r.screenToWorld(mx, my);
      if (now && G.anchor) { this.r.target.x += G.anchor.x - now.x; this.r.target.z += G.anchor.z - now.z; this.r.updateCamera(); }
      return;
    }
    if (G.type === 'pan') {
      if (G.tap) return;
      const now = this.r.screenToWorld(p.x, p.y);
      if (now && G.anchor) { this.r.target.x += G.anchor.x - now.x; this.r.target.z += G.anchor.z - now.z; this.r.updateCamera(); }
      return;
    }
    const tile = this.r.screenToTile(p.x, p.y);
    if (!tile) return;
    if (G.type === 'collect') {
      const ent = this.g.entityAt(tile[0], tile[1]);
      if (ent && !G.seen.has(ent.id)) { G.seen.add(ent.id); this.app.collect(ent, true); this.r.setSelection(ent); }
      return;
    }
    if (G.type === 'edit') {
      if (G.tap) return; // ignore jitter until it is clearly a drag
      const P = this.app.pending, tool = this.app.tool;
      if (tool === 'paste') this.app.setPasteAnchor(tile);
      else if (P) {
        P.end = tile;
        if (tool === 'build') {
          const dx = tile[0] - P.start[0], dy = tile[1] - P.start[1];
          if (!dx && !dy) P.axis = null;
          else if (!P.axis) P.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        }
      }
      this.updatePreview(); this.app.renderActionBar();
      return;
    }
    if (G.type === 'line') {
      G.end = tile;
      const dx = tile[0] - G.start[0], dy = tile[1] - G.start[1];
      if (!G.axis && (Math.abs(dx) > 0 || Math.abs(dy) > 0)) G.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    } else if (G.type === 'rect') G.end = tile;
    else if (G.type === 'paste') this.app.setPasteAnchor(tile);
    this.updatePreview();
  }

  hover(e) {
    if (e.pointerType !== 'mouse') return;
    this.app.pointer = 'mouse';
    const tool = this.app.tool;
    if (tool !== 'build' && tool !== 'paste') return;
    const tile = this.r.screenToTile(e.clientX, e.clientY);
    if (!tile) return;
    this.hoverTile = tile;
    if (tool === 'paste' && !this.app.pasteLocked) this.app.setPasteAnchor(tile);
    this.updatePreview();
  }

  up(e, cancelled) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    this.clearLongPress();
    const G = this.gesture;
    if (!G) return;
    if (G.type === 'pinch') { if (this.ptrs.size === 0) this.gesture = null; return; }
    this.gesture = null;
    if (cancelled) { this.updatePreview(); return; }
    const app = this.app;
    if (G.type === 'pan' && G.tap && G.btn === 0 && e.timeStamp - p.ts >= LONG_PRESS_MS && this.startCollect(G, p)) { this.gesture = null; G.type = 'collect'; }
    if (G.type === 'collect') { setTimeout(() => { if (app.ui.panel !== 'entity') this.r.setSelection(null); }, 300); return; }
    if (G.type === 'edit') {
      if (G.tap) app.confirmPending(); // second tap on the ghost/selection confirms it
    } else if (G.type === 'pan') {
      if (G.tap && G.place) app.setPending(G.start);
      else if (G.tap && G.btn === 0) app.inspectTile(G.start);
      else if (G.tap && G.btn === 2 && app.tool !== 'inspect') app.setTool('inspect');
    } else if (G.type === 'line') {
      app.placeMany(this.linePlan(G));
    } else if (G.type === 'rect') {
      const r = rectOf(G.start, G.end);
      if (app.tool === 'remove') app.removeRect(r, G.tap);
      else app.copyRect(r);
    } else if (G.type === 'paste') {
      app.pasteLocked = true;
    }
    this.updatePreview();
  }

  cancelGesture() { this.clearLongPress(); this.gesture = null; this.r.setRect(null); this.updatePreview(); }

  // ----- pending (touch) actions -----
  pendingList() {
    const P = this.app.pending;
    if (!P || !P.start) return [];
    return this.linePlan({ start: P.start, end: P.end, axis: P.axis, tap: P.start[0] === P.end[0] && P.start[1] === P.end[1] });
  }
  pendingRect() {
    const P = this.app.pending;
    if (!P || !P.base) return null;
    const b = P.base, [ex, ey] = P.end;
    const x0 = Math.min(b.x, ex), y0 = Math.min(b.y, ey), x1 = Math.max(b.x + b.w - 1, ex), y1 = Math.max(b.y + b.h - 1, ey);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  hitPending([x, y]) {
    const app = this.app, tool = app.tool;
    if (tool === 'paste') {
      if (!app.blueprint || !app.pasteAnchor) return false;
      const [ax, ay] = app.pasteAnchor;
      return x >= ax && y >= ay && x < ax + app.blueprint.w && y < ay + app.blueprint.h;
    }
    if (!app.pending) return false;
    if (tool === 'build') {
      return this.pendingList().some(it => { const [w, h] = rotSize(it.type, it.rot); return x >= it.x && y >= it.y && x < it.x + w && y < it.y + h; });
    }
    const r = this.pendingRect();
    return r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  }

  // Compute placement plan for a drag line (straight or L-shaped).
  linePlan(G) {
    const type = this.app.buildType;
    if (!type) return [];
    const def = BUILDINGS[type];
    const [s0, s1] = G.start, [e0, e1] = G.end;
    const out = [];
    const rot0 = this.app.rot;
    if (G.tap || (s0 === e0 && s1 === e1)) {
      const [w, h] = rotSize(type, rot0);
      return [{ type, x: s0 - Math.floor((w - 1) / 2), y: s1 - Math.floor((h - 1) / 2), rot: rot0 }];
    }
    const dirOf = (dx, dy) => Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    // corner point: first along chosen axis, then the other
    const corner = G.axis === 'x' ? [e0, s1] : [s0, e1];
    const segs = [[G.start, corner], [corner, G.end]].filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
    const dirLine = def.kind === 'belt' || def.kind === 'pipe';
    if (def.kind === 'underground' || def.kind === 'upipe') {
      const d = dirOf(e0 - s0, e1 - s1);
      const end = G.axis === 'x' ? [e0, s1] : [s0, e1];
      this.app.rot = d;
      return [{ type, x: s0, y: s1, rot: d, mode: 'in' }, { type, x: end[0], y: end[1], rot: d, mode: 'out' }];
    }
    const [w, h] = rotSize(type, rot0);
    const ctr = (tx, ty, rot) => ({ type, x: tx - Math.floor((w - 1) / 2), y: ty - Math.floor((h - 1) / 2), rot });
    if (dirLine) {
      // L-shaped path: along the first axis to the corner, then to the end. Corner takes the second direction.
      const pts = [];
      const walk = (a, b, inclEnd) => {
        const d = dirOf(b[0] - a[0], b[1] - a[1]);
        const len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
        for (let k = 0; k < len + (inclEnd ? 1 : 0); k++) pts.push([a[0] + DX[d] * k, a[1] + DY[d] * k, d]);
        return d;
      };
      let last = rot0;
      if (segs.length === 2) { walk(segs[0][0], segs[0][1], false); last = walk(segs[1][0], segs[1][1], true); }
      else last = walk(segs[0][0], segs[0][1], true);
      this.app.rot = last;
      return pts.map(([x, y, d]) => ctr(x, y, d));
    }
    // Other buildings: straight line along the dominant axis, spaced by footprint (or wire reach for poles).
    const d = dirOf(e0 - s0, e1 - s1);
    const len = Math.abs(d % 2 ? e0 - s0 : e1 - s1);
    const stride = def.kind === 'pole' ? Math.max(1, Math.floor(def.reach)) : (d % 2 ? w : h);
    for (let k = 0; k <= len; k += stride) out.push(ctr(s0 + DX[d] * k, s1 + DY[d] * k, rot0));
    return out;
  }

  updatePreview() {
    const app = this.app, r = this.r, g = this.g;
    const G = this.gesture;
    if (app.tool === 'build' && app.buildType) {
      let list;
      if (G && G.type === 'line') list = this.linePlan(G);
      else if (app.pending) list = this.pendingList();
      else if (this.hoverTile && app.pointer === 'mouse') list = this.linePlan({ start: this.hoverTile, end: this.hoverTile, tap: true });
      else list = [];
      const def = BUILDINGS[app.buildType];
      r.setPreview(list.map((it, i) => {
        const fr = def.kind === 'belt' && g.entityAt(it.x, it.y)?.kind === 'belt';
        const p = { ...it, ok: fr || g.canPlace(it.type, it.x, it.y, it.rot).ok };
        if (i === list.length - 1) {
          if (def.kind === 'drill') { const off = (def.area - def.size[0]) / 2; p.area = [it.x - off, it.y - off, def.area, def.area]; }
          if (def.kind === 'pole') { p.area = [it.x - def.supply, it.y - def.supply, 1 + def.supply * 2 + (def.size[0] - 1), 1 + def.supply * 2 + (def.size[1] - 1)]; p.areaColor = '#5ab0ff'; }
          if (def.kind === 'beacon') { const R = def.range; p.area = [it.x - R, it.y - R, 3 + 2 * R, 3 + 2 * R]; }
        }
        return p;
      }));
      r.setRect(null);
    } else if (app.tool === 'paste' && app.blueprint && app.pasteAnchor) {
      const bp = app.blueprint;
      const [ax, ay] = app.pasteAnchor;
      r.setPreview(bp.ents.map(en => ({ type: en.type, x: ax + en.dx, y: ay + en.dy, rot: en.rot, ok: g.canPlace(en.type, ax + en.dx, ay + en.dy, en.rot).ok })));
      r.setRect(null);
    } else {
      r.setPreview(null);
      const col = app.tool === 'copy' ? '#5ab0ff' : '#ff5a5a';
      if (G && G.type === 'rect') r.setRect(rectOf(G.start, G.end), col);
      else if (app.pending && (app.tool === 'remove' || app.tool === 'copy')) r.setRect(this.pendingRect(), col);
      else r.setRect(null);
    }
  }

  key(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const app = this.app;
    const k = e.key.toLowerCase();
    const pan = 3 + this.r.dist * 0.08;
    if (k === 'r') app.rotate();
    else if (k === 'escape' || k === 'q') { if (app.ui.panelOpen()) app.ui.closePanel(); else if (app.pending) app.actionBar('clear'); else app.setTool('inspect'); }
    else if (k === 'enter') app.confirmPending();
    else if (k === 'e') app.ui.toggle('craft');
    else if (k === 't') app.ui.toggle('research');
    else if (k === 'p') app.ui.toggle('stats');
    else if (k === 'b') app.ui.toggle('build');
    else if (k === 'x') app.setTool('remove');
    else if (k === 'c') app.setTool('copy');
    else if (k === 'v') app.setTool('paste');
    else if (k === 'w' || k === 'arrowup') this.r.target.z -= pan;
    else if (k === 's' || k === 'arrowdown') this.r.target.z += pan;
    else if (k === 'a' || k === 'arrowleft') this.r.target.x -= pan;
    else if (k === 'd' || k === 'arrowright') this.r.target.x += pan;
    else if (k === '+' || k === '=') this.r.dist *= 0.85;
    else if (k === '-') this.r.dist *= 1.18;
    else if (k === ' ') { app.togglePause(); e.preventDefault(); }
    else if (/^[1-9]$/.test(k)) app.ui.hotbarPick(+k - 1);
    else return;
    this.updatePreview();
  }
}

export function rectOf(a, b) {
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1 };
}

// Rotate a blueprint 90° clockwise.
export function rotateBlueprint(bp) {
  const ents = bp.ents.map(e => {
    const [w, h] = rotSize(e.type, e.rot);
    return { ...e, dx: bp.h - (e.dy + h), dy: e.dx, rot: (e.rot + 1) & 3 };
  });
  return { ...bp, w: bp.h, h: bp.w, ents };
}

export function makeBlueprint(g, r) {
  const ents = [];
  const seen = new Set();
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const e = g.entityAt(x, y);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    ents.push({ type: e.type, dx: e.x - r.x, dy: e.y - r.y, rot: e.rot, settings: entitySettings(e), mode: e.mode });
  }
  if (!ents.length) return null;
  let mx = 0, my = 0, nx = 1e9, ny = 1e9;
  for (const e of ents) { const [w, h] = rotSize(e.type, e.rot); nx = Math.min(nx, e.dx); ny = Math.min(ny, e.dy); mx = Math.max(mx, e.dx + w); my = Math.max(my, e.dy + h); }
  for (const e of ents) { e.dx -= nx; e.dy -= ny; }
  return { w: mx - nx, h: my - ny, ents };
}
