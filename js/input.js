// Pointer / touch / keyboard input and build tools.
import { BUILDINGS } from './data.js';
import { rotSize, DX, DY, entitySettings, BELTLIKE } from './sim.js';

const TAP_PX = 10;

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

  down(e) {
    this.app.ui.blurPanels?.();
    this.r.canvas.setPointerCapture?.(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), btn: e.button, type: e.pointerType });
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
    if (e.button === 2 || e.button === 1 || (tool === 'inspect') ) {
      this.gesture = { type: 'pan', anchor: this.r.screenToWorld(e.clientX, e.clientY), btn: e.button, tap: true, start: tile };
      return;
    }
    if (tool === 'build') this.gesture = { type: 'line', start: tile, end: tile, axis: null, tap: true };
    else if (tool === 'remove' || tool === 'copy') this.gesture = { type: 'rect', start: tile, end: tile, tap: true };
    else if (tool === 'paste') { this.gesture = { type: 'paste', tap: true }; this.app.setPasteAnchor(tile); }
    this.updatePreview();
  }

  move(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) { this.hover(e); return; }
    p.x = e.clientX; p.y = e.clientY;
    const G = this.gesture;
    if (!G) return;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > TAP_PX) G.tap = false;
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
    const G = this.gesture;
    if (!G) return;
    if (G.type === 'pinch') { if (this.ptrs.size === 0) this.gesture = null; return; }
    this.gesture = null;
    if (cancelled) { this.updatePreview(); return; }
    const app = this.app;
    if (G.type === 'pan') {
      if (G.tap && G.btn === 0) app.inspectTile(G.start);
      else if (G.tap && G.btn === 2 && app.tool !== 'inspect') app.setTool('inspect');
    } else if (G.type === 'line') {
      const list = this.linePlan(G);
      app.placeMany(list);
    } else if (G.type === 'rect') {
      const r = rectOf(G.start, G.end);
      if (app.tool === 'remove') app.removeRect(r, G.tap);
      else app.copyRect(r);
    } else if (G.type === 'paste') {
      app.pasteLocked = true;
    }
    this.updatePreview();
  }

  cancelGesture() { this.gesture = null; this.r.setRect(null); this.updatePreview(); }

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
      else if (this.hoverTile) list = this.linePlan({ start: this.hoverTile, end: this.hoverTile, tap: true });
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
      if (G && G.type === 'rect') r.setRect(rectOf(G.start, G.end), app.tool === 'copy' ? '#5ab0ff' : '#ff5a5a');
      else r.setRect(null);
    }
  }

  key(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const app = this.app;
    const k = e.key.toLowerCase();
    const pan = 3 + this.r.dist * 0.08;
    if (k === 'r') app.rotate();
    else if (k === 'escape' || k === 'q') { if (app.ui.panelOpen()) app.ui.closePanel(); else app.setTool('inspect'); }
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
