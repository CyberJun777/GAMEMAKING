// 헤드리스 시뮬레이션 테스트 — 기획서 ⑥ 완료 기준 1~21
// 실행: node --test tests/sim.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, UNIT_BY_ID } from '../js/sim/game.js';
import { ECON, WAVES, GRADES, MISSIONS, MISSION_RULES, UNITS, ACHIEVEMENTS } from '../js/config.js';
import { PATH_LENGTH, BUILD_CELLS, isPath, cellToWorld } from '../js/sim/board.js';
import { diligentBot, idleBot } from './bots.js';

const fresh = (seed = 7) => new Game({ seed });
const firstOfType = (g, type) => g.units.find(u => u.type === type);
// 테스트 편의: 원하는 유닛을 지정 칸에 직접 배치
const place = (g, type, cell) => { const c = cell || g.freeCell(); return g.addUnit(type, c.cx, c.cy); };

test('보드: 204개 배치 칸, 경로 52칸', () => {
  assert.equal(BUILD_CELLS.length, 204);
  assert.equal(PATH_LENGTH, 52);
  assert.ok(BUILD_CELLS.every(c => !isPath(c.cx, c.cy)));
});

test('1. 뽑기: 광물 -50, 빈 칸에 유닛 1기', () => {
  const g = fresh();
  const r = g.draw();
  assert.ok(r.ok);
  assert.equal(g.minerals, ECON.startMinerals - ECON.drawCost);
  assert.equal(g.units.length, 1);
  assert.ok(!isPath(r.unit.cx, r.unit.cy));
});

test('2. 광물 부족 / 빈 칸 없음이면 뽑기 불가, 광물 그대로', () => {
  const g = fresh();
  g.minerals = 49;
  assert.equal(g.draw().ok, false);
  assert.equal(g.minerals, 49);
  assert.equal(g.units.length, 0);
  const g2 = fresh();
  for (const c of BUILD_CELLS) g2.addUnit('m0', c.cx, c.cy);
  g2.minerals = 1000;
  const r = g2.draw();
  assert.equal(r.ok, false);
  assert.equal(r.reason, '빈 칸 없음');
  assert.equal(g2.minerals, 1000);
});

test('3. 뽑기 10,000회 등급 비율 82/15/3 (±1.5%p)', () => {
  const g = fresh(123);
  const n = 10000, cnt = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) cnt[g.rollGrade()]++;
  const pct = cnt.map(c => (c / n) * 100);
  assert.ok(Math.abs(pct[0] - 82) <= 1.5, `일반 ${pct[0]}`);
  assert.ok(Math.abs(pct[1] - 15) <= 1.5, `희귀 ${pct[1]}`);
  assert.ok(Math.abs(pct[2] - 3) <= 1.5, `영웅 ${pct[2]}`);
  assert.equal(cnt[3] + cnt[4], 0);
});

test('4. 같은 유닛 2기 합성 → 2기 사라지고 한 등급 위 1기', () => {
  for (const type of ['m0', 'b1', 'a2', 'm3']) {
    const g = fresh();
    const a = place(g, type), b = place(g, type);
    const r = g.merge(a.id);
    assert.ok(r.ok, type);
    assert.equal(g.units.length, 1);
    assert.ok(!g.unitById(a.id) && !g.unitById(b.id));
    assert.equal(r.unit.def.grade, UNIT_BY_ID[type].grade + 1);
    assert.deepEqual([r.unit.cx, r.unit.cy], [a.cx, a.cy]);
  }
});

test('5. 다른 유닛끼리 / 신 등급은 합성 불가', () => {
  const g = fresh();
  const a = place(g, 'm0'); place(g, 'b0');
  assert.equal(g.merge(a.id).ok, false);
  assert.equal(g.units.length, 2);
  const g2 = fresh();
  const s = place(g2, 'm4'); place(g2, 'm4');
  assert.equal(g2.merge(s.id).ok, false);
  assert.equal(g2.units.length, 2);
});

test('6. 판매: 유닛 제거 + 등급별 판매가 환급, 신은 판매 불가', () => {
  for (let gr = 0; gr < 4; gr++) {
    const g = fresh();
    const u = place(g, UNITS.find(x => x.grade === gr).id);
    const before = g.minerals;
    assert.ok(g.sell(u.id).ok);
    assert.equal(g.units.length, 0);
    assert.equal(g.minerals - before, GRADES[gr].sell);
  }
  const g = fresh(); const god = place(g, 'b4');
  assert.equal(g.sell(god.id).ok, false);
  assert.equal(g.units.length, 1);
});

test('7. 진영 업그레이드: 가스 차감, 해당 진영 피해만 +12%', () => {
  const run = (upgrade) => {
    const g = fresh();
    const m = place(g, 'm0', { cx: 2, cy: 2 });  // 경로 바로 옆
    const b = place(g, 'b0', { cx: 2, cy: 3 });
    g.gas = 1000;
    if (upgrade) { const before = g.gas; assert.ok(g.upgrade('mech').ok); assert.equal(before - g.gas, ECON.upgradeCost(0)); }
    g.run(25);
    return { m: m.dealt, b: b.dealt, g };
  };
  const base = run(false), up = run(true);
  assert.ok(base.m > 0 && base.b > 0);
  assert.ok(Math.abs(up.m / base.m - 1.12) < 0.02, `기계 배율 ${up.m / base.m}`);
  assert.ok(Math.abs(up.b / base.b - 1) < 0.02, `생체 배율 ${up.b / base.b}`);
  assert.equal(up.g.upgrades.mech, 1);
  const g = fresh(); g.gas = 0;
  assert.equal(g.upgrade('arc').ok, false);
});

test('8. 환전 비율', () => {
  const g = fresh();
  g.minerals = 100; g.gas = 0; g.crystals = 1;
  assert.ok(g.exchange('m2g').ok); assert.equal(g.minerals, 0); assert.equal(g.gas, 60);
  g.gas = 100; assert.ok(g.exchange('g2m').ok); assert.equal(g.gas, 0); assert.equal(g.minerals, 60);
  assert.ok(g.exchange('c2g').ok); assert.equal(g.crystals, 0); assert.equal(g.gas, ECON.crystalToGas);
  assert.equal(g.exchange('c2g').ok, false);
  g.minerals = 99; assert.equal(g.exchange('m2g').ok, false);
});

test('9. 업적: 조건 만족 순간 1번씩만 보상', () => {
  const g = fresh();
  for (let i = 0; i < 8; i++) place(g, 'm0');
  const m0 = g.minerals; g.checkAchievements();
  const massReward = ACHIEVEMENTS.find(x => x.id === 'mass').reward;
  assert.ok(g.achieved.has('mass')); assert.equal(g.minerals - m0, massReward);
  g.checkAchievements(); assert.equal(g.minerals - m0, massReward, '두 번 주면 안 됨');
  place(g, 'b0'); place(g, 'a0');
  const m1 = g.minerals; g.checkAchievements();
  assert.ok(g.achieved.has('trinity')); assert.equal(g.minerals - m1, 300);
  place(g, 'm2'); g.checkAchievements(); assert.ok(g.achieved.has('hero1'));
  for (let i = 0; i < 6; i++) place(g, 'b2'); g.checkAchievements(); assert.ok(g.achieved.has('hero7'));
  for (let i = 0; i < 6; i++) place(g, 'a3'); g.checkAchievements(); assert.ok(g.achieved.has('legend6'));
  g.stats.kills = 5000; g.checkAchievements();
  assert.ok(['kill500', 'kill2000', 'kill5000'].every(id => g.achieved.has(id)));
  const evs = g.events.filter(e => e.t === 'achv').map(e => e.id);
  assert.equal(new Set(evs).size, evs.length, '중복 보상 이벤트 없음');
  assert.equal(evs.length, 8);
});

test('10. 시작 5초 후 몬스터 등장, 고리 길을 시계 방향으로 끝없이 순환', () => {
  const g = fresh();
  g.run(4.9); assert.equal(g.monsters.length, 0);
  g.run(0.3); assert.ok(g.monsters.length >= 1);
  const m = g.monsters[0];
  const start = { x: m.x, z: m.z };
  g.run(0.5);
  assert.ok(m.x > start.x && Math.abs(m.z - start.z) < 1e-6, '첫 구간은 +x 방향');
  // 한 바퀴 이상 진행: 경로 위에 있는지 매 틱 확인
  let maxTraveled = 0, offPath = 0;
  g.run(40, () => {
    if (!m.alive) return;
    maxTraveled = m.traveled;
    const onEdge = [m.x, m.z].some(v => Math.abs(Math.abs(v) - 6.5) < 1e-6);
    if (!onEdge) offPath++;
  });
  assert.ok(maxTraveled > PATH_LENGTH, `한 바퀴 이상 (${maxTraveled})`);
  assert.equal(offPath, 0, '항상 고리 위');
});

test('11. 라운드당 40마리, 35초마다 라운드 증가', () => {
  const g = fresh();
  let spawned = 0;
  g.run(5 + 35 * 3 - 0.1, (g) => { spawned += g.events.filter(e => e.t === 'spawn' && e.kind === 'normal').length; g.events.length = 0;
    for (const m of g.monsters) m.alive = false; }); // 패배 방지용으로 치움
  assert.equal(g.round, 3);
  assert.equal(spawned, 120);
  g.run(0.2); assert.equal(g.round, 4);
});

test('12. 사거리 안 공격 → 체력 감소 → 처치 시 제거 + 광물', () => {
  const g = fresh();
  for (let i = 0; i < 6; i++) place(g, 'm0');
  let sawDamage = false;
  g.run(12, (g) => { if (g.monsters.some(m => m.hp < m.maxHp)) sawDamage = true; });
  assert.ok(sawDamage);
  assert.ok(g.stats.kills > 0);
  assert.equal(g.monsters.filter(m => m.hp <= 0).length, 0, '죽은 몬스터는 목록에서 사라짐');
  // 광물 = 시작 + 처치 수 × 보상 (뽑기 안 했으므로)
  assert.equal(g.minerals, ECON.startMinerals + g.stats.kills * ECON.killReward(1));
  // 사거리 밖이면 공격하지 않음
  const g2 = fresh(); const far = place(g2, 'b0', { cx: 7, cy: 7 });
  g2.run(20); assert.equal(far.dealt, 0);
});

test('13. 스플래시·연쇄·관통·장판·둔화·오라', () => {
  const setup = (type, cell = { cx: 2, cy: 2 }) => {
    const g = fresh(); const u = place(g, type, cell);
    // 몬스터를 직접 뭉쳐서 배치
    const ms = [];
    for (let i = 0; i < 5; i++) {
      g.monsters.push({ id: 900 + i, kind: 'normal', hp: 1e6, maxHp: 1e6, armor: 0, speed: 0, d: 0, traveled: 10 - i, x: -6.5 + i * 0.4, z: -6.5, px: 0, pz: 0, slow: 0, slowT: 0, alive: true });
      ms.push(g.monsters[g.monsters.length - 1]);
    }
    return { g, u, ms };
  };
  const fire = async (g) => { const { updateCombat } = await import('../js/sim/combat.js'); updateCombat(g, g.dt); };
  return (async () => {
    // 스플래시: 여러 마리 동시 피해
    let s = setup('a0'); await fire(s.g);
    assert.ok(s.ms.filter(m => m.hp < m.maxHp).length >= 2, '스플래시 다수 피해');
    // 연쇄: 정확히 chain 수만큼
    s = setup('a1'); await fire(s.g);
    assert.equal(s.ms.filter(m => m.hp < m.maxHp).length, 3, '번개구슬 3연쇄');
    // 관통: 직선 위 다수
    s = setup('m2', { cx: 5, cy: 0 }); await fire(s.g);
    assert.ok(s.ms.filter(m => m.hp < m.maxHp).length >= 2, '관통 다수');
    // 장판: 범위 안 전부 + 둔화
    s = setup('b2'); await fire(s.g);
    assert.equal(s.ms.filter(m => m.hp < m.maxHp).length, 5, '장판 전체');
    assert.ok(s.ms.every(m => Math.abs(m.slow - 0.35) < 1e-9), '장판 둔화 35%');
    // 단일 + 둔화
    s = setup('b1'); await fire(s.g);
    assert.equal(s.ms.filter(m => m.slow > 0).length, 1); assert.equal(s.ms[0].slow, 0.2);
    // 둔화 시 실제 이동 속도 감소
    const g = fresh(); g.run(5.1); const m = g.monsters[0];
    const d0 = m.d; g.run(1); const v0 = m.d - d0;
    m.slow = 0.5; m.slowT = 10; const d1 = m.d; g.run(1); const v1 = m.d - d1;
    assert.ok(Math.abs(v1 / v0 - 0.5) < 0.05, `둔화 이동 ${v1 / v0}`);
    // 오라: 세계수 주변 유닛 공속 +25%
    const g2 = fresh(); place(g2, 'b4', { cx: 7, cy: 7 }); const near = place(g2, 'm0', { cx: 8, cy: 7 }); const farU = place(g2, 'm0', { cx: 0, cy: 0 });
    const { updateCombat } = await import('../js/sim/combat.js'); updateCombat(g2, g2.dt);
    assert.equal(near.aura, 0.25); assert.equal(farU.aura, 0);
  })();
});

test('14. 방어력이 피해를 깎고 최소 1', async () => {
  const { updateCombat } = await import('../js/sim/combat.js');
  const g = fresh(); place(g, 'b0', { cx: 2, cy: 2 }); // 공격 5
  const mk = (armor) => ({ id: 1, kind: 'normal', hp: 100, maxHp: 100, armor, speed: 0, d: 0, traveled: 1, x: -6.5, z: -6.5, slow: 0, slowT: 0, alive: true });
  g.monsters = [mk(3)]; updateCombat(g, g.dt); assert.equal(g.monsters[0].hp, 98);
  g.units[0].cdLeft = 0; g.monsters = [mk(50)]; updateCombat(g, g.dt); assert.equal(g.monsters[0].hp, 99);
});

test('15. 보스 라운드에 보스 등장, 처치 시 결정 1 + 광물 100', () => {
  const g = fresh();
  g.time = WAVES.firstRoundAt + WAVES.roundLength * 9 - g.dt / 2; g.round = 9;
  g.tick();
  assert.equal(g.round, 10);
  assert.ok(g.boss && g.boss.m.kind === 'boss');
  assert.equal(g.spawnLeft, 0, '보스 라운드엔 일반 몬스터 없음');
  const before = { m: g.minerals, c: g.crystals };
  g.killMonster(g.boss.m);
  assert.equal(g.crystals - before.c, 1);
  assert.equal(g.minerals - before.m, 100);
  assert.equal(g.boss, null);
});

test('16. 보스를 70초 안에 못 잡으면 목숨 -1, 보스 사라짐', () => {
  const g = fresh();
  g.time = WAVES.firstRoundAt + WAVES.roundLength * 9 - g.dt / 2; g.round = 9;
  g.tick();
  const boss = g.boss.m;
  g.run(WAVES.bossTimeLimit + 0.5, (g) => { for (const m of g.monsters) if (m.kind === 'normal') m.alive = false; });
  assert.equal(g.lives, WAVES.lives - 1);
  assert.equal(boss.alive, false);
  assert.ok(!g.monsters.includes(boss));
});

test('17. 미션 보스 소환·보상·쿨타임', () => {
  const g = fresh();
  assert.ok(g.summonMission(0).ok);
  assert.ok(g.mission);
  assert.equal(g.summonMission(1).ok, false, '동시 1마리');
  const before = { m: g.minerals, g: g.gas };
  g.killMonster(g.mission.m);
  assert.equal(g.minerals - before.m, MISSIONS[0].reward.minerals);
  assert.equal(g.gas - before.g, MISSIONS[0].reward.gas);
  assert.equal(g.summonMission(0).ok, false, '쿨타임 중');
  g.run(MISSION_RULES.cooldown + 0.1, (g) => { for (const m of g.monsters) m.alive = false; });
  assert.ok(g.canSummon(0).ok, '90초 후 다시 가능');
  // 미션 시간 초과 → 벌칙 없이 사라짐
  const g2 = fresh(); g2.summonMission(0); const lives = g2.lives;
  g2.run(MISSION_RULES.timeLimit + 0.2, (g) => { for (const m of g.monsters) if (m.kind === 'normal') m.alive = false; });
  assert.equal(g2.mission, null); assert.equal(g2.lives, lives);
});

test('18. 길 위 몬스터 70마리 → 즉시 패배 (방치)', () => {
  const g = fresh();
  let maxSeen = 0;
  g.run(600, (g) => { idleBot(g); maxSeen = Math.max(maxSeen, g.normalCount); });
  assert.equal(g.state, 'defeat');
  assert.equal(maxSeen, WAVES.monsterLimit);
  assert.ok(g.defeatReason.includes('70'));
});

test('19. 목숨 0 → 패배', () => {
  const g = fresh(); g.lives = 1;
  g.time = WAVES.firstRoundAt + WAVES.roundLength * 9 - g.dt / 2; g.round = 9;
  g.tick();
  g.run(WAVES.bossTimeLimit + 1, (g) => { for (const m of g.monsters) if (m.kind === 'normal') m.alive = false; });
  assert.equal(g.lives, 0);
  assert.equal(g.state, 'defeat');
});

test('20. 40라운드 보스 처치 → 승리', () => {
  const g = fresh();
  g.time = WAVES.firstRoundAt + WAVES.roundLength * 39 - g.dt / 2; g.round = 39;
  g.tick();
  assert.equal(g.round, 40);
  g.killMonster(g.boss.m);
  assert.equal(g.state, 'victory');
});

test('21. 성실 봇은 R40 클리어(3시드), 방치 봇은 R5 이전 패배', () => {
  for (const seed of [1, 2, 3]) {
    const g = fresh(seed);
    g.run(60 * 40, diligentBot);
    assert.equal(g.state, 'victory', `seed ${seed}: ${g.state} R${g.round} ${g.defeatReason}`);
  }
  const idle = fresh();
  idle.run(60 * 10, idleBot);
  assert.equal(idle.state, 'defeat');
  assert.ok(idle.round < 5, `방치 봇 패배 라운드 ${idle.round}`);
});

test('부가: 같은 시드 → 같은 결과 (재현성)', () => {
  const a = fresh(42), b = fresh(42);
  a.run(200, diligentBot); b.run(200, diligentBot);
  assert.equal(a.minerals, b.minerals);
  assert.deepEqual(a.units.map(u => u.type), b.units.map(u => u.type));
});

test('부가: 이동 명령은 빈 배치 칸에만', () => {
  const g = fresh();
  const u = place(g, 'm0', { cx: 3, cy: 3 }); place(g, 'b0', { cx: 4, cy: 4 });
  assert.equal(g.move(u.id, 1, 5).ok, false, '길');
  assert.equal(g.move(u.id, 4, 4).ok, false, '찬 칸');
  assert.ok(g.move(u.id, 6, 6).ok);
  assert.deepEqual([u.cx, u.cy, u.x, u.z], [6, 6, cellToWorld(6, 6).x, cellToWorld(6, 6).z]);
  assert.equal(g.unitAt(3, 3), null);
});
