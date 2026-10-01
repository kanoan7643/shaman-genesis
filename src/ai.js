// 敵方部族 AI
import { SPELLS, BUILD, TRAIN_COST, LAYOUT } from './config.js';

export class AI {
  constructor(g, tribe, diff) {
    this.g = g; this.tribe = tribe; this.diff = diff;
    this.t = 0; this.nextAttack = diff.firstAttack; this.attacking = false; this.castT = 0;
    const base = LAYOUT.bases[tribe];
    this.base = base;
    // 敵方可觸及的石像（不含孤島）
    this.heads = g.heads.filter((h) => Math.hypot(h.pos.x - base.x, h.pos.z - base.z) < 120 && !h.far)
      .sort((a, b) => Math.hypot(a.pos.x - base.x, a.pos.z - base.z) - Math.hypot(b.pos.x - base.x, b.pos.z - base.z));
  }
  update(dt) {
    this.t -= dt; this.castT -= dt;
    this.shamanLogic();
    if (this.t > 0) return;
    this.t = 1;
    const g = this.g, T = this.tribe, tr = g.tribes[T];
    if (tr.defeated) return;
    const mine = g.units.filter((u) => u.alive && u.tribe === T);
    const braves = mine.filter((u) => u.type === 'brave');
    const warriors = mine.filter((u) => u.type === 'warrior');
    const blds = g.buildings.filter((b) => b.alive && b.tribe === T);
    const huts = blds.filter((b) => b.type === 'hut');
    const whuts = blds.filter((b) => b.type === 'warriorhut');
    const sites = blds.filter((b) => !b.complete);
    const totem = tr.totem && tr.totem.alive ? tr.totem : null;
    const center = totem ? totem.pos : (blds[0] ? blds[0].pos : { x: this.base.x, z: this.base.z });

    // 經濟：蓋房子
    const wantHuts = Math.min(9, 2 + Math.floor(g.time / (75 / this.diff.econ)));
    if (sites.length < 2) {
      if (whuts.length === 0 && huts.length >= 3 && tr.wood >= BUILD.warriorhut.wood) this.place('warriorhut', center);
      else if (huts.length < wantHuts && tr.wood >= BUILD.hut.wood) this.place('hut', center);
      else if (whuts.length < 2 && huts.length >= 6 && tr.wood >= BUILD.warriorhut.wood + 20) this.place('warriorhut', center);
    }
    // 訓練戰士
    const wantWar = Math.min(26, 3 + Math.floor(g.time / 45 * this.diff.econ));
    const wh = whuts.find((b) => b.complete);
    if (wh && braves.length > 7 && warriors.length + wh.trainQ < wantWar && tr.wood >= TRAIN_COST) {
      const b = braves.find((u) => !u.manual && u.ord.type !== 'train');
      if (b) { tr.wood -= TRAIN_COST; b.setOrder({ type: 'train', hut: wh }, true); }
    }
    // 祈禱：石像
    const idleBraves = () => braves.filter((u) => !u.manual && u.alive && u.ord.type !== 'train');
    for (const h of this.heads) {
      if (tr.unlocked.has(h.spell) || g.time < 45) continue;
      const assigned = braves.filter((u) => u.ord.type === 'pray' && u.ord.site === h).length;
      const threat = g.units.some((u) => u.alive && u.tribe === 0 && u.type !== 'brave' && Math.hypot(u.pos.x - h.pos.x, u.pos.z - h.pos.z) < 14);
      if (threat) continue;
      if (assigned < 3 + (this.diff.econ > 1.2 ? 1 : 0) && braves.length > 6) {
        const b = idleBraves()[0];
        if (b) b.setOrder({ type: 'pray', site: h }, true);
      }
      break; // 一次專注一座石像
    }
    // 祈禱：補充法術次數（圖騰平均補充；火球另派人到最近的火球石像）
    const needCharge = g.needsCharge(T);
    if (totem && needCharge) {
      const atTotem = braves.filter((u) => u.ord.type === 'pray' && u.ord.site === totem).length;
      const want = Math.min(6, Math.floor(braves.length / 4));
      if (atTotem < want) { const b = idleBraves()[0]; if (b) b.setOrder({ type: 'pray', site: totem }, true); }
    }
    const blastHead = this.heads.find((h) => h.spell === 'blast');
    if (blastHead && tr.unlocked.has('blast') && tr.charges.blast < SPELLS.blast.charges && braves.length > 8) {
      const at = braves.filter((u) => u.ord.type === 'pray' && u.ord.site === blastHead).length;
      if (at < 2) { const b = idleBraves()[0]; if (b) b.setOrder({ type: 'pray', site: blastHead }, true); }
    }
    // 解鎖完成或彈藥已滿時釋放祈禱者
    for (const b of braves) {
      if (b.ord.type !== 'pray') continue;
      const site = b.ord.site;
      if (site.kind === 'head' && tr.unlocked.has(site.spell) && tr.charges[site.spell] >= SPELLS[site.spell].charges) b.setOrder({ type: 'idle' }, false);
      else if (site.kind === 'building' && !needCharge) b.setOrder({ type: 'idle' }, false);
    }

    // 防守
    const intruders = g.units.filter((u) => u.alive && u.tribe === 0 && Math.hypot(u.pos.x - center.x, u.pos.z - center.z) < 38);
    if (intruders.length) {
      for (const w of warriors) if (w.ord.type !== 'attack' && !(this.attacking && w.manual)) w.setOrder({ type: 'attack', target: this.closest(w, intruders), auto: true }, true);
      if (intruders.length > braves.length * 0.3) for (const b of braves) if (b.ord.type !== 'attack' && Math.hypot(b.pos.x - center.x, b.pos.z - center.z) < 40 && Math.random() < 0.5) b.setOrder({ type: 'attack', target: this.closest(b, intruders), auto: true });
    }

    // 進攻
    if (g.time > this.nextAttack) {
      const army = warriors.filter((w) => w.ord.type !== 'train');
      const need = this.diff.army + Math.floor(g.time / 240) * 2;
      if (army.length >= need || (army.length >= 3 && g.time > this.nextAttack + 90)) {
        const tgt = this.pickTarget();
        if (tgt) {
          const extra = braves.filter((b) => !b.manual).slice(0, Math.floor(braves.length * 0.25));
          for (const u of [...army, ...extra]) u.setOrder({ type: 'move', x: tgt.pos.x + (Math.random() - 0.5) * 8, z: tgt.pos.z + (Math.random() - 0.5) * 8, amove: true }, true);
          if (tr.shaman && tr.shaman.alive) tr.shaman.setOrder({ type: 'move', x: tgt.pos.x, z: tgt.pos.z, amove: true }, true);
          this.attacking = true; this.attackTarget = tgt;
          g.enemyAttack(tgt);
          this.nextAttack = g.time + this.diff.interval;
        }
      }
    }
    // 進攻中的單位抵達後繼續找目標
    if (this.attacking) {
      const tgt = this.pickTarget();
      for (const u of mine) {
        if (!u.manual || u.type === 'shaman') continue;
        if (u.ord.type === 'idle' && tgt) u.setOrder({ type: 'attack', target: tgt }, true);
      }
      if (!tgt) this.attacking = false;
    }
    // 回收無事可做的手動勇者
    for (const b of braves) if (b.manual && b.ord.type === 'idle' && !this.attacking) b.manual = false;
  }
  closest(u, list) {
    let best = null, bd = 1e9;
    for (const o of list) { const d = Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  pickTarget() {
    const g = this.g;
    const ref = { pos: { x: this.base.x, z: this.base.z } };
    const bl = g.buildings.filter((b) => b.alive && b.tribe === 0);
    if (bl.length) return this.closest(ref, bl);
    const us = g.units.filter((u) => u.alive && u.tribe === 0);
    return us.length ? this.closest(ref, us) : null;
  }
  place(type, center) {
    const g = this.g;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * (14 + g.time / 30);
      const x = center.x + Math.cos(a) * Math.min(r, 34), z = center.z + Math.sin(a) * Math.min(r, 34);
      if (g.canPlace(type, x, z)) { g.placeBuilding(type, this.tribe, x, z); return true; }
    }
    return false;
  }
  shamanLogic() {
    const g = this.g, tr = g.tribes[this.tribe], s = tr.shaman;
    if (!s || !s.alive || s.flung || this.castT > 0 || s.ord.type === 'cast') return;
    this.castT = 1.5;
    // 簡單難度會保留最後一發，不會把法術用光
    const has = (sp) => tr.unlocked.has(sp) && tr.charges[sp] >= (this.diff.name === '簡單' ? 2 : 1);
    const foes = g.units.filter((u) => u.alive && u.tribe === 0 && Math.hypot(u.pos.x - s.pos.x, u.pos.z - s.pos.z) < 44);
    if (foes.length) {
      // 找最密集的敵人
      let best = null, bn = 0;
      for (const f of foes) {
        let n = 0;
        for (const o of foes) if (Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z) < 4.5) n += o.type === 'shaman' ? 3 : o.type === 'warrior' ? 1.5 : 1;
        if (n > bn) { bn = n; best = f; }
      }
      const shamanFoe = foes.find((f) => f.type === 'shaman');
      let spell = null, tgt = best;
      if (shamanFoe && has('lightning') && Math.random() < 0.6) { spell = 'lightning'; tgt = shamanFoe; }
      else if (bn >= 6 && has('tornado')) spell = 'tornado';
      else if (bn >= 3 && has('lightning')) spell = 'lightning';
      else if (bn >= 1.5 && has('blast')) spell = 'blast';
      if (spell && Math.hypot(tgt.pos.x - s.pos.x, tgt.pos.z - s.pos.z) < SPELLS[spell].range + 10) {
        s.setOrder({ type: 'cast', spell, x: tgt.pos.x, z: tgt.pos.z, resume: s.ord }, true);
        return;
      }
    }
    // 攻城：對玩家建築丟雷擊
    if (this.attacking && has('lightning') && tr.charges.lightning >= 2) {
      const b = g.buildings.find((b) => b.alive && b.tribe === 0 && Math.hypot(b.pos.x - s.pos.x, b.pos.z - s.pos.z) < SPELLS.lightning.range);
      if (b) { s.setOrder({ type: 'cast', spell: 'lightning', x: b.pos.x, z: b.pos.z }, true); return; }
    }
    // 感化野人
    if (has('convert') && s.ord.type === 'idle') {
      const w = g.units.find((u) => u.alive && u.type === 'wild' && Math.hypot(u.pos.x - s.pos.x, u.pos.z - s.pos.z) < 50);
      if (w) { s.setOrder({ type: 'cast', spell: 'convert', x: w.pos.x, z: w.pos.z }, true); return; }
    }
    // 閒置時回家
    if (s.ord.type === 'idle' && !this.attacking && tr.totem && tr.totem.alive && Math.hypot(tr.totem.pos.x - s.pos.x, tr.totem.pos.z - s.pos.z) > 20)
      s.setOrder({ type: 'move', x: tr.totem.pos.x + 5, z: tr.totem.pos.z + 5 }, true);
  }
}
