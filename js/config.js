// 모든 게임 수치. 밸런싱은 이 파일만 고친다.

export const SIM_HZ = 30;

export const BOARD = {
  size: 16,          // 16x16 칸
  ringIndex: [1, 14] // 이 행/열이 몬스터 고리 길
};

export const GRADES = [
  { key: 'common',    name: '일반', color: '#e8eef2', drawWeight: 82, sell: 25 },
  { key: 'rare',      name: '희귀', color: '#5fd0ff', drawWeight: 15, sell: 60 },
  { key: 'hero',      name: '영웅', color: '#b46bff', drawWeight: 3,  sell: 150 },
  { key: 'legend',    name: '전설', color: '#ff9a2e', drawWeight: 0,  sell: 400 },
  { key: 'god',       name: '신',   color: '#3dff7a', drawWeight: 0,  sell: 0 }
];

export const FACTIONS = [
  { key: 'mech', name: '기계', color: '#6f9dd6' },
  { key: 'bio',  name: '생체', color: '#7ee05a' },
  { key: 'arc',  name: '비전', color: '#c07bff' }
];

// kind: single | splash | chain | pierce | field
// range 단위 = 칸. cd = 공격 간격(초)
export const UNITS = [
  // ── 일반
  { id: 'm0', name: '포탑병',   grade: 0, faction: 'mech', dmg: 10,   cd: 1.0,  range: 3.5, kind: 'single' },
  { id: 'b0', name: '가시벌레', grade: 0, faction: 'bio',  dmg: 5,    cd: 0.5,  range: 2.5, kind: 'single' },
  { id: 'a0', name: '불씨술사', grade: 0, faction: 'arc',  dmg: 6,    cd: 1.2,  range: 3.0, kind: 'splash', splash: 1.0 },
  // ── 희귀
  { id: 'm1', name: '저격드론', grade: 1, faction: 'mech', dmg: 40,   cd: 1.5,  range: 5.0, kind: 'single' },
  { id: 'b1', name: '산성거미', grade: 1, faction: 'bio',  dmg: 14,   cd: 0.5,  range: 3.0, kind: 'single', slow: 0.20 },
  { id: 'a1', name: '번개구슬', grade: 1, faction: 'arc',  dmg: 18,   cd: 1.0,  range: 3.5, kind: 'chain',  chain: 3 },
  // ── 영웅
  { id: 'm2', name: '레일캐논', grade: 2, faction: 'mech', dmg: 160,  cd: 2.0,  range: 5.5, kind: 'pierce' },
  { id: 'b2', name: '독안개꽃', grade: 2, faction: 'bio',  dmg: 30,   cd: 0.5,  range: 2.5, kind: 'field',  slow: 0.35 },
  { id: 'a2', name: '유성술사', grade: 2, faction: 'arc',  dmg: 90,   cd: 1.6,  range: 4.0, kind: 'splash', splash: 2.0 },
  // ── 전설
  { id: 'm3', name: '궤도포대', grade: 3, faction: 'mech', dmg: 500,  cd: 2.5,  range: 99,  kind: 'single' },
  { id: 'b3', name: '군체여왕', grade: 3, faction: 'bio',  dmg: 70,   cd: 0.3,  range: 3.5, kind: 'single', slow: 0.50 },
  { id: 'a3', name: '폭풍핵',   grade: 3, faction: 'arc',  dmg: 200,  cd: 1.2,  range: 4.0, kind: 'chain',  chain: 5 },
  // ── 신
  { id: 'm4', name: '종말병기', grade: 4, faction: 'mech', dmg: 1400, cd: 2.0,  range: 6.0, kind: 'splash', splash: 2.0 },
  { id: 'b4', name: '세계수',   grade: 4, faction: 'bio',  dmg: 180,  cd: 0.25, range: 4.0, kind: 'single', aura: { radius: 3, atkSpeed: 0.25 } },
  { id: 'a4', name: '프리즘 신', grade: 4, faction: 'arc', dmg: 550,  cd: 1.0,  range: 5.0, kind: 'splash', splash: 2.5, chain: 6 }
];

export const COMBAT = {
  chainJump: 2.2,       // 연쇄가 다음 대상으로 튀는 최대 거리
  pierceWidth: 0.6,     // 관통 공격 폭
  slowDuration: 1.5,    // 둔화 지속
  bossSlowResist: 0.5   // 보스류는 둔화 효과 절반
};

export const ECON = {
  startMinerals: 200,
  startGas: 100,
  drawCost: 50,
  killReward: (round) => 1,
  roundBonus: (round) => 20 + 2 * round,
  roundGas: (round) => 10 + round,
  bossReward: { minerals: 100, crystals: 1 },
  crystalToGas: 250,
  mineralsToGas: { pay: 100, get: 60 },
  gasToMinerals: { pay: 100, get: 60 },
  upgradePerLevel: 0.12,
  upgradeMaxLevel: 30,
  upgradeCost: (level) => 20 + 10 * level
};

export const WAVES = {
  rounds: 40,
  firstRoundAt: 5,      // 게임 시작 후 첫 라운드까지 초
  roundLength: 35,
  spawnCount: 40,
  spawnInterval: 0.5,
  monsterLimit: 70,
  lives: 3,
  bossRounds: [10, 20, 30, 40],
  bossTimeLimit: 90,   // 보스가 고리를 약 1.5바퀴 (분산 배치에서도 모든 유닛 앞을 지나감)
  hpMult: 1.0,          // 난이도 상수
  normalHp: (r) => 25 * Math.pow(1.215, r - 1),
  normalArmor: (r) => Math.floor(r / 4),
  normalSpeed: 1.6,
  bossHpMult: 3.5,
  bossArmorMult: 3,
  bossSpeed: 0.9
};

export const MISSIONS = [
  { name: '미션 1', hp: 12000,   armor: 5,   reward: { minerals: 100,  gas: 60 } },
  { name: '미션 2', hp: 180000,  armor: 15, reward: { minerals: 300,  gas: 180 } },
  { name: '미션 3', hp: 1800000, armor: 30, reward: { minerals: 800,  gas: 450 } }
];
export const MISSION_RULES = { cooldown: 90, timeLimit: 60, speed: 1.0 };

export const ACHIEVEMENTS = [
  { id: 'mass',     name: '물량전',      desc: '일반 유닛 8기 동시 보유', reward: 200 },
  { id: 'hero1',    name: '첫 영웅',     desc: '영웅 등급 첫 획득',       reward: 150 },
  { id: 'hero7',    name: '영웅 수집가', desc: '영웅 7기 획득(누적)',     reward: 500 },
  { id: 'legend6',  name: '전설 수집가', desc: '전설 6기 획득(누적)',     reward: 1000 },
  { id: 'trinity',  name: '삼위일체',    desc: '같은 등급 3진영 동시 보유', reward: 300 },
  { id: 'kill500',  name: '학살자 I',    desc: '누적 처치 500',           reward: 200 },
  { id: 'kill2000', name: '학살자 II',   desc: '누적 처치 2000',          reward: 500 },
  { id: 'kill5000', name: '학살자 III',  desc: '누적 처치 5000',          reward: 1000 }
];
