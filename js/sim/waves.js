import { WAVES, ECON, COMBAT } from '../config.js';
import { pathPos } from './board.js';

export function spawnMonster(g, kind, hp, armor, speed) {
  const p = pathPos(0);
  const m = {
    id: g.nextId++, kind, hp, maxHp: hp, armor, speed,
    d: 0, traveled: 0, x: p.x, z: p.z, px: p.x, pz: p.z,
    slow: 0, slowT: 0, alive: true, born: g.time
  };
  g.monsters.push(m);
  if (kind === 'normal') g.normalCount++;
  g.emit({ t: 'spawn', id: m.id, kind });
  return m;
}

function startRound(g, r) {
  if (r > 1) {
    g.minerals += ECON.roundBonus(r - 1);
    g.gas += ECON.roundGas(r - 1);
  }
  g.round = r;
  g.emit({ t: 'round', r });
  if (WAVES.bossRounds.includes(r)) {
    const hp = WAVES.normalHp(r) * WAVES.bossHpMult * WAVES.hpMult;
    const m = spawnMonster(g, 'boss', hp, WAVES.normalArmor(r) * WAVES.bossArmorMult, WAVES.bossSpeed);
    g.boss = { m, timer: WAVES.bossTimeLimit, round: r };
    g.spawnLeft = 0;
    g.toast(`${r}라운드 보스 등장! ${WAVES.bossTimeLimit}초 안에 처치`, '#ff5d5d');
  } else {
    g.spawnLeft = WAVES.spawnCount;
    g.spawnTimer = 0;
  }
}

export function updateWaves(g, dt) {
  // 라운드 시작 (고정 시간표: 남은 몬스터와 무관하게 진행)
  while (g.round < WAVES.rounds && g.time >= WAVES.firstRoundAt + WAVES.roundLength * g.round) {
    startRound(g, g.round + 1);
  }
  // 생성
  if (g.spawnLeft > 0) {
    g.spawnTimer -= dt;
    while (g.spawnTimer <= 0 && g.spawnLeft > 0) {
      const r = g.round;
      spawnMonster(g, 'normal', WAVES.normalHp(r) * WAVES.hpMult, WAVES.normalArmor(r), WAVES.normalSpeed);
      g.spawnLeft--;
      g.spawnTimer += WAVES.spawnInterval;
    }
  }
  // 보스 제한 시간
  if (g.boss) {
    g.boss.timer -= dt;
    if (g.boss.timer <= 0 && g.boss.m.alive) {
      const finalBoss = g.boss.round === WAVES.rounds;
      g.boss.m.alive = false;
      g.emit({ t: 'escape', x: g.boss.m.x, z: g.boss.m.z });
      g.boss = null;
      g.lives--;
      g.toast(`보스를 놓쳤습니다. 목숨 -1`, '#ff5d5d');
      if (finalBoss) g.lose('최종 보스를 제한 시간 안에 잡지 못했습니다');
      else if (g.lives <= 0) g.lose('목숨을 모두 잃었습니다');
    }
  }
  // 미션 제한 시간
  if (g.mission) {
    g.mission.timer -= dt;
    if (g.mission.timer <= 0 && g.mission.m.alive) {
      g.mission.m.alive = false;
      g.emit({ t: 'escape', x: g.mission.m.x, z: g.mission.m.z });
      g.toast('미션 실패 (보상 없음)', '#aaa');
      g.mission = null;
    }
  }
}

export function updateMonsters(g, dt) {
  for (const m of g.monsters) {
    if (!m.alive) continue;
    if (m.slowT > 0) { m.slowT -= dt; if (m.slowT <= 0) m.slow = 0; }
    const v = m.speed * (1 - m.slow) * dt;
    m.d += v; m.traveled += v;
    m.px = m.x; m.pz = m.z;
    const p = pathPos(m.d);
    m.x = p.x; m.z = p.z;
  }
}

export function applySlow(m, pct) {
  if (m.kind !== 'normal') pct *= COMBAT.bossSlowResist;
  if (pct >= m.slow || m.slowT <= 0) { m.slow = pct; }
  m.slowT = COMBAT.slowDuration;
}
