// 테스트용 플레이 봇
import { FACTIONS } from '../js/config.js';

// 성실 봇: 광물 생기면 뽑기 → 합성 가능하면 합성 → 가스로 업그레이드 → 여유 되면 미션
export function diligentBot(g) {
  if (g.tickCount % 3 !== 0) return; // 0.1초마다 판단
  if (g.state !== 'playing') return;
  while (g.crystals > 0 && g.exchange('c2g').ok);
  let merged = true;
  while (merged) {
    merged = false;
    for (const u of g.units) {
      if (u.def.grade < 4 && g.canMerge(u.id).ok) { g.merge(u.id); merged = true; break; }
    }
  }
  while (g.canDraw().ok) g.draw();
  if (!g.freeCell() && g.minerals >= 150) g.exchange('m2g');
  // 가장 강한 진영에 업그레이드 집중
  const power = Object.fromEntries(FACTIONS.map(f => [f.key, 0]));
  for (const u of g.units) power[u.def.faction] += Math.pow(4, u.def.grade);
  const order = Object.keys(power).sort((a, b) => power[b] - power[a]);
  let spent = true;
  while (spent) {
    spent = false;
    for (const f of order) { if (g.upgrade(f).ok) { spent = true; break; } }
  }
  // 미션: 해당 등급 이상 유닛이 있으면 소환
  const maxGrade = g.units.reduce((m, u) => Math.max(m, u.def.grade), -1);
  for (let i = 2; i >= 0; i--) if (maxGrade >= i + 2 && g.canSummon(i).ok && !g.boss) { g.summonMission(i); break; }
}

export function idleBot() {}
