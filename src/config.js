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

export const UNIT_STATS = {
  brave:   { hp: 60,  dmg: 5,  speed: 6.0, range: 1.7, rate: 1.0, aggro: 6,  name: '勇者', scale: 1.25 },
  warrior: { hp: 170, dmg: 15, speed: 6.4, range: 1.9, rate: 0.9, aggro: 13, name: '戰士', scale: 1.4 },
  shaman:  { hp: 260, dmg: 9,  speed: 7.2, range: 1.9, rate: 1.0, aggro: 6,  name: '薩滿', scale: 1.5 },
  wild:    { hp: 40,  dmg: 0,  speed: 3.0, range: 1.5, rate: 1.5, aggro: 0,  name: '野人', scale: 1.15 },
};

export const BUILD = {
  hut:        { name: '小屋',       wood: 40, hp: 320, work: 55, radius: 2.8 },
  warriorhut: { name: '戰士訓練所', wood: 70, hp: 460, work: 85, radius: 3.6 },
  totem:      { name: '靈魂圖騰',   wood: 0,  hp: 1000, work: 0, radius: 2.6 },
};

export const TRAIN_COST = 15;      // 訓練戰士所需木材
export const MANA_MAX = 300;
export const HEAD_NEED = 150;       // 石像解鎖所需祈禱值

export const SPELLS = {
  blast:      { key: '1', name: '爆破',   icon: '💥', cost: 20,  range: 30, radius: 4,   desc: '擲出火球爆炸，灼傷並震飛敵人。' },
  convert:    { key: '2', name: '感化',   icon: '✨', cost: 15,  range: 26, radius: 8,   desc: '將範圍內的野人轉化為你的子民。' },
  lightning:  { key: '3', name: '雷擊',   icon: '⚡', cost: 45,  range: 40, radius: 3.5, desc: '召喚天雷重創目標，對建築傷害極高。' },
  tornado:    { key: '4', name: '龍捲風', icon: '🌪️', cost: 70, range: 34, radius: 5,   desc: '召喚龍捲風，捲飛敵人、摧毀建築與樹木。' },
  landbridge: { key: '5', name: '陸橋',   icon: '⛰️', cost: 50,  range: 50, radius: 3,   desc: '從薩滿腳下隆起一條通往目標的陸地，可跨越海洋。' },
  earthquake: { key: '6', name: '地震',   icon: '🪨', cost: 90,  range: 36, radius: 13,  desc: '撕裂大地，使地面下陷並震垮建築。' },
  volcano:    { key: '7', name: '火山',   icon: '🌋', cost: 150, range: 34, radius: 12,  desc: '在目標處噴發火山，岩漿吞噬一切。' },
};
export const SPELL_ORDER = ['blast', 'convert', 'lightning', 'tornado', 'landbridge', 'earthquake', 'volcano'];
export const START_SPELLS = ['blast', 'convert'];

export const DIFFICULTY = {
  easy:   { name: '簡單', econ: 0.7, firstAttack: 420, interval: 210, army: 5,  mana: 0.7 },
  normal: { name: '普通', econ: 1.0, firstAttack: 310, interval: 170, army: 7,  mana: 1.0 },
  hard:   { name: '困難', econ: 1.35, firstAttack: 220, interval: 130, army: 9, mana: 1.4 },
};

// 地圖佈局
export const LAYOUT = {
  bases: [{ x: -66, z: 58 }, { x: 66, z: -58 }],
  islands: [{ x: -96, z: -38, r: 21 }, { x: 96, z: 38, r: 21 }],
  heads: [
    { x: -40, z: 26,  spell: 'lightning' },
    { x: -92, z: 32,  spell: 'landbridge' },
    { x: 40,  z: -26, spell: 'lightning' },
    { x: 92,  z: -32, spell: 'landbridge' },
    { x: 0,   z: 0,   spell: 'tornado' },
    { x: -96, z: -38, spell: 'earthquake' },
    { x: 96,  z: 38,  spell: 'volcano' },
  ],
};
