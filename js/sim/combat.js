import { COMBAT } from '../config.js';
import { applySlow } from './waves.js';

const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;

function hit(g, u, m, raw) {
  if (!m.alive) return;
  const dmg = Math.max(1, raw - m.armor);
  m.hp -= dmg;
  u.dealt += Math.min(dmg, m.hp + dmg);
  if (u.def.slow) applySlow(m, u.def.slow);
  if (m.hp <= 0) g.killMonster(m);
}

// 사거리 안에서 가장 멀리 진행한 몬스터 (선두 우선)
function pickTarget(g, u, range) {
  const r2 = range * range;
  let best = null;
  for (const m of g.monsters) {
    if (!m.alive) continue;
    if (dist2(u.x, u.z, m.x, m.z) > r2) continue;
    if (!best || m.traveled > best.traveled) best = m;
  }
  return best;
}

function chainFrom(g, u, first, jumps, raw) {
  const hitSet = new Set([first]);
  let cur = first;
  const j2 = COMBAT.chainJump ** 2;
  for (let i = 0; i < jumps; i++) {
    let next = null, bd = Infinity;
    for (const m of g.monsters) {
      if (!m.alive || hitSet.has(m)) continue;
      const d = dist2(cur.x, cur.z, m.x, m.z);
      if (d <= j2 && d < bd) { bd = d; next = m; }
    }
    if (!next) break;
    hitSet.add(next);
    g.emit({ t: 'atk', kind: 'chain', x: cur.x, z: cur.z, tx: next.x, tz: next.z, f: u.def.faction, gr: u.def.grade });
    hit(g, u, next, raw);
    cur = next;
  }
}

function attack(g, u, target, raw) {
  const d = u.def;
  const ev = { t: 'atk', kind: d.kind, x: u.x, z: u.z, tx: target.x, tz: target.z, f: d.faction, gr: d.grade, uid: u.id };
  switch (d.kind) {
    case 'single':
      g.emit(ev); hit(g, u, target, raw); break;
    case 'splash': {
      ev.r = d.splash; g.emit(ev);
      const r2 = d.splash ** 2, tx = target.x, tz = target.z;
      for (const m of g.monsters) if (m.alive && dist2(tx, tz, m.x, m.z) <= r2) hit(g, u, m, raw);
      if (d.chain) chainFrom(g, u, target, d.chain, raw);
      break;
    }
    case 'chain':
      g.emit(ev); hit(g, u, target, raw); chainFrom(g, u, target, d.chain - 1, raw); break;
    case 'pierce': {
      // 유닛 → 대상 방향으로 사거리만큼 직선, 폭 안의 모두에게 피해
      let dx = target.x - u.x, dz = target.z - u.z;
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      const L = d.range, w2 = COMBAT.pierceWidth ** 2;
      ev.tx = u.x + dx * L; ev.tz = u.z + dz * L; g.emit(ev);
      for (const m of g.monsters) {
        if (!m.alive) continue;
        const px = m.x - u.x, pz = m.z - u.z;
        const t = px * dx + pz * dz;
        if (t < 0 || t > L) continue;
        if ((px - dx * t) ** 2 + (pz - dz * t) ** 2 <= w2) hit(g, u, m, raw);
      }
      break;
    }
    case 'field': {
      ev.r = d.range; ev.tx = u.x; ev.tz = u.z; g.emit(ev);
      const r2 = d.range ** 2;
      for (const m of g.monsters) if (m.alive && dist2(u.x, u.z, m.x, m.z) <= r2) hit(g, u, m, raw);
      break;
    }
  }
}

export function updateCombat(g, dt) {
  // 오라(공속 증가) — 오라 유닛은 드물어서 매 틱 계산해도 싸다
  const auraUnits = g.units.filter(u => u.def.aura);
  for (const u of g.units) {
    let a = 0;
    for (const s of auraUnits) {
      if (dist2(u.x, u.z, s.x, s.z) <= s.def.aura.radius ** 2) a = Math.max(a, s.def.aura.atkSpeed);
    }
    u.aura = a;
  }
  for (const u of g.units) {
    u.cdLeft -= dt * (1 + u.aura);
    if (u.cdLeft > 0) continue;
    const target = pickTarget(g, u, u.def.range);
    if (!target) { u.cdLeft = 0; continue; }
    attack(g, u, target, u.def.dmg * g.dmgMult(u.def.faction));
    u.cdLeft += u.def.cd;
    if (g.state !== 'playing') return;
  }
}
