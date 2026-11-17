// 시뮬레이션 코어. DOM·Three.js 의존 없음 → Node에서 그대로 테스트된다.
import { UNITS, GRADES, FACTIONS, ECON, WAVES, MISSIONS, MISSION_RULES, ACHIEVEMENTS, SIM_HZ } from '../config.js';
import { makeRng } from './rng.js';
import { cellToWorld, cellIndex, isBuildable, PLACE_ORDER } from './board.js';
import { updateWaves, updateMonsters, spawnMonster } from './waves.js';
import { updateCombat } from './combat.js';

export const UNIT_BY_ID = Object.fromEntries(UNITS.map(u => [u.id, u]));
export const UNITS_BY_GRADE = GRADES.map((_, g) => UNITS.filter(u => u.grade === g));
const DRAW_TOTAL = GRADES.reduce((s, g) => s + g.drawWeight, 0);

export class Game {
  constructor({ seed = 1 } = {}) {
    this.rng = makeRng(seed);
    this.dt = 1 / SIM_HZ;
    this.time = 0;
    this.tickCount = 0;
    this.state = 'playing';         // playing | victory | defeat
    this.defeatReason = '';
    this.minerals = ECON.startMinerals;
    this.gas = ECON.startGas;
    this.crystals = 0;
    this.lives = WAVES.lives;
    this.round = 0;                 // 시작된 마지막 라운드
    this.spawnLeft = 0;
    this.spawnTimer = 0;
    this.boss = null;               // { m, timer, round }
    this.mission = null;            // { m, timer, idx }
    this.missionCd = MISSIONS.map(() => 0);
    this.units = [];
    this.grid = new Map();          // cellIndex → unit
    this.monsters = [];
    this.normalCount = 0;
    this.upgrades = Object.fromEntries(FACTIONS.map(f => [f.key, 0]));
    this.stats = { kills: 0, draws: 0, acquired: GRADES.map(() => 0), bossKills: 0, missionKills: 0 };
    this.achieved = new Set();
    this.events = [];               // 렌더/UI가 매 프레임 소비
    this.nextId = 1;
  }

  // ───────── 진행
  tick() {
    if (this.state !== 'playing') return;
    const dt = this.dt;
    this.time += dt;
    this.tickCount++;
    for (let i = 0; i < this.missionCd.length; i++) this.missionCd[i] = Math.max(0, this.missionCd[i] - dt);
    updateWaves(this, dt);
    updateMonsters(this, dt);
    updateCombat(this, dt);
    this.cleanupDead();
    this.checkAchievements();
    if (this.state === 'playing' && this.normalCount >= WAVES.monsterLimit) {
      this.lose(`몬스터가 ${WAVES.monsterLimit}마리를 넘었습니다`);
    }
  }
  run(seconds, everyTick) {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n && this.state === 'playing'; i++) { this.tick(); everyTick && everyTick(this); }
  }

  emit(e) { this.events.push(e); if (this.events.length > 4000) this.events.splice(0, 2000); }
  toast(text, color = '#fff') { this.emit({ t: 'toast', text, color }); }
  lose(reason) { if (this.state !== 'playing') return; this.state = 'defeat'; this.defeatReason = reason; this.emit({ t: 'end', state: 'defeat' }); }
  win() { if (this.state !== 'playing') return; this.state = 'victory'; this.emit({ t: 'end', state: 'victory' }); }

  // ───────── 유닛
  freeCell() {
    for (const c of PLACE_ORDER) if (!this.grid.has(cellIndex(c.cx, c.cy))) return c;
    return null;
  }
  addUnit(typeId, cx, cy) {
    const def = UNIT_BY_ID[typeId];
    const { x, z } = cellToWorld(cx, cy);
    const u = { id: this.nextId++, type: typeId, def, cx, cy, x, z, cdLeft: 0, dealt: 0, born: this.time, aura: 0 };
    this.units.push(u);
    this.grid.set(cellIndex(cx, cy), u);
    this.stats.acquired[def.grade]++;
    if (def.grade >= 2) this.toast(`${GRADES[def.grade].name} 획득! ${def.name}`, GRADES[def.grade].color);
    this.emit({ t: 'unit', id: u.id, x, z, g: def.grade });
    return u;
  }
  removeUnit(u) {
    this.units.splice(this.units.indexOf(u), 1);
    this.grid.delete(cellIndex(u.cx, u.cy));
  }
  unitById(id) { return this.units.find(u => u.id === id) || null; }
  unitAt(cx, cy) { return this.grid.get(cellIndex(cx, cy)) || null; }

  rollGrade() {
    let r = this.rng() * DRAW_TOTAL;
    for (let g = 0; g < GRADES.length; g++) { r -= GRADES[g].drawWeight; if (r < 0) return g; }
    return 0;
  }

  // ───────── 명령 (모두 {ok, reason} 반환)
  canDraw() {
    if (this.state !== 'playing') return { ok: false, reason: '게임 종료' };
    if (this.minerals < ECON.drawCost) return { ok: false, reason: '광물 부족' };
    if (!this.freeCell()) return { ok: false, reason: '빈 칸 없음' };
    return { ok: true };
  }
  draw() {
    const c = this.canDraw();
    if (!c.ok) return c;
    const cell = this.freeCell();
    this.minerals -= ECON.drawCost;
    this.stats.draws++;
    const g = this.rollGrade();
    const def = this.rng.pick(UNITS_BY_GRADE[g]);
    const unit = this.addUnit(def.id, cell.cx, cell.cy);
    return { ok: true, unit };
  }
  mergePartner(u, prefer = []) {
    const same = (o) => o !== u && o.type === u.type;
    return prefer.map(id => this.unitById(id)).find(o => o && same(o)) || this.units.find(same) || null;
  }
  canMerge(unitId, prefer) {
    const u = this.unitById(unitId);
    if (!u || this.state !== 'playing') return { ok: false, reason: '유닛 없음' };
    if (u.def.grade >= GRADES.length - 1) return { ok: false, reason: '최고 등급' };
    if (!this.mergePartner(u, prefer)) return { ok: false, reason: '같은 유닛이 1기 더 필요' };
    return { ok: true };
  }
  merge(unitId, prefer = []) {
    const c = this.canMerge(unitId, prefer);
    if (!c.ok) return c;
    const u = this.unitById(unitId);
    const p = this.mergePartner(u, prefer);
    const g = u.def.grade + 1;
    this.removeUnit(u);
    this.removeUnit(p);
    const def = this.rng.pick(UNITS_BY_GRADE[g]);
    const unit = this.addUnit(def.id, u.cx, u.cy);
    this.emit({ t: 'merge', x: u.x, z: u.z, g });
    return { ok: true, unit };
  }
  sell(unitId) {
    const u = this.unitById(unitId);
    if (!u || this.state !== 'playing') return { ok: false, reason: '유닛 없음' };
    const price = GRADES[u.def.grade].sell;
    if (price <= 0) return { ok: false, reason: '판매 불가 등급' };
    this.removeUnit(u);
    this.minerals += price;
    return { ok: true, price };
  }
  move(unitId, cx, cy) {
    const u = this.unitById(unitId);
    if (!u || this.state !== 'playing') return { ok: false, reason: '유닛 없음' };
    if (!isBuildable(cx, cy)) return { ok: false, reason: '배치 불가 칸' };
    if (this.unitAt(cx, cy)) return { ok: false, reason: '이미 찬 칸' };
    this.grid.delete(cellIndex(u.cx, u.cy));
    Object.assign(u, { cx, cy }, cellToWorld(cx, cy));
    this.grid.set(cellIndex(cx, cy), u);
    return { ok: true };
  }
  upgradeCost(f) { return ECON.upgradeCost(this.upgrades[f]); }
  upgrade(f) {
    if (!(f in this.upgrades) || this.state !== 'playing') return { ok: false, reason: '잘못된 진영' };
    if (this.upgrades[f] >= ECON.upgradeMaxLevel) return { ok: false, reason: '최대 레벨' };
    const cost = this.upgradeCost(f);
    if (this.gas < cost) return { ok: false, reason: '가스 부족' };
    this.gas -= cost;
    this.upgrades[f]++;
    return { ok: true };
  }
  exchange(kind) {
    if (this.state !== 'playing') return { ok: false, reason: '게임 종료' };
    if (kind === 'm2g') {
      const { pay, get } = ECON.mineralsToGas;
      if (this.minerals < pay) return { ok: false, reason: '광물 부족' };
      this.minerals -= pay; this.gas += get; return { ok: true };
    }
    if (kind === 'g2m') {
      const { pay, get } = ECON.gasToMinerals;
      if (this.gas < pay) return { ok: false, reason: '가스 부족' };
      this.gas -= pay; this.minerals += get; return { ok: true };
    }
    if (kind === 'c2g') {
      if (this.crystals < 1) return { ok: false, reason: '결정 없음' };
      this.crystals--; this.gas += ECON.crystalToGas; return { ok: true };
    }
    return { ok: false, reason: '잘못된 환전' };
  }
  canSummon(i) {
    if (this.state !== 'playing' || !MISSIONS[i]) return { ok: false, reason: '불가' };
    if (this.mission) return { ok: false, reason: '이미 미션 진행 중' };
    if (this.missionCd[i] > 0) return { ok: false, reason: `쿨타임 ${Math.ceil(this.missionCd[i])}초` };
    return { ok: true };
  }
  summonMission(i) {
    const c = this.canSummon(i);
    if (!c.ok) return c;
    const def = MISSIONS[i];
    const m = spawnMonster(this, 'mission', def.hp * WAVES.hpMult, def.armor, MISSION_RULES.speed);
    m.missionIdx = i;
    this.mission = { m, timer: MISSION_RULES.timeLimit, idx: i };
    this.missionCd[i] = MISSION_RULES.cooldown;
    this.toast(`${def.name} 보스 소환`, '#ffd34d');
    return { ok: true };
  }

  // 공격력 배율 (진영 업그레이드)
  dmgMult(faction) { return 1 + ECON.upgradePerLevel * this.upgrades[faction]; }

  // ───────── 처치·정리
  killMonster(m) {
    if (!m.alive) return;
    m.alive = false;
    this.emit({ t: 'die', x: m.x, z: m.z, kind: m.kind });
    if (m.kind === 'normal') {
      this.stats.kills++;
      this.minerals += ECON.killReward(this.round);
    } else if (m.kind === 'boss') {
      this.stats.kills++; this.stats.bossKills++;
      this.minerals += ECON.bossReward.minerals;
      this.crystals += ECON.bossReward.crystals;
      this.toast(`보스 처치! 결정 +${ECON.bossReward.crystals}`, '#ffd34d');
      const wasFinal = this.boss && this.boss.round === WAVES.rounds;
      this.boss = null;
      if (wasFinal) this.win();
    } else if (m.kind === 'mission') {
      this.stats.missionKills++;
      const r = MISSIONS[m.missionIdx].reward;
      this.minerals += r.minerals; this.gas += r.gas;
      this.toast(`${MISSIONS[m.missionIdx].name} 성공! 광물 +${r.minerals} 가스 +${r.gas}`, '#ffd34d');
      this.mission = null;
    }
  }
  cleanupDead() {
    let w = 0;
    for (const m of this.monsters) if (m.alive) this.monsters[w++] = m;
    this.monsters.length = w;
    this.normalCount = 0;
    for (const m of this.monsters) if (m.kind === 'normal') this.normalCount++;
  }

  // ───────── 업적
  grant(id) {
    if (this.achieved.has(id)) return;
    const a = ACHIEVEMENTS.find(x => x.id === id);
    this.achieved.add(id);
    this.minerals += a.reward;
    this.emit({ t: 'achv', id, name: a.name, reward: a.reward });
    this.toast(`업적 「${a.name}」 광물 +${a.reward}`, '#ffe08a');
  }
  checkAchievements() {
    const s = this.stats;
    if (s.acquired[2] >= 1) this.grant('hero1');
    if (s.acquired[2] >= 7) this.grant('hero7');
    if (s.acquired[3] >= 6) this.grant('legend6');
    if (s.kills >= 500) this.grant('kill500');
    if (s.kills >= 2000) this.grant('kill2000');
    if (s.kills >= 5000) this.grant('kill5000');
    if (!this.achieved.has('mass') || !this.achieved.has('trinity')) {
      let commons = 0;
      const seen = GRADES.map(() => new Set());
      for (const u of this.units) { if (u.def.grade === 0) commons++; seen[u.def.grade].add(u.def.faction); }
      if (commons >= 8) this.grant('mass');
      if (seen.some(s2 => s2.size >= FACTIONS.length)) this.grant('trinity');
    }
  }

  // UI용 요약
  countsByType() {
    const c = Object.fromEntries(UNITS.map(u => [u.id, 0]));
    for (const u of this.units) c[u.type]++;
    return c;
  }
  nextRoundIn() {
    if (this.round >= WAVES.rounds) return 0;
    return WAVES.firstRoundAt + WAVES.roundLength * this.round - this.time;
  }
}
