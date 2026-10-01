// 戰爭迷霧（半透明）：整張地圖的地形都看得到，視野外只是稍微變暗，
// 但視野外的敵方單位會被隱藏；敵方建築看過一次後就會留在畫面上
import * as THREE from 'three';
import { HALF, SIZE } from './config.js';

export const FN = 128;                 // 迷霧格數（每邊）
const CS = SIZE / FN;                  // 每格世界單位
const SIGHT = { shaman: 24, warrior: 17, brave: 14, building: 17, totem: 22 };
const LIGHT = [0.62, 0.62, 1];         // 未探索 / 已探索 / 視野內 的亮度

export class WarFog {
  constructor(enabled) {
    this.enabled = enabled;
    this.state = new Uint8Array(FN * FN);   // 0 未探索 · 1 已探索 · 2 視野內
    this.cur = new Float32Array(FN * FN);
    this.data = new Uint8Array(FN * FN * 4).fill(255);
    this.tex = new THREE.DataTexture(this.data, FN, FN, THREE.RGBAFormat);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
    this.uTex = { value: this.tex };
    this.uMix = { value: 0 };               // 0 = 不顯示迷霧（開始畫面），1 = 顯示
    this.t = 0;
  }
  idx(x, z) {
    const i = Math.min(FN - 1, Math.max(0, Math.floor((x + HALF) / CS)));
    const j = Math.min(FN - 1, Math.max(0, Math.floor((z + HALF) / CS)));
    return j * FN + i;
  }
  visible(x, z) { return !this.enabled || this.state[this.idx(x, z)] === 2; }
  reveal(x, z, r) {
    const i0 = Math.max(0, Math.floor((x - r + HALF) / CS)), i1 = Math.min(FN - 1, Math.floor((x + r + HALF) / CS));
    const j0 = Math.max(0, Math.floor((z - r + HALF) / CS)), j1 = Math.min(FN - 1, Math.floor((z + r + HALF) / CS));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * CS - HALF - x, cz = (j + 0.5) * CS - HALF - z;
      if (cx * cx + cz * cz <= r2) this.state[j * FN + i] = 2;
    }
  }
  recompute(g) {
    const s = this.state;
    for (let k = 0; k < s.length; k++) if (s[k] === 2) s[k] = 1;
    for (const u of g.units) if (u.alive && u.tribe === 0) this.reveal(u.pos.x, u.pos.z, SIGHT[u.type] || 14);
    for (const b of g.buildings) if (b.alive && b.tribe === 0) this.reveal(b.pos.x, b.pos.z, SIGHT[b.type] || SIGHT.building);
  }
  update(dt, g, instant = false) {
    if (!this.enabled) return;
    this.t -= dt;
    if (this.t <= 0 || instant) { this.t = 0.2; this.recompute(g); }
    const k = instant ? 1 : Math.min(1, dt * 5);
    const s = this.state, c = this.cur, d = this.data;
    for (let n = 0; n < s.length; n++) {
      c[n] += (LIGHT[s[n]] - c[n]) * k;
      d[n * 4] = c[n] * 255;
    }
    this.tex.needsUpdate = true;
  }

  // 讓一般材質（地形、單位、建築、樹木）依迷霧變暗
  patch(m) {
    if (m.userData.warFog === this || m.userData.warFog === 'skip') return;
    m.userData.warFog = this;
    const fog = this;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uWar = fog.uTex; shader.uniforms.uWarMix = fog.uMix;
      shader.vertexShader = 'varying vec2 vWarXZ;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vec4 warW = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          warW = instanceMatrix * warW;
        #endif
        vWarXZ = ( modelMatrix * warW ).xz;`);
      shader.fragmentShader = 'varying vec2 vWarXZ;\nuniform sampler2D uWar;\nuniform float uWarMix;\n' + shader.fragmentShader.replace('#include <fog_fragment>', `
        gl_FragColor.rgb *= mix( 1.0, texture2D( uWar, ( vWarXZ + ${HALF.toFixed(1)} ) / ${SIZE.toFixed(1)} ).r, uWarMix );
        #include <fog_fragment>`);
    };
    m.customProgramCacheKey = () => 'warfog';
    m.needsUpdate = true;
  }
  patchScene(scene) {
    if (!this.enabled) return;
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of [].concat(o.material)) if (m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) this.patch(m);
    });
  }
}
