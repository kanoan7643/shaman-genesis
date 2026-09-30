// 程序化 3D 模型：部族成員、建築、石像、樹木
import * as THREE from 'three';
import { TRIBE_COLORS } from './config.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...opts }));
  return matCache.get(key);
}
function glow(color, intensity = 3) {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
}
function shade(hex, f) { return new THREE.Color(hex).multiplyScalar(f).getHex(); }

const G = {
  torso: new THREE.CylinderGeometry(0.26, 0.34, 0.75, 12),
  robe: new THREE.CylinderGeometry(0.24, 0.55, 1.25, 14),
  head: new THREE.SphereGeometry(0.24, 16, 12),
  hair: new THREE.SphereGeometry(0.255, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  limb: new THREE.CylinderGeometry(0.075, 0.065, 0.55, 8),
  leg: new THREE.CylinderGeometry(0.1, 0.08, 0.62, 8),
  club: new THREE.CylinderGeometry(0.1, 0.045, 0.8, 8),
  shield: new THREE.CylinderGeometry(0.34, 0.34, 0.07, 18),
  helmet: new THREE.ConeGeometry(0.28, 0.4, 12),
  staff: new THREE.CylinderGeometry(0.035, 0.045, 1.9, 8),
  orb: new THREE.SphereGeometry(0.14, 16, 12),
  feather: new THREE.ConeGeometry(0.05, 0.5, 6),
  ring: new THREE.RingGeometry(0.75, 0.95, 32),
  shadowDisc: new THREE.CircleGeometry(0.5, 16),
  axe: new THREE.BoxGeometry(0.22, 0.14, 0.04),
};
G.ring.rotateX(-Math.PI / 2);
G.shadowDisc.rotateX(-Math.PI / 2);

const SKIN = 0xc98d5e, HAIR = 0x2a1b12;
const ringMats = [0x5cff8a, 0xff5a4a, 0xe0c080].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, depthWrite: false }));

function limb(geo, material, x, y, z) {
  // 以關節為旋轉中心
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const m = new THREE.Mesh(geo, material);
  m.position.y = -geo.parameters.height / 2;
  m.castShadow = true;
  pivot.add(m);
  return pivot;
}

export function makeUnitModel(type, tribe, scale) {
  const tc = TRIBE_COLORS[tribe];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const parts = { body };
  const add = (geo, m, x, y, z, parent = body) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };

  const skin = mat(SKIN);
  if (type === 'shaman') {
    add(G.robe, mat(shade(tc, 0.75)), 0, 0.62, 0);
    add(G.torso, mat(tc), 0, 1.35, 0).scale.set(0.9, 0.7, 0.9);
    add(G.head, skin, 0, 1.78, 0);
    add(G.hair, mat(HAIR), 0, 1.8, 0);
    const colors = [0xffd23f, 0xff6b35, tc, 0xffffff, 0x2ec4b6];
    for (let i = 0; i < 5; i++) {
      const f = add(G.feather, mat(colors[i]), (i - 2) * 0.09, 2.12, -0.12);
      f.rotation.z = (i - 2) * -0.28; f.rotation.x = -0.25;
    }
    parts.armL = limb(G.limb, mat(tc), -0.33, 1.55, 0); body.add(parts.armL);
    parts.armR = limb(G.limb, mat(tc), 0.33, 1.55, 0); body.add(parts.armR);
    const staff = new THREE.Group();
    staff.position.set(0, -0.5, 0.08);
    const st = new THREE.Mesh(G.staff, mat(0x6b4423)); st.castShadow = true; staff.add(st);
    const orb = new THREE.Mesh(G.orb, glow(tc, 4)); orb.position.y = 1.0; staff.add(orb);
    parts.armR.add(staff); parts.orb = orb;
  } else {
    const warrior = type === 'warrior', wild = type === 'wild';
    const cloth = wild ? 0x7a5634 : warrior ? tc : 0xd8c39a;
    const legMat = mat(wild ? 0x5a3e24 : warrior ? shade(tc, 0.55) : 0x6b4a2b);
    parts.legL = limb(G.leg, legMat, -0.14, 0.62, 0); body.add(parts.legL);
    parts.legR = limb(G.leg, legMat, 0.14, 0.62, 0); body.add(parts.legR);
    const torso = add(G.torso, mat(cloth), 0, 0.98, 0);
    if (!wild && !warrior) { // 勇者：部族色腰帶
      const sash = add(new THREE.TorusGeometry(0.3, 0.06, 6, 16), mat(tc), 0, 0.8, 0);
      sash.rotation.x = Math.PI / 2;
    }
    if (warrior) torso.scale.set(1.18, 1.05, 1.1);
    add(G.head, skin, 0, 1.55, 0);
    if (warrior) add(G.helmet, mat(0x9aa0a6, { metalness: 0.6, roughness: 0.35 }), 0, 1.72, 0);
    else add(G.hair, mat(wild ? 0x3b2a1a : HAIR), 0, 1.57, 0).scale.set(wild ? 1.25 : 1, wild ? 1.3 : 1, wild ? 1.25 : 1);
    const armMat = warrior ? mat(tc) : skin;
    parts.armL = limb(G.limb, armMat, -0.36, 1.3, 0); body.add(parts.armL);
    parts.armR = limb(G.limb, armMat, 0.36, 1.3, 0); body.add(parts.armR);
    if (warrior) {
      const club = new THREE.Mesh(G.club, mat(0x5b3a1e)); club.position.set(0, -0.55, 0.25); club.rotation.x = Math.PI / 2 - 0.3; club.castShadow = true;
      parts.armR.add(club);
      const sh = new THREE.Mesh(G.shield, mat(tc, { roughness: 0.5 })); sh.rotation.z = Math.PI / 2; sh.position.set(-0.08, -0.4, 0.1); sh.castShadow = true;
      parts.armL.add(sh);
    } else if (!wild) {
      const tool = new THREE.Group(); tool.position.set(0, -0.5, 0.05);
      const h = new THREE.Mesh(G.limb, mat(0x6b4423)); h.rotation.x = Math.PI / 2; h.position.z = 0.2; tool.add(h);
      const blade = new THREE.Mesh(G.axe, mat(0x8d8d8d, { metalness: 0.5 })); blade.position.set(0, 0, 0.45); tool.add(blade);
      tool.visible = false; parts.armR.add(tool); parts.tool = tool;
      const bundle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 6), mat(0x8b5a2b));
      bundle.rotation.z = Math.PI / 2; bundle.position.set(0, 1.25, -0.28); bundle.visible = false; body.add(bundle); parts.log = bundle;
    }
  }
  const ring = new THREE.Mesh(G.ring, ringMats[tribe]);
  ring.position.y = 0.08; ring.visible = false; ring.renderOrder = 3;
  root.add(ring);
  root.scale.setScalar(scale);
  return { root, parts, ring };
}

// ---------- 建築 ----------
export function makeBuildingModel(type, tribe) {
  const tc = TRIBE_COLORS[tribe];
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  const add = (geo, m, x, y, z, p = inner) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; p.add(mesh); return mesh; };
  const extra = {};
  if (type === 'hut') {
    add(new THREE.CylinderGeometry(2.0, 2.25, 1.7, 16), mat(0xb48a5a, { roughness: 0.95 }), 0, 0.85, 0);
    add(new THREE.ConeGeometry(2.85, 2.5, 16), mat(0xcfa650, { roughness: 1 }), 0, 2.9, 0);
    add(new THREE.ConeGeometry(1.0, 0.8, 12), mat(0xb08a3a, { roughness: 1 }), 0, 4.2, 0);
    add(new THREE.BoxGeometry(0.8, 1.2, 0.3), mat(0x3a2616), 0, 0.6, 2.1);
    add(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), mat(0x5b3a1e), 0, 5.2, 0);
    const flag = add(new THREE.PlaneGeometry(0.9, 0.55), mat(tc, { side: THREE.DoubleSide }), 0.45, 5.9, 0);
    extra.flag = flag;
  } else if (type === 'warriorhut') {
    add(new THREE.BoxGeometry(5.2, 2.3, 5.2), mat(0x8b5a2b, { roughness: 0.95 }), 0, 1.15, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      add(new THREE.CylinderGeometry(0.28, 0.32, 2.8, 8), mat(0x5b3a1e), sx * 2.6, 1.4, sz * 2.6);
    const roof = add(new THREE.ConeGeometry(4.6, 3.2, 4), mat(shade(tc, 0.6), { roughness: 0.8 }), 0, 3.9, 0);
    roof.rotation.y = Math.PI / 4;
    add(new THREE.BoxGeometry(1.2, 1.6, 0.3), mat(0x2a1a0e), 0, 0.8, 2.65);
    for (let i = 0; i < 6; i++) {
      const sp = add(new THREE.ConeGeometry(0.12, 1.1, 6), mat(0xe8dcc0), -2.2 + i * 0.88, 2.6, 2.75);
      sp.rotation.x = 0.5;
    }
    for (const sx of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), mat(0x3a2616), sx * 3.2, 3.6, 2.8);
      extra['banner' + sx] = add(new THREE.PlaneGeometry(0.8, 1.4), mat(tc, { side: THREE.DoubleSide }), sx * 3.2 + 0.42, 4.4, 2.8);
    }
  } else if (type === 'totem') {
    const cols = [0x7a4b2a, tc, 0x8b5a2b, 0xd9b36b];
    for (let i = 0; i < 4; i++) {
      add(new THREE.CylinderGeometry(0.62 - i * 0.05, 0.7 - i * 0.05, 1.3, 10), mat(cols[i]), 0, 0.65 + i * 1.3, 0);
      add(new THREE.BoxGeometry(0.18, 0.12, 0.1), glow(0xffe080, 2), -0.2, 0.85 + i * 1.3, 0.62 - i * 0.05);
      add(new THREE.BoxGeometry(0.18, 0.12, 0.1), glow(0xffe080, 2), 0.2, 0.85 + i * 1.3, 0.62 - i * 0.05);
    }
    const wing = new THREE.BoxGeometry(2.6, 0.5, 0.2);
    add(wing, mat(tc), 0, 5.0, 0).rotation.z = 0.08;
    const crystal = add(new THREE.OctahedronGeometry(0.55), glow(tc, 3.5), 0, 6.8, 0);
    extra.crystal = crystal;
    const ring = add(new THREE.TorusGeometry(3.2, 0.1, 8, 48), glow(tc, 2.2), 0, 0.2, 0);
    ring.rotation.x = Math.PI / 2; ring.castShadow = false;
    extra.ring = ring;
  }
  return { root, inner, extra };
}

export function makeStoneHead() {
  const root = new THREE.Group();
  const stone = mat(0x8e8a84, { roughness: 0.95 });
  const add = (geo, m, x, y, z) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh; };
  add(new THREE.CylinderGeometry(2.4, 2.8, 0.6, 10), mat(0x6e6a64), 0, 0.3, 0);
  add(new THREE.BoxGeometry(2.3, 3.8, 2.0), stone, 0, 2.5, 0);
  add(new THREE.BoxGeometry(2.4, 0.45, 0.6), stone, 0, 3.4, 0.9);
  add(new THREE.BoxGeometry(0.55, 1.4, 0.55), stone, 0, 2.6, 1.15);
  add(new THREE.BoxGeometry(1.4, 0.3, 0.3), mat(0x6e6a64), 0, 1.45, 1.05);
  add(new THREE.BoxGeometry(0.5, 1.6, 1.0), stone, -1.35, 2.7, 0);
  add(new THREE.BoxGeometry(0.5, 1.6, 1.0), stone, 1.35, 2.7, 0);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2a8), toneMapped: false });
  add(new THREE.SphereGeometry(0.2, 12, 8), eyeMat, -0.5, 3.05, 1.0);
  add(new THREE.SphereGeometry(0.2, 12, 8), eyeMat, 0.5, 3.05, 1.0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.08, 6, 64), new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.6, toneMapped: false }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.25; root.add(ring);
  return { root, eyeMat, ring };
}

// ---------- 樹木（InstancedMesh） ----------
export class Forest {
  constructor(scene, max = 520) {
    this.max = max;
    this.trees = [];
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1.6, 7); trunkGeo.translate(0, 0.8, 0);
    const pineGeo = new THREE.ConeGeometry(1.1, 2.6, 9); pineGeo.translate(0, 2.7, 0);
    const pine2 = new THREE.ConeGeometry(0.8, 2.0, 9); pine2.translate(0, 3.8, 0);
    const roundGeo = new THREE.IcosahedronGeometry(1.25, 1); roundGeo.translate(0, 2.6, 0);
    this.trunks = new THREE.InstancedMesh(trunkGeo, mat(0x6b4526, { roughness: 1 }), max);
    this.pines = new THREE.InstancedMesh(pineGeo, mat(0xffffff, { roughness: 0.9 }), max);
    this.pines2 = new THREE.InstancedMesh(pine2, mat(0xffffff, { roughness: 0.9 }), max);
    this.rounds = new THREE.InstancedMesh(roundGeo, mat(0xffffff, { roughness: 0.9, flatShading: true }), max);
    for (const m of [this.trunks, this.pines, this.pines2, this.rounds]) {
      m.castShadow = true; m.receiveShadow = true; m.count = max;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      this.trunks.setMatrixAt(i, this.zero); this.pines.setMatrixAt(i, this.zero);
      this.pines2.setMatrixAt(i, this.zero); this.rounds.setMatrixAt(i, this.zero);
      this.trees.push({ slot: i, alive: false });
    }
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < max; i++) { this.pines.setColorAt(i, white); this.pines2.setColorAt(i, white); this.rounds.setColorAt(i, white); }
    this.tmp = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3();
  }
  add(x, y, z, kind, scale) {
    const t = this.trees.find((t) => !t.alive);
    if (!t) return null;
    Object.assign(t, { alive: true, x, y, z, kind, scale, grow: 0.15, wood: 30, rot: Math.random() * Math.PI * 2, tilt: 0, fall: 0, fallDir: 0 });
    const c = new THREE.Color().setHSL(kind === 'pine' ? 0.3 + Math.random() * 0.05 : 0.22 + Math.random() * 0.08, 0.55, 0.26 + Math.random() * 0.1);
    this.pines.setColorAt(t.slot, c); this.pines2.setColorAt(t.slot, c.clone().offsetHSL(0, 0, 0.04)); this.rounds.setColorAt(t.slot, c);
    for (const m of [this.pines, this.pines2, this.rounds]) m.instanceColor.needsUpdate = true;
    this.updateTree(t);
    return t;
  }
  updateTree(t) {
    const S = this.zero;
    if (!t.alive) {
      for (const m of [this.trunks, this.pines, this.pines2, this.rounds]) m.setMatrixAt(t.slot, S);
    } else {
      const sc = t.scale * t.grow;
      this.q.setFromEuler(new THREE.Euler(t.fall ? Math.cos(t.fallDir) * t.tilt : 0, t.rot, t.fall ? Math.sin(t.fallDir) * t.tilt : 0));
      this.tmp.compose(this.p.set(t.x, t.y - 0.1, t.z), this.q, this.s.set(sc, sc, sc));
      this.trunks.setMatrixAt(t.slot, this.tmp);
      if (t.kind === 'pine') {
        this.pines.setMatrixAt(t.slot, this.tmp); this.pines2.setMatrixAt(t.slot, this.tmp); this.rounds.setMatrixAt(t.slot, S);
      } else {
        this.rounds.setMatrixAt(t.slot, this.tmp); this.pines.setMatrixAt(t.slot, S); this.pines2.setMatrixAt(t.slot, S);
      }
    }
    for (const m of [this.trunks, this.pines, this.pines2, this.rounds]) m.instanceMatrix.needsUpdate = true;
  }
  remove(t) { t.alive = false; this.updateTree(t); }
  alive() { return this.trees.filter((t) => t.alive); }
}

// 放置建築時的半透明預覽
export function makeGhost(type) {
  const { root } = makeBuildingModel(type, 0);
  const gm = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.4, depthWrite: false });
  root.traverse((o) => { if (o.isMesh) { o.material = gm; o.castShadow = false; } });
  root.userData.mat = gm;
  return root;
}
