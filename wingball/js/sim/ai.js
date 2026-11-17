// 컴퓨터 선수 판단. think()는 판단 주기마다 호출되어 p.ai.target / p.ai.boost 를 정하고,
// 슛·패스·태클 같은 즉시 행동은 actions.js 함수로 실행한다.
import { CFG, attackSign } from '../config.js';
import { add, dist, dot, len, norm, scale, sub, v } from './vec.js';
import { canHandleBall, pass, ringCenters, shoot, tryTackle } from './actions.js';

const goalCenter = (end) => v(end * CFG.rings.x, 14, 0);

function segDist(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-6, dot(ab, ab))));
  return dist(p, add(a, scale(ab, t)));
}

function laneClear(s, a, b, team, margin = 3) {
  for (const q of s.players) {
    if (q.team === team || q.stunned > 0) continue;
    if (segDist(q.pos, a, b) < margin) return false;
  }
  return true;
}

function clampY(t, lo = 4, hi = 38) { t.y = Math.max(lo, Math.min(hi, t.y)); return t; }

export function think(s, p) {
  const ai = p.ai;
  ai.boost = false;
  ai.targetVel = null;
  if (p.stunned > 0) return;
  switch (p.role) {
    case 'runner': return thinkRunner(s, p);
    case 'keeper': return thinkKeeper(s, p);
    case 'breaker': return thinkBreaker(s, p);
    case 'hunter': return thinkHunter(s, p);
  }
}

function thinkRunner(s, p) {
  const c = s.comet, ai = p.ai;
  const end = attackSign(p.team);
  const G = goalCenter(end);
  const ownG = goalCenter(-end);
  const holder = c.holder != null ? s.players[c.holder] : null;
  const mates = s.players.filter((q) => q.team === p.team && q.role === 'runner');

  // 공통: 상대 소유자에 붙어 있으면 태클
  if (holder && holder.team !== p.team) tryTackle(s, p);

  if (holder && holder.id === p.id) {
    const dG = dist(p.pos, G);
    const toG = norm(sub(G, p.pos));
    const blockers = s.players.filter((q) => q.team !== p.team && q.stunned <= 0 &&
      q.role === 'runner' &&   // 가디언은 항상 링 앞에 있으므로 '막는 수비'에서 제외
      dist(q.pos, p.pos) < CFG.ai.clearAhead && dot(norm(sub(q.pos, p.pos)), toG) > 0.5);
    const shootRange = CFG.ai.shootDist;
    const toPlane = CFG.rings.x - p.pos.x * end;            // 링 평면까지 x 거리
    const nearCrease = toPlane < CFG.rings.crease + 3;     // 금지 구역 직전이면 무조건 슛
    if (nearCrease || (dG < shootRange && (blockers.length === 0 || p.holdT > 2.5)) || (dG < 45 && p.holdT > 6)) {
      // 상대 가디언에서 가장 먼 링을 노린다
      const keeper = s.players.find((q) => q.team !== p.team && q.role === 'keeper');
      const rings = ringCenters(end);
      rings.sort((a, b) => dist(b, keeper.pos) - dist(a, keeper.pos));
      const target = { ...rings[0] };
      const err = (CFG.ai.aimErr[p.team === 1 ? s.difficulty : 'normal'] * Math.PI) / 180 * dist(target, p.pos);
      target.y += (s.r() * 2 - 1) * err;
      target.z += (s.r() * 2 - 1) * err;
      shoot(s, p, sub(target, p.pos), 0.55 + s.r() * 0.45);
      return;
    }
    if (p.holdT > 0.6) {
      const options = mates.filter((q) => q.id !== p.id && q.stunned <= 0 &&
        dist(q.pos, G) < dG - 6 && dist(q.pos, p.pos) < 38 && laneClear(s, p.pos, q.pos, p.team));
      if (options.length && (blockers.length > 0 || s.r() < 0.35)) {
        options.sort((a, b) => dist(a.pos, G) - dist(b.pos, G));
        pass(s, p, options[0]);
        return;
      }
    }
    // 전진 + 회피
    let t = add(p.pos, scale(toG, 12));
    if (blockers.length) {
      const b = blockers[0];
      const side = (b.pos.z - p.pos.z) > 0 ? -1 : 1;
      t.z += side * 9;
      t.y += (b.pos.y > p.pos.y ? -4 : 4);
    }
    t.y += (14 - t.y) * 0.3;
    ai.target = clampY(t, 5, 30);
    return;
  }

  if (holder && holder.team === p.team) {
    // 동료가 소유 — 앞쪽 빈 공간으로 침투
    const others = mates.filter((q) => q.id !== holder.id);
    const idx = Math.max(0, others.findIndex((q) => q.id === p.id));
    const lat = idx === 0 ? -10 : 10;
    const fwd = Math.min(22, Math.max(6, Math.abs(G.x - holder.pos.x) - 8));
    ai.target = clampY(v(holder.pos.x + end * fwd, holder.pos.y + (idx === 0 ? 3 : -3), lat * 0.6 + holder.pos.z * 0.4), 6, 28);
    return;
  }

  if (holder && holder.team !== p.team) {
    // 수비: 가장 가까운 1명 압박, 나머지 패스 경로 차단
    const ranked = [...mates].sort((a, b) => dist(a.pos, holder.pos) - dist(b.pos, holder.pos));
    const rank = ranked.findIndex((q) => q.id === p.id);
    if (rank === 0) {
      ai.target = { ...holder.pos };
      ai.targetVel = holder.vel;
      ai.boost = p.stamina > 30;
    } else {
      const toHolder = sub(holder.pos, ownG);
      const t = add(ownG, scale(toHolder, 0.55));
      t.z += rank === 1 ? -8 : 8;
      ai.target = clampY(t, 6, 30);
    }
    return;
  }

  // 빈 볼: 패스 받을 사람이 있으면 그가, 아니면 가장 가까운 1~2명이 추격
  const ranked = [...mates].filter((q) => q.stunned <= 0)
    .sort((a, b) => dist(a.pos, c.pos) - dist(b.pos, c.pos));
  const receiver = c.passTo != null ? s.players[c.passTo] : null;
  const chaser = receiver && receiver.team === p.team ? receiver.id : (ranked[0] && ranked[0].id);
  const second = ranked[1] && ranked[1].id;
  if (p.id === chaser || (p.id === second && dist(p.pos, c.pos) < 25)) {
    const tt = Math.min(1.2, dist(p.pos, c.pos) / CFG.roles.runner.maxSpeed);
    ai.target = add(c.pos, scale(c.vel, tt));
    if (len(c.vel) > 3) ai.targetVel = c.vel;
    ai.boost = p.stamina > 30 && p.id === chaser;
  } else {
    const idx = mates.findIndex((q) => q.id === p.id);
    ai.target = clampY(v(c.pos.x + end * 8, 14 + (idx - 1) * 3, (idx - 1) * 12), 6, 28);
  }
}

function thinkKeeper(s, p) {
  const c = s.comet, ai = p.ai;
  const ownEnd = -attackSign(p.team);
  const home = goalCenter(ownEnd);
  if (c.holder === p.id) {
    if (p.holdT > 0.8) {
      // 상대와 가장 멀리 떨어진 러너에게 아웃렛 패스
      const mates = s.players.filter((q) => q.team === p.team && q.role === 'runner' && q.stunned <= 0);
      let best = null, bestScore = -1;
      for (const q of mates) {
        let nearest = 1e9;
        for (const o of s.players) if (o.team !== p.team) nearest = Math.min(nearest, dist(o.pos, q.pos));
        if (nearest > bestScore) { bestScore = nearest; best = q; }
      }
      if (best) { pass(s, p, best); return; }
    }
    ai.target = add(home, v(-ownEnd * CFG.ai.keeperFront, 0, 0));
    return;
  }
  const holder = c.holder != null ? s.players[c.holder] : null;
  if (holder && holder.team !== p.team) tryTackle(s, p);

  // 링 근처 빈 볼 회수
  if (!holder && dist(c.pos, home) < CFG.roles.keeper.leash + 2) {
    ai.target = { ...c.pos };
    return;
  }
  // 기본 위치: 볼과 링 중심을 잇는 선 위, 링 앞
  const dir = norm(sub(c.pos, home));
  const t = add(home, scale(dir, CFG.ai.keeperFront));
  if ((t.x - home.x) * -ownEnd < 1) t.x = home.x - ownEnd * 1;
  ai.target = t;
}

function thinkBreaker(s, p) {
  const c = s.comet, ai = p.ai;
  const ownEnd = -attackSign(p.team);
  // 가까운 스톤 요격
  let best = null, bd = 14;
  for (const st of s.stones) {
    if (st.ownerTeam === p.team && st.ownerT > 0) continue;
    const d = dist(st.pos, p.pos);
    if (d < bd) { bd = d; best = st; }
  }
  if (best) {
    ai.target = add(best.pos, scale(best.vel, 0.15));
    ai.boost = bd < 8 && p.stamina > 20;
    return;
  }
  const mates = s.players.filter((q) => q.team === p.team && q.role === 'breaker');
  const idx = mates.findIndex((q) => q.id === p.id);
  const holder = c.holder != null ? s.players[c.holder] : null;
  if (holder && holder.team === p.team) {
    // 소유 동료 호위
    ai.target = add(holder.pos, v(-attackSign(p.team) * 4, idx ? 3 : -3, idx ? 5 : -5));
    return;
  }
  // 우리 진영 쪽에서 스톤을 기다림
  ai.target = clampY(v(c.pos.x + ownEnd * 12, 16 + (idx ? 4 : -2), idx ? 12 : -12), 6, 30);
}

function thinkHunter(s, p) {
  const o = s.orb, ai = p.ai;
  if (o.active) {
    const d = dist(o.pos, p.pos);
    const lead = d < 6 ? 0.12 : Math.min(0.6, d / 60);
    ai.target = add(o.pos, scale(o.vel, lead));
    ai.targetVel = o.vel;
    ai.boost = p.stamina > 15 && d < 40;
    return;
  }
  const ang = s.time * 0.25 + p.team * Math.PI;
  ai.target = v(Math.cos(ang) * 35, 30, Math.sin(ang) * 20);
}

// 매 스텝 호출: 내 링으로 날아오는 슛을 감지하면(반응 지연 후) 예측 지점으로 즉시 이동.
// 판단 주기(0.25s)를 기다리면 0.6~0.9초짜리 슛에 늦기 때문에 별도 처리.
export function keeperTick(s, p) {
  const c = s.comet;
  if (p.stunned > 0 || c.holder != null || !c.shot || c.shot.team === p.team) return;
  if (s.time - c.shot.t < CFG.ai.keeperReact) return;
  const ownEnd = -attackSign(p.team);
  const home = goalCenter(ownEnd);
  if (c.vel.x * ownEnd < 10) return;
  const planeX = home.x - ownEnd * 2;
  const t = (planeX - c.pos.x) / c.vel.x;
  if (t > 0 && t < 2.5) {
    p.ai.target = add(c.pos, scale(c.vel, t));
    p.ai.targetVel = null;
    p.ai.boost = true;
  }
}
