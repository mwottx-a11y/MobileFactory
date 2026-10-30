// World generation: terrain, water, ore patches, oil seeps.

export const ORES = ['', 'iron-ore', 'copper-ore', 'coal', 'stone', 'quartz', 'bauxite', 'crude-oil'];
export const ORE_ID = Object.fromEntries(ORES.map((o, i) => [o, i]));
export const OIL = ORE_ID['crude-oil'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value noise with smooth interpolation, seeded.
export function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const perm = new Uint16Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const h = (x, y) => vals[perm[(x & 255) + perm[y & 255]]];
  const s = (t) => t * t * (3 - 2 * t);
  function n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    const u = s(xf), v = s(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  return function fbm(x, y, oct = 4) {
    let f = 1, amp = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += n2(x * f, y * f) * amp; norm += amp; f *= 2; amp *= 0.5; }
    return sum / norm;
  };
}

export class World {
  constructor(size, seed) {
    this.size = size;
    this.seed = seed;
    const n = size * size;
    this.water = new Uint8Array(n);
    this.ore = new Uint8Array(n);
    this.amount = new Float32Array(n);
    this.shade = new Uint8Array(n); // cosmetic ground variation
    this.generate();
  }

  idx(x, y) { return y * this.size + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
  isWater(x, y) { return !this.inBounds(x, y) || this.water[this.idx(x, y)] === 1; }

  generate() {
    const S = this.size, c = S / 2;
    const rnd = mulberry32(this.seed * 7 + 3);
    const noiseA = makeNoise(this.seed);
    const noiseB = makeNoise(this.seed + 101);
    const noiseW = makeNoise(this.seed + 202);

    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = this.idx(x, y);
      this.shade[i] = Math.floor(noiseA(x / 24, y / 24) * 200 + noiseB(x / 5, y / 5) * 55);
      const d = Math.hypot(x - c, y - c);
      const w = noiseW(x / 40, y / 40, 4);
      if (d > 34 && w > 0.66) this.water[i] = 1;
      if (x < 2 || y < 2 || x >= S - 2 || y >= S - 2) this.water[i] = 1;
    }

    // Guaranteed starter lake.
    this.blob(c - 22, c + 16, 5, (x, y) => { this.water[this.idx(x, y)] = 1; }, 0.35);

    // Starter patches near spawn; richer and rarer resources further away.
    const patch = (ore, cx, cy, r, base) => {
      const oid = ORE_ID[ore];
      const pn = makeNoise(Math.floor(rnd() * 1e6));
      this.blob(cx, cy, r, (x, y, f) => {
        const i = this.idx(x, y);
        if (this.water[i]) return;
        const v = f * (0.6 + 0.8 * pn(x / 6, y / 6));
        if (v < 0.25) return;
        this.ore[i] = oid;
        this.amount[i] = Math.floor(base * (0.5 + v));
      }, 0.5, pn);
    };
    patch('iron-ore', c - 14, c - 6, 7, 900);
    patch('copper-ore', c + 13, c - 9, 6, 900);
    patch('coal', c - 3, c + 13, 5, 800);
    patch('stone', c + 14, c + 10, 4.5, 700);
    patch('quartz', c + 36, c + 30, 6, 1000);
    patch('bauxite', c - 58, c - 50, 7, 1400);

    // Oil seeps near spawn-ish
    this.seeps(c + 44, c - 34, 9, 10, rnd);

    // Random patches across the map
    const kinds = ['iron-ore', 'iron-ore', 'copper-ore', 'copper-ore', 'coal', 'stone', 'quartz', 'bauxite', 'iron-ore', 'copper-ore'];
    let placed = 0, tries = 0;
    while (placed < 70 && tries < 2000) {
      tries++;
      const x = 10 + rnd() * (S - 20), y = 10 + rnd() * (S - 20);
      const d = Math.hypot(x - c, y - c);
      if (d < 50) continue;
      if (rnd() < 0.12) { this.seeps(x, y, 7, 6 + Math.floor(rnd() * 6), rnd); placed++; continue; }
      const ore = kinds[Math.floor(rnd() * kinds.length)];
      const rich = 1 + d / 60;
      patch(ore, x, y, 5 + rnd() * 7, 1200 * rich);
      placed++;
    }

    // Keep the spawn area dry.
    for (let y = c - 8; y <= c + 8; y++) for (let x = c - 8; x <= c + 8; x++) this.water[this.idx(x, y)] = 0;
  }

  blob(cx, cy, r, fn, jitter = 0.4, pn = null) {
    const R = Math.ceil(r * 1.6);
    for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (!this.inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy) / r;
      const wobble = pn ? (pn(x / 4 + 9, y / 4 + 9) - 0.5) * jitter * 2 : 0;
      const f = 1 - d + wobble;
      if (f > 0) fn(x, y, Math.min(1, f));
    }
  }

  seeps(cx, cy, r, count, rnd) {
    for (let k = 0; k < count; k++) {
      const a = rnd() * Math.PI * 2, d = rnd() * r;
      const x = Math.floor(cx + Math.cos(a) * d), y = Math.floor(cy + Math.sin(a) * d);
      if (!this.inBounds(x, y)) continue;
      const i = this.idx(x, y);
      if (this.water[i]) continue;
      this.ore[i] = OIL;
      this.amount[i] = 60 + Math.floor(rnd() * 140); // yield percentage
    }
  }

  // Serialize ore state compactly.
  serialize() {
    const a16 = Uint16Array.from(this.amount, v => Math.min(65535, Math.ceil(v)));
    return { size: this.size, seed: this.seed, amount16: b64(new Uint8Array(a16.buffer)), ore: b64(this.ore) };
  }
  restore(data) {
    this.ore.set(unb64(data.ore));
    if (data.amount16) this.amount.set(new Uint16Array(unb64(data.amount16).buffer));
    else this.amount.set(new Float32Array(unb64(data.amount).buffer));
  }
}

function b64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
