// 單位、建築、石像
import * as THREE from 'three';
import { UNIT_STATS, BUILD, WATER, SPELLS, HALF, TRIBE_COLORS, PRAY_HEAD, PRAY_TOTEM } from './config.js';
import { makeUnitModel, makeBuildingModel, makeStoneHead } from './models.js';
import { lineClear } from './path.js';
import { clamp } from './noise.js';

let NEXT_ID = 1;
const angleLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

export class Unit {
  constructor(game, type, tribe, x, z) {
    this.id = NEXT_ID++;
    this.kind = 'unit';
    this.game = game; this.type = type; this.tribe = tribe;
    const s = UNIT_STATS[type];
    this.stats = s;
    this.maxHp = this.hp = s.hp; this.speed = s.speed * (0.94 + Math.random() * 0.12);
    this.pos = new THREE.Vector3(x, game.terrain.heightAt(x, z), z);
    this.vel = new THREE.Vector3();
    this.heading = Math.random() * Math.PI * 2;
    this.ord = { type: type === 'wild' ? 'wander' : 'idle' };
    this.manual = false;
    this.path = null; this.pathI = 0; this.dest = null; this.pathPending = false; this.pathFailed = false;
    this.carry = 0; this.atkCd = 0; this.workT = 0; this.thinkT = Math.random() * 0.5;
    this.animT = Math.random() * 10; this.swingT = 0; this.castT = 0;
    this.alive = true; this.removed = false; this.selected = false; this.lastHurt = -99; this.drownT = 0;
    this.flung = false; this.spin = 0; this.deadT = 0;
    this.home = { x, z }; this.idleSince = game.time;
    const m = makeUnitModel(type, tribe, s.scale);
    this.model = m;
    game.scene.add(m.root);
    this.sync();
  }
  get radius() { return 0.45 * this.stats.scale; }
  get isFollower() { return this.type === 'brave' || this.type === 'warrior'; }

  setOrder(o, manual) {
    if (!this.alive || this.flung) { if (this.flung) this.pendingOrd = o; return; }
    if (o.type === 'idle' && this.ord.type !== 'idle') this.idleSince = this.game.time;
    this.ord = o; this.path = null; this.dest = null; this.workT = 0; this.castT = 0; this.pathFailed = false;
    if (manual !== undefined) this.manual = manual;
  }

  // ---------- 移動 ----------
  goTo(x, z, arrive, dt) {
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    if (d <= arrive) { this.path = null; this.dest = null; return true; }
    const g = this.game;
    if (!this.dest || Math.hypot(this.dest[0] - x, this.dest[1] - z) > 1.5) {
      this.dest = [x, z]; this.pathI = 0; this.pathFailed = false;
      if (d < 8 && lineClear(g.terrain, this.pos.x, this.pos.z, x, z)) this.path = [[x, z]];
      else { this.path = null; g.requestPath(this); }
    }
    if (!this.path) return this.pathFailed ? null : false;
    if (this.pathI >= this.path.length) {
      // 路徑走完但尚未抵達（目標不可達）
      if (d < arrive + 2.5 && g.terrain.walkable(x, z)) { this.step(x, z, dt); return false; }
      return null;
    }
    const wp = this.path[this.pathI];
    const last = this.pathI === this.path.length - 1;
    const wd = Math.hypot(wp[0] - this.pos.x, wp[1] - this.pos.z);
    if (wd < (last ? 0.3 : 0.8)) { this.pathI++; return false; }
    this.step(wp[0], wp[1], dt);
    return false;
  }
  step(tx, tz, dt, mul = 1) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const sp = Math.min(d, this.speed * mul * dt);
    const nx = this.pos.x + (dx / d) * sp, nz = this.pos.z + (dz / d) * sp;
    const t = this.game.terrain;
    if (t.heightAt(nx, nz) > WATER - 0.1 || t.heightAt(nx, nz) >= t.heightAt(this.pos.x, this.pos.z)) {
      this.pos.x = nx; this.pos.z = nz;
    }
    this.face(dx, dz, dt);
    this.moving = true;
  }
  face(dx, dz, dt) { this.heading = angleLerp(this.heading, Math.atan2(dx, dz), Math.min(1, dt * 10)); }

  // ---------- 更新 ----------
  update(dt) {
    if (!this.alive) return this.updateDead(dt);
    this.moving = false; this.working = null;
    if (this.flung) { this.updateFlung(dt); this.animate(dt); return; }
    const g = this.game;
    const ground = g.terrain.heightAt(this.pos.x, this.pos.z);
    if (ground < WATER - 0.6) {
      this.drownT += dt;
      if (this.drownT > 1.5) { g.fx.splash(this.pos.x, this.pos.z); g.sfx('splash', this.pos); this.die(); return; }
    } else this.drownT = 0;
    this.atkCd -= dt; this.thinkT -= dt; this.swingT -= dt;
    const o = this.ord;
    switch (o.type) {
      case 'idle': this.doIdle(dt); break;
      case 'wander': this.doWander(dt); break;
      case 'move': this.doMove(dt); break;
      case 'attack': this.doAttack(dt); break;
      case 'gather': this.doGather(dt); break;
      case 'build': this.doBuild(dt); break;
      case 'pray': this.doPray(dt); break;
      case 'train': this.doTrain(dt); break;
      case 'cast': this.doCast(dt); break;
    }
    if (!this.alive) return;
    this.pos.x = clamp(this.pos.x, -HALF + 3, HALF - 3); this.pos.z = clamp(this.pos.z, -HALF + 3, HALF - 3);
    const gh = g.terrain.heightAt(this.pos.x, this.pos.z);
    this.pos.y = gh < WATER - 0.6 ? WATER - 0.9 * this.stats.scale + Math.sin(g.time * 6) * 0.1 : gh;
    this.animate(dt);
  }

  aggroRange() {
    if (this.type === 'warrior') return this.stats.aggro;
    if (this.type === 'shaman') return this.tribe === 0 ? 7 : 12;
    if (this.type === 'brave') return this.manual ? 5 : 7;
    return 0;
  }
  lookForFight(resume) {
    if (this.type === 'wild') return false;
    const e = this.game.nearestEnemyUnit(this, this.aggroRange());
    if (e) { this.setOrder({ type: 'attack', target: e, auto: true, resume }); return true; }
    return false;
  }
  finish() {
    const r = this.ord.resume;
    if (r && (!r.target || r.target.alive)) this.setOrder(r);
    else this.setOrder({ type: 'idle' });
  }

  doIdle(dt) {
    if (this.thinkT > 0) return;
    this.thinkT = 0.4 + Math.random() * 0.3;
    if (this.lookForFight()) return;
    if (!this.manual && this.type === 'brave') this.game.autoWork(this);
  }
  doWander(dt) {
    const o = this.ord;
    if (!o.tx || this.thinkT < -4) {
      this.thinkT = Math.random() * 2;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 7;
      o.tx = this.home.x + Math.cos(a) * r; o.tz = this.home.z + Math.sin(a) * r;
    }
    if (!this.game.terrain.walkable(o.tx, o.tz)) { o.tx = null; return; }
    if (Math.hypot(o.tx - this.pos.x, o.tz - this.pos.z) > 0.5) this.step(o.tx, o.tz, dt, 0.5);
  }
  doMove(dt) {
    const o = this.ord;
    if (o.amove && this.thinkT <= 0) { this.thinkT = 0.4; if (this.lookForFight(o)) return; }
    const r = this.goTo(o.x, o.z, 0.5, dt);
    if (r === true || r === null) this.setOrder({ type: 'idle' });
  }
  doAttack(dt) {
    const o = this.ord, t = o.target;
    if (!t || !t.alive || (t.kind === 'unit' && t.tribe === this.tribe)) { this.finish(); return; }
    const reach = this.stats.range + (t.kind === 'unit' ? t.radius : t.radius);
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d > reach) {
      if (o.auto && d > this.aggroRange() * 2.2 + 4) { this.finish(); return; }
      // 攻擊途中若有更近的敵方單位，改打它（攻擊建築時）
      if (t.kind !== 'unit' && this.thinkT <= 0) {
        this.thinkT = 0.6;
        const e = this.game.nearestEnemyUnit(this, Math.min(8, this.aggroRange() + 2));
        if (e) { this.setOrder({ type: 'attack', target: e, auto: true, resume: o }); return; }
      }
      const r = this.goTo(t.pos.x, t.pos.z, reach * 0.85, dt);
      if (r === null) this.finish();
      return;
    }
    this.face(dx, dz, dt);
    if (this.atkCd <= 0) {
      this.atkCd = this.stats.rate;
      this.swingT = 0.35;
      const dmg = this.stats.dmg * (0.8 + Math.random() * 0.4);
      const g = this.game;
      t.damage(dmg, this);
      g.fx.hit(t.pos.x, t.pos.y + 1, t.pos.z);
      g.sfx('hit', this.pos);
    }
  }
  doGather(dt) {
    const g = this.game, o = this.ord;
    if (this.carry > 0) {
      const drop = g.nearestDropoff(this);
      if (!drop) { this.setOrder({ type: 'idle' }); return; }
      const r = this.goTo(drop.pos.x, drop.pos.z, drop.radius + 1.0, dt);
      if (r === true) {
        g.tribes[this.tribe].wood += this.carry;
        if (this.tribe === 0) g.floatText(`+${this.carry} 木`, drop.pos, '#e8c27a');
        this.carry = 0;
      } else if (r === null) this.setOrder({ type: 'idle' });
      return;
    }
    let tree = o.tree;
    if (!tree || !tree.alive || tree.fall) {
      tree = g.nearestTree(o.tree || this.pos, 22);
      if (!tree) { this.setOrder({ type: 'idle' }); return; }
      o.tree = tree;
    }
    const r = this.goTo(tree.x, tree.z, 1.4, dt);
    if (r === null) { o.tree = null; this.pathFailed = false; this.setOrder({ type: 'idle' }); return; }
    if (r !== true) return;
    this.working = 'chop';
    this.face(tree.x - this.pos.x, tree.z - this.pos.z, dt);
    const before = this.workT;
    this.workT += dt;
    if (Math.floor(before / 0.55) !== Math.floor(this.workT / 0.55)) { g.sfx('chop', this.pos); g.fx.dust(tree.x, tree.y + 1, tree.z, 2, 0.4); }
    if (this.workT >= 4.5) {
      this.workT = 0;
      const amt = Math.min(tree.wood, 4);
      tree.wood -= amt; this.carry = amt;
      if (tree.wood <= 0) g.fellTree(tree, Math.atan2(tree.x - this.pos.x, tree.z - this.pos.z));
    }
  }
  doBuild(dt) {
    const g = this.game, s = this.ord.site;
    if (!s || !s.alive || s.complete) { this.setOrder({ type: 'idle' }); return; }
    const r = this.goTo(s.pos.x, s.pos.z, s.radius + 1.1, dt);
    if (r === null) { this.setOrder({ type: 'idle' }); return; }
    if (r !== true) return;
    this.working = 'build';
    this.face(s.pos.x - this.pos.x, s.pos.z - this.pos.z, dt);
    const before = this.workT; this.workT += dt;
    if (Math.floor(before / 0.5) !== Math.floor(this.workT / 0.5)) g.sfx('build', this.pos);
    s.addWork(dt);
  }
  doPray(dt) {
    const g = this.game, o = this.ord, s = o.site;
    if (!s || !s.alive) { this.setOrder({ type: 'idle' }); return; }
    if (this.thinkT <= 0) {
      this.thinkT = 0.8;
      const e = g.nearestEnemyUnit(this, 4.5);
      if (e && this.type !== 'shaman') { this.setOrder({ type: 'attack', target: e, auto: true, resume: o }); return; }
    }
    if (o.angle === undefined) o.angle = s.nextPraySlot();
    const R = s.prayR;
    const tx = s.pos.x + Math.cos(o.angle) * R, tz = s.pos.z + Math.sin(o.angle) * R;
    const r = this.goTo(tx, tz, 0.6, dt);
    if (r === null) {
      // 若無法抵達指定位置，找最近可站立點
      if (Math.hypot(s.pos.x - this.pos.x, s.pos.z - this.pos.z) < R + 3) { o.angle = undefined; }
      else { this.setOrder({ type: 'idle' }); return; }
    }
    if (r !== true && Math.hypot(s.pos.x - this.pos.x, s.pos.z - this.pos.z) > R + 1.2) return;
    this.working = 'pray';
    this.face(s.pos.x - this.pos.x, s.pos.z - this.pos.z, dt);
    s.pray(this, dt);
  }
  doTrain(dt) {
    const g = this.game, h = this.ord.hut;
    if (!h || !h.alive || !h.complete) { this.setOrder({ type: 'idle' }); return; }
    const door = h.door();
    const r = this.goTo(door.x, door.z, 1.2, dt);
    if (r === null) { this.setOrder({ type: 'idle' }); return; }
    if (r === true) {
      h.trainQ++;
      g.fx.poof(this.pos.x, this.pos.y, this.pos.z, 0xe0d0b0);
      this.vanish();
    }
  }
  doCast(dt) {
    const g = this.game, o = this.ord, sp = SPELLS[o.spell];
    const d = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
    if (this.castT <= 0 && d > sp.range - 0.5) {
      const r = this.goTo(o.x, o.z, sp.range - 1.5, dt);
      if (r === null) { if (this.tribe === 0) g.msg('無法走到施法範圍內'); this.setOrder({ type: 'idle' }); }
      return;
    }
    this.face(o.x - this.pos.x, o.z - this.pos.z, dt);
    if (this.castT <= 0) {
      const tr = g.tribes[this.tribe];
      if (tr.charges[o.spell] < 1) { if (this.tribe === 0) { g.msg(`${sp.icon} ${sp.name} 沒有次數了！讓子民在石像或圖騰祈禱以補充`); g.sfx('error'); } this.setOrder({ type: 'idle' }); return; }
      tr.charges[o.spell]--;
      this.castT = 0.75;
      g.sfx('cast', this.pos);
      g.fx.magic(this.pos.x, this.pos.y + 2, this.pos.z, TRIBE_COLORS[this.tribe], 25, 0.8);
      return;
    }
    this.working = 'cast';
    this.castT -= dt;
    if (this.castT <= 0) {
      g.castSpell(this, o.spell, o.x, o.z);
      this.castT = 0;
      this.setOrder({ type: 'idle' });
    }
  }

  // ---------- 物理 / 傷害 ----------
  fling(vx, vy, vz) {
    if (!this.alive) return;
    if (!this.flung) this.pendingOrd = null;
    this.flung = true; this.vel.set(vx, vy, vz); this.spin = (Math.random() - 0.5) * 16;
    this.pos.y += 0.3; this.path = null; this.dest = null;
  }
  updateFlung(dt) {
    const g = this.game;
    this.vel.y -= 30 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.pos.x = clamp(this.pos.x, -HALF + 3, HALF - 3); this.pos.z = clamp(this.pos.z, -HALF + 3, HALF - 3);
    const gh = g.terrain.heightAt(this.pos.x, this.pos.z);
    const floor = Math.max(gh, WATER);
    if (this.pos.y <= floor && this.vel.y < 0) {
      if (gh < WATER - 0.4) { g.fx.splash(this.pos.x, this.pos.z); g.sfx('splash', this.pos); this.pos.y = WATER; this.die(); return; }
      const impact = -this.vel.y;
      this.flung = false; this.pos.y = gh; this.vel.set(0, 0, 0);
      g.fx.dust(this.pos.x, gh, this.pos.z, 6, 0.6);
      if (impact > 12) this.damage((impact - 12) * 2.6, null);
      const p = this.pendingOrd; this.pendingOrd = null;
      if (this.alive) this.setOrder(p || (this.type === 'wild' ? { type: 'wander' } : { type: 'idle' }));
    }
  }
  damage(amount, src) {
    if (!this.alive) return;
    this.hp -= amount;
    this.lastHurt = this.game.time;
    if (this.hp <= 0) { this.die(); return; }
    if (src && src.kind === 'unit' && src.alive && src.tribe !== this.tribe && this.type !== 'wild' && !this.flung) {
      const t = this.ord.type;
      if (t === 'idle' || t === 'gather' || t === 'build' || t === 'pray' || (t === 'move' && this.ord.amove)) {
        if (this.type === 'shaman' && this.tribe === 0 && t !== 'idle') return;
        this.setOrder({ type: 'attack', target: src, auto: true, resume: t === 'idle' ? null : this.ord });
      }
    }
  }
  die() {
    if (!this.alive) return;
    this.alive = false; this.deadT = 0; this.selected = false;
    this.model.ring.visible = false;
    this.game.onUnitDeath(this);
    this.game.sfx('die', this.pos);
  }
  vanish() { this.alive = false; this.deadT = 99; this.game.onUnitDeath(this, true); }
  updateDead(dt) {
    this.deadT += dt;
    const b = this.model.parts.body;
    b.rotation.x = Math.min(Math.PI / 2, this.deadT * 5) * -1;
    if (this.deadT > 1.8) this.model.root.position.y -= dt * 1.2;
    if (this.deadT > 3.2 && !this.removed) { this.removed = true; this.game.scene.remove(this.model.root); }
    else if (!this.removed) this.model.root.position.set(this.pos.x, this.model.root.position.y, this.pos.z);
  }

  // ---------- 動畫 ----------
  animate(dt) {
    const p = this.model.parts, t = (this.animT += dt);
    const walk = this.moving ? Math.sin(t * this.speed * 1.7) : 0;
    if (p.legL) { p.legL.rotation.x = walk * 0.7; p.legR.rotation.x = -walk * 0.7; }
    let aL = -walk * 0.5, aR = walk * 0.5, bodyX = 0, bob = this.moving ? Math.abs(walk) * 0.06 : Math.sin(t * 2) * 0.015;
    if (this.working === 'chop' || this.working === 'build') { aR = -1.2 - Math.sin(t * 11) * 1.0; aL = -0.4; bodyX = 0.15; }
    else if (this.working === 'pray') { const s = Math.sin(t * 2.2); bodyX = 0.35 + s * 0.3; aL = aR = -2.6 + s * 0.3; bob = -0.25; }
    else if (this.working === 'cast') { aL = aR = -2.9; bob = 0.1; }
    if (this.swingT > 0) { aR = -2.6 + (0.35 - this.swingT) * 9; bodyX = 0.1; }
    if (this.type === 'shaman' && !this.working && this.swingT <= 0) aR = -0.3;
    p.armL.rotation.x = aL; p.armR.rotation.x = aR;
    p.body.rotation.x = bodyX; p.body.position.y = bob;
    if (this.flung) { p.body.rotation.z += this.spin * dt; p.body.rotation.x += this.spin * 0.6 * dt; }
    else p.body.rotation.z = 0;
    if (p.tool) p.tool.visible = this.working === 'chop' || this.working === 'build';
    if (p.log) p.log.visible = this.carry > 0;
    if (p.orb) p.orb.scale.setScalar(1 + Math.sin(t * 5) * 0.15 + (this.working === 'cast' ? 0.8 : 0));
    this.sync();
  }
  sync() {
    const r = this.model.root;
    r.position.copy(this.pos);
    r.rotation.y = this.heading;
    this.model.ring.visible = this.selected;
  }
}

// ---------- 建築 ----------
export class Building {
  constructor(game, type, tribe, x, z, complete) {
    this.id = NEXT_ID++;
    this.kind = 'building';
    this.game = game; this.type = type; this.tribe = tribe;
    const s = BUILD[type];
    this.stats = s; this.radius = s.radius; this.maxHp = s.hp;
    this.progress = complete ? 1 : 0; this.complete = !!complete;
    this.hp = complete ? s.hp : s.hp * 0.25;
    this.pos = new THREE.Vector3(x, game.terrain.heightAt(x, z), z);
    this.alive = true; this.removed = false; this.selected = false; this.lastHurt = -99;
    this.spawnT = Math.random() * 6; this.trainQ = 0; this.trainT = 0;
    this.prayR = 4.2; this.slot = 0; this.prayers = 0; this.prayCount = 0;
    this.deadT = 0;
    const m = makeBuildingModel(type, tribe);
    this.model = m;
    m.root.position.copy(this.pos);
    m.inner.scale.y = complete ? 1 : 0.12;
    game.scene.add(m.root);
    if (!complete) {
      const sc = new THREE.Group();
      const pole = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 5);
      const pm = new THREE.MeshStandardMaterial({ color: 0x8b6a3e, roughness: 1 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, mm = new THREE.Mesh(pole, pm);
        mm.position.set(Math.cos(a) * this.radius * 0.9, 1.6, Math.sin(a) * this.radius * 0.9); mm.castShadow = true;
        sc.add(mm);
      }
      m.root.add(sc); this.scaffold = sc;
    }
  }
  door() { return { x: this.pos.x, z: this.pos.z + this.radius + 0.9 }; }
  nextPraySlot() { this.slot++; return this.slot * 2.39996; }
  addWork(amount) {
    if (this.complete) return;
    this.progress = Math.min(1, this.progress + amount / this.stats.work);
    this.hp = Math.min(this.maxHp, this.hp + (amount / this.stats.work) * this.maxHp * 0.75);
    if (this.progress >= 1) {
      this.complete = true;
      if (this.scaffold) { this.model.root.remove(this.scaffold); this.scaffold = null; }
      this.game.onBuildingComplete(this);
    }
  }
  pray(u, dt) {
    this.game.prayGeneral(this.tribe, dt * PRAY_TOTEM, this.pos);
    this.prayCount++;
  }
  update(dt) {
    const g = this.game, m = this.model;
    if (!this.alive) {
      this.deadT += dt;
      m.root.position.y -= dt * 2.2;
      m.inner.rotation.z = Math.sin(this.deadT * 20) * 0.03;
      if (this.deadT < 1.2 && Math.random() < 0.5) g.fx.dust(this.pos.x, this.pos.y, this.pos.z, 2, this.radius);
      if (this.deadT > 2.5 && !this.removed) { this.removed = true; g.scene.remove(m.root); }
      return;
    }
    const gh = g.terrain.heightAt(this.pos.x, this.pos.z);
    this.pos.y = gh; m.root.position.y = gh;
    if (gh < WATER - 0.8) { this.damage(dt * 200, null); }
    const target = this.complete ? 1 : 0.12 + 0.88 * this.progress;
    m.inner.scale.y += (target - m.inner.scale.y) * Math.min(1, dt * 6);
    const t = g.time;
    if (m.extra.flag) m.extra.flag.rotation.y = Math.sin(t * 3 + this.id) * 0.3;
    for (const k of ['banner-1', 'banner1']) if (m.extra[k]) m.extra[k].rotation.y = Math.sin(t * 2.5 + this.id + (k === 'banner1' ? 1 : 0)) * 0.25;
    if (m.extra.crystal) { m.extra.crystal.rotation.y += dt * 1.5; m.extra.crystal.position.y = 6.8 + Math.sin(t * 2) * 0.25; }
    if (m.extra.ring) m.extra.ring.scale.setScalar(1 + (this.prayers > 0 ? Math.sin(t * 4) * 0.05 : 0));
    this.prayers = this.prayCount; this.prayCount = 0;
    if (this.prayers > 0 && Math.random() < dt * 8) g.fx.magic(this.pos.x, this.pos.y + 5, this.pos.z, TRIBE_COLORS[this.tribe], 1, 0.8);

    if (this.complete) {
      const tr = g.tribes[this.tribe];
      if (this.type === 'hut') {
        this.spawnT += dt * (tr.econ || 1);
        if (this.spawnT >= 26) {
          if (g.popOf(this.tribe) < g.capOf(this.tribe)) {
            this.spawnT = 0;
            const d = this.door();
            const u = g.spawnUnit('brave', this.tribe, d.x, d.z);
            g.fx.magic(d.x, gh + 0.5, d.z, TRIBE_COLORS[this.tribe], 10, 0.6);
            if (u && this.tribe === 0) g.sfx('spawn', this.pos);
          } else this.spawnT = 26;
        }
      } else if (this.type === 'warriorhut' && this.trainQ > 0) {
        this.trainT += dt;
        if (this.trainT >= 5) {
          this.trainT = 0; this.trainQ--;
          const d = this.door();
          const u = g.spawnUnit('warrior', this.tribe, d.x, d.z);
          g.fx.poof(d.x, gh, d.z, 0xe0d0b0);
          if (this.tribe === 0) { g.sfx('done', this.pos); if (this.rally) u.setOrder({ type: 'move', x: this.rally.x, z: this.rally.z }, true); }
        }
      }
    }
    if (this.hp < this.maxHp * 0.5 && Math.random() < dt * 6) {
      const a = Math.random() * Math.PI * 2;
      if (this.hp < this.maxHp * 0.3) g.fx.fire(this.pos.x + Math.cos(a) * this.radius * 0.6, this.pos.y + 2.5, this.pos.z + Math.sin(a) * this.radius * 0.6, 0.6);
      else g.fx.smoke(this.pos.x, this.pos.y + 3.5, this.pos.z);
    }
  }
  damage(amount, src) {
    if (!this.alive) return;
    this.hp -= amount; this.lastHurt = this.game.time;
    if (this.hp <= 0) this.destroy();
  }
  destroy() {
    if (!this.alive) return;
    this.alive = false; this.selected = false;
    this.game.fx.explosion(this.pos.x, this.pos.y + 1, this.pos.z, 0.6);
    this.game.fx.dust(this.pos.x, this.pos.y, this.pos.z, 30, this.radius);
    this.game.sfx('collapse', this.pos);
    this.game.onBuildingDestroyed(this);
  }
}

// ---------- 石像 ----------
export class StoneHead {
  constructor(game, x, z, spell, far = false) {
    this.id = NEXT_ID++;
    this.kind = 'head'; this.far = far; this.type = 'head';
    this.game = game; this.spell = spell; this.tribe = -1;
    this.pos = new THREE.Vector3(x, game.terrain.heightAt(x, z), z);
    this.radius = 2.6; this.prayR = 4.6; this.alive = true;
    this.need = SPELLS[spell].unlock;
    this.progress = [0, 0]; this.prayCount = [0, 0]; this.prayers = [0, 0]; this.slot = 0;
    const m = makeStoneHead();
    this.model = m;
    m.root.position.copy(this.pos);
    m.root.rotation.y = Math.atan2(-x, -z) + Math.PI * 0; // 面向地圖中心
    game.scene.add(m.root);
  }
  nextPraySlot() { this.slot++; return this.slot * 2.39996; }
  pray(u, dt) {
    const t = u.tribe; if (t > 1) return;
    const g = this.game, tr = g.tribes[t];
    this.prayCount[t]++;
    if (!tr.unlocked.has(this.spell)) {
      this.progress[t] += dt * tr.prayMul;
      if (this.progress[t] >= this.need) { this.progress[t] = this.need; g.unlockSpell(t, this.spell, this); }
    } else g.addCharge(t, this.spell, dt * PRAY_HEAD, this.pos);
  }
  update(dt) {
    const g = this.game;
    this.prayers = this.prayCount.slice(); this.prayCount = [0, 0];
    const active = this.prayers[0] + this.prayers[1];
    const t = g.time;
    const I = 1.2 + (active ? 2.5 + Math.sin(t * 6) * 0.8 : Math.sin(t * 1.5) * 0.3);
    this.model.eyeMat.color.setRGB(I, I * 0.9, I * 0.5);
    this.model.ring.material.opacity = active ? 0.9 : 0.35;
    this.model.ring.scale.setScalar(1 + (active ? Math.sin(t * 3) * 0.04 : 0));
    const lead = this.prayers[0] >= this.prayers[1] ? 0 : 1;
    if (active) {
      this.model.ring.material.color.set(TRIBE_COLORS[lead]).multiplyScalar(2);
      if (Math.random() < dt * 10) g.fx.magic(this.pos.x, this.pos.y + 4, this.pos.z, 0xfff0a0, 1, 1.2);
    } else this.model.ring.material.color.set(0xfff2a8);
    const gh = g.terrain.heightAt(this.pos.x, this.pos.z);
    this.pos.y = gh; this.model.root.position.y = gh;
  }
}
