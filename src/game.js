// 遊戲世界邏輯
import * as THREE from 'three';
import { LAYOUT, START_SPELLS, BUILD, SPELLS, TRIBE_NAMES, TRIBE_CSS, MANA_MAX, WATER, HALF } from './config.js';
import { Terrain } from './terrain.js';
import { Forest, mat } from './models.js';
import { Unit, Building, StoneHead } from './entities.js';
import { findPath } from './path.js';
import { castSpell } from './spells.js';
import { AI } from './ai.js';
import { FX } from './fx.js';
import { mulberry32, lerp } from './noise.js';

export class Game {
  constructor(scene, audio, opts) {
    this.scene = scene; this.audio = audio; this.opts = opts;
    this.seed = opts.seed;
    this.rand = mulberry32(opts.seed * 7 + 3);
    this.time = 0;
    this.units = []; this.buildings = []; this.heads = []; this.effects = [];
    this.pathQueue = []; this.messages = []; this.floats = []; this.pings = [];
    this.shakeAmt = 0; this.camTarget = { x: 0, z: 0 }; this.hearDist = 120;
    this.over = null; this.rally = null;
    this.terrain = new Terrain(scene, opts.seed);
    this.fx = new FX(scene);
    this.forest = new Forest(scene);
    const d = opts.diff;
    this.tribes = [0, 1, 2].map((i) => ({
      id: i, name: TRIBE_NAMES[i], css: TRIBE_CSS[i], mana: 45, wood: 35,
      unlocked: new Set(i < 2 ? START_SPELLS : []), shaman: null, totem: null, respawnT: 0, defeated: false,
      manaMul: i === 1 ? d.mana : 1, econ: i === 1 ? d.econ : 1, kills: 0,
    }));
    this.setup();
    this.ai = new AI(this, 1, d);
  }

  setup() {
    const R = this.rand;
    for (const h of LAYOUT.heads) this.heads.push(new StoneHead(this, h.x, h.z, h.spell));
    for (let t = 0; t < 2; t++) {
      const b = LAYOUT.bases[t];
      const s = t === 0 ? 1 : -1;
      this.placeBuilding('totem', t, b.x, b.z, true);
      this.placeBuilding('hut', t, b.x + 10 * s, b.z + 3 * s, true);
      this.placeBuilding('hut', t, b.x - 3 * s, b.z - 10 * s, true);
      this.spawnUnit('shaman', t, b.x + 4 * s, b.z + 6 * s);
      const n = t === 1 ? 7 : 6;
      for (let i = 0; i < n; i++) this.spawnUnit('brave', t, b.x + (R() - 0.5) * 10 + 5 * s, b.z + (R() - 0.5) * 10 + 5 * s);
    }
    // 樹林
    const noiseF = (x, z) => Math.sin(x * 0.07 + this.seed) + Math.sin(z * 0.09 - this.seed * 0.7) + Math.sin((x + z) * 0.05);
    for (let k = 0, placed = 0; k < 6000 && placed < 380; k++) {
      const x = (R() - 0.5) * 230, z = (R() - 0.5) * 230;
      const h = this.terrain.heightAt(x, z);
      if (h < 1.3 || h > 11) continue;
      if (noiseF(x, z) < 0.3 && R() > 0.08) continue;
      if (LAYOUT.bases.some((b) => Math.hypot(b.x - x, b.z - z) < 16)) continue;
      if (this.heads.some((hd) => Math.hypot(hd.pos.x - x, hd.pos.z - z) < 7)) continue;
      const f = this.terrain.flatness(x, z, 0.8);
      if (f.max - f.min > 1.6) continue;
      const t = this.forest.add(x, h, z, R() < 0.6 ? 'pine' : 'round', 0.8 + R() * 0.55);
      if (t) { t.grow = 1; this.forest.updateTree(t); placed++; }
    }
    // 岩石裝飾
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    this.rocks = new THREE.InstancedMesh(rockGeo, mat(0x8a857d, { roughness: 1, flatShading: true }), 160);
    this.rocks.castShadow = this.rocks.receiveShadow = true;
    this.rockData = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let k = 0, i = 0; k < 3000 && i < 160; k++) {
      const x = (R() - 0.5) * 240, z = (R() - 0.5) * 240, h = this.terrain.heightAt(x, z);
      if (h < -1 || LAYOUT.bases.some((b) => Math.hypot(b.x - x, b.z - z) < 20)) continue;
      const f = this.terrain.flatness(x, z, 1.5);
      if (f.max - f.min < 1.2 && R() > 0.15) continue;
      const s = 0.4 + R() * 1.1;
      this.rockData.push({ x, z, s, rx: R() * 6, ry: R() * 6 });
      q.setFromEuler(e.set(R() * 6, R() * 6, 0));
      m4.compose(new THREE.Vector3(x, h - s * 0.3, z), q, new THREE.Vector3(s, s * 0.7, s));
      this.rocks.setMatrixAt(i++, m4);
    }
    this.rocks.count = this.rockData.length;
    this.scene.add(this.rocks);
    // 野人
    const camps = [[-20, 40], [25, -45], [-95, -5], [95, 5], [-10, -60], [10, 60], [0, 10]];
    for (const [cx, cz] of camps) {
      const n = 2 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        let x = cx + (R() - 0.5) * 12, z = cz + (R() - 0.5) * 12;
        if (!this.terrain.walkable(x, z)) continue;
        const u = this.spawnUnit('wild', 2, x, z);
        if (u) u.home = { x: cx, z: cz };
      }
    }
  }

  setDifficulty(d) {
    this.opts.diff = d;
    this.ai.diff = d; this.ai.nextAttack = d.firstAttack;
    this.tribes[1].manaMul = d.mana; this.tribes[1].econ = d.econ;
    if (d.name === '困難') { const b = LAYOUT.bases[1]; for (let i = 0; i < 3; i++) this.spawnUnit('warrior', 1, b.x - 6 + i, b.z + 6); }
  }

  // ---------- 生成 ----------
  spawnUnit(type, tribe, x, z) {
    if (!this.terrain.walkable(x, z)) {
      let found = false;
      for (let r = 1; r < 10 && !found; r++) for (let a = 0; a < 8; a++) {
        const nx = x + Math.cos(a * 0.785) * r, nz = z + Math.sin(a * 0.785) * r;
        if (this.terrain.walkable(nx, nz)) { x = nx; z = nz; found = true; break; }
      }
    }
    const u = new Unit(this, type, tribe, x, z);
    this.units.push(u);
    if (type === 'shaman') this.tribes[tribe].shaman = u;
    return u;
  }
  canPlace(type, x, z) {
    const r = BUILD[type].radius;
    if (Math.abs(x) > HALF - 12 || Math.abs(z) > HALF - 12) return false;
    const f = this.terrain.flatness(x, z, r + 0.4);
    if (f.min < 0.7 || f.max - f.min > 2.4) return false;
    for (const b of this.buildings) if (b.alive && Math.hypot(b.pos.x - x, b.pos.z - z) < r + b.radius + 1.6) return false;
    for (const h of this.heads) if (Math.hypot(h.pos.x - x, h.pos.z - z) < r + h.prayR + 1.5) return false;
    return true;
  }
  placeBuilding(type, tribe, x, z, complete = false) {
    const st = BUILD[type];
    if (!complete) this.tribes[tribe].wood -= st.wood;
    const f = this.terrain.flatness(x, z, st.radius);
    const avg = Math.max(0.9, (f.min + f.max) / 2);
    const r = st.radius + 0.4;
    this.terrain.modify(x, z, r + 2.5, (h, d) => lerp(h, avg, d < r ? 1 : Math.max(0, 1 - (d - r) / 2.5) * 0.9));
    for (const t of this.forest.trees) if (t.alive && Math.hypot(t.x - x, t.z - z) < st.radius + 1.2) this.forest.remove(t);
    const b = new Building(this, type, tribe, x, z, complete);
    this.buildings.push(b);
    if (type === 'totem') this.tribes[tribe].totem = b;
    if (!complete) this.fx.dust(x, avg, z, 14, st.radius);
    return b;
  }

  // ---------- 查詢 ----------
  requestPath(u) { if (!u.pathPending) { u.pathPending = true; this.pathQueue.push(u); } }
  processPaths() {
    const t0 = performance.now();
    let n = 0;
    while (this.pathQueue.length && (n < 3 || performance.now() - t0 < 4)) {
      const u = this.pathQueue.shift(); n++;
      u.pathPending = false;
      if (!u.alive || !u.dest) continue;
      const p = findPath(this.terrain, u.pos.x, u.pos.z, u.dest[0], u.dest[1]);
      if (!p || !p.length) { u.pathFailed = true; u.path = null; }
      else { u.path = p; u.pathI = 0; }
    }
  }
  nearestEnemyUnit(u, r) {
    let best = null, bd = r;
    for (const o of this.units) {
      if (!o.alive || o.tribe === u.tribe || o.tribe === 2) continue;
      const d = Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  nearestTree(p, r) {
    const x = p.x ?? p.pos.x, z = p.z ?? p.pos.z;
    let best = null, bd = r;
    for (const t of this.forest.trees) {
      if (!t.alive || t.fall || t.grow < 0.8) continue;
      const d = Math.hypot(t.x - x, t.z - z) + Math.random() * 3;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  nearestDropoff(u) {
    let best = null, bd = 1e9;
    for (const b of this.buildings) {
      if (!b.alive || b.tribe !== u.tribe || !b.complete || b.type === 'warriorhut') continue;
      const d = Math.hypot(b.pos.x - u.pos.x, b.pos.z - u.pos.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  autoWork(u) {
    const tr = this.tribes[u.tribe];
    const sites = this.buildings.filter((b) => b.alive && b.tribe === u.tribe && !b.complete);
    for (const s of sites) {
      const builders = this.units.filter((o) => o.alive && o.ord.type === 'build' && o.ord.site === s).length;
      if (builders < 5 && Math.hypot(s.pos.x - u.pos.x, s.pos.z - u.pos.z) < 80) { u.setOrder({ type: 'build', site: s }); return; }
    }
    const home = tr.totem && tr.totem.alive ? tr.totem.pos : u.pos;
    let tree = this.nearestTree(u.pos, 30);
    if (!tree || Math.hypot(tree.x - home.x, tree.z - home.z) > 55) tree = this.nearestTree(home, 50);
    if (tree) u.setOrder({ type: 'gather', tree });
  }
  popOf(t) {
    let n = 0;
    for (const u of this.units) if (u.alive && u.tribe === t && u.isFollower) n++;
    for (const b of this.buildings) if (b.alive && b.tribe === t) n += b.trainQ;
    return n;
  }
  capOf(t) {
    let n = 8;
    for (const b of this.buildings) if (b.alive && b.tribe === t && b.type === 'hut' && b.complete) n += 6;
    return Math.min(100, n);
  }

  // ---------- 事件 ----------
  castSpell(caster, id, x, z) { castSpell(this, caster, id, x, z); }
  unlockSpell(t, spell, head) {
    const tr = this.tribes[t];
    if (tr.unlocked.has(spell)) return;
    tr.unlocked.add(spell);
    const sp = SPELLS[spell];
    this.fx.ringWave(head.pos.x, head.pos.y + 1, head.pos.z, 6, 0xfff0a0, 120);
    this.fx.magic(head.pos.x, head.pos.y + 2, head.pos.z, 0xfff0a0, 60, 2);
    if (t === 0) {
      this.msg(`${sp.icon} 眾神回應了祈禱！獲得法術「${sp.name}」`, '#ffe28a');
      this.sfx('unlock');
      this.banner = { text: `獲得法術：${sp.icon} ${sp.name}`, t: 3.5 };
    } else this.msg(`⚠ ${tr.name} 在石像獲得了「${sp.name}」`, '#ff9a8a');
  }
  onUnitDeath(u, silent) {
    const tr = this.tribes[u.tribe];
    if (u.type === 'shaman' && tr) {
      tr.shaman = null;
      if (tr.totem && tr.totem.alive) {
        tr.respawnT = 25;
        this.msg(u.tribe === 0 ? '你的薩滿倒下了！將於 25 秒後在圖騰重生' : `${tr.name} 的薩滿被擊倒了！`, u.tribe === 0 ? '#ff9a8a' : '#9fd4ff');
      } else this.msg(u.tribe === 0 ? '你的薩滿倒下了，圖騰已毀無法重生！' : '敵方薩滿已永久消滅！', '#ffd28a');
    }
    if (!silent && u.tribe !== 2) this.fx.poof(u.pos.x, u.pos.y, u.pos.z, 0xbbbbbb);
  }
  onBuildingComplete(b) {
    if (b.tribe === 0) { this.msg(`${BUILD[b.type].name} 建造完成`, '#bfe8a8'); this.sfx('done', b.pos); }
  }
  onBuildingDestroyed(b) {
    const tr = this.tribes[b.tribe];
    if (b.type === 'totem') { tr.totem = null; this.msg(b.tribe === 0 ? '⚠ 我方靈魂圖騰被摧毀了！' : '🔥 敵方靈魂圖騰被摧毀！', b.tribe === 0 ? '#ff8a7a' : '#ffe28a'); }
    else if (b.tribe === 0) this.msg(`我方${BUILD[b.type].name}被摧毀`, '#ff9a8a');
    this.onTerrainChanged(b.pos.x, b.pos.z, 0);
  }
  onTerrainChanged(x, z, r) {
    for (const t of this.forest.trees) {
      if (!t.alive || Math.hypot(t.x - x, t.z - z) > r + 2) continue;
      t.y = this.terrain.heightAt(t.x, t.z);
      if (t.y < WATER + 0.2) this.forest.remove(t); else this.forest.updateTree(t);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    this.rockData.forEach((rk, i) => {
      if (Math.hypot(rk.x - x, rk.z - z) > r + 2) return;
      q.setFromEuler(e.set(rk.rx, rk.ry, 0));
      m4.compose(new THREE.Vector3(rk.x, this.terrain.heightAt(rk.x, rk.z) - rk.s * 0.3, rk.z), q, new THREE.Vector3(rk.s, rk.s * 0.7, rk.s));
      this.rocks.setMatrixAt(i, m4);
    });
    this.rocks.instanceMatrix.needsUpdate = true;
  }
  enemyAttack(tgt) {
    this.msg('⚔ 赤焰部族的軍隊正在進攻！', '#ff8a7a');
    this.sfx('alarm');
    this.pings.push({ x: tgt.pos.x, z: tgt.pos.z, t: 4 });
  }
  fellTree(t, dir) { t.fall = true; t.fallDir = dir; t.tilt = 0; }
  burnTree(t) {
    for (let i = 0; i < 12; i++) this.fx.fire(t.x, t.y + 1 + Math.random() * 2, t.z, 0.8);
    this.terrain.burn(t.x, t.z, 1.6, 0.4);
    this.forest.remove(t);
  }
  msg(text, color = '#fff') { this.messages.push({ text, color, t: 7 }); if (this.messages.length > 7) this.messages.shift(); }
  floatText(text, pos, color) { this.floats.push({ text, color, x: pos.x, y: pos.y + 4, z: pos.z, t: 1.4 }); }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  sfx(name, pos) {
    if (pos && Math.hypot(pos.x - this.camTarget.x, pos.z - this.camTarget.z) > this.hearDist) return;
    this.audio.play(name);
  }

  // ---------- 主更新 ----------
  update(dt) {
    if (this.over) { this.fx.update(dt); return; }
    this.time += dt;
    for (let t = 0; t < 2; t++) {
      const tr = this.tribes[t];
      const f = this.units.reduce((n, u) => n + (u.alive && u.tribe === t && u.isFollower ? 1 : 0), 0);
      tr.followers = f;
      tr.mana = Math.min(MANA_MAX, tr.mana + dt * (0.25 + f * 0.012) * tr.manaMul);
      if (!tr.shaman && tr.respawnT > 0) {
        tr.respawnT -= dt;
        if (tr.respawnT <= 0 && tr.totem && tr.totem.alive) {
          const p = tr.totem.pos;
          const s = this.spawnUnit('shaman', t, p.x + 4, p.z + 4);
          this.fx.ringWave(p.x, p.y, p.z, 5, 0xffffff);
          this.fx.magic(s.pos.x, s.pos.y, s.pos.z, 0xffffff, 40, 1);
          if (t === 0) { this.msg('薩滿已在圖騰重生！', '#9fd4ff'); this.sfx('unlock'); }
        }
      }
    }
    this.processPaths();
    for (const u of this.units) u.update(dt);
    this.separate(dt);
    for (const b of this.buildings) b.update(dt);
    for (const h of this.heads) h.update(dt);
    this.effects = this.effects.filter((e) => e.update(dt));
    this.updateTrees(dt);
    this.ai.update(dt);
    this.fx.update(dt);
    this.units = this.units.filter((u) => !u.removed || u.alive);
    this.buildings = this.buildings.filter((b) => !b.removed);
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);
    for (const f of this.floats) { f.t -= dt; f.y += dt * 1.5; }
    this.floats = this.floats.filter((f) => f.t > 0);
    for (const p of this.pings) p.t -= dt;
    this.pings = this.pings.filter((p) => p.t > 0);
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    this.checkEnd();
  }
  separate(dt) {
    const us = this.units;
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      if (!a.alive || a.flung) continue;
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j];
        if (!b.alive || b.flung) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
        const d = Math.hypot(dx, dz);
        if (d >= min) continue;
        const push = (min - d) * 0.5 * Math.min(1, dt * 12), nx = d > 1e-3 ? dx / d : Math.random() - 0.5, nz = d > 1e-3 ? dz / d : Math.random() - 0.5;
        const wa = a.working ? 0.2 : 1, wb = b.working ? 0.2 : 1;
        this.nudge(a, -nx * push * wa, -nz * push * wa);
        this.nudge(b, nx * push * wb, nz * push * wb);
      }
      for (const b of this.buildings) {
        if (!b.alive) continue;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z, d = Math.hypot(dx, dz), min = b.radius + 0.2;
        if (d < min && d > 1e-3) this.nudge(a, (dx / d) * (min - d), (dz / d) * (min - d));
      }
    }
  }
  nudge(u, dx, dz) {
    const nx = u.pos.x + dx, nz = u.pos.z + dz;
    if (this.terrain.walkable(nx, nz) || !this.terrain.walkable(u.pos.x, u.pos.z)) { u.pos.x = nx; u.pos.z = nz; }
  }
  updateTrees(dt) {
    for (const t of this.forest.trees) {
      if (!t.alive) continue;
      if (t.fall) {
        t.tilt = Math.min(Math.PI / 2, t.tilt + dt * (0.6 + t.tilt * 2.5));
        this.forest.updateTree(t);
        if (t.tilt >= Math.PI / 2) { t.fall = 0; this.fx.dust(t.x + Math.sin(t.fallDir) * 2, t.y, t.z + Math.cos(t.fallDir) * 2, 12, 1.4); this.forest.remove(t); }
      } else if (t.grow < 1) { t.grow = Math.min(1, t.grow + dt * 0.02); this.forest.updateTree(t); }
    }
    this.regrowT = (this.regrowT || 0) + dt;
    if (this.regrowT > 5) {
      this.regrowT = 0;
      const alive = this.forest.alive();
      if (alive.length < 420 && alive.length) {
        const p = alive[Math.floor(Math.random() * alive.length)];
        const a = Math.random() * 6.28, r = 2 + Math.random() * 4;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, h = this.terrain.heightAt(x, z);
        if (h > 1.2 && h < 11 && !this.heads.some((hd) => Math.hypot(hd.pos.x - x, hd.pos.z - z) < 7) && !this.buildings.some((b) => b.alive && Math.hypot(b.pos.x - x, b.pos.z - z) < b.radius + 2))
          this.forest.add(x, h, z, p.kind, 0.8 + Math.random() * 0.5);
      }
    }
  }
  checkEnd() {
    this.endT = (this.endT || 0) + 1;
    if (this.endT % 30) return;
    for (let t = 0; t < 2; t++) {
      const f = this.units.some((u) => u.alive && u.tribe === t && u.isFollower);
      const b = this.buildings.some((b) => b.alive && b.tribe === t && b.type !== 'totem');
      if (!f && !b) this.tribes[t].defeated = true;
    }
    if (this.tribes[1].defeated) { this.over = 'win'; this.audio.play('win'); }
    else if (this.tribes[0].defeated) { this.over = 'lose'; this.audio.play('lose'); }
  }
}
