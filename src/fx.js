// 粒子系統、閃電、合成音效
import * as THREE from 'three';

class ParticlePool {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3); this.a = new Float32Array(max); this.s = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max);
    this.fade = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr); g.setAttribute('color', this.colAttr); g.setAttribute('size', this.sizeAttr);
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 600 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute vec4 color; attribute float size; uniform float uScale; varying vec4 vC;
        void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*uScale/max(1.0,-mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC;
        void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d)*2.0; if(r>1.0) discard;
          float a = ${additive ? 'pow(1.0-r, 1.6)' : 'smoothstep(1.0, 0.35, r)'};
          gl_FragColor = vec4(vC.rgb, vC.a*a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(o) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p[i * 3] = o.x; this.p[i * 3 + 1] = o.y; this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx || 0; this.v[i * 3 + 1] = o.vy || 0; this.v[i * 3 + 2] = o.vz || 0;
    const col = o.color;
    this.c[i * 3] = col.r; this.c[i * 3 + 1] = col.g; this.c[i * 3 + 2] = col.b;
    this.a[i] = o.alpha ?? 1; this.s[i] = o.size ?? 1;
    this.life[i] = this.maxLife[i] = o.life ?? 1;
    this.grav[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 0; this.grow[i] = o.grow ?? 0;
    this.fade[i] = o.fade ?? 1;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.copy(this.n - 1, i); this.n--; continue; }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i * 3] *= d; this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.grav[i] * dt; this.v[i * 3 + 2] *= d;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.s[i] += this.grow[i] * dt;
      i++;
    }
    const P = this.posAttr.array, Cc = this.colAttr.array, S = this.sizeAttr.array;
    for (let k = 0; k < this.n; k++) {
      P[k * 3] = this.p[k * 3]; P[k * 3 + 1] = this.p[k * 3 + 1]; P[k * 3 + 2] = this.p[k * 3 + 2];
      const t = this.life[k] / this.maxLife[k];
      Cc[k * 4] = this.c[k * 3]; Cc[k * 4 + 1] = this.c[k * 3 + 1]; Cc[k * 4 + 2] = this.c[k * 3 + 2];
      Cc[k * 4 + 3] = this.a[k] * (this.fade[k] ? Math.min(1, t * 2.5) : 1);
      S[k] = Math.max(0, this.s[k]);
    }
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = this.sizeAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.n);
  }
  copy(from, to) {
    if (from === to) return;
    for (let k = 0; k < 3; k++) { this.p[to * 3 + k] = this.p[from * 3 + k]; this.v[to * 3 + k] = this.v[from * 3 + k]; this.c[to * 3 + k] = this.c[from * 3 + k]; }
    this.a[to] = this.a[from]; this.s[to] = this.s[from]; this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from]; this.grow[to] = this.grow[from]; this.fade[to] = this.fade[from];
  }
}

const R = (a = 1) => (Math.random() - 0.5) * 2 * a;
const col = (r, g, b) => ({ r, g, b });

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.glow = new ParticlePool(scene, 7000, true);
    this.soft = new ParticlePool(scene, 4000, false);
    this.bolts = [];
    this.flash = new THREE.PointLight(0xbfd8ff, 0, 60, 1.5);
    scene.add(this.flash);
    this.flashT = 0;
  }
  setScale(pxHeight, fov) {
    const s = pxHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    this.glow.uniforms.uScale.value = s; this.soft.uniforms.uScale.value = s;
  }
  update(dt) {
    this.glow.update(dt); this.soft.update(dt);
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t -= dt;
      b.mesh.visible = Math.random() > 0.25;
      if (b.t <= 0) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); this.bolts.splice(i, 1); }
    }
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity = Math.max(0, this.flashT) * 9000; } else this.flash.intensity = 0;
  }

  explosion(x, y, z, s = 1) {
    for (let i = 0; i < 70 * s; i++) {
      const a = Math.random() * Math.PI * 2, sp = (4 + Math.random() * 12) * s;
      this.glow.emit({ x, y: y + 0.5, z, vx: Math.cos(a) * sp, vy: Math.random() * 10 * s, vz: Math.sin(a) * sp,
        color: Math.random() < 0.5 ? col(3, 1.3, 0.3) : col(3, 2.2, 0.8), size: 0.9 + Math.random() * 1.2 * s, life: 0.4 + Math.random() * 0.5, drag: 3.5, gravity: 4 });
    }
    for (let i = 0; i < 26 * s; i++)
      this.soft.emit({ x: x + R(1.5 * s), y: y + 0.5 + Math.random() * 2, z: z + R(1.5 * s), vx: R(2), vy: 1.5 + Math.random() * 3, vz: R(2),
        color: col(0.18, 0.16, 0.15), alpha: 0.65, size: 1.5 * s, grow: 2.2, life: 1.4 + Math.random(), drag: 1.2 });
    for (let i = 0; i < 25 * s; i++)
      this.soft.emit({ x, y: y + 0.4, z, vx: R(8), vy: 5 + Math.random() * 9, vz: R(8), color: col(0.35, 0.26, 0.17), size: 0.25, life: 1.2, gravity: 22, fade: 0 });
    this.light(x, y + 2, z, 0.12, 0xffa050);
  }
  fireball(x, y, z) {
    this.glow.emit({ x, y, z, color: col(3, 1.6, 0.4), size: 1.6, life: 0.12 });
    this.glow.emit({ x: x + R(0.3), y: y + R(0.3), z: z + R(0.3), vy: 1, color: col(2.5, 0.8, 0.15), size: 1, life: 0.35, grow: -1.5 });
  }
  fire(x, y, z, s = 1) {
    this.glow.emit({ x: x + R(s), y: y + Math.random() * 0.5, z: z + R(s), vx: R(0.5), vy: 2 + Math.random() * 3, vz: R(0.5),
      color: Math.random() < 0.6 ? col(2.6, 0.9, 0.15) : col(3, 1.8, 0.5), size: 0.7 + Math.random() * 0.8 * s, grow: -0.6, life: 0.5 + Math.random() * 0.5 });
    if (Math.random() < 0.3) this.soft.emit({ x: x + R(s), y: y + 1.5, z: z + R(s), vy: 2.5, vx: R(0.5), vz: R(0.5), color: col(0.15, 0.14, 0.14), alpha: 0.45, size: 1, grow: 1.6, life: 2 });
  }
  smoke(x, y, z) {
    this.soft.emit({ x: x + R(0.6), y, z: z + R(0.6), vx: R(0.6) + 0.6, vy: 1.8 + Math.random(), vz: R(0.6), color: col(0.25, 0.24, 0.24), alpha: 0.5, size: 1.1, grow: 1.4, life: 2.5 });
  }
  dust(x, y, z, n = 10, s = 1) {
    for (let i = 0; i < n; i++)
      this.soft.emit({ x: x + R(s), y: y + 0.2, z: z + R(s), vx: R(3), vy: Math.random() * 2.5, vz: R(3), color: col(0.62, 0.52, 0.38), alpha: 0.55, size: 0.8 * s, grow: 1.5, life: 1 + Math.random(), drag: 2 });
  }
  splash(x, z) {
    for (let i = 0; i < 30; i++)
      this.soft.emit({ x, y: 0.1, z, vx: R(3), vy: 4 + Math.random() * 6, vz: R(3), color: col(0.85, 0.93, 1), alpha: 0.8, size: 0.35, life: 0.9, gravity: 20, fade: 0 });
  }
  magic(x, y, z, color, n = 20, spread = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++)
      this.glow.emit({ x: x + R(spread), y: y + Math.random() * 2 * spread, z: z + R(spread), vx: R(0.5), vy: 1 + Math.random() * 2, vz: R(0.5),
        color: col(c.r * 2.5, c.g * 2.5, c.b * 2.5), size: 0.35 + Math.random() * 0.3, life: 0.8 + Math.random() * 0.7 });
  }
  ringWave(x, y, z, r, color, n = 80) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.glow.emit({ x, y: y + 0.5, z, vx: Math.cos(a) * r * 1.6, vy: 0.6, vz: Math.sin(a) * r * 1.6, color: col(c.r * 3, c.g * 3, c.b * 3), size: 0.8, life: 0.6, drag: 1.2 });
    }
  }
  sparks(x, y, z, n = 6) {
    for (let i = 0; i < n; i++)
      this.glow.emit({ x, y, z, vx: R(4), vy: 2 + Math.random() * 4, vz: R(4), color: col(3, 2.4, 1.2), size: 0.22, life: 0.35, gravity: 15 });
  }
  hit(x, y, z) {
    for (let i = 0; i < 6; i++)
      this.soft.emit({ x, y, z, vx: R(2.5), vy: 1 + Math.random() * 2.5, vz: R(2.5), color: col(0.9, 0.85, 0.7), alpha: 0.7, size: 0.3, life: 0.4, gravity: 8 });
  }
  poof(x, y, z, color = 0xdddddd) {
    const c = new THREE.Color(color);
    for (let i = 0; i < 16; i++)
      this.soft.emit({ x: x + R(0.5), y: y + 0.4 + Math.random(), z: z + R(0.5), vx: R(2), vy: 1 + Math.random() * 2, vz: R(2), color: col(c.r, c.g, c.b), alpha: 0.7, size: 0.6, grow: 1.2, life: 0.9, drag: 2 });
  }
  lava(x, y, z) {
    this.glow.emit({ x, y, z, vx: R(6), vy: 10 + Math.random() * 14, vz: R(6), color: col(3, 0.9 + Math.random() * 0.8, 0.1), size: 0.6 + Math.random() * 0.8, life: 1.6, gravity: 18, fade: 1 });
  }
  light(x, y, z, t, color) {
    this.flash.position.set(x, y, z); this.flash.color.set(color); this.flashT = Math.max(this.flashT, t);
  }
  bolt(x, y, z) {
    const pts = [];
    let px = x + R(4), pz = z + R(4);
    for (let h = 60; h > y; h -= 4 + Math.random() * 3) { pts.push(new THREE.Vector3(px, h, pz)); px += R(1.6); pz += R(1.6); }
    pts.push(new THREE.Vector3(x, y, z));
    const path = new THREE.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    const make = (p, r) => {
      const m = new THREE.Mesh(new THREE.TubeGeometry(p, pts.length * 3, r, 5, false),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 5, 8), toneMapped: false }));
      this.scene.add(m); this.bolts.push({ mesh: m, t: 0.45 });
    };
    make(path, 0.14);
    // 分支
    for (let b = 0; b < 3; b++) {
      const s = pts[2 + Math.floor(Math.random() * (pts.length - 4))];
      if (!s) continue;
      const bp = new THREE.CurvePath(); let cur = s.clone();
      for (let k = 0; k < 4; k++) { const nx = cur.clone().add(new THREE.Vector3(R(3), -3 - Math.random() * 2, R(3))); bp.add(new THREE.LineCurve3(cur, nx)); cur = nx; }
      make(bp, 0.06);
    }
    this.light(x, y + 8, z, 0.25, 0xcfe0ff);
    for (let i = 0; i < 40; i++)
      this.glow.emit({ x, y: y + 0.3, z, vx: R(9), vy: Math.random() * 8, vz: R(9), color: col(2.5, 3, 4), size: 0.35, life: 0.5, gravity: 10, drag: 2 });
  }
}

// ---------- 合成音效 ----------
export class Audio {
  constructor() { this.ctx = null; this.vol = 0.5; this.last = {}; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  noise(dur, freq, q, gain, type = 'lowpass', sweep = null) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  tone(freq, dur, gain, type = 'sine', slide = null, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  play(name) {
    if (!this.ctx) return;
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < 60) return;
    this.last[name] = now;
    switch (name) {
      case 'blast': this.noise(0.9, 900, 0.7, 0.9, 'lowpass', 80); this.tone(90, 0.5, 0.5, 'sine', 35); break;
      case 'cast': this.tone(420, 0.35, 0.18, 'triangle', 880); this.tone(630, 0.35, 0.1, 'sine', 1260, 0.05); break;
      case 'thunder': this.noise(0.25, 4000, 0.5, 0.8, 'highpass'); this.noise(2.2, 400, 0.6, 1.0, 'lowpass', 40); this.tone(60, 1.2, 0.5, 'sine', 30); break;
      case 'tornado': this.noise(3.5, 300, 4, 0.35, 'bandpass', 1400); break;
      case 'quake': this.noise(3, 120, 1, 1.0, 'lowpass', 40); this.tone(40, 3, 0.5, 'sawtooth', 25); break;
      case 'volcano': this.noise(4, 200, 1, 1.0, 'lowpass', 60); this.tone(55, 3, 0.5, 'sawtooth', 28); this.noise(1, 1500, 1, 0.3, 'bandpass', 300); break;
      case 'rumble': this.noise(1.6, 180, 1, 0.5, 'lowpass', 60); break;
      case 'convert': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.6, 0.12, 'sine', null, i * 0.07)); break;
      case 'unlock': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 1.0, 0.14, 'triangle', null, i * 0.11)); break;
      case 'hit': this.noise(0.08, 1800, 1, 0.25, 'bandpass'); break;
      case 'chop': this.noise(0.06, 2500, 3, 0.18, 'bandpass'); this.tone(180, 0.06, 0.08, 'square'); break;
      case 'die': this.tone(300, 0.35, 0.12, 'sawtooth', 90); break;
      case 'build': this.noise(0.05, 900, 2, 0.12, 'bandpass'); break;
      case 'done': [523, 784].forEach((f, i) => this.tone(f, 0.4, 0.15, 'triangle', null, i * 0.12)); break;
      case 'select': this.tone(880, 0.07, 0.07, 'sine'); break;
      case 'order': this.tone(660, 0.07, 0.07, 'sine'); this.tone(990, 0.08, 0.05, 'sine', null, 0.05); break;
      case 'error': this.tone(180, 0.18, 0.12, 'square'); break;
      case 'splash': this.noise(0.5, 1200, 1, 0.35, 'lowpass', 200); break;
      case 'collapse': this.noise(1.4, 500, 1, 0.8, 'lowpass', 50); break;
      case 'spawn': this.tone(700, 0.15, 0.06, 'sine', 1050); break;
      case 'alarm': [440, 330, 440, 330].forEach((f, i) => this.tone(f, 0.18, 0.12, 'square', null, i * 0.2)); break;
      case 'win': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 1.2, 0.15, 'triangle', null, i * 0.18)); break;
      case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(f, 1.0, 0.15, 'sawtooth', null, i * 0.25)); break;
    }
  }
}
