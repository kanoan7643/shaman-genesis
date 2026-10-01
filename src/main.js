// 主程式：渲染、鏡頭、輸入、介面
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Game } from './game.js';
import { Audio } from './fx.js';
import { makeGhost } from './models.js';
import { SPELLS, SPELL_ORDER, BUILD, TRAIN_COST, DIFFICULTY, LAYOUT, HALF, WATER, UNIT_STATS, UNIT_TABS, TRIBE_CSS, PRAY_HEAD, PRAY_TOTEM } from './config.js';
import { LEVELS, LEVEL_ORDER, applyLevel } from './levels.js';
import { FN } from './fog.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view'), overlay = $('overlay'), octx = overlay.getContext('2d');
const mini = $('minimap'), mctx = mini.getContext('2d');

// ---------- 設定 ----------
const params = new URLSearchParams(location.search);
let settings = { diff: params.get('d') || 'normal', quality: params.get('q') || 'ultra', level: 'twin', fog: true, sound: true, edge: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem('shaman-settings') || '{}')); } catch (e) { /* 無痕模式 */ }
if (params.get('d')) settings.diff = params.get('d');
if (params.get('level')) settings.level = params.get('level');
if (!LEVELS[settings.level]) settings.level = 'twin';
const saveSettings = () => { try { localStorage.setItem('shaman-settings', JSON.stringify(settings)); } catch (e) { /* 忽略 */ } };

// ---------- 渲染器 ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

let scene = null;
const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 2600);

const sunDir = new THREE.Vector3(0.5, 0.75, 0.35).normalize();
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.castShadow = true;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
const lights = [sun, sun.target, new THREE.HemisphereLight(0xcfe6ff, 0x6a5534, 1.25), new THREE.AmbientLight(0xffffff, 0.15)];
function buildScene() {
  if (scene) scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) m.dispose();
  });
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbcd8ea, 240, 680);
  scene.add(...lights);
}

let composer = null, bloom = null, renderPass = null;
function applyQuality() {
  const q = settings.quality, dpr = window.devicePixelRatio || 1;
  const pr = q === 'ultra' ? Math.min(dpr * 1.25, 2.5) : q === 'high' ? Math.min(dpr, 1.5) : 1;
  renderer.setPixelRatio(pr);
  const sm = q === 'ultra' ? 4096 : q === 'high' ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== sm) { sun.shadow.mapSize.set(sm, sm); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  if (q !== 'perf') {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q === 'ultra' ? 4 : 2 });
    composer = new EffectComposer(renderer, rt);
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  } else composer = null;
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w < 2 || h < 2) return; // 視窗隱藏時避免建立零尺寸緩衝區
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  const d = window.devicePixelRatio || 1;
  overlay.width = w * d; overlay.height = h * d; octx.setTransform(d, 0, 0, d, 0, 0);
  if (game) game.fx.setScale(h * renderer.getPixelRatio(), camera.fov);
}
window.addEventListener('resize', resize);

// ---------- 遊戲 ----------
const audio = new Audio();
let game = null, started = false, paused = false;
let miniImg = null, miniT = 0;
const seed = Math.floor(Math.random() * 1e6);
const cam = { x: 0, z: 0, y: 3, yaw: 0.6, tYaw: 0.6, dist: 150, tDist: 150 };
const base = () => LAYOUT.bases[0];
let rallyFlag = null;
function makeRallyFlag() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 6), new THREE.MeshStandardMaterial({ color: 0x8b6a3e, roughness: 1 }));
  pole.position.y = 1.7; pole.castShadow = true;
  const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(1.5, -0.45); shape.lineTo(0, -0.9); shape.closePath();
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: TRIBE_CSS[0], side: THREE.DoubleSide, emissive: 0x113366 }));
  cloth.position.set(0.05, 3.35, 0); cloth.castShadow = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0x777066, roughness: 1 }));
  base.position.y = 0.09;
  g.add(pole, cloth, base);
  g.userData.cloth = cloth;
  return g;
}
// 建立（或切換關卡時重建）整個世界
function newWorld(levelId) {
  applyLevel(levelId);
  buildScene();
  game = new Game(scene, audio, { seed, diff: DIFFICULTY[settings.diff] || DIFFICULTY.normal, fog: settings.fog });
  game.fog.patchScene(scene);
  rallyFlag = makeRallyFlag(); rallyFlag.visible = false; scene.add(rallyFlag);
  if (renderPass) renderPass.scene = scene;
  miniImg = null;
  cam.x = base().x + 8; cam.z = base().z - 6;
  window.__game = game;
  resize();
}
newWorld(settings.level);
applyQuality();
$('loading').classList.add('hidden');

// ---------- 選取與模式 ----------
let selection = [];       // 我方單位
let selObj = null;        // 選取的建築 / 石像 / 敵方單位
let mode = null;          // {kind:'cast', spell} | {kind:'build', type, ghost}
const mouse = { x: 0, y: 0, down: false, sx: 0, sy: 0, drag: false, mid: false, lx: 0, in: false };
const keys = new Set();
let hover = null, groundPt = null, lastClick = { t: 0, type: null };

function clearSel() { for (const u of selection) u.selected = false; selection = []; if (selObj) selObj.selected = false; selObj = null; }
function setSel(list, add) {
  if (!add) clearSel();
  for (const u of list) if (!u.selected) { u.selected = true; selection.push(u); }
  if (list.length) audio.play('select');
}
function playerShaman() { const s = game.tribes[0].shaman; return s && s.alive ? s : null; }

// ---------- 投影與點選 ----------
const tmpV = new THREE.Vector3(), ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function toScreen(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  return { x: (tmpV.x + 1) / 2 * window.innerWidth, y: (1 - tmpV.y) / 2 * window.innerHeight, ok: tmpV.z < 1 && tmpV.z > -1 };
}
function pickGround(sx, sy) {
  ndc.set(sx / window.innerWidth * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction, T = game.terrain;
  const surf = (p) => Math.max(T.heightAt(p.x, p.z), WATER);
  let prev = 0, p = new THREE.Vector3();
  for (let t = 1; t < 1500; t += 1.2) {
    p.copy(o).addScaledVector(d, t);
    if (p.y < surf(p)) {
      let a = prev, b = t;
      for (let i = 0; i < 8; i++) { const m = (a + b) / 2; p.copy(o).addScaledVector(d, m); if (p.y < surf(p)) b = m; else a = m; }
      return p.clone();
    }
    prev = t;
    if (p.y < -15) break;
  }
  return null;
}
function pickUnit(sx, sy, filter) {
  let best = null, bd = 24;
  for (const u of game.units) {
    if (!u.alive || !u.model.root.visible || (filter && !filter(u))) continue;
    const s = toScreen(u.pos.x, u.pos.y + 1.1 * u.stats.scale, u.pos.z);
    if (!s.ok) continue;
    const d = Math.hypot(s.x - sx, s.y - sy) - (u.tribe === 0 ? 4 : 0);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}
function pickObject(sx, sy, gp) {
  let best = null, bd = 1e9;
  for (const b of [...game.buildings, ...game.heads]) {
    if (!b.alive || !b.model.root.visible) continue;
    let d = gp ? Math.hypot(gp.x - b.pos.x, gp.z - b.pos.z) - b.radius - 0.8 : 1e9;
    const s = toScreen(b.pos.x, b.pos.y + 2.5, b.pos.z);
    if (s.ok && Math.hypot(s.x - sx, s.y - sy) < 34) d = Math.min(d, -0.5 + Math.hypot(s.x - sx, s.y - sy) / 100);
    if (d < 0 && d < bd) { bd = d; best = b; }
  }
  return best;
}
function pickTree(gp) {
  if (!gp) return null;
  let best = null, bd = 2.2;
  for (const t of game.forest.trees) {
    if (!t.alive || t.fall) continue;
    const d = Math.hypot(t.x - gp.x, t.z - gp.z);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
function hoverAt(sx, sy) {
  const gp = pickGround(sx, sy);
  const u = pickUnit(sx, sy);
  if (u) return { kind: 'unit', obj: u, gp };
  const o = pickObject(sx, sy, gp);
  if (o) return { kind: o.kind, obj: o, gp };
  const t = pickTree(gp);
  if (t) return { kind: 'tree', obj: t, gp };
  return { kind: 'ground', gp };
}

// ---------- 指令 ----------
function ping(x, z, color) { game.pings.push({ x, z, t: 0.9, color, cmd: true }); }
function formation(units, x, z, orderFn) {
  const n = units.length, cols = Math.ceil(Math.sqrt(n)), sp = 1.8;
  const sorted = [...units].sort((a, b) => Math.hypot(a.pos.x - x, a.pos.z - z) - Math.hypot(b.pos.x - x, b.pos.z - z));
  sorted.forEach((u, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    orderFn(u, x + (c - (cols - 1) / 2) * sp, z + (r - (Math.ceil(n / cols) - 1) / 2) * sp);
  });
}
function command(sx, sy) {
  const mine = selection.filter((u) => u.alive);
  if (!mine.length) {
    if (isMyWarriorHut(selObj)) { const gp = pickGround(sx, sy); if (gp) setRally(selObj, gp); }
    return;
  }
  const h = hoverAt(sx, sy);
  const followers = mine.filter((u) => u.isFollower);
  const braves = mine.filter((u) => u.type === 'brave');
  if (h.kind === 'unit' && h.obj.tribe === 1) {
    for (const u of mine) u.setOrder({ type: 'attack', target: h.obj }, true);
    ping(h.obj.pos.x, h.obj.pos.z, '#ff5a4a'); audio.play('order'); return;
  }
  if (h.kind === 'building' && h.obj.tribe === 1) {
    for (const u of mine) u.setOrder({ type: 'attack', target: h.obj }, true);
    ping(h.obj.pos.x, h.obj.pos.z, '#ff5a4a'); audio.play('order'); return;
  }
  const rest = (list) => {
    const others = mine.filter((u) => !list.includes(u));
    if (others.length && h.gp) formation(others, h.gp.x, h.gp.z, (u, x, z) => u.setOrder({ type: 'move', x, z }, true));
  };
  if ((h.kind === 'head' || (h.kind === 'building' && h.obj.type === 'totem' && h.obj.tribe === 0)) && followers.length) {
    for (const u of followers) u.setOrder({ type: 'pray', site: h.obj }, true);
    const sh = mine.find((u) => u.type === 'shaman');
    if (sh) sh.setOrder({ type: 'move', x: h.obj.pos.x + 6, z: h.obj.pos.z + 6 }, true);
    ping(h.obj.pos.x, h.obj.pos.z, '#ffe28a'); audio.play('order');
    if (h.kind === 'head' && game.tribes[0].unlocked.has(h.obj.spell)) {
      const sp = SPELLS[h.obj.spell], c = game.tribes[0].charges[h.obj.spell];
      game.msg(c >= sp.charges ? `${sp.icon} ${sp.name} 次數已滿（${c}/${sp.charges}）` : `在石像祈禱，補充 ${sp.icon} ${sp.name} 的次數`);
    }
    return;
  }
  if (h.kind === 'building' && h.obj.tribe === 0 && !h.obj.complete && braves.length) {
    for (const u of braves) u.setOrder({ type: 'build', site: h.obj }, false);
    rest(braves); ping(h.obj.pos.x, h.obj.pos.z, '#bfe8a8'); audio.play('order'); return;
  }
  if (h.kind === 'building' && h.obj.tribe === 0 && h.obj.type === 'warriorhut' && h.obj.complete && braves.length) {
    let n = 0;
    for (const u of braves) { if (game.tribes[0].wood < TRAIN_COST) break; game.tribes[0].wood -= TRAIN_COST; u.setOrder({ type: 'train', hut: h.obj }, true); n++; }
    if (!n) { game.msg(`木材不足（每名戰士需 ${TRAIN_COST} 木材）`); audio.play('error'); }
    else { game.msg(`${n} 名勇者前往受訓`); audio.play('order'); }
    return;
  }
  if (h.kind === 'tree' && braves.length) {
    for (const u of braves) u.setOrder({ type: 'gather', tree: h.obj }, false);
    rest(braves); ping(h.obj.x, h.obj.z, '#e8c27a'); audio.play('order'); return;
  }
  if (!h.gp) return;
  const amove = keys.has('control');
  formation(mine, h.gp.x, h.gp.z, (u, x, z) => u.setOrder({ type: 'move', x, z, amove }, true));
  ping(h.gp.x, h.gp.z, amove ? '#ff9a5a' : '#8fff9a'); audio.play('order');
}

function enterCast(id) {
  const tr = game.tribes[0];
  if (!tr.unlocked.has(id)) { game.msg(`「${SPELLS[id].name}」尚未解鎖——讓子民到石像祈禱`); audio.play('error'); return; }
  if (!playerShaman()) { game.msg('薩滿不在，無法施法'); audio.play('error'); return; }
  if (tr.charges[id] < 1) { game.msg(`${SPELLS[id].icon} ${SPELLS[id].name} 沒有次數了——讓子民到石像或圖騰祈禱補充`); audio.play('error'); return; }
  cancelMode();
  mode = { kind: 'cast', spell: id };
}
function enterBuild(type) {
  if (game.tribes[0].wood < BUILD[type].wood) { game.msg(`木材不足：${BUILD[type].name} 需要 ${BUILD[type].wood} 木材`); audio.play('error'); return; }
  cancelMode();
  const ghost = makeGhost(type);
  ghost.userData.mat.userData.warFog = 'skip';
  scene.add(ghost);
  mode = { kind: 'build', type, ghost };
}
function isMyWarriorHut(o) { return o && o.alive && o.kind === 'building' && o.tribe === 0 && o.type === 'warriorhut'; }
function setRally(hut, gp) {
  if (!game.terrain.walkable(gp.x, gp.z)) { game.msg('集結點必須在可行走的陸地上'); audio.play('error'); return; }
  hut.rally = { x: gp.x, z: gp.z };
  ping(gp.x, gp.z, '#5ab0ff'); audio.play('order');
  game.msg('🚩 集結點已設定：新訓練的戰士會自動前往');
}
function enterRally() {
  if (!isMyWarriorHut(selObj)) return;
  cancelMode();
  mode = { kind: 'rally', hut: selObj };
}
function clearRally() { if (isMyWarriorHut(selObj)) { selObj.rally = null; audio.play('order'); } }
function cancelMode() {
  if (mode && mode.ghost) scene.remove(mode.ghost);
  mode = null;
}
function doCast(gp) {
  const s = playerShaman();
  if (!s || !gp) return;
  const sp = SPELLS[mode.spell];
  if (game.tribes[0].charges[mode.spell] < 1) { game.msg(`${sp.icon} ${sp.name} 沒有次數了`); audio.play('error'); cancelMode(); return; }
  s.setOrder({ type: 'cast', spell: mode.spell, x: gp.x, z: gp.z }, true);
  ping(gp.x, gp.z, '#9ef0ff'); audio.play('order');
  if (!keys.has('shift')) cancelMode();
}
function doBuild(gp) {
  if (!gp) return;
  const type = mode.type;
  if (game.tribes[0].wood < BUILD[type].wood) { game.msg('木材不足'); audio.play('error'); cancelMode(); return; }
  if (!game.canPlace(type, gp.x, gp.z)) { game.msg('這裡無法建造（需要平坦的陸地）'); audio.play('error'); return; }
  const b = game.placeBuilding(type, 0, gp.x, gp.z);
  const braves = selection.filter((u) => u.alive && u.type === 'brave');
  for (const u of braves) u.setOrder({ type: 'build', site: b }, false);
  audio.play('build');
  game.msg(`開始建造 ${BUILD[type].name}${braves.length ? '' : '（閒置的勇者會自動前往）'}`);
  if (!keys.has('shift') || game.tribes[0].wood < BUILD[type].wood) cancelMode();
}
function trainWarrior() {
  const hut = selObj && selObj.type === 'warriorhut' && selObj.tribe === 0 && selObj.complete ? selObj
    : game.buildings.find((b) => b.alive && b.tribe === 0 && b.type === 'warriorhut' && b.complete);
  if (!hut) { game.msg('需要先建造完成戰士訓練所'); audio.play('error'); return; }
  if (game.tribes[0].wood < TRAIN_COST) { game.msg(`木材不足（需要 ${TRAIN_COST}）`); audio.play('error'); return; }
  let best = null, bd = 1e9;
  for (const u of game.units) {
    if (!u.alive || u.tribe !== 0 || u.type !== 'brave' || u.ord.type === 'train') continue;
    const d = Math.hypot(u.pos.x - hut.pos.x, u.pos.z - hut.pos.z) + (u.manual ? 40 : 0) + (u.ord.type === 'pray' ? 60 : 0);
    if (d < bd) { bd = d; best = u; }
  }
  if (!best) { game.msg('沒有可受訓的勇者'); audio.play('error'); return; }
  game.tribes[0].wood -= TRAIN_COST;
  best.setOrder({ type: 'train', hut }, true);
  audio.play('order');
}
function prayAtTotem() {
  const t = game.tribes[0].totem;
  if (!t || !t.alive) return;
  const f = selection.filter((u) => u.alive && u.isFollower);
  for (const u of f) u.setOrder({ type: 'pray', site: t }, true);
  if (f.length) audio.play('order');
}
function autoWork() {
  for (const u of selection) if (u.alive && u.type === 'brave') { u.manual = false; u.setOrder({ type: 'idle' }, false); }
  audio.play('order');
}
function stopSel() { for (const u of selection) if (u.alive) u.setOrder({ type: 'idle' }, true); }
function selectShaman() {
  const s = playerShaman();
  if (!s) { game.msg(game.tribes[0].respawnT > 0 ? `薩滿將於 ${Math.ceil(game.tribes[0].respawnT)} 秒後重生` : '薩滿已無法重生'); audio.play('error'); return; }
  setSel([s]);
  if (Math.hypot(cam.x - s.pos.x, cam.z - s.pos.z) < 3) return;
  cam.x = s.pos.x; cam.z = s.pos.z;
}
// 單位分頁：選取某兵種的所有單位；短時間內再按一次則鏡頭移到該部隊
let lastTab = { type: null, t: 0 };
function selectTab(type, add) {
  if (type === 'shaman' && !add) { selectShaman(); return; }
  const list = game.units.filter((u) => u.alive && u.tribe === 0 && u.type === type);
  if (!list.length) { game.msg(`目前沒有${UNIT_STATS[type].name}`); audio.play('error'); return; }
  selectGroup(type, list, add);
}
// 閒置勇者：沒有工作（手動指令做完、或附近沒樹可砍）超過 1.5 秒的勇者
function idleBraves() { return game.units.filter((u) => u.alive && u.tribe === 0 && u.type === 'brave' && u.ord.type === 'idle' && game.time - u.idleSince > 1.5); }
function selectIdle(add) {
  const list = idleBraves();
  if (!list.length) { game.msg('沒有閒置的勇者'); audio.play('error'); return; }
  selectGroup('idle', list, add);
}
function selectGroup(type, list, add) {
  const now = performance.now(), again = lastTab.type === type && now - lastTab.t < 450;
  lastTab = { type, t: now };
  setSel(list, add);
  if (again) {
    // 鏡頭移到離目前畫面最近的一群
    let best = list[0], bd = 1e9;
    for (const u of list) { const d = Math.hypot(u.pos.x - cam.x, u.pos.z - cam.z); if (d < bd) { bd = d; best = u; } }
    const near = list.filter((u) => Math.hypot(u.pos.x - best.pos.x, u.pos.z - best.pos.z) < 25);
    cam.x = near.reduce((a, u) => a + u.pos.x, 0) / near.length; cam.z = near.reduce((a, u) => a + u.pos.z, 0) / near.length;
  }
}

// ---------- 輸入 ----------
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  audio.init();
  if (!started || paused) return;
  if (e.button === 1) { mouse.mid = true; mouse.lx = e.clientX; e.preventDefault(); return; }
  if (e.button === 2) {
    if (mode) { cancelMode(); return; }
    command(e.clientX, e.clientY); return;
  }
  if (e.button !== 0) return;
  if (mode && mode.kind === 'cast') { doCast(pickGround(e.clientX, e.clientY)); return; }
  if (mode && mode.kind === 'build') { doBuild(pickGround(e.clientX, e.clientY)); return; }
  if (mode && mode.kind === 'rally') { const gp = pickGround(e.clientX, e.clientY), hut = mode.hut; cancelMode(); if (gp && hut.alive) setRally(hut, gp); return; }
  mouse.down = true; mouse.sx = e.clientX; mouse.sy = e.clientY; mouse.drag = false;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true;
  if (mouse.mid) { cam.tYaw -= (e.clientX - mouse.lx) * 0.006; mouse.lx = e.clientX; }
  if (mouse.down && Math.hypot(e.clientX - mouse.sx, e.clientY - mouse.sy) > 6) mouse.drag = true;
});
canvas.addEventListener('pointerleave', () => { mouse.in = false; });
window.addEventListener('pointerup', (e) => {
  if (e.button === 1) { mouse.mid = false; return; }
  if (e.button !== 0 || !mouse.down) return;
  mouse.down = false;
  const add = e.shiftKey;
  if (mouse.drag) {
    const x0 = Math.min(mouse.sx, e.clientX), x1 = Math.max(mouse.sx, e.clientX), y0 = Math.min(mouse.sy, e.clientY), y1 = Math.max(mouse.sy, e.clientY);
    const list = game.units.filter((u) => {
      if (!u.alive || u.tribe !== 0) return false;
      const s = toScreen(u.pos.x, u.pos.y + 1, u.pos.z);
      return s.ok && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
    });
    if (list.length || !add) setSel(list, add);
    mouse.drag = false;
    return;
  }
  const u = pickUnit(e.clientX, e.clientY);
  if (u && u.tribe === 0) {
    const now = performance.now();
    if (now - lastClick.t < 350 && lastClick.type === u.type) {
      setSel(game.units.filter((o) => o.alive && o.tribe === 0 && o.type === u.type && toScreen(o.pos.x, o.pos.y, o.pos.z).ok), add);
    } else if (add && u.selected) { u.selected = false; selection = selection.filter((o) => o !== u); }
    else setSel([u], add);
    lastClick = { t: now, type: u.type };
    return;
  }
  clearSel();
  if (u) { selObj = u; u.selected = true; audio.play('select'); return; }
  const o = pickObject(e.clientX, e.clientY, pickGround(e.clientX, e.clientY));
  if (o) { selObj = o; o.selected = true; audio.play('select'); }
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.tDist = THREE.MathUtils.clamp(cam.tDist * Math.pow(1.0015, e.deltaY), 22, 175); }, { passive: false });
canvas.addEventListener('dblclick', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (e.shiftKey) keys.add('shift');
  if (e.ctrlKey) keys.add('control');
  if (!started) return;
  if (k === 'escape') { if (mode) cancelMode(); else togglePause(); return; }
  if (k === 'p') { togglePause(); return; }
  if (paused) return;
  const sp = SPELL_ORDER.find((id) => SPELLS[id].key === k);
  if (sp) { enterCast(sp); return; }
  const tab = !e.ctrlKey && UNIT_TABS.find((t) => UNIT_STATS[t].tab.key === k);
  if (tab) { selectTab(tab, e.shiftKey); return; }
  if (k === 'v' && !e.ctrlKey) { selectIdle(e.shiftKey); return; }
  if (k === ' ') { e.preventDefault(); selectShaman(); }
  else if (k === 'b') enterBuild('hut');
  else if (k === 'n') enterBuild('warriorhut');
  else if (k === 'g') autoWork();
  else if (k === 't') prayAtTotem();
  else if (k === 'h') stopSel();
  else if (k === 'r') trainWarrior();
  else if (k === 'home') { const t = game.tribes[0].totem; if (t) { cam.x = t.pos.x; cam.z = t.pos.z; } }
  else if (k === 'a' && e.ctrlKey) { e.preventDefault(); setSel(game.units.filter((u) => u.alive && u.tribe === 0 && u.type !== 'brave')); }
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.key.toLowerCase());
  if (!e.shiftKey) keys.delete('shift');
  if (!e.ctrlKey) keys.delete('control');
});
window.addEventListener('blur', () => keys.clear());

// 小地圖
function miniToWorld(e) {
  const r = mini.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width - 0.5) * HALF * 2, z: ((e.clientY - r.top) / r.height - 0.5) * HALF * 2 };
}
let miniDrag = false;
mini.addEventListener('contextmenu', (e) => e.preventDefault());
mini.addEventListener('pointerdown', (e) => {
  audio.init();
  const p = miniToWorld(e);
  if (e.button === 2) {
    const mine = selection.filter((u) => u.alive);
    if (mine.length) { formation(mine, p.x, p.z, (u, x, z) => u.setOrder({ type: 'move', x, z }, true)); ping(p.x, p.z, '#8fff9a'); audio.play('order'); }
    return;
  }
  miniDrag = true; cam.x = p.x; cam.z = p.z; mini.setPointerCapture(e.pointerId);
});
mini.addEventListener('pointermove', (e) => { if (miniDrag) { const p = miniToWorld(e); cam.x = p.x; cam.z = p.z; } });
mini.addEventListener('pointerup', () => { miniDrag = false; });

// ---------- 介面 ----------
const spellBox = $('spells');
const spellBtns = {};
for (const id of SPELL_ORDER) {
  const s = SPELLS[id];
  const b = document.createElement('button');
  b.className = 'spell';
  b.innerHTML = `<div class="cd"></div><span class="hk">${s.key}</span><span class="ic">${s.icon}</span><span class="nm">${s.name}</span><span class="ct"></span>`;
  b.onclick = () => { audio.init(); enterCast(id); };
  b.onmouseenter = () => showTip(b, () => {
    const tr = game.tribes[0], lock = !tr.unlocked.has(id);
    const heads = game.heads.filter((h) => h.spell === id);
    const where = !heads.length ? '<br><span style="color:#ff8a7a">此地圖沒有這座石像</span>'
      : heads.every((h) => h.far) ? '（石像位於孤島，需要陸橋）' : '';
    return `<b>${s.icon} ${s.name}</b>（${s.key}）<br>${s.desc}<br>射程 ${s.range} · 最多 ${s.charges} 次` +
      (lock ? `<br><span style="color:#ffb27a">🔒 讓子民在「${s.name}」石像祈禱以解鎖（需 ${s.unlock} 祈禱量）${where}</span>`
        : `<br>剩餘 <b>${tr.charges[id]}/${s.charges}</b> 次 · 補充一次需 ${s.need} 祈禱量` +
          `<br><small>在${s.name}石像祈禱：每人每秒 ${PRAY_HEAD}；在圖騰祈禱：每人每秒 ${PRAY_TOTEM}，平分給所有未滿的法術。人越多越快。</small>${where}`);
  });
  b.onmouseleave = hideTip;
  spellBox.appendChild(b);
  spellBtns[id] = b;
}
const tabBox = $('unitTabs');
const tabBtns = {};
for (const type of UNIT_TABS) {
  const st = UNIT_STATS[type];
  const b = document.createElement('button');
  b.className = 'utab';
  b.innerHTML = `<span class="hk">${st.tab.label}</span><span class="ic">${st.tab.icon}</span><span class="nm">${st.name}</span><b class="n">0</b>`;
  b.onclick = (e) => { audio.init(); selectTab(type, e.shiftKey); };
  b.onmouseenter = () => showTip(b, () => `<b>${st.tab.icon} ${st.name}</b>（${st.tab.label}${type === 'shaman' ? ' / 空白鍵' : ''}）<br>選取所有${st.name} · Shift 加選 · 連按兩下移動鏡頭`);
  b.onmouseleave = hideTip;
  tabBox.appendChild(b);
  tabBtns[type] = b;
}
const idleBtn = document.createElement('button');
idleBtn.className = 'utab idle';
idleBtn.innerHTML = `<span class="hk">V</span><span class="ic">💤</span><span class="nm">閒置勇者</span><b class="n">0</b>`;
idleBtn.onclick = (e) => { audio.init(); selectIdle(e.shiftKey); };
idleBtn.onmouseenter = () => showTip(idleBtn, () => '<b>💤 閒置勇者</b>（V）<br>勇者平常會自動伐木、建造；下過手動指令（移動、祈禱結束等）或附近沒樹可砍時會閒置。<br>選取後按 G 讓他們回去自動工作 · 連按兩下移動鏡頭');
idleBtn.onmouseleave = hideTip;
tabBox.appendChild(idleBtn);
const tip = $('tooltip');
let tipFn = null, tipEl = null;
function showTip(el, fn) { tipEl = el; tipFn = fn; tip.style.display = 'block'; updateTip(); }
function hideTip() { tipFn = null; tip.style.display = 'none'; }
function updateTip() {
  if (!tipFn) return;
  tip.innerHTML = tipFn();
  const r = tipEl.getBoundingClientRect();
  tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
  tip.style.top = (r.top - tip.offsetHeight - 10) + 'px';
}

const STATE_TXT = { idle: '閒置', move: '移動中', attack: '戰鬥中', gather: '伐木中', build: '建造中', pray: '祈禱中', train: '前往受訓', cast: '施法中', wander: '遊蕩' };
let panelSig = '';
function act(label, sub, fn, disabled, tipTxt) { return { label, sub, fn, disabled, tipTxt }; }
function buildPanel() {
  const tr = game.tribes[0];
  const sel = selection.filter((u) => u.alive);
  if (selection.length !== sel.length) selection = sel;
  if (selObj && !selObj.alive) selObj = null;
  let info = '', acts = [];
  const hpBar = (o) => `<div class="hp"><i style="width:${Math.max(0, o.hp / o.maxHp * 100)}%"></i></div>`;
  if (sel.length === 1) {
    const u = sel[0];
    info = `<h3>${UNIT_STATS[u.type].name}</h3>${hpBar(u)}生命 ${Math.ceil(u.hp)}/${u.maxHp} · ${STATE_TXT[u.ord.type] || ''}${u.carry ? ` · 攜帶 ${u.carry} 木` : ''}${u.manual ? '' : u.type === 'brave' ? ' · 自動工作' : ''}`;
  } else if (sel.length > 1) {
    const c = {}; for (const u of sel) c[u.type] = (c[u.type] || 0) + 1;
    info = `<h3>已選取 ${sel.length} 名</h3>` + Object.entries(c).map(([t, n]) => `${UNIT_STATS[t].name} ×${n}`).join(' · ');
  } else if (selObj) {
    const o = selObj;
    if (o.kind === 'head') {
      const s = SPELLS[o.spell], own = tr.unlocked.has(o.spell);
      const c = tr.charges[o.spell], full = c >= s.charges;
      info = `<h3>🗿 ${s.name}石像 · ${s.icon}</h3>` + (own
        ? `<span style="color:#bfe8a8">✔ 已解鎖</span> · 次數 <b>${c}/${s.charges}</b> · ${full ? '已滿' : `補充 ${Math.floor(tr.chargeP[o.spell] / s.need * 100)}%`}`
        : `解鎖進度 我方 ${Math.floor(o.progress[0] / o.need * 100)}% · 敵方 ${Math.floor(o.progress[1] / o.need * 100)}%`) +
        `<br><small>${o.prayers[0] ? `🙏 ${o.prayers[0]} 人祈禱中 · ` : ''}選取子民後右鍵石像祈禱${own ? '補充次數' : '解鎖'}，人越多越快</small>`;
    } else if (o.kind === 'building') {
      const st = BUILD[o.type];
      info = `<h3>${o.tribe === 1 ? '敵方 ' : ''}${st.name}</h3>${hpBar(o)}`;
      if (!o.complete) info += `建造中 ${Math.floor(o.progress * 100)}%`;
      else if (o.type === 'hut') info += `每 26 秒產生一名勇者 · 人口 ${game.popOf(o.tribe)}/${game.capOf(o.tribe)}`;
      else if (o.type === 'warriorhut') {
        info += `訓練佇列：${o.trainQ}${o.trainQ ? `（${Math.floor(o.trainT / 5 * 100)}%）` : ''}`;
        if (o.tribe === 0) info += `<br><small>🚩 集結點：${o.rally ? '已設定' : '未設定'} · 選取訓練所後右鍵地面即可設定</small>`;
      }
      else if (o.type === 'totem') info += `祈禱者 ${o.prayers} 名 · 薩滿重生點<br><small>在圖騰祈禱會平均補充所有未滿的法術</small>`;
      if (o.type === 'warriorhut' && o.tribe === 0 && o.complete) acts.push(act('🗡 訓練戰士', `${TRAIN_COST} 木 (R)`, trainWarrior, tr.wood < TRAIN_COST));
      if (o.type === 'warriorhut' && o.tribe === 0) {
        acts.push(act('🚩 集結點', '點地面 / 右鍵', enterRally, false, '設定新戰士訓練完成後自動前往的位置'));
        if (o.rally) acts.push(act('✖ 取消集結', '', clearRally, false));
      }
    } else if (o.kind === 'unit') {
      info = `<h3>${o.tribe === 2 ? '野人' : '敵方 ' + UNIT_STATS[o.type].name}</h3>${hpBar(o)}${o.tribe === 2 ? '使用「感化」將他們轉化為子民' : ''}`;
    }
  } else {
    info = `<h3>${LAYOUT.icon} ${LAYOUT.name}</h3><small>拖曳框選子民 · Z 薩滿 · X 戰士 · V 閒置勇者<br>在石像祈禱 → 解鎖法術、補充次數；在圖騰祈禱 → 補充全部</small>`;
  }
  if (sel.length) {
    const hasF = sel.some((u) => u.isFollower), hasB = sel.some((u) => u.type === 'brave');
    acts.push(act('🙏 圖騰祈禱', '(T)', prayAtTotem, !hasF || !tr.totem));
    acts.push(act('🪓 自動工作', '(G)', autoWork, !hasB));
    acts.push(act('✋ 停止', '(H)', stopSel, false));
  }
  acts.push(act('🛖 小屋', `${BUILD.hut.wood} 木 (B)`, () => enterBuild('hut'), tr.wood < BUILD.hut.wood, '增加人口上限 6，並定期產生勇者'));
  acts.push(act('⚔ 訓練所', `${BUILD.warriorhut.wood} 木 (N)`, () => enterBuild('warriorhut'), tr.wood < BUILD.warriorhut.wood, '把勇者訓練成強壯的戰士'));
  if (!(selObj && selObj.type === 'warriorhut') && game.buildings.some((b) => b.alive && b.tribe === 0 && b.type === 'warriorhut' && b.complete))
    acts.push(act('🗡 訓練戰士', `${TRAIN_COST} 木 (R)`, trainWarrior, tr.wood < TRAIN_COST));
  $('selInfo').innerHTML = info;
  const sig = acts.map((a) => a.label + a.sub + a.disabled).join('|') + (mode ? mode.kind + (mode.type || '') : '');
  if (sig !== panelSig) {
    panelSig = sig;
    const box = $('actions');
    box.innerHTML = '';
    for (const a of acts) {
      const b = document.createElement('button');
      b.className = 'act' + ((mode && mode.kind === 'build' && a.label.includes(BUILD[mode.type].name.slice(-3))) || (mode && mode.kind === 'rally' && a.label.includes('集結點')) ? ' on' : '');
      b.innerHTML = `${a.label}<small>${a.sub}</small>`;
      b.disabled = !!a.disabled;
      b.onclick = () => { audio.init(); a.fn(); };
      if (a.tipTxt) { b.onmouseenter = () => showTip(b, () => a.tipTxt); b.onmouseleave = hideTip; }
      box.appendChild(b);
    }
  }
}
let uiT = 0, logSig = '';
function updateUI(dt) {
  uiT -= dt;
  const tr = game.tribes[0];
  if (uiT > 0) return;
  uiT = 0.15;
  $('wood').textContent = Math.floor(tr.wood);
  $('pop').textContent = `${game.popOf(0)}/${game.capOf(0)}`;
  $('enemyPop').textContent = game.tribes[1].followers ?? 0;
  $('prayers').textContent = game.units.reduce((n, u) => n + (u.alive && u.tribe === 0 && u.working === 'pray' ? 1 : 0), 0);
  const selTypes = new Set(selection.filter((u) => u.alive).map((u) => u.type));
  for (const type of UNIT_TABS) {
    const n = game.units.reduce((a, u) => a + (u.alive && u.tribe === 0 && u.type === type ? 1 : 0), 0);
    const b = tabBtns[type];
    b.querySelector('.n').textContent = type === 'shaman' && !n && game.tribes[0].respawnT > 0 ? `${Math.ceil(game.tribes[0].respawnT)}s` : n;
    b.classList.toggle('empty', !n);
    b.classList.toggle('on', selTypes.has(type));
  }
  const nIdle = idleBraves().length;
  idleBtn.querySelector('.n').textContent = nIdle;
  idleBtn.classList.toggle('empty', !nIdle);
  idleBtn.classList.toggle('alert', nIdle > 0);
  const t = Math.floor(game.time);
  $('clock').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  for (const id of SPELL_ORDER) {
    const b = spellBtns[id], s = SPELLS[id], lock = !tr.unlocked.has(id);
    const c = tr.charges[id], full = c >= s.charges;
    b.classList.toggle('locked', lock);
    b.classList.toggle('poor', !lock && c < 1);
    b.classList.toggle('ready', !lock && c >= 1);
    b.classList.toggle('active', !!(mode && mode.spell === id));
    b.classList.toggle('hidden', lock && !game.heads.some((h) => h.spell === id));
    b.querySelector('.cd').style.height = lock || full ? '0' : Math.min(100, tr.chargeP[id] / s.need * 100) + '%';
    b.querySelector('.ct').innerHTML = lock ? '' : '<i class="on"></i>'.repeat(c) + '<i></i>'.repeat(s.charges - c);
  }
  buildPanel();
  const sig = game.messages.map((m) => m.text).join('|');
  if (sig !== logSig) {
    logSig = sig;
    $('log').innerHTML = game.messages.map((m) => `<div style="color:${m.color}">${m.text}</div>`).join('');
  }
  const bn = $('banner');
  if (game.banner) { bn.textContent = game.banner.text; bn.classList.add('on'); } else bn.classList.remove('on');
  updateTip();
  canvas.className = mode ? 'c-cast' : hover && ((hover.kind === 'unit' && hover.obj.tribe === 1) || (hover.kind === 'building' && hover.obj.tribe === 1)) && selection.length ? 'c-attack'
    : hover && hover.kind === 'head' && selection.length ? 'c-pray' : '';
  if (game.over && $('end').classList.contains('hidden')) {
    $('end').classList.remove('hidden');
    $('endTitle').textContent = game.over === 'win' ? '🏆 勝利！' : '💀 部族覆滅';
    $('endText').textContent = game.over === 'win'
      ? `你在 ${$('clock').textContent} 內於「${LAYOUT.name}」擊潰了赤焰部族，眾神為你歡呼！`
      : `赤焰部族消滅了你的子民……但信仰永不熄滅。`;
    const next = LEVEL_ORDER[LEVEL_ORDER.indexOf(LAYOUT.id) + 1];
    $('btnNext').classList.toggle('hidden', !(game.over === 'win' && next));
    if (next) $('btnNext').textContent = `下一關：${LEVELS[next].name}`;
  }
}

// ---------- 覆蓋層繪製 ----------
function circleWorld(x, z, r, color, width = 2, dash = null) {
  octx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const s = toScreen(px, Math.max(game.terrain.heightAt(px, pz), WATER) + 0.3, pz);
    if (i === 0) octx.moveTo(s.x, s.y); else octx.lineTo(s.x, s.y);
  }
  octx.strokeStyle = color; octx.lineWidth = width; octx.setLineDash(dash || []); octx.stroke(); octx.setLineDash([]);
}
function bar(x, y, w, frac, color, h = 5) {
  octx.fillStyle = 'rgba(0,0,0,.65)'; octx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
  octx.fillStyle = color; octx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), h);
}
function drawOverlay() {
  const W = window.innerWidth, H = window.innerHeight;
  octx.clearRect(0, 0, W, H);
  if (!started) return;
  const hpCol = (f) => f > 0.6 ? '#5ee06a' : f > 0.3 ? '#f2c14e' : '#ff5a4a';
  octx.font = '600 13px "Noto Sans TC", sans-serif'; octx.textAlign = 'center';
  // 單位血條
  for (const u of game.units) {
    if (!u.alive || !u.model.root.visible) continue;
    const show = u.selected || game.time - u.lastHurt < 3 || (u.type === 'shaman');
    if (!show) continue;
    const s = toScreen(u.pos.x, u.pos.y + 2.3 * u.stats.scale, u.pos.z);
    if (!s.ok || s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20) continue;
    if (u.type === 'shaman') {
      octx.fillStyle = TRIBE_CSS[u.tribe];
      octx.beginPath(); octx.moveTo(s.x, s.y - 4); octx.lineTo(s.x - 6, s.y - 13); octx.lineTo(s.x + 6, s.y - 13); octx.closePath(); octx.fill();
      octx.strokeStyle = '#fff'; octx.lineWidth = 1.5; octx.stroke();
    }
    const f = u.hp / u.maxHp;
    bar(s.x, s.y, u.type === 'shaman' ? 40 : 26, f, u.tribe === 1 ? '#ff6a5a' : hpCol(f), u.type === 'shaman' ? 5 : 4);
    if (u.type === 'shaman' && u.tribe === 0 && u.ord.type === 'cast' && u.castT <= 0) {
      octx.fillStyle = '#9ef0ff'; octx.fillText('前往施法…', s.x, s.y - 18);
    }
  }
  // 建築
  for (const b of game.buildings) {
    if (!b.alive || !b.model.root.visible) continue;
    const s = toScreen(b.pos.x, b.pos.y + (b.type === 'totem' ? 8 : 6), b.pos.z);
    if (!s.ok) continue;
    if (!b.complete) { bar(s.x, s.y, 50, b.progress, '#e8c27a', 6); }
    else if (b.selected || b.hp < b.maxHp * 0.999 && game.time - b.lastHurt < 6) bar(s.x, s.y, 50, b.hp / b.maxHp, b.tribe === 1 ? '#ff6a5a' : hpCol(b.hp / b.maxHp), 6);
    if (b.type === 'warriorhut' && b.trainQ > 0 && b.tribe === 0) { bar(s.x, s.y + 9, 50, b.trainT / 5, '#9ecbff', 4); octx.fillStyle = '#fff'; octx.fillText(`受訓 ×${b.trainQ}`, s.x, s.y + 26); }
    if (b.type === 'totem' && !game.tribes[b.tribe].shaman && game.tribes[b.tribe].respawnT > 0) {
      octx.fillStyle = TRIBE_CSS[b.tribe]; octx.font = '700 15px "Noto Sans TC"';
      octx.fillText(`薩滿重生 ${Math.ceil(game.tribes[b.tribe].respawnT)}`, s.x, s.y - 12);
      octx.font = '600 13px "Noto Sans TC", sans-serif';
    }
    if (b.selected) circleWorld(b.pos.x, b.pos.z, b.radius + 0.8, b.tribe === 0 ? '#8fff9a' : '#ff6a5a', 2);
  }
  // 石像
  for (const h of game.heads) {
    const s = toScreen(h.pos.x, h.pos.y + 6.5, h.pos.z);
    if (!s.ok || s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40) continue;
    const tr0 = game.tribes[0], sp = SPELLS[h.spell], own = tr0.unlocked.has(h.spell);
    octx.fillStyle = 'rgba(20,14,6,.78)';
    octx.beginPath(); octx.arc(s.x, s.y, 17, 0, Math.PI * 2); octx.fill();
    octx.strokeStyle = own ? '#9ef0ff' : '#f1c86a'; octx.lineWidth = 2; octx.stroke();
    octx.font = '18px "Segoe UI Emoji", sans-serif'; octx.fillText(sp.icon, s.x, s.y + 6);
    octx.font = '600 13px "Noto Sans TC", sans-serif';
    for (let t = 0; t < 2; t++) {
      // 已解鎖的一方不再顯示解鎖進度；我方改顯示補充進度
      if (game.tribes[t].unlocked.has(h.spell) && t === 1) continue;
      const f = t === 0 && own ? tr0.chargeP[h.spell] / sp.need : h.progress[t] / h.need;
      octx.strokeStyle = t === 0 ? (own ? '#9ef0ff' : '#3d8dff') : '#ff4a3a'; octx.lineWidth = 3.5;
      if (f > 0) { octx.beginPath(); octx.arc(s.x, s.y, 21 + t * 5, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); octx.stroke(); }
    }
    octx.fillStyle = own ? '#9ef0ff' : '#ffe9a8';
    octx.fillText(own ? `${sp.name} ${tr0.charges[h.spell]}/${sp.charges}` : sp.name, s.x, s.y + 42);
    if (h.prayers[0]) { octx.fillStyle = '#bfe0ff'; octx.fillText(`🙏×${h.prayers[0]}`, s.x, s.y - 30); }
  }
  // 漂浮文字
  for (const f of game.floats) {
    const s = toScreen(f.x, f.y, f.z);
    if (!s.ok) continue;
    octx.globalAlpha = Math.min(1, f.t * 2);
    octx.fillStyle = f.color; octx.font = '700 14px "Noto Sans TC"'; octx.fillText(f.text, s.x, s.y);
    octx.globalAlpha = 1;
  }
  octx.font = '600 13px "Noto Sans TC", sans-serif';
  // 指令標記
  for (const p of game.pings) {
    if (!p.cmd) continue;
    const k = 1 - p.t / 0.9;
    octx.globalAlpha = p.t / 0.9;
    circleWorld(p.x, p.z, 0.6 + k * 2.2, p.color, 2.5);
    octx.globalAlpha = 1;
  }
  // 施法瞄準
  const s = playerShaman();
  if (mode && mode.kind === 'cast' && s) {
    const sp = SPELLS[mode.spell];
    circleWorld(s.pos.x, s.pos.z, sp.range, 'rgba(158,240,255,.55)', 1.5, [8, 6]);
    if (groundPt) {
      const inR = Math.hypot(groundPt.x - s.pos.x, groundPt.z - s.pos.z) <= sp.range;
      const c = inR ? '#9ef0ff' : '#ffb27a';
      if (mode.spell === 'landbridge') {
        const a = toScreen(s.pos.x, s.pos.y + 0.5, s.pos.z), b = toScreen(groundPt.x, groundPt.y + 0.5, groundPt.z);
        octx.strokeStyle = c; octx.lineWidth = 3; octx.setLineDash([10, 6]);
        octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke(); octx.setLineDash([]);
      }
      circleWorld(groundPt.x, groundPt.z, Math.max(1.5, sp.radius), c, 2.5);
      const m = toScreen(groundPt.x, groundPt.y + 2, groundPt.z);
      octx.fillStyle = c; octx.fillText(`${sp.icon} ${sp.name}${inR ? '' : '（薩滿將移動）'}`, m.x, m.y - 10);
    }
  }
  // 集結點
  const rh = mode && mode.kind === 'rally' ? mode.hut : isMyWarriorHut(selObj) ? selObj : null;
  if (rh) {
    const tgt = mode && mode.kind === 'rally' ? groundPt : rh.rally;
    if (tgt) {
      const a = toScreen(rh.pos.x, rh.pos.y + 1, rh.pos.z), b = toScreen(tgt.x, game.terrain.heightAt(tgt.x, tgt.z) + 0.5, tgt.z);
      octx.strokeStyle = '#5ab0ff'; octx.lineWidth = 2.5; octx.setLineDash([9, 7]);
      octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke(); octx.setLineDash([]);
      circleWorld(tgt.x, tgt.z, 1.4, '#5ab0ff', 2);
      if (mode && mode.kind === 'rally') { octx.fillStyle = '#9fd0ff'; octx.fillText('🚩 點擊設定集結點', b.x, b.y - 52); }
    }
  }
  if (mode && mode.kind === 'build' && groundPt) {
    const ok = game.canPlace(mode.type, groundPt.x, groundPt.z);
    circleWorld(groundPt.x, groundPt.z, BUILD[mode.type].radius + 0.4, ok ? '#8fff9a' : '#ff5a4a', 2.5);
  }
  // 框選
  if (mouse.down && mouse.drag) {
    octx.strokeStyle = '#8fff9a'; octx.lineWidth = 1.5; octx.fillStyle = 'rgba(143,255,154,.08)';
    const x = Math.min(mouse.sx, mouse.x), y = Math.min(mouse.sy, mouse.y), w = Math.abs(mouse.x - mouse.sx), h = Math.abs(mouse.y - mouse.sy);
    octx.fillRect(x, y, w, h); octx.strokeRect(x, y, w, h);
  }
}

// ---------- 小地圖 ----------
let fogCan = null, fogImg = null;
function drawMinimap(dt) {
  const S = mini.width;
  miniT -= dt;
  if (!miniImg || (game.terrain.dirtyMini && miniT <= 0)) {
    game.terrain.dirtyMini = false; miniT = 1;
    const res = 220, img = mctx.createImageData(res, res);
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const x = (i / res - 0.5) * HALF * 2, z = (j / res - 0.5) * HALF * 2;
      const c = game.terrain.miniColor(x, z), k = (j * res + i) * 4;
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
    miniImg = document.createElement('canvas'); miniImg.width = miniImg.height = res;
    miniImg.getContext('2d').putImageData(img, 0, 0);
  }
  mctx.imageSmoothingEnabled = true;
  mctx.drawImage(miniImg, 0, 0, S, S);
  const P = (x, z) => [(x / (HALF * 2) + 0.5) * S, (z / (HALF * 2) + 0.5) * S];
  // 迷霧
  const fog = game.fog;
  if (fog.enabled && started) {
    if (!fogCan) { fogCan = document.createElement('canvas'); fogCan.width = fogCan.height = FN; fogImg = fogCan.getContext('2d').createImageData(FN, FN); }
    for (let k = 0; k < FN * FN; k++) fogImg.data[k * 4 + 3] = (1 - fog.cur[k]) * 170;
    fogCan.getContext('2d').putImageData(fogImg, 0, 0);
    mctx.drawImage(fogCan, 0, 0, S, S);
  }
  for (const h of game.heads) {
    const [x, y] = P(h.pos.x, h.pos.z);
    mctx.fillStyle = game.tribes[0].unlocked.has(h.spell) ? '#9ef0ff' : '#ffe28a';
    mctx.beginPath(); mctx.arc(x, y, 6, 0, 7); mctx.fill(); mctx.strokeStyle = '#000'; mctx.lineWidth = 1.5; mctx.stroke();
  }
  for (const b of game.buildings) {
    if (!b.alive || !b.model.root.visible) continue;
    const [x, y] = P(b.pos.x, b.pos.z), r = b.type === 'totem' ? 9 : 6;
    mctx.fillStyle = TRIBE_CSS[b.tribe]; mctx.fillRect(x - r, y - r, r * 2, r * 2);
    mctx.strokeStyle = '#fff'; mctx.lineWidth = b.type === 'totem' ? 2 : 1; mctx.strokeRect(x - r, y - r, r * 2, r * 2);
  }
  for (const u of game.units) {
    if (!u.alive || !u.model.root.visible) continue;
    const [x, y] = P(u.pos.x, u.pos.z);
    mctx.fillStyle = u.tribe === 2 ? '#e8d8b0' : u.selected ? '#aaffaa' : TRIBE_CSS[u.tribe];
    const r = u.type === 'shaman' ? 5 : 3;
    mctx.fillRect(x - r, y - r, r * 2, r * 2);
    if (u.type === 'shaman') { mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5; mctx.strokeRect(x - r, y - r, r * 2, r * 2); }
  }
  for (const p of game.pings) {
    if (p.cmd) continue;
    const [x, y] = P(p.x, p.z);
    mctx.strokeStyle = `rgba(255,80,60,${Math.min(1, p.t)})`; mctx.lineWidth = 3;
    mctx.beginPath(); mctx.arc(x, y, 10 + (4 - p.t) % 1 * 30, 0, 7); mctx.stroke();
  }
  // 視野框
  const W = window.innerWidth, H = window.innerHeight;
  const corners = [[0, 0], [W, 0], [W, H * 0.8], [0, H * 0.8]].map(([sx, sy]) => {
    ndc.set(sx / W * 2 - 1, -(sy / H) * 2 + 1); ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const t = d.y < -0.01 ? (cam.y - o.y) / d.y : 400;
    return P(o.x + d.x * Math.min(t, 400), o.z + d.z * Math.min(t, 400));
  });
  mctx.strokeStyle = 'rgba(255,255,255,.85)'; mctx.lineWidth = 2;
  mctx.beginPath(); corners.forEach(([x, y], i) => (i ? mctx.lineTo(x, y) : mctx.moveTo(x, y))); mctx.closePath(); mctx.stroke();
}

// ---------- 鏡頭 ----------
function updateCamera(dt) {
  const sp = cam.dist * 1.05 * dt;
  let mx = 0, mz = 0;
  if (started && !paused) {
    if (keys.has('w') || keys.has('arrowup')) mz -= 1;
    if (keys.has('s') || keys.has('arrowdown')) mz += 1;
    if (keys.has('a') && !keys.has('control') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
    if (settings.edge && mouse.in && !mouse.down && document.hasFocus()) {
      const m = 6;
      if (mouse.x < m) mx -= 1; if (mouse.x > window.innerWidth - m) mx += 1;
      if (mouse.y < m) mz -= 1; if (mouse.y > window.innerHeight - m) mz += 1;
    }
    if (keys.has('q')) cam.tYaw += dt * 1.8;
    if (keys.has('e')) cam.tYaw -= dt * 1.8;
  } else if (!started) cam.tYaw += dt * 0.05;
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  cam.x += (rx * mx - fx * mz) * sp; cam.z += (rz * mx - fz * mz) * sp;
  cam.x = THREE.MathUtils.clamp(cam.x, -HALF + 10, HALF - 10); cam.z = THREE.MathUtils.clamp(cam.z, -HALF + 10, HALF - 10);
  cam.yaw += (cam.tYaw - cam.yaw) * Math.min(1, dt * 8);
  cam.dist += (cam.tDist - cam.dist) * Math.min(1, dt * 6);
  const gy = Math.max(game.terrain.heightAt(cam.x, cam.z), WATER);
  cam.y += (gy - cam.y) * Math.min(1, dt * 3);
  const pitch = THREE.MathUtils.lerp(0.55, 1.02, (cam.dist - 22) / 153);
  let px = cam.x + Math.sin(cam.yaw) * Math.cos(pitch) * cam.dist;
  let pz = cam.z + Math.cos(cam.yaw) * Math.cos(pitch) * cam.dist;
  let py = cam.y + Math.sin(pitch) * cam.dist;
  py = Math.max(py, game.terrain.heightAt(px, pz) + 4);
  const sh = game.shakeAmt;
  if (sh > 0) { px += (Math.random() - 0.5) * sh; py += (Math.random() - 0.5) * sh; pz += (Math.random() - 0.5) * sh; game.shakeAmt = Math.max(0, sh - dt * 1.8); }
  camera.position.set(px, py, pz);
  camera.lookAt(cam.x, cam.y, cam.z);
  game.camTarget.x = cam.x; game.camTarget.z = cam.z; game.hearDist = 60 + cam.dist * 0.8;
  // 陰影相機跟隨視野
  const ext = THREE.MathUtils.clamp(cam.dist * 1.15, 45, 150);
  const sc = sun.shadow.camera;
  if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 400; sc.updateProjectionMatrix(); }
  sun.target.position.set(cam.x, cam.y, cam.z);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 180);
}

// ---------- 戰爭迷霧 ----------
let fogPatchT = 0;
function applyFog(dt) {
  const f = game.fog, on = started && f.enabled;
  f.uMix.value = on ? 1 : 0;
  fogPatchT -= dt || 0.016;
  if (fogPatchT <= 0) { fogPatchT = 0.5; f.patchScene(scene); }   // 新生成的單位、建築、特效
  for (const u of game.units) if (u.tribe !== 0) u.model.root.visible = !on || f.visible(u.pos.x, u.pos.z);
  for (const b of game.buildings) {
    if (b.tribe === 0) continue;
    if (on && f.visible(b.pos.x, b.pos.z)) b.seen = true;   // 建築一旦看過就會留在畫面上
    b.model.root.visible = !on || !!b.seen;
  }
  if (selObj && selObj.model && !selObj.model.root.visible) { selObj.selected = false; selObj = null; }
  // 集結旗
  const rh = mode && mode.kind === 'rally' ? mode.hut : isMyWarriorHut(selObj) ? selObj : null;
  const tgt = rh && (mode && mode.kind === 'rally' ? groundPt : rh.rally);
  rallyFlag.visible = !!tgt;
  if (tgt) {
    rallyFlag.position.set(tgt.x, Math.max(game.terrain.heightAt(tgt.x, tgt.z), WATER), tgt.z);
    rallyFlag.userData.cloth.rotation.y = Math.sin(performance.now() / 300) * 0.25;
  }
}

// ---------- 主迴圈 ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) dt = 0;
  updateCamera(Math.min(0.05, (now - (frame.prev || now)) / 1000) || 0.016);
  frame.prev = now;
  if (started && !paused) game.update(dt);
  applyFog(dt);
  game.terrain.waterUniforms.uTime.value += dt || (started ? 0 : 0.016);
  if (started) {
    if (mouse.in) {
      groundPt = pickGround(mouse.x, mouse.y);
      frame.hc = (frame.hc || 0) + 1;
      if (frame.hc % 4 === 0) hover = hoverAt(mouse.x, mouse.y);
    }
    if (mode && mode.kind === 'build' && groundPt) {
      mode.ghost.position.set(groundPt.x, game.terrain.heightAt(groundPt.x, groundPt.z), groundPt.z);
      mode.ghost.userData.mat.color.set(game.canPlace(mode.type, groundPt.x, groundPt.z) && game.tribes[0].wood >= BUILD[mode.type].wood ? 0x66ff88 : 0xff5544);
    }
    updateUI(dt);
    drawMinimap(dt);
  }
  if (composer) composer.render(); else renderer.render(scene, camera);
  drawOverlay();
}
requestAnimationFrame(frame);

// ---------- 畫面按鈕 ----------
function segment(id, key) {
  const seg = $(id);
  for (const b of seg.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === settings[key]);
    b.onclick = () => {
      settings[key] = b.dataset.v; saveSettings();
      for (const o of seg.querySelectorAll('button')) o.classList.toggle('on', o === b);
      if (key === 'quality') applyQuality();
    };
  }
}
segment('diffSeg', 'diff'); segment('qualSeg', 'quality');
$('chkSound').checked = settings.sound; $('chkEdge').checked = settings.edge;
$('chkSound').onchange = (e) => { settings.sound = e.target.checked; saveSettings(); if (audio.master) audio.master.gain.value = settings.sound ? audio.vol : 0; };
$('chkEdge').onchange = (e) => { settings.edge = e.target.checked; saveSettings(); };
$('chkFog').checked = settings.fog;
$('chkFog').onchange = (e) => { settings.fog = e.target.checked; saveSettings(); newWorld(settings.level); };

function startGame() {
  audio.init();
  if (audio.master) audio.master.gain.value = settings.sound ? audio.vol : 0;
  game.setDifficulty(DIFFICULTY[settings.diff] || DIFFICULTY.normal);
  $('start').classList.add('hidden'); $('hud').classList.remove('hidden');
  started = true;
  cam.x = base().x + 6; cam.z = base().z + 4; cam.tDist = 70; cam.tYaw = Math.round(cam.yaw / (Math.PI * 2)) * Math.PI * 2 + 0.5;
  game.fog.update(0, game, true);
  game.msg(`${LAYOUT.icon} ${LAYOUT.name}——歡迎，${game.tribes[0].name} 的薩滿！`, '#ffe28a');
  game.msg('法術有使用次數：選取子民右鍵該法術的「石像」祈禱來補充', '#bfe0ff');
  game.msg('右鍵尚未解鎖的石像祈禱可獲得新法術 · Z 薩滿 / X 戰士 / V 閒置勇者', '#bfe0ff');
  selectShaman();
  last = performance.now();
}
function togglePause() {
  paused = !paused;
  $('pause').classList.toggle('hidden', !paused);
}
$('btnStart').onclick = startGame;
$('btnResume').onclick = togglePause;
$('btnMenu').onclick = togglePause;
const restart = () => { saveSettings(); location.reload(); };
$('btnRestart').onclick = restart;
$('btnAgain').onclick = restart;
$('btnNext').onclick = () => { const next = LEVEL_ORDER[LEVEL_ORDER.indexOf(LAYOUT.id) + 1]; if (next) settings.level = next; restart(); };

// 關卡選擇
const levelBox = $('levels');
function renderLevels() {
  levelBox.innerHTML = '';
  for (const id of LEVEL_ORDER) {
    const lv = LEVELS[id], b = document.createElement('button');
    b.className = 'lvl' + (id === settings.level ? ' on' : '');
    b.innerHTML = `<span class="ic">${lv.icon}</span><b>${lv.name}</b><small>${lv.sub}</small>`;
    b.onclick = () => {
      if (settings.level === id) return;
      settings.level = id; saveSettings();
      newWorld(id); renderLevels();
    };
    levelBox.appendChild(b);
  }
  $('levelDesc').textContent = LEVELS[settings.level].desc;
}
renderLevels();

// 開發者除錯用
window.__cam = cam;
window.__dbg = { toScreen, hoverAt, pickGround };
