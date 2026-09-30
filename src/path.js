// A* 尋路（8 方向）＋路徑平滑
import { N } from './config.js';

const SQ2 = Math.SQRT2;
const g = new Float32Array(N * N);
const f = new Float32Array(N * N);
const parent = new Int32Array(N * N);
const stamp = new Uint32Array(N * N);
const closed = new Uint32Array(N * N);
let curStamp = 1;
const heap = new Int32Array(N * N * 4);
let heapSize = 0;

function push(k) {
  let i = heapSize++;
  heap[i] = k;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (f[heap[p]] <= f[heap[i]]) break;
    const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
  }
}
function pop() {
  const top = heap[0];
  heap[0] = heap[--heapSize];
  let i = 0;
  for (;;) {
    const l = i * 2 + 1, r = l + 1;
    let m = i;
    if (l < heapSize && f[heap[l]] < f[heap[m]]) m = l;
    if (r < heapSize && f[heap[r]] < f[heap[m]]) m = r;
    if (m === i) break;
    const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
  }
  return top;
}

export function nearestWalkable(terrain, i, j, maxR = 10) {
  const W = terrain.walk;
  if (i >= 0 && j >= 0 && i < N && j < N && W[j * N + i]) return [i, j];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= N || b >= N || !W[b * N + a]) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = [a, b]; }
    }
    if (best) return best;
  }
  return null;
}

// 回傳世界座標路徑點陣列，或 null
export function findPath(terrain, sx, sz, tx, tz) {
  const W = terrain.walk;
  let [si, sj] = terrain.cellOf(sx, sz);
  let [ti, tj] = terrain.cellOf(tx, tz);
  const s = nearestWalkable(terrain, si, sj, 4);
  const t = nearestWalkable(terrain, ti, tj, 12);
  if (!s || !t) return null;
  [si, sj] = s; [ti, tj] = t;
  const goalExact = ti === terrain.cellOf(tx, tz)[0] && tj === terrain.cellOf(tx, tz)[1];
  const start = sj * N + si, goal = tj * N + ti;
  curStamp++;
  heapSize = 0;
  g[start] = 0; f[start] = 0; parent[start] = -1; stamp[start] = curStamp;
  push(start);
  let found = false, iter = 0;
  let bestK = start, bestH = 1e9;
  while (heapSize > 0 && iter++ < 26000) {
    const k = pop();
    if (closed[k] === curStamp) continue;
    closed[k] = curStamp;
    if (k === goal) { found = true; break; }
    const ci = k % N, cj = (k / N) | 0;
    const hh = Math.abs(ci - ti) + Math.abs(cj - tj);
    if (hh < bestH) { bestH = hh; bestK = k; }
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = nj * N + ni;
      if (!W[nk] || closed[nk] === curStamp) continue;
      if (di && dj && (!W[cj * N + ni] || !W[nj * N + ci])) continue; // 不切角
      const ng = g[k] + (di && dj ? SQ2 : 1);
      if (stamp[nk] !== curStamp || ng < g[nk]) {
        stamp[nk] = curStamp; g[nk] = ng; parent[nk] = k;
        const dx = Math.abs(ni - ti), dz = Math.abs(nj - tj);
        f[nk] = ng + (dx + dz + (SQ2 - 2) * Math.min(dx, dz)) * 1.05;
        push(nk);
      }
    }
  }
  const end = found ? goal : bestK;
  const cells = [];
  for (let k = end; k !== -1; k = parent[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map((k) => terrain.cellCenter(k % N, (k / N) | 0));
  if (found && goalExact) pts[pts.length - 1] = [tx, tz];
  return smooth(terrain, sx, sz, pts);
}

function lineClear(terrain, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az), steps = Math.ceil(d / 0.6);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (!terrain.walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

function smooth(terrain, sx, sz, pts) {
  if (pts.length <= 1) return pts;
  const out = [];
  let cx = sx, cz = sz, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !lineClear(terrain, cx, cz, pts[j][0], pts[j][1])) j--;
    out.push(pts[j]);
    cx = pts[j][0]; cz = pts[j][1];
    i = j + 1;
  }
  return out;
}

export { lineClear };
