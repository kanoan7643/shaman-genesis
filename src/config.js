// 全域設定與遊戲數值
export const N = 160;            // 地形格數（每邊）
export const CELL = 1.6;         // 每格世界單位
export const SIZE = N * CELL;    // 256
export const HALF = SIZE / 2;
export const WATER = 0;          // 水面高度

export const PLAYER = 0, ENEMY = 1, WILD = 2;
export const TRIBE_COLORS = [0x2f86ff, 0xe8392b, 0x8a6a45];
export const TRIBE_CSS = ['#3d8dff', '#ff4a3a', '#b08b5e'];
export const TRIBE_NAMES = ['藍月部族', '赤焰部族', '野人'];

// tab：單位分頁（快捷鍵選取）。新增兵種時加上 tab 即會自動出現在分頁列
// 按鍵：1 薩滿 · 2 戰士 · 3~9 留給新兵種 · 0 是「閒置勇者」（法術使用 Z~M）
export const UNIT_STATS = {
  shaman:  { hp: 260, dmg: 9,  speed: 7.2, range: 1.9, rate: 1.0, aggro: 6,  name: '薩滿', scale: 1.5,  tab: { key: '1', label: '1', icon: '🧙' } },
  brave:   { hp: 60,  dmg: 5,  speed: 6.0, range: 1.7, rate: 1.0, aggro: 6,  name: '勇者', scale: 1.25 },
  warrior: { hp: 170, dmg: 15, speed: 6.4, range: 1.9, rate: 0.9, aggro: 13, name: '戰士', scale: 1.4,  tab: { key: '2', label: '2', icon: '🗡️' } },
  wild:    { hp: 40,  dmg: 0,  speed: 3.0, range: 1.5, rate: 1.5, aggro: 0,  name: '野人', scale: 1.15 },
};
export const UNIT_TABS = Object.keys(UNIT_STATS).filter((t) => UNIT_STATS[t].tab);

export const BUILD = {
  hut:        { name: '小屋',       wood: 40, hp: 320, work: 55, radius: 2.8 },
  warriorhut: { name: '戰士訓練所', wood: 70, hp: 460, work: 85, radius: 3.6 },
  totem:      { name: '靈魂圖騰',   wood: 0,  hp: 1000, work: 0, radius: 2.6 },
};

export const TRAIN_COST = 15;      // 訓練戰士所需木材

// 法術採「彈藥次數」制：
//   charges 最大次數（越強越少）· need 補充一發所需的祈禱量（祈禱人數 × 秒）· unlock 在石像解鎖所需的祈禱量
// 子民在該法術的石像祈禱 → 補充該法術；在靈魂圖騰祈禱 → 平均補充所有未滿的法術（效率較低）
export const SPELLS = {
  blast:      { key: 'z', name: '火球',   icon: '💥', charges: 4, need: 18,  unlock: 60,  range: 30, radius: 4,   desc: '擲出火球爆炸，灼傷並震飛敵人。' },
  convert:    { key: 'x', name: '感化',   icon: '✨', charges: 3, need: 15,  unlock: 60,  range: 26, radius: 8,   desc: '將範圍內的野人轉化為你的子民。' },
  lightning:  { key: 'c', name: '雷擊',   icon: '⚡', charges: 3, need: 40,  unlock: 120, range: 40, radius: 3.5, desc: '召喚天雷重創目標，對建築傷害極高。' },
  tornado:    { key: 'v', name: '龍捲風', icon: '🌪️', charges: 2, need: 60, unlock: 160, range: 34, radius: 5,   desc: '召喚龍捲風，捲飛敵人、摧毀建築與樹木。' },
  landbridge: { key: 'b', name: '陸橋',   icon: '⛰️', charges: 2, need: 40,  unlock: 120, range: 50, radius: 3,   desc: '從薩滿腳下隆起一條通往目標的陸地，可跨越海洋。' },
  earthquake: { key: 'n', name: '地震',   icon: '🪨', charges: 1, need: 85,  unlock: 200, range: 36, radius: 13,  desc: '撕裂大地，使地面下陷並震垮建築。' },
  volcano:    { key: 'm', name: '火山',   icon: '🌋', charges: 1, need: 130, unlock: 260, range: 34, radius: 12,  desc: '在目標處噴發火山，岩漿吞噬一切。' },
};
export const SPELL_ORDER = ['blast', 'convert', 'lightning', 'tornado', 'landbridge', 'earthquake', 'volcano'];
export const PRAY_HEAD = 1.0;    // 在石像祈禱：每人每秒補充量
export const PRAY_TOTEM = 0.5;   // 在圖騰祈禱：每人每秒補充量（平均分給所有未滿的法術）

export const DIFFICULTY = {
  easy:   { name: '簡單', econ: 0.7, firstAttack: 420, interval: 210, army: 5,  pray: 0.7 },
  normal: { name: '普通', econ: 1.0, firstAttack: 310, interval: 170, army: 7,  pray: 1.0 },
  hard:   { name: '困難', econ: 1.35, firstAttack: 220, interval: 130, army: 9, pray: 1.4 },
};

// 目前關卡的地圖佈局（由 levels.js 的 applyLevel 填入）
export const LAYOUT = {};
