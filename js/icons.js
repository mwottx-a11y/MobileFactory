// Procedural canvas icons for items, fluids and buildings.
import { ITEMS, FLUIDS, BUILDINGS } from './data.js';

const cache = new Map();
const SZ = 64;

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f > 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function rr(x, _, X, y, w, h, r) { x.beginPath(); x.roundRect(X, y, w, h, r); }

function gearPath(x, cx, cy, r1, r2, teeth) {
  x.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2, a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const r = i % 2 ? r1 : r2;
    x.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    x.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
  }
  x.closePath();
}

function drawShape(x, shape, c, id) {
  const lw = 3;
  x.lineJoin = 'round'; x.lineCap = 'round';
  x.strokeStyle = shade(c, -0.55); x.lineWidth = lw;
  const grad = (y0, y1) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, shade(c, 0.35)); g.addColorStop(1, shade(c, -0.25)); return g; };
  switch (shape) {
    case 'ore': {
      x.fillStyle = grad(14, 54);
      x.beginPath(); x.moveTo(12, 40); x.lineTo(18, 20); x.lineTo(34, 12); x.lineTo(50, 20); x.lineTo(54, 40); x.lineTo(40, 52); x.lineTo(22, 52); x.closePath();
      x.fill(); x.stroke();
      x.fillStyle = shade(c, 0.5); x.beginPath(); x.arc(28, 28, 4, 0, 7); x.fill(); x.beginPath(); x.arc(40, 36, 3, 0, 7); x.fill();
      break;
    }
    case 'crystal': {
      x.fillStyle = grad(8, 56);
      x.beginPath(); x.moveTo(32, 6); x.lineTo(46, 24); x.lineTo(40, 56); x.lineTo(24, 56); x.lineTo(18, 24); x.closePath(); x.fill(); x.stroke();
      x.strokeStyle = shade(c, 0.6); x.beginPath(); x.moveTo(32, 8); x.lineTo(32, 54); x.stroke();
      break;
    }
    case 'plate': {
      x.fillStyle = grad(16, 50);
      x.beginPath(); x.moveTo(8, 34); x.lineTo(30, 18); x.lineTo(56, 26); x.lineTo(34, 44); x.closePath(); x.fill(); x.stroke();
      x.fillStyle = shade(c, -0.35); x.beginPath(); x.moveTo(8, 34); x.lineTo(34, 44); x.lineTo(34, 50); x.lineTo(8, 40); x.closePath(); x.fill(); x.stroke();
      x.fillStyle = shade(c, -0.5); x.beginPath(); x.moveTo(34, 44); x.lineTo(56, 26); x.lineTo(56, 32); x.lineTo(34, 50); x.closePath(); x.fill(); x.stroke();
      break;
    }
    case 'brick': {
      x.fillStyle = grad(18, 50);
      rr(x, 0, 10, 22, 44, 22, 3); x.fill(); x.stroke();
      x.fillStyle = shade(c, -0.2); rr(x, 0, 14, 30, 36, 22, 3); x.fill(); x.stroke();
      break;
    }
    case 'wafer': {
      x.fillStyle = grad(10, 54); x.beginPath(); x.arc(32, 32, 22, 0, 7); x.fill(); x.stroke();
      x.strokeStyle = shade(c, 0.4); x.lineWidth = 1.5;
      for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(14, 32 + i * 7); x.lineTo(50, 32 + i * 7); x.stroke(); x.beginPath(); x.moveTo(32 + i * 7, 14); x.lineTo(32 + i * 7, 50); x.stroke(); }
      break;
    }
    case 'powder': {
      x.fillStyle = grad(20, 52);
      x.beginPath(); x.moveTo(8, 50); x.quadraticCurveTo(20, 18, 32, 16); x.quadraticCurveTo(44, 18, 56, 50); x.closePath(); x.fill(); x.stroke();
      break;
    }
    case 'blob': {
      x.fillStyle = grad(14, 52);
      x.beginPath(); x.ellipse(32, 36, 22, 15, 0, 0, 7); x.fill(); x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.ellipse(26, 31, 7, 3, -0.3, 0, 7); x.fill();
      break;
    }
    case 'gear': {
      x.fillStyle = grad(8, 56); gearPath(x, 32, 32, 18, 25, 9); x.fill(); x.stroke();
      x.fillStyle = '#222'; x.beginPath(); x.arc(32, 32, 7, 0, 7); x.fill();
      break;
    }
    case 'wire': {
      x.strokeStyle = shade(c, -0.4); x.lineWidth = 7;
      x.beginPath(); for (let i = 0; i < 5; i++) x.ellipse(18 + i * 7, 32, 6, 16, 0.25, 0, 7); x.stroke();
      x.strokeStyle = c; x.lineWidth = 4;
      x.beginPath(); for (let i = 0; i < 5; i++) x.ellipse(18 + i * 7, 32, 6, 16, 0.25, 0, 7); x.stroke();
      break;
    }
    case 'chip': {
      x.fillStyle = grad(10, 54); rr(x, 0, 10, 10, 44, 44, 5); x.fill(); x.stroke();
      x.fillStyle = '#1a1a1a'; rr(x, 0, 22, 22, 20, 20, 2); x.fill();
      x.strokeStyle = '#ffd25a'; x.lineWidth = 2;
      for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(16 + i * 10, 12); x.lineTo(16 + i * 10, 20); x.stroke(); x.beginPath(); x.moveTo(16 + i * 10, 44); x.lineTo(16 + i * 10, 52); x.stroke(); }
      break;
    }
    case 'engine': {
      x.fillStyle = grad(14, 52); rr(x, 0, 10, 18, 40, 30, 5); x.fill(); x.stroke();
      x.fillStyle = shade(c, -0.3); rr(x, 0, 18, 10, 12, 10, 2); x.fill(); x.stroke(); rr(x, 0, 34, 10, 12, 10, 2); x.fill(); x.stroke();
      x.fillStyle = '#333'; x.beginPath(); x.arc(52, 33, 6, 0, 7); x.fill();
      break;
    }
    case 'battery': {
      x.fillStyle = grad(10, 56); rr(x, 0, 18, 12, 28, 44, 5); x.fill(); x.stroke();
      x.fillStyle = '#ddd'; x.fillRect(26, 6, 12, 7);
      x.fillStyle = '#222'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.fillText('+', 32, 40);
      break;
    }
    case 'frame': {
      x.strokeStyle = shade(c, -0.5); x.lineWidth = 8;
      x.beginPath(); x.moveTo(10, 50); x.lineTo(32, 12); x.lineTo(54, 50); x.closePath(); x.moveTo(21, 31); x.lineTo(43, 31); x.stroke();
      x.strokeStyle = c; x.lineWidth = 4; x.stroke();
      break;
    }
    case 'core': {
      const g = x.createRadialGradient(32, 32, 2, 32, 32, 26); g.addColorStop(0, '#fff'); g.addColorStop(0.4, c); g.addColorStop(1, shade(c, -0.6));
      x.fillStyle = g; x.beginPath(); x.arc(32, 32, 24, 0, 7); x.fill();
      x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.ellipse(32, 32, 28, 10, 0.5, 0, 7); x.stroke();
      break;
    }
    case 'module': {
      x.fillStyle = '#2a2d33'; rr(x, 0, 10, 12, 44, 40, 4); x.fill(); x.stroke();
      x.fillStyle = c; rr(x, 0, 16, 18, 32, 28, 3); x.fill();
      const tier = ITEMS[id]?.tier || 1;
      x.fillStyle = '#fff';
      for (let i = 0; i < tier; i++) x.fillRect(22 + i * 8, 26, 5, 12);
      break;
    }
    case 'pack': {
      x.fillStyle = 'rgba(220,235,255,0.35)'; x.strokeStyle = '#cfd8e3'; x.lineWidth = 3;
      x.beginPath(); x.moveTo(26, 8); x.lineTo(38, 8); x.lineTo(38, 24); x.lineTo(52, 50); x.quadraticCurveTo(54, 56, 46, 56); x.lineTo(18, 56); x.quadraticCurveTo(10, 56, 12, 50); x.lineTo(26, 24); x.closePath();
      x.fill(); x.stroke();
      x.save(); x.clip();
      x.fillStyle = c; x.fillRect(0, 32, 64, 32);
      x.fillStyle = shade(c, 0.4); x.beginPath(); x.arc(26, 44, 3, 0, 7); x.arc(36, 48, 2, 0, 7); x.fill();
      x.restore();
      break;
    }
    case 'fluid': {
      const g = x.createLinearGradient(0, 8, 0, 56); g.addColorStop(0, shade(c, 0.4)); g.addColorStop(1, shade(c, -0.3));
      x.fillStyle = g; x.strokeStyle = shade(c, -0.6);
      x.beginPath(); x.moveTo(32, 6); x.bezierCurveTo(44, 24, 52, 32, 52, 40); x.arc(32, 40, 20, 0, Math.PI); x.bezierCurveTo(12, 32, 20, 24, 32, 6); x.fill(); x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.4)'; x.beginPath(); x.ellipse(25, 40, 4, 8, 0.3, 0, 7); x.fill();
      break;
    }
    default: {
      x.fillStyle = grad(10, 54); rr(x, 0, 10, 10, 44, 44, 8); x.fill(); x.stroke();
    }
  }
}

const KIND_COLOR = {
  drill: '#5a86c4', pumpjack: '#d24a3a', offshore: '#3f6d9c', furnace: '#c47a3a', assembler: '#6f8aa6', lab: '#7fc6ff',
  belt: '#d8b03a', underground: '#d8b03a', splitter: '#d8b03a', inserter: '#d8b03a', chest: '#8d949c', uplink: '#3a9ab0', downlink: '#b03a9a',
  pole: '#a07a50', pipe: '#8a96a3', upipe: '#5e6a78', boiler: '#a8743f', generator: '#8b939c', solar: '#2a4a9a', accumulator: '#c3d642',
  beacon: '#6ff', gate: '#ffd23f',
};
const TIER = (t) => t === 1 ? '#d8b03a' : t === 2 ? '#e05a4a' : '#3a8ad8';

function drawBuilding(x, id) {
  const b = BUILDINGS[id];
  let c = KIND_COLOR[b.kind] || '#888';
  if (b.tier) c = TIER(b.tier);
  if (id === 'chem-plant') c = '#7cc48d';
  if (id === 'refinery') c = '#b9b2a8';
  const bg = x.createLinearGradient(0, 4, 0, 60); bg.addColorStop(0, '#4a5260'); bg.addColorStop(1, '#2b3038');
  x.fillStyle = bg; rr(x, 0, 4, 4, 56, 56, 10); x.fill();
  x.strokeStyle = c; x.lineWidth = 3; rr(x, 0, 5.5, 5.5, 53, 53, 9); x.stroke();
  x.fillStyle = c; x.strokeStyle = c; x.lineWidth = 4; x.lineCap = 'round'; x.lineJoin = 'round';
  switch (b.kind) {
    case 'belt': x.lineWidth = 6; for (const o of [0, 14]) { x.beginPath(); x.moveTo(18, 34 + o - 8); x.lineTo(32, 20 + o - 8); x.lineTo(46, 34 + o - 8); x.stroke(); } break;
    case 'underground': x.fillRect(14, 30, 36, 18); x.fillStyle = '#222'; x.beginPath(); x.arc(32, 48, 12, Math.PI, 0); x.fill(); break;
    case 'splitter': x.lineWidth = 5; x.beginPath(); x.moveTo(32, 50); x.lineTo(32, 34); x.lineTo(18, 16); x.moveTo(32, 34); x.lineTo(46, 16); x.stroke(); break;
    case 'inserter': {
      const ic = { 'burner-inserter': '#a0703a', 'long-inserter': '#e04a4a', 'fast-inserter': '#4a8ae0', 'filter-inserter': '#a05ae0', 'stack-inserter': '#4ac080' }[id] || '#e0b83a';
      x.strokeStyle = ic; x.fillStyle = ic; x.lineWidth = 5;
      x.beginPath(); x.moveTo(20, 50); x.lineTo(28, 28); x.lineTo(46, 18); x.stroke();
      x.beginPath(); x.arc(28, 28, 5, 0, 7); x.fill(); x.fillRect(14, 48, 16, 6);
      x.beginPath(); x.moveTo(44, 12); x.lineTo(50, 22); x.stroke();
      if (b.reach > 1) { x.beginPath(); x.moveTo(46, 18); x.lineTo(54, 12); x.stroke(); }
      break;
    }
    case 'drill': x.beginPath(); x.moveTo(22, 14); x.lineTo(42, 14); x.lineTo(32, 52); x.closePath(); x.fill(); x.strokeStyle = '#222'; x.lineWidth = 2; for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(24 + i * 1.5, 20 + i * 8); x.lineTo(40 - i * 1.5, 24 + i * 8); x.stroke(); } break;
    case 'pumpjack': x.lineWidth = 5; x.beginPath(); x.moveTo(12, 24); x.lineTo(50, 18); x.moveTo(30, 21); x.lineTo(26, 50); x.lineTo(40, 50); x.lineTo(32, 21); x.stroke(); break;
    case 'offshore': x.fillStyle = '#3d7fd6'; x.fillRect(10, 40, 44, 14); x.fillStyle = c; x.fillRect(22, 18, 20, 26); break;
    case 'furnace': {
      x.fillStyle = id === 'stone-furnace' ? '#9c8d77' : id === 'steel-furnace' ? '#5e666f' : '#7b8590'; x.fillRect(14, 16, 36, 36);
      x.fillStyle = '#ff8a2a'; x.beginPath(); x.moveTo(32, 26); x.quadraticCurveTo(42, 38, 32, 48); x.quadraticCurveTo(22, 38, 32, 26); x.fill();
      if (id === 'electric-furnace') { x.fillStyle = '#4ab0ff'; x.fillRect(14, 12, 36, 5); }
      break;
    }
    case 'assembler': {
      if (id === 'chem-plant') { x.fillStyle = '#c9c46a'; x.beginPath(); x.arc(24, 34, 10, 0, 7); x.fill(); x.fillStyle = '#7cc48d'; x.beginPath(); x.arc(40, 34, 10, 0, 7); x.fill(); break; }
      if (id === 'refinery') { x.fillRect(14, 20, 8, 32); x.fillRect(28, 28, 8, 24); x.fillRect(42, 34, 8, 18); x.fillStyle = '#ff8a3a'; x.fillRect(14, 14, 8, 5); break; }
      gearPath(x, 32, 32, 12, 17, 8); x.fill(); x.fillStyle = '#2b3038'; x.beginPath(); x.arc(32, 32, 5, 0, 7); x.fill();
      x.fillStyle = '#fff'; x.font = 'bold 13px sans-serif'; x.textAlign = 'center'; x.fillText(id.slice(-1) === '1' ? 'I' : id.slice(-1) === '2' ? 'II' : 'III', 32, 58 - 4);
      break;
    }
    case 'lab': x.fillStyle = 'rgba(127,198,255,0.6)'; x.beginPath(); x.arc(32, 34, 16, Math.PI, 0); x.fill(); x.fillStyle = '#ddd'; x.fillRect(12, 34, 40, 12); x.fillStyle = '#fff3a0'; x.fillRect(16, 26, 32, 3); break;
    case 'chest': case 'uplink': case 'downlink': {
      x.fillStyle = id === 'steel-chest' ? '#6a7078' : c; x.fillRect(14, 22, 36, 28); x.fillStyle = '#2b3038'; x.fillRect(14, 30, 36, 3); x.fillRect(29, 30, 6, 8);
      if (b.kind === 'uplink') { x.strokeStyle = '#6ff'; x.lineWidth = 4; x.beginPath(); x.moveTo(32, 18); x.lineTo(32, 6); x.moveTo(26, 12); x.lineTo(32, 6); x.lineTo(38, 12); x.stroke(); }
      if (b.kind === 'downlink') { x.strokeStyle = '#f6f'; x.lineWidth = 4; x.beginPath(); x.moveTo(32, 6); x.lineTo(32, 18); x.moveTo(26, 12); x.lineTo(32, 18); x.lineTo(38, 12); x.stroke(); }
      break;
    }
    case 'pole': x.lineWidth = id === 'substation' ? 8 : 5; x.beginPath(); x.moveTo(32, 54); x.lineTo(32, 12); x.moveTo(18, 18); x.lineTo(46, 18); x.stroke(); if (id === 'substation') { x.strokeRect(20, 30, 24, 20); } break;
    case 'pipe': x.fillRect(10, 26, 44, 12); x.fillStyle = '#5a6470'; x.fillRect(16, 23, 6, 18); x.fillRect(42, 23, 6, 18); break;
    case 'upipe': x.fillRect(10, 26, 24, 12); x.fillStyle = '#222'; x.beginPath(); x.arc(40, 32, 12, 0, 7); x.fill(); break;
    case 'boiler': x.fillStyle = '#a8743f'; rr(x, 0, 12, 22, 40, 24, 10); x.fill(); x.fillStyle = '#ff7a2a'; x.fillRect(26, 40, 12, 6); x.fillStyle = '#ddd'; x.fillRect(42, 10, 6, 14); break;
    case 'generator': x.fillStyle = '#8b939c'; x.fillRect(12, 26, 26, 20); x.strokeStyle = '#ddd'; x.lineWidth = 4; x.beginPath(); x.arc(44, 32, 11, 0, 7); x.stroke(); x.beginPath(); x.moveTo(44, 21); x.lineTo(44, 43); x.moveTo(33, 32); x.lineTo(55, 32); x.stroke(); break;
    case 'solar': x.fillStyle = '#2a4a9a'; x.fillRect(12, 14, 40, 36); x.strokeStyle = '#8ab4ff'; x.lineWidth = 1.5; for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(12 + i * 10, 14); x.lineTo(12 + i * 10, 50); x.stroke(); x.beginPath(); x.moveTo(12, 14 + i * 9); x.lineTo(52, 14 + i * 9); x.stroke(); } break;
    case 'accumulator': x.fillStyle = '#7d848c'; x.fillRect(14, 18, 14, 32); x.fillRect(36, 18, 14, 32); x.fillStyle = '#ffd23f'; x.fillRect(14, 14, 36, 4); break;
    case 'beacon': x.lineWidth = 4; x.beginPath(); x.moveTo(32, 54); x.lineTo(32, 26); x.stroke(); x.beginPath(); x.ellipse(32, 24, 16, 5, 0, 0, 7); x.stroke(); for (const r of [6, 12]) { x.beginPath(); x.arc(32, 14, r, Math.PI * 1.2, Math.PI * 1.8); x.stroke(); } break;
    case 'gate': { const g = x.createRadialGradient(32, 32, 2, 32, 32, 20); g.addColorStop(0, '#fff'); g.addColorStop(1, '#ffd23f'); x.fillStyle = g; x.beginPath(); x.arc(32, 32, 12, 0, 7); x.fill(); x.lineWidth = 3; x.beginPath(); x.arc(32, 32, 20, 0, 7); x.stroke(); break; }
  }
}

export function iconURL(id) {
  if (cache.has(id)) return cache.get(id);
  const c = document.createElement('canvas'); c.width = c.height = SZ;
  const x = c.getContext('2d');
  if (FLUIDS[id]) drawShape(x, 'fluid', FLUIDS[id].color, id);
  else if (BUILDINGS[id]) drawBuilding(x, id);
  else if (ITEMS[id]) drawShape(x, ITEMS[id].shape, ITEMS[id].color, id);
  else { x.fillStyle = '#f0f'; x.fillRect(8, 8, 48, 48); }
  const url = c.toDataURL();
  cache.set(id, url);
  return url;
}

export function iconImg(id, cls = 'ic') { return `<img class="${cls}" src="${iconURL(id)}" alt="" draggable="false">`; }

// Tech icon: the icon of its first unlock, or a symbol for bonuses.
export function techIcon(t) {
  if (t.unlocks.length) return iconURL(t.unlocks[0]);
  const key = 'tech:' + (t.effects[0]?.type || 'x');
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = SZ;
  const x = c.getContext('2d');
  const map = { 'mining-prod': ['#7d8fa6', '⛏'], 'lab-speed': ['#7fc6ff', '⚗'], 'craft-speed': ['#e0b83a', '✋'], 'stack-bonus': ['#4ac080', '⇶'] };
  const [col, sym] = map[t.effects[0]?.type] || ['#888', '?'];
  x.fillStyle = '#2b3038'; rr(x, 0, 4, 4, 56, 56, 10); x.fill();
  x.strokeStyle = col; x.lineWidth = 3; rr(x, 0, 6, 6, 52, 52, 9); x.stroke();
  x.fillStyle = col; x.font = '32px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(sym, 32, 34);
  x.fillStyle = '#fff'; x.font = 'bold 16px sans-serif'; x.fillText('+', 50, 16);
  const url = c.toDataURL(); cache.set(key, url); return url;
}
