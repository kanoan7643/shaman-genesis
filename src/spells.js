// 法術效果
import * as THREE from 'three';
import { SPELLS, TRIBE_COLORS, WATER } from './config.js';
import { smoothstep, distToSeg, clamp } from './noise.js';

const R = (a = 1) => (Math.random() - 0.5) * 2 * a;

function enemiesOf(g, tribe) { return g.units.filter((u) => u.alive && u.tribe !== tribe); }

export function castSpell(g, caster, id, x, z) {
  const tribe = caster.tribe;
  const sp = SPELLS[id];
  g.tribes[tribe].casts = (g.tribes[tribe].casts || 0) + 1;
  switch (id) {
    case 'blast': g.effects.push(new Fireball(g, caster, x, z)); break;
    case 'convert': {
      const y = g.terrain.heightAt(x, z);
      g.fx.ringWave(x, y, z, sp.radius, TRIBE_COLORS[tribe]);
      g.fx.magic(x, y, z, 0xffffff, 40, sp.radius * 0.6);
      g.sfx('convert', { x, z });
      let n = 0;
      for (const u of g.units) {
        if (!u.alive || u.type !== 'wild' || u.flung) continue;
        if (Math.hypot(u.pos.x - x, u.pos.z - z) > sp.radius) continue;
        n++;
        const px = u.pos.x, pz = u.pos.z;
        u.vanish();
        g.fx.magic(px, u.pos.y, pz, TRIBE_COLORS[tribe], 18, 0.5);
        const nu = g.spawnUnit('brave', tribe, px, pz);
        nu.heading = u.heading;
      }
      if (tribe === 0) g.msg(n ? `感化了 ${n} 名野人！` : '範圍內沒有野人');
      break;
    }
    case 'lightning': {
      const y = g.terrain.heightAt(x, z);
      g.fx.bolt(x, Math.max(y, WATER), z);
      g.fx.explosion(x, y, z, 0.5);
      g.sfx('thunder', { x, z });
      g.shake(0.6);
      g.terrain.burn(x, z, 3.5, 0.9);
      for (const u of enemiesOf(g, tribe)) {
        const d = Math.hypot(u.pos.x - x, u.pos.z - z);
        if (d < sp.radius) { u.damage(130 * (1 - d / sp.radius * 0.5), caster); if (u.alive) u.fling(R(4), 7, R(4)); }
      }
      for (const b of g.buildings) if (b.alive && b.tribe !== tribe && Math.hypot(b.pos.x - x, b.pos.z - z) < sp.radius + b.radius) b.damage(260, caster);
      for (const t of g.forest.trees) if (t.alive && !t.fall && Math.hypot(t.x - x, t.z - z) < 2.5) g.burnTree(t);
      break;
    }
    case 'tornado': g.effects.push(new Tornado(g, tribe, x, z)); g.sfx('tornado', { x, z }); break;
    case 'landbridge': g.effects.push(new LandBridge(g, caster.pos.x, caster.pos.z, x, z)); g.sfx('rumble', { x, z }); break;
    case 'earthquake': g.effects.push(new Earthquake(g, tribe, x, z, sp.radius)); g.sfx('quake', { x, z }); break;
    case 'volcano': g.effects.push(new Volcano(g, tribe, x, z, sp.radius)); g.sfx('volcano', { x, z }); break;
  }
}

class Fireball {
  constructor(g, caster, x, z) {
    this.g = g; this.tribe = caster.tribe; this.caster = caster;
    this.from = new THREE.Vector3(caster.pos.x, caster.pos.y + 2.6, caster.pos.z);
    this.to = new THREE.Vector3(x, g.terrain.heightAt(x, z), z);
    this.to.y = Math.max(this.to.y, WATER);
    this.t = 0; this.dur = Math.max(0.35, this.from.distanceTo(this.to) / 38);
  }
  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / this.dur);
    const p = this.from.clone().lerp(this.to, k);
    p.y += Math.sin(k * Math.PI) * 5;
    this.g.fx.fireball(p.x, p.y, p.z);
    if (k < 1) return true;
    const g = this.g, { x, y, z } = this.to, r = 4.2;
    g.fx.explosion(x, y, z, 1);
    g.sfx('blast', { x, z });
    g.shake(0.3);
    g.terrain.burn(x, z, 3.2, 0.5);
    for (const u of g.units) {
      if (!u.alive || u.tribe === this.tribe) continue;
      const dx = u.pos.x - x, dz = u.pos.z - z, d = Math.hypot(dx, dz);
      if (d > r) continue;
      const f = 1 - d / r;
      u.damage(38 * (0.4 + f * 0.6), this.caster);
      if (u.alive) { const n = d > 0.01 ? 1 / d : 0; u.fling(dx * n * (6 + f * 10) + R(1), 9 + f * 7, dz * n * (6 + f * 10) + R(1)); }
    }
    for (const b of g.buildings) if (b.alive && b.tribe !== this.tribe && Math.hypot(b.pos.x - x, b.pos.z - z) < r + b.radius) b.damage(70, this.caster);
    return false;
  }
}

class Tornado {
  constructor(g, tribe, x, z) {
    this.g = g; this.tribe = tribe; this.x = x; this.z = z; this.life = 13; this.t = 0;
    this.dir = Math.random() * Math.PI * 2;
  }
  update(dt) {
    const g = this.g;
    this.t += dt; this.life -= dt;
    this.dir += R(1.2) * dt;
    this.x = clamp(this.x + Math.cos(this.dir) * 3 * dt, -120, 120);
    this.z = clamp(this.z + Math.sin(this.dir) * 3 * dt, -120, 120);
    const y = Math.max(g.terrain.heightAt(this.x, this.z), WATER);
    const fade = Math.min(1, this.life, this.t);
    // 漏斗粒子
    for (let i = 0; i < 14 * fade; i++) {
      const h = Math.random() * 20, a = Math.random() * Math.PI * 2 + this.t * 6, r = 0.6 + h * 0.28;
      const sp = 9;
      g.fx.soft.emit({ x: this.x + Math.cos(a) * r, y: y + h, z: this.z + Math.sin(a) * r,
        vx: -Math.sin(a) * sp, vy: 3, vz: Math.cos(a) * sp, color: { r: 0.72, g: 0.7, b: 0.66 }, alpha: 0.35, size: 1.1 + h * 0.08, grow: 0.8, life: 0.45, drag: 3 });
    }
    if (Math.random() < 0.6) g.fx.dust(this.x, y, this.z, 2, 2.5);
    const R0 = 5;
    for (const u of g.units) {
      if (!u.alive || u.flung || u.tribe === this.tribe) continue;
      const dx = u.pos.x - this.x, dz = u.pos.z - this.z, d = Math.hypot(dx, dz);
      if (d < R0) {
        u.damage(10, null);
        if (u.alive) u.fling(-dz * 2 + R(3), 16 + Math.random() * 8, dx * 2 + R(3));
      }
    }
    for (const b of g.buildings) if (b.alive && b.tribe !== this.tribe && Math.hypot(b.pos.x - this.x, b.pos.z - this.z) < R0 + b.radius) b.damage(55 * dt, null);
    for (const t of g.forest.trees) if (t.alive && !t.fall && Math.hypot(t.x - this.x, t.z - this.z) < 3.5) {
      g.fx.dust(t.x, t.y + 2, t.z, 8, 1); g.forest.remove(t);
    }
    return this.life > 0;
  }
}

class LandBridge {
  constructor(g, x0, z0, x1, z1) {
    this.g = g; this.x0 = x0; this.z0 = z0; this.x1 = x1; this.z1 = z1;
    this.h0 = Math.max(1.5, g.terrain.heightAt(x0, z0)); this.h1 = Math.max(1.5, g.terrain.heightAt(x1, z1));
    this.t = 0; this.dur = 2.2; this.width = 3.6;
    this.len = Math.hypot(x1 - x0, z1 - z0);
    this.cx = (x0 + x1) / 2; this.cz = (z0 + z1) / 2;
  }
  update(dt) {
    const g = this.g;
    const prev = this.t;
    this.t = Math.min(this.dur, this.t + dt);
    const k = this.t / this.dur, dk = k - prev / this.dur;
    const { x0, z0, x1, z1, width: W } = this;
    const L2 = this.len * this.len || 1;
    g.terrain.modify(this.cx, this.cz, this.len / 2 + W + 2, (h, d, x, z) => {
      const ds = distToSeg(x, z, x0, z0, x1, z1);
      if (ds > W + 1.5) return h;
      const u = clamp(((x - x0) * (x1 - x0) + (z - z0) * (z1 - z0)) / L2, 0, 1);
      const w = 1 - smoothstep(W * 0.55, W + 1.5, ds);
      const target = (this.h0 + (this.h1 - this.h0) * u) * (0.85 + 0.15 * w) + Math.sin(u * Math.PI) * 0.5;
      if (h >= target) return h;
      return h + (target - h) * w * Math.min(1, dk / Math.max(0.001, 1 - k + dk));
    });
    for (let i = 0; i < 6; i++) {
      const u = Math.random();
      const x = x0 + (x1 - x0) * u + R(W), z = z0 + (z1 - z0) * u + R(W);
      g.fx.dust(x, g.terrain.heightAt(x, z), z, 1, 1);
    }
    g.shake(0.08);
    if (this.t >= this.dur) { g.onTerrainChanged(this.cx, this.cz, this.len / 2 + W); return false; }
    return true;
  }
}

class Earthquake {
  constructor(g, tribe, x, z, r) {
    this.g = g; this.tribe = tribe; this.x = x; this.z = z; this.r = r; this.t = 0; this.dur = 3.2;
    this.seed = Math.random() * 100;
  }
  update(dt) {
    const g = this.g, { x, z, r } = this;
    this.t += dt;
    g.shake(0.5);
    const s = this.seed;
    g.terrain.modify(x, z, r, (h, d, px, pz) => {
      const crack = Math.abs(Math.sin(px * 0.7 + s) + Math.sin(pz * 0.63 - s * 1.3) + Math.sin((px + pz) * 0.41 + s * 0.5));
      const f = (1 - d / r) * (0.5 + crack * 0.45);
      return h - f * 1.5 * dt;
    });
    if (Math.random() < 0.5) g.terrain.burn(x + R(r * 0.7), z + R(r * 0.7), 2, 0.2);
    for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28, rr = Math.random() * r; const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr; g.fx.dust(px, g.terrain.heightAt(px, pz), pz, 1, 1.2); }
    for (const b of g.buildings) if (b.alive && b.tribe !== this.tribe && Math.hypot(b.pos.x - x, b.pos.z - z) < r + b.radius) b.damage(120 * dt, null);
    for (const u of g.units) {
      if (!u.alive || u.flung || u.tribe === this.tribe) continue;
      if (Math.hypot(u.pos.x - x, u.pos.z - z) < r && Math.random() < dt * 1.5) { u.damage(8, null); if (u.alive) u.fling(R(3), 5 + Math.random() * 4, R(3)); }
    }
    for (const t of g.forest.trees) if (t.alive && !t.fall && Math.hypot(t.x - x, t.z - z) < r && Math.random() < dt * 0.6) g.fellTree(t, Math.random() * 6.28);
    if (this.t >= this.dur) { g.onTerrainChanged(x, z, r); return false; }
    return true;
  }
}

class Volcano {
  constructor(g, tribe, x, z, r) {
    this.g = g; this.tribe = tribe; this.x = x; this.z = z; this.r = r; this.t = 0; this.grow = 3.5; this.dur = 14;
    this.base = g.terrain.heightAt(x, z);
    const y0 = Math.max(this.base, WATER);
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.3, 0.2), toneMapped: false, transparent: true }));
    this.pool.rotation.x = -Math.PI / 2; this.pool.position.set(x, y0, z);
    g.scene.add(this.pool);
  }
  update(dt) {
    const g = this.g, { x, z, r } = this;
    this.t += dt;
    if (this.t < this.grow) {
      const k = dt / this.grow;
      g.terrain.modify(x, z, r, (h, d) => {
        const u = d / r;
        let cone = Math.pow(1 - u, 1.4) * 17 + Math.max(this.base, 1);
        if (u < 0.16) cone -= (0.16 - u) * 25; // 火山口
        return h < cone ? h + (cone - Math.min(h, cone)) * Math.min(1, k * 3) : h;
      });
      g.shake(0.6);
      if (Math.random() < dt * 3) g.terrain.burn(x + R(r * 0.5), z + R(r * 0.5), 3, 0.3);
    }
    const top = g.terrain.heightAt(x, z) + 0.3;
    this.pool.position.y = top;
    const erupt = this.t < this.dur - 2;
    const pulse = 0.7 + Math.sin(this.t * 7) * 0.3;
    this.pool.material.color.setRGB(4 * pulse, 1.3 * pulse, 0.2);
    if (erupt) {
      for (let i = 0; i < 5; i++) g.fx.lava(x + R(1), top, z + R(1));
      if (Math.random() < 0.5) g.fx.soft.emit({ x: x + R(1), y: top + 2, z: z + R(1), vx: R(1) + 1, vy: 5, vz: R(1), color: { r: 0.12, g: 0.1, b: 0.1 }, alpha: 0.6, size: 3, grow: 3, life: 4, drag: 0.3 });
      // 熔岩彈
      if (Math.random() < dt * 2.5) {
        const a = Math.random() * 6.28, rr = 3 + Math.random() * (r + 6);
        g.effects.push(new LavaBomb(g, this.tribe, x, top, z, x + Math.cos(a) * rr, z + Math.sin(a) * rr));
      }
      for (const u of g.units) {
        if (!u.alive || u.tribe === this.tribe) continue;
        const d = Math.hypot(u.pos.x - x, u.pos.z - z);
        if (d < r * 0.8) { u.damage(22 * dt, null); if (Math.random() < dt * 3) g.fx.fire(u.pos.x, u.pos.y + 0.5, u.pos.z, 0.3); }
      }
      for (const b of g.buildings) if (b.alive && Math.hypot(b.pos.x - x, b.pos.z - z) < r * 0.8 + b.radius) b.damage(160 * dt, null);
      for (const t of g.forest.trees) if (t.alive && !t.fall && Math.hypot(t.x - x, t.z - z) < r * 0.8) g.burnTree(t);
    }
    if (this.t > this.dur) {
      this.pool.material.opacity -= dt;
      if (this.pool.material.opacity <= 0) { g.scene.remove(this.pool); g.onTerrainChanged(x, z, r); return false; }
    }
    return true;
  }
}

class LavaBomb {
  constructor(g, tribe, x, y, z, tx, tz) {
    this.g = g; this.tribe = tribe;
    this.p = new THREE.Vector3(x, y, z);
    const T = 1.4; this.T = T; this.t = 0;
    const ty = g.terrain.heightAt(tx, tz);
    this.v = new THREE.Vector3((tx - x) / T, (ty - y + 0.5 * 20 * T * T) / T, (tz - z) / T);
  }
  update(dt) {
    const g = this.g;
    this.t += dt;
    this.v.y -= 20 * dt;
    this.p.addScaledVector(this.v, dt);
    g.fx.fireball(this.p.x, this.p.y, this.p.z);
    const gh = g.terrain.heightAt(this.p.x, this.p.z);
    if (this.p.y <= Math.max(gh, WATER) || this.t > 3) {
      g.fx.explosion(this.p.x, gh, this.p.z, 0.35);
      g.terrain.burn(this.p.x, this.p.z, 2, 0.5);
      for (const u of g.units) if (u.alive && u.tribe !== this.tribe && Math.hypot(u.pos.x - this.p.x, u.pos.z - this.p.z) < 2.5) u.damage(30, null);
      for (const b of g.buildings) if (b.alive && Math.hypot(b.pos.x - this.p.x, b.pos.z - this.p.z) < 2 + b.radius) b.damage(40, null);
      return false;
    }
    return true;
  }
}
