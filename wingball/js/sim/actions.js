// 선수 행동(슛·패스·태클·전환) — 사람 입력과 AI가 같은 함수를 쓴다.
import { CFG } from '../config.js';
import { add, copy, dist, dot, jitterDir, norm, scale, sub, addTo } from './vec.js';

export const canHandleBall = (p) => p.role === 'runner' || p.role === 'keeper';

export function releaseBall(s, p, vel, noPickupT = CFG.comet.noPickupSelf) {
  const c = s.comet;
  c.holder = null;
  c.vel = vel;
  c.airborne = true;
  c.noPickup = { id: p.id, t: noPickupT };
  c.lastTeam = p.team;
  c.pos = add(p.pos, scale(norm(vel), 1.6));
}

export function shoot(s, p, aimDir, charge) {
  const c = s.comet;
  if (c.holder !== p.id) return false;
  const k = Math.max(0, Math.min(1, charge));
  const speed = CFG.comet.shotMin + (CFG.comet.shotMax - CFG.comet.shotMin) * k;
  const err = CFG.comet.errMax + (CFG.comet.errMin - CFG.comet.errMax) * k;
  const d = jitterDir(norm(aimDir), err, s.r);
  releaseBall(s, p, scale(d, speed));
  c.shot = { team: p.team, by: p.id, t: s.time };
  c.passTo = null;
  s.stats.shots[p.team]++;
  s.events.push({ t: s.time, type: 'shot', team: p.team, id: p.id });
  return true;
}

export function pass(s, p, target) {
  const c = s.comet;
  if (c.holder !== p.id || !target || target.id === p.id) return false;
  const sp = CFG.comet.passSpeed;
  const t = dist(p.pos, target.pos) / sp;
  const aim = add(target.pos, scale(target.vel, t));
  releaseBall(s, p, scale(norm(sub(aim, p.pos)), sp));
  c.shot = null;
  c.passTo = target.id;
  s.stats.passes[p.team]++;
  s.events.push({ t: s.time, type: 'pass', team: p.team, id: p.id, to: target.id });
  return true;
}

// 시선 방향에 가장 가까운 동료 (러너·가디언)
export function passTargetByAim(s, p, aimDir) {
  let best = null, bestDot = -2;
  for (const q of s.players) {
    if (q.team !== p.team || q.id === p.id || !canHandleBall(q) || q.stunned > 0) continue;
    const d = dot(norm(sub(q.pos, p.pos)), norm(aimDir));
    if (d > bestDot) { bestDot = d; best = q; }
  }
  return best;
}

export function tryTackle(s, p) {
  if (p.tackleCd > 0 || p.stunned > 0 || !canHandleBall(p)) return false;
  const c = s.comet;
  if (c.holder == null) return false;
  const h = s.players[c.holder];
  if (h.team === p.team || dist(h.pos, p.pos) > CFG.player.tackleRange) return false;
  p.tackleCd = CFG.player.tackleCd;
  const front = dot(h.facing, norm(sub(p.pos, h.pos))) > 0.3;
  const chance = front ? CFG.player.tackleFront : CFG.player.tackleBack;
  const ok = s.r() < chance;
  s.stats.tackles[p.team]++;
  if (ok) {
    c.holder = p.id;
    c.passTo = null;
    c.shot = null;
    p.holdT = 0;
    s.stats.steals[p.team]++;
  }
  s.events.push({ t: s.time, type: ok ? 'steal' : 'tackle_miss', team: p.team, id: p.id });
  return ok;
}

export function switchRole(s) {
  if (s.humanId == null || s.switchCd > 0) return false;
  const cur = s.players[s.humanId];
  let next;
  if (cur.role === 'hunter') {
    // 볼에 가장 가까운 우리 러너로
    next = s.players
      .filter((q) => q.team === cur.team && q.role === 'runner')
      .sort((a, b) => dist(a.pos, s.comet.pos) - dist(b.pos, s.comet.pos))[0];
  } else {
    next = s.players.find((q) => q.team === cur.team && q.role === 'hunter');
  }
  if (!next) return false;
  cur.isHuman = false;
  next.isHuman = true;
  next.aimYaw = cur.aimYaw;
  next.aimPitch = cur.aimPitch;
  s.humanId = next.id;
  s.switchCd = CFG.player.switchCd;
  s.events.push({ t: s.time, type: 'switch', team: cur.team, id: next.id, role: next.role });
  return true;
}

export const ringCenters = (end) =>
  CFG.rings.zs.map((z, i) => ({ x: end * CFG.rings.x, y: CFG.rings.ys[i], z }));

export { copy, addTo };
