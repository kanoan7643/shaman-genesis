// 可設定種子的亂數與 Perlin 雜訊
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise2D {
  constructor(rand = Math.random) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  grad(h, x, y) {
    switch (h & 7) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  }
  noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10);
    const P = this.perm;
    const a = P[X] + Y, b = P[X + 1] + Y;
    const l1 = this.grad(P[a], x, y) + u * (this.grad(P[b], x - 1, y) - this.grad(P[a], x, y));
    const l2 = this.grad(P[a + 1], x, y - 1) + u * (this.grad(P[b + 1], x - 1, y - 1) - this.grad(P[a + 1], x, y - 1));
    return l1 + v * (l2 - l1);
  }
  fbm(x, y, oct = 4) {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += this.noise(x * f, y * f) * amp;
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return s / norm;
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return Math.sqrt(x * x + z * z);
}
