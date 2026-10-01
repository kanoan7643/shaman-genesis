// 地形：高度圖生成、3D 網格、頂點上色、水面與天空、可行走格
import * as THREE from 'three';
import { N, CELL, HALF, SIZE, WATER, LAYOUT } from './config.js';
import { Noise2D, mulberry32, clamp, lerp, smoothstep, distToSeg } from './noise.js';

const V = N + 1;
const C = (hex) => new THREE.Color(hex);
const COL = {
  seabed: C(0x5d6b5a), sandWet: C(0xb89e6a), sand: C(0xe3cc92),
  grassA: C(0x6aa640), grassB: C(0x3f7f2a), grassC: C(0x8fb34a),
  dirt: C(0x7d6443), rock: C(0x8b8378), rockDark: C(0x5f5a54), snow: C(0xf4f6fa),
  scorch: C(0x2a2220),
};

export class Terrain {
  constructor(scene, seed) {
    this.scene = scene;
    this.V = V;
    this.h = new Float32Array(V * V);
    this.scorch = new Float32Array(V * V);
    this.vary = new Float32Array(V * V);
    this.walk = new Uint8Array(N * N);
    this.navVersion = 0;
    this.dirtyMini = true;
    this.generate(seed);
    this.buildMesh();
    this.buildWater();
    this.buildSky();
    this.rebuildNav(0, 0, N - 1, N - 1);
  }

  // ---------- 生成 ----------
  generate(seed) {
    const rand = mulberry32(seed);
    const n1 = new Noise2D(rand), n2 = new Noise2D(rand), n3 = new Noise2D(rand);
    const L = LAYOUT, mtMul = L.mountain ?? 1;
    const shapeDist = (s, x, z) => s.t === 'path' ? distToSeg(x, z, s.x0, s.z0, s.x1, s.z1)
      : s.t === 'ring' ? Math.abs(Math.hypot(x - s.x, z - s.z) - s.r) : Math.hypot(x - s.x, z - s.z);
    const roads = L.land.filter((s) => s.t !== 'blob');
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const x = i * CELL - HALF, z = j * CELL - HALF;
      const warp = n1.fbm(x * 0.02, z * 0.02, 3) * 16;
      let m = 0;
      for (const s of L.land) m = Math.max(m, 1 - smoothstep(s.a, s.b, shapeDist(s, x, z) + warp * s.w));
      let h = -7.5 + m * 10.5;
      const hills = n2.fbm(x * 0.025 + 5, z * 0.025 - 3, 5);
      h += hills * 5 * m;
      const mt = Math.max(0, n3.fbm(x * 0.013 + 30, z * 0.013 + 11, 4) - 0.08 + (L.peaks || 0));
      let mountain = mt * mt * 95 * m * mtMul;
      // 通道與石像周圍不長山
      for (const s of roads) mountain *= smoothstep(6, 16, shapeDist(s, x, z));
      for (const hd of L.heads) mountain *= smoothstep(6, 14, Math.hypot(x - hd.x, z - hd.z));
      h += mountain;
      const e = Math.max(Math.abs(x), Math.abs(z));
      h = lerp(h, -9, smoothstep(104, 126, e));
      for (const b of L.bases) {
        const w = 1 - smoothstep(15, 26, Math.hypot(x - b.x, z - b.z));
        h = lerp(h, 3 + hills * 0.8, w);
      }
      for (const hd of L.heads) {
        const w = 1 - smoothstep(3.5, 8, Math.hypot(x - hd.x, z - hd.z));
        h = lerp(h, Math.max(2.4, Math.min(h, 6)), w);
      }
      this.h[j * V + i] = h;
      this.vary[j * V + i] = n2.noise(x * 0.18, z * 0.18) * 0.5 + 0.5 + (rand() - 0.5) * 0.25;
    }
  }

  // ---------- 查詢 ----------
  inBounds(x, z) { return x > -HALF + 2 && x < HALF - 2 && z > -HALF + 2 && z < HALF - 2; }
  heightAt(x, z) {
    const gx = clamp((x + HALF) / CELL, 0, N - 0.001), gz = clamp((z + HALF) / CELL, 0, N - 0.001);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const h = this.h, k = j * V + i;
    const a = h[k], b = h[k + 1], c = h[k + V], d = h[k + V + 1];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }
  isLand(x, z) { return this.inBounds(x, z) && this.heightAt(x, z) > WATER + 0.2; }
  cellOf(x, z) {
    return [clamp(Math.floor((x + HALF) / CELL), 0, N - 1), clamp(Math.floor((z + HALF) / CELL), 0, N - 1)];
  }
  cellCenter(i, j) { return [i * CELL - HALF + CELL / 2, j * CELL - HALF + CELL / 2]; }
  walkable(x, z) {
    if (!this.inBounds(x, z)) return false;
    const [i, j] = this.cellOf(x, z);
    return this.walk[j * N + i] === 1;
  }
  flatness(x, z, r) {
    let mn = 1e9, mx = -1e9;
    for (let a = 0; a < 9; a++) {
      const ang = a * Math.PI * 2 / 8, rr = a === 8 ? 0 : r;
      const h = this.heightAt(x + Math.cos(ang) * rr, z + Math.sin(ang) * rr);
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    return { min: mn, max: mx };
  }

  // ---------- 網格 ----------
  buildMesh() {
    const pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i;
      pos[k * 3] = i * CELL - HALF; pos[k * 3 + 1] = this.h[k]; pos[k * 3 + 2] = j * CELL - HALF;
    }
    const idx = new Uint32Array(N * N * 6);
    let p = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      // 依對角線方向交錯，減少鋸齒
      if ((i + j) & 1) { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
      else { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    this.geo = g;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.0 });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);

    // 地底裙邊，避免從邊緣看到空洞
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(SIZE, 6, SIZE),
      new THREE.MeshStandardMaterial({ color: 0x3e4a44, roughness: 1 }));
    skirt.position.y = -12;
    this.scene.add(skirt);

    this.heightTex = new THREE.DataTexture(new Uint8Array(V * V * 4), V, V, THREE.RGBAFormat);
    this.heightTex.magFilter = THREE.LinearFilter; this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.refresh(0, 0, V - 1, V - 1, false);
  }

  refresh(i0, j0, i1, j1, normals = true) {
    i0 = clamp(i0, 0, V - 1); j0 = clamp(j0, 0, V - 1); i1 = clamp(i1, 0, V - 1); j1 = clamp(j1, 0, V - 1);
    const pos = this.geo.attributes.position.array;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * V + i; pos[k * 3 + 1] = this.h[k];
    }
    if (normals) this.geo.computeVertexNormals();
    this.geo.attributes.position.needsUpdate = true;
    this.colorize(i0, j0, i1, j1);
    const d = this.heightTex.image.data;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * V + i;
      d[k * 4] = clamp(Math.round((this.h[k] + 12) / 36 * 255), 0, 255);
      d[k * 4 + 3] = 255;
    }
    this.heightTex.needsUpdate = true;
    this.dirtyMini = true;
  }

  colorize(i0, j0, i1, j1) {
    const col = this.geo.attributes.color.array, nrm = this.geo.attributes.normal.array;
    const c = new THREE.Color(), t = new THREE.Color();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * V + i, h = this.h[k], v = this.vary[k], ny = nrm[k * 3 + 1];
      if (h < -1.2) c.copy(COL.seabed).lerp(COL.sandWet, smoothstep(-5, -1.2, h));
      else if (h < 0.5) c.copy(COL.sandWet).lerp(COL.sand, smoothstep(-1.2, 0.5, h));
      else {
        t.copy(COL.grassA).lerp(COL.grassB, v).lerp(COL.grassC, smoothstep(0.75, 1, v) * 0.6);
        c.copy(COL.sand).lerp(t, smoothstep(0.6, 1.7, h));
        c.lerp(COL.dirt, smoothstep(6, 9, h) * 0.5);
        t.copy(COL.rock).lerp(COL.rockDark, v);
        c.lerp(t, Math.max(smoothstep(8.5, 12, h), smoothstep(0.86, 0.62, ny)));
        c.lerp(COL.snow, smoothstep(15, 18, h) * smoothstep(0.55, 0.8, ny));
      }
      if (this.scorch[k] > 0) c.lerp(COL.scorch, clamp(this.scorch[k], 0, 0.85));
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    this.geo.attributes.color.needsUpdate = true;
  }

  // 以函式修改半徑內的高度：fn(h, dist, x, z) => 新高度
  modify(cx, cz, r, fn) {
    const i0 = Math.floor((cx - r + HALF) / CELL), i1 = Math.ceil((cx + r + HALF) / CELL);
    const j0 = Math.floor((cz - r + HALF) / CELL), j1 = Math.ceil((cz + r + HALF) / CELL);
    for (let j = Math.max(0, j0); j <= Math.min(V - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(V - 1, i1); i++) {
        const x = i * CELL - HALF, z = j * CELL - HALF, d = Math.hypot(x - cx, z - cz);
        if (d > r) continue;
        const k = j * V + i;
        this.h[k] = clamp(fn(this.h[k], d, x, z), -12, 24);
      }
    this.refresh(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
    this.rebuildNav(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
  }

  burn(cx, cz, r, amt = 0.6) {
    const i0 = Math.floor((cx - r + HALF) / CELL), i1 = Math.ceil((cx + r + HALF) / CELL);
    const j0 = Math.floor((cz - r + HALF) / CELL), j1 = Math.ceil((cz + r + HALF) / CELL);
    for (let j = Math.max(0, j0); j <= Math.min(V - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(V - 1, i1); i++) {
        const d = Math.hypot(i * CELL - HALF - cx, j * CELL - HALF - cz);
        if (d > r) continue;
        const k = j * V + i;
        this.scorch[k] = Math.min(0.85, this.scorch[k] + amt * (1 - d / r) * (0.7 + this.vary[k] * 0.6));
      }
    this.colorize(Math.max(0, i0), Math.max(0, j0), Math.min(V - 1, i1), Math.min(V - 1, j1));
    this.dirtyMini = true;
  }

  rebuildNav(i0, j0, i1, j1) {
    i0 = clamp(i0, 0, N - 1); j0 = clamp(j0, 0, N - 1); i1 = clamp(i1, 0, N - 1); j1 = clamp(j1, 0, N - 1);
    const h = this.h;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * V + i;
      const a = h[k], b = h[k + 1], c = h[k + V], d = h[k + V + 1];
      const mn = Math.min(a, b, c, d), mx = Math.max(a, b, c, d);
      const edge = i < 2 || j < 2 || i > N - 3 || j > N - 3;
      this.walk[j * N + i] = (!edge && mn > WATER + 0.25 && mx - mn < 2.3) ? 1 : 0;
    }
    this.navVersion++;
  }

  // ---------- 水面 ----------
  buildWater() {
    const geo = new THREE.PlaneGeometry(1600, 1600, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.waterUniforms = {
      uTime: { value: 0 }, uHeight: { value: this.heightTex },
      uSun: { value: new THREE.Vector3(0.5, 0.75, 0.35).normalize() },
      uFog: { value: new THREE.Color(0xbcd8ea) }, uFogNear: { value: 220 }, uFogFar: { value: 640 },
      uWar: { value: null }, uWarMix: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms, transparent: true, depthWrite: false,
      vertexShader: `
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        uniform float uTime; uniform sampler2D uHeight; uniform vec3 uSun; uniform vec3 uFog; uniform float uFogNear, uFogFar;
        uniform sampler2D uWar; uniform float uWarMix;
        varying vec3 vW;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float waves(vec2 p){
          float t=uTime;
          return vnoise(p*0.35+vec2(t*0.25,t*0.12))*0.6 + vnoise(p*0.9-vec2(t*0.4,-t*0.3))*0.3 + vnoise(p*2.3+vec2(t*0.9,t*0.5))*0.12;
        }
        void main(){
          vec2 uv = (vW.xz + ${HALF.toFixed(1)}) / ${SIZE.toFixed(1)};
          float th = texture2D(uHeight, clamp(uv, 0.0, 1.0)).r * 36.0 - 12.0;
          if (uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) th = -12.0;
          float depth = max(0.0, -th);
          float e = 0.15; vec2 p = vW.xz;
          float h0 = waves(p), hx = waves(p+vec2(e,0.)), hz = waves(p+vec2(0.,e));
          vec3 n = normalize(vec3((h0-hx)*2.2, 1.0, (h0-hz)*2.2));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          vec3 shallow = vec3(0.13, 0.62, 0.66), deep = vec3(0.02, 0.16, 0.36);
          vec3 col = mix(shallow, deep, smoothstep(0.0, 7.0, depth));
          vec3 sky = vec3(0.62, 0.8, 0.95);
          col = mix(col, sky, fres * 0.55);
          vec3 H = normalize(uSun + V);
          float spec = pow(max(dot(n, H), 0.0), 180.0) * 2.5;
          col += vec3(1.0, 0.95, 0.85) * spec;
          float foamBand = smoothstep(1.1, 0.0, depth);
          float foam = foamBand * (0.55 + 0.45*sin(depth*9.0 - uTime*2.4 + vnoise(p*0.8)*6.0));
          foam *= smoothstep(0.35, 0.7, vnoise(p*1.6 + uTime*0.3) + foamBand*0.4);
          col = mix(col, vec3(0.96,0.98,1.0), clamp(foam,0.,1.)*0.85);
          float alpha = mix(0.45, 0.93, smoothstep(0.0, 3.5, depth));
          alpha = max(alpha, foam*0.9);
          col *= mix(1.0, texture2D(uWar, clamp(uv, 0.0, 1.0)).r, uWarMix);
          float dist = length(cameraPosition - vW);
          col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
          gl_FragColor = vec4(col, alpha);
          #include <colorspace_fragment>
        }`,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = WATER;
    this.water.renderOrder = 2;
    this.scene.add(this.water);
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(1200, 32, 16);
    this.skyUniforms = { uSun: this.waterUniforms.uSun };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyUniforms,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uSun; varying vec3 vD;
        void main(){
          float y = vD.y;
          vec3 top = vec3(0.16,0.42,0.82), hor = vec3(0.74,0.86,0.94), low = vec3(0.55,0.7,0.8);
          vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.55)) : mix(hor, low, min(1.0, -y*4.0));
          float s = max(dot(vD, uSun), 0.0);
          c += vec3(1.0,0.85,0.6) * pow(s, 8.0) * 0.35 + vec3(1.0,0.95,0.85) * pow(s, 900.0) * 3.0;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  // 小地圖顏色
  miniColor(x, z) {
    const [i, j] = this.cellOf(x, z);
    const k = j * V + i, col = this.geo.attributes.color.array, h = this.h[k];
    if (h < WATER) {
      const t = smoothstep(-8, 0, h);
      return [lerp(10, 40, t), lerp(50, 150, t), lerp(100, 170, t)];
    }
    return [Math.pow(col[k * 3], 1 / 2.2) * 255, Math.pow(col[k * 3 + 1], 1 / 2.2) * 255, Math.pow(col[k * 3 + 2], 1 / 2.2) * 255];
  }
}
