// 關卡資料
// land：組成陸地的形狀（地形生成時取聯集）
//   blob { x, z, a, b, w }        圓形陸塊：距離 < a 為陸地，a~b 漸變入海；w 為邊緣扭曲程度
//   path { x0, z0, x1, z1, a, b, w } 帶狀陸地（通道），沿線不會長出高山
//   ring { x, z, r, a, b, w }     環形陸地，沿線不會長出高山
// mountain 山的高度倍率 · peaks 山的覆蓋範圍加成
// heads：石像 { x, z, spell, far }，far 表示需要陸橋才能抵達（敵方 AI 不會前往）
// camps：野人營地 [x, z]
import { LAYOUT } from './config.js';

const blob = (x, z, a, b, w = 0.5) => ({ t: 'blob', x, z, a, b, w });
const path = (x0, z0, x1, z1, a, b, w = 0.3) => ({ t: 'path', x0, z0, x1, z1, a, b, w });
const ring = (x, z, r, a, b, w = 0.4) => ({ t: 'ring', x, z, r, a, b, w });
const head = (x, z, spell, far = false) => ({ x, z, spell, far });
// 以地圖中心點對稱產生敵方石像
const mirror = (list) => list.flatMap((h) => [h, { ...h, x: -h.x, z: -h.z }]);

const DEFAULT_START = {
  braves: [6, 7], warriors: [0, 0], wood: [35, 35],
  spells: [['blast', 'convert'], ['blast', 'convert']],
  charges: { blast: 2, convert: 2 },
};

export const LEVELS = {
  twin: {
    name: '雙子大陸', sub: '入門', icon: '🌍',
    desc: '兩塊大陸由狹長地峽相連，外海孤島藏著強大的古老石像。',
    bases: [{ x: -66, z: 58 }, { x: 66, z: -58 }],
    land: [
      blob(-66, 58, 40, 64, 1), blob(66, -58, 40, 64, 1),
      path(-66, 58, 66, -58, 5, 11, 0.35),
      blob(0, 0, 9, 17, 0.4),
      blob(-96, -38, 10.5, 21, 0.6), blob(96, 38, 10.5, 21, 0.6),
    ],
    heads: [
      ...mirror([head(-44, 72, 'blast'), head(-50, 40, 'convert'), head(-40, 26, 'lightning'), head(-92, 32, 'landbridge')]),
      head(0, 0, 'tornado'),
      head(-96, -38, 'earthquake', true), head(96, 38, 'volcano', true),
    ],
    camps: [[-20, 40], [25, -45], [-95, -5], [95, 5], [-10, -60], [10, 60], [0, 10]],
    mountain: 1,
  },
  archipelago: {
    name: '碎星群島', sub: '島嶼', icon: '🏝️',
    desc: '星羅棋布的小島以淺灘相連。通道狹窄，適合伏擊；最遠的兩座島只能靠陸橋登陸。',
    bases: [{ x: -72, z: 66 }, { x: 72, z: -66 }],
    land: [
      blob(-72, 66, 24, 40, 0.5), blob(72, -66, 24, 40, 0.5),
      blob(-62, -4, 10, 22), blob(62, 4, 10, 22), blob(0, 0, 11, 22),
      blob(4, 66, 9, 20), blob(-4, -66, 9, 20),
      path(-72, 66, -62, -4, 3.5, 7.5, 0.25), path(-72, 66, 4, 66, 3.5, 7.5, 0.25),
      path(72, -66, 62, 4, 3.5, 7.5, 0.25), path(72, -66, -4, -66, 3.5, 7.5, 0.25),
      path(-62, -4, 0, 0, 3.5, 7.5, 0.25), path(62, 4, 0, 0, 3.5, 7.5, 0.25),
      path(4, 66, 0, 0, 3.5, 7.5, 0.25), path(-4, -66, 0, 0, 3.5, 7.5, 0.25),
      blob(-90, -80, 9, 18), blob(90, 80, 9, 18),
    ],
    heads: [
      ...mirror([head(-50, 74, 'blast'), head(-84, 46, 'convert'), head(-62, -4, 'lightning'), head(4, 66, 'landbridge')]),
      head(0, 0, 'tornado'),
      head(-90, -80, 'earthquake', true), head(90, 80, 'volcano', true),
    ],
    camps: [[-60, 8], [60, -8], [8, -10], [10, 56], [-10, -56]],
    mountain: 0.35,
  },
  highland: {
    name: '烈焰高地', sub: '山地', icon: '🌋',
    desc: '群山環繞的大陸，只有三條山道可以通行。中央的火山石像是兵家必爭之地。',
    bases: [{ x: -68, z: 62 }, { x: 68, z: -62 }],
    land: [
      blob(0, 0, 88, 118, 0.6),
      path(-68, 62, 0, 0, 6, 12), path(0, 0, 68, -62, 6, 12),
      path(-68, 62, -62, -50, 6, 12), path(-62, -50, 68, -62, 6, 12),
      path(-68, 62, 62, 50, 6, 12), path(62, 50, 68, -62, 6, 12),
    ],
    heads: [
      ...mirror([head(-46, 74, 'blast'), head(-48, 42, 'convert'), head(-62, -50, 'lightning')]),
      head(0, 0, 'volcano'),
    ],
    camps: [[-20, -20], [20, 20], [-62, -36], [62, 36], [0, -40], [0, 40]],
    mountain: 0.85, peaks: 0.2,
    ai: { econ: 1.1 },
  },
  ringlake: {
    name: '月環湖', sub: '環形', icon: '🌙',
    desc: '環形大陸圍繞著一座聖湖。可以從兩側包抄敵人，湖心島上沉睡著火山之神。',
    bases: [{ x: -76, z: 4 }, { x: 76, z: -4 }],
    land: [
      ring(0, 0, 76, 9, 20),
      blob(-76, 4, 20, 34, 0.6), blob(76, -4, 20, 34, 0.6),
      blob(0, 0, 8, 16, 0.4),
    ],
    heads: [
      ...mirror([head(-70, -22, 'blast'), head(-70, 30, 'convert'), head(0, 76, 'lightning'), head(-54, 54, 'tornado'), head(-54, -54, 'landbridge')]),
      head(0, 0, 'volcano', true),
    ],
    camps: [[-40, 64], [40, -64], [64, 40], [-64, -40], [0, -70], [0, 70]],
    mountain: 0.7,
  },
  laststand: {
    name: '孤軍死守', sub: '挑戰', icon: '🛡️',
    desc: '你的部族被逼退到半島一角，赤焰部族兵強馬壯且已掌握雷擊。善用法術，以寡擊眾！',
    bases: [{ x: -80, z: 78 }, { x: 40, z: -36 }],
    land: [
      blob(-80, 78, 16, 30, 0.5), blob(40, -36, 44, 70, 0.8),
      path(-80, 78, 40, -36, 6, 12, 0.3),
      path(-80, 78, -80, 14, 4, 9, 0.3), blob(-80, 14, 9, 18),
      blob(-84, -74, 9, 17), blob(86, 86, 9, 17),
    ],
    heads: [
      head(-58, 82, 'blast'), head(-92, 62, 'convert'),
      head(60, -56, 'blast'), head(20, -60, 'convert'),
      head(-20, 21, 'lightning'), head(66, -6, 'tornado'), head(-80, 14, 'landbridge'),
      head(-84, -74, 'earthquake', true), head(86, 86, 'volcano', true),
    ],
    camps: [[-40, 40], [-72, 6], [10, 0], [0, -20]],
    mountain: 0.9,
    start: {
      braves: [8, 12], warriors: [0, 5], wood: [50, 80],
      spells: [['blast', 'convert'], ['blast', 'convert', 'lightning']],
      charges: { blast: 4, convert: 3, lightning: 1 },
    },
    ai: { attack: 0.8, econ: 1.15 },
  },
};
export const LEVEL_ORDER = ['twin', 'archipelago', 'highland', 'ringlake', 'laststand'];

// 將目前關卡寫入共用的 LAYOUT
export function applyLevel(id) {
  const lv = LEVELS[id] || LEVELS.twin;
  for (const k of Object.keys(LAYOUT)) delete LAYOUT[k];
  Object.assign(LAYOUT, lv, {
    id: LEVELS[id] ? id : 'twin',
    start: { ...DEFAULT_START, ...(lv.start || {}) },
    ai: { attack: 1, econ: 1, ...(lv.ai || {}) },
  });
  return LAYOUT;
}
