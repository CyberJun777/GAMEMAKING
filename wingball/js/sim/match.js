// 경기 시뮬레이션 코어. DOM·Three.js 의존 없음 → Node에서 headless 테스트 가능.
import { CFG, attackSign } from '../config.js';
import { add, addTo, clampLen, copy, dirFrom, dist, dot, len, norm, rng, scale, set, sub, v } from './vec.js';
import { canHandleBall, pass, passTargetByAim, releaseBall, shoot, switchRole, tryTackle } from './actions.js';
import { keeperTick, think } from './ai.js';

const ROLE_ORDER = ['keeper', 'runner', 'runner', 'runner', 'breaker', 'breaker', 'hunter'];

function spawnPos(team, role, k) {
  const sgn = -attackSign(team); // 자기 진영 쪽
  switch (role) {
    case 'keeper': return v(sgn * 66, 14, 0);
    case 'runner': return v(sgn * 20, 12 + k * 2, (k - 1) * 12);
    case 'breaker': return v(sgn * 32, 16, k === 0 ? -18 : 18);
    case 'hunter': return v(sgn * 10, 28, 0);
  }
}

export function createMatch({ difficulty = 'normal', seed = 1, humanTeam = 0 } = {}) {
  const s = {
    difficulty, time: 0, over: false, winner: null, endReason: null, orbCatcher: null,
    score: [0, 0], r: rng(seed), events: [], humanId: null, switchCd: 0,
    players: [], stones: [],
    stats: { shots: [0, 0], goals: [0, 0], passes: [0, 0], tackles: [0, 0], steals: [0, 0],
             saves: [0, 0], stoneHits: 0, bats: 0, maxNoTouch: 0 },
    noTouchT: 0,
  };
  for (let team = 0; team < 2; team++) {
    const counts = {};
    for (const role of ROLE_ORDER) {
      const k = (counts[role] = (counts[role] ?? -1) + 1);
      const pos = spawnPos(team, role, k);
      const yaw = team === 0 ? 0 : Math.PI;
      s.players.push({
        id: s.players.length, team, role, k, pos, prev: copy(pos), vel: v(),
        facing: dirFrom(yaw, 0), aimYaw: yaw, aimPitch: 0,
        stunned: 0, stamina: CFG.player.staminaMax, boostDelay: 0, boosting: false, exhausted: false,
        tackleCd: 0, batCd: 0, holdT: 0, catchT: 0, isHuman: false,
        speedMul: team === 1 ? CFG.ai.speed[difficulty] : 1,
        ai: { target: copy(pos), boost: false, thinkT: (s.players.length % 7) * 0.03 },
      });
    }
  }
  if (humanTeam === 0 || humanTeam === 1) {
    const h = s.players.find((p) => p.team === humanTeam && p.role === 'runner' && p.k === 1);
    h.isHuman = true;
    s.humanId = h.id;
  }
  s.comet = { pos: v(0, 14, 0), prev: v(0, 14, 0), vel: v(), holder: null, airborne: false,
              noPickup: { id: -1, t: 0 }, lastTeam: null, passTo: null, shot: null };
  for (let i = 0; i < CFG.stone.count; i++) {
    const pos = v(0, 20 + i * 6, i ? 15 : -15);
    s.stones.push({ pos, prev: copy(pos), vel: v(i ? -10 : 10, 0, 0), target: null, retargetT: 1 + i,
                    hitCd: 0, ownerTeam: null, ownerT: 0 });
  }
  s.orb = { active: false, pos: v(0, -50, 0), prev: v(0, -50, 0), vel: v(), turnT: 0, mul: 1 };
  return s;
}

const roleCfg = (p) => CFG.roles[p.role];
const thinkInterval = (s, p) => (p.team === 1 ? CFG.ai.think[s.difficulty] : CFG.ai.think.normal);

// ─────────────────────────── 이동·경계 ───────────────────────────

function confineArena(pos, vel, bounce) {
  const { rx, rz, ceil, floor } = CFG.arena;
  const q = (pos.x / rx) ** 2 + (pos.z / rz) ** 2;
  if (q > 1) {
    const k = 1 / Math.sqrt(q);
    pos.x *= k; pos.z *= k;
    const n = norm(v(pos.x / (rx * rx), 0, pos.z / (rz * rz)));
    const vn = dot(vel, n);
    if (vn > 0) addTo(vel, n, -(1 + bounce) * vn);
  }
  const lo = bounce > 0 ? 0.5 : floor;
  if (pos.y < lo) { pos.y = lo; if (vel.y < 0) vel.y = -vel.y * bounce; }
  if (pos.y > ceil) { pos.y = ceil; if (vel.y > 0) vel.y = -vel.y * bounce; }
}

function movePlayer(s, p, desired, wantBoost, dt) {
  const P = CFG.player;
  if (p.stunned > 0) {
    p.vel.x *= 0.9; p.vel.z *= 0.9; p.vel.y = -P.stunFall;
  } else {
    const holding = s.comet.holder === p.id;
    if (p.exhausted && p.stamina >= P.exhaustRecover) p.exhausted = false;
    const canBoost = wantBoost && !p.exhausted && p.stamina > 0 && len(desired) > 1;
    p.boosting = canBoost;
    const max = roleCfg(p).maxSpeed * (canBoost ? P.boostMul : 1) * (holding ? P.holdMul : 1) * p.speedMul;
    const want = clampLen(desired, max);
    const dv = clampLen(sub(want, p.vel), roleCfg(p).accel * (canBoost ? 1.5 : 1) * dt);
    addTo(p.vel, dv);
    p.vel = clampLen(p.vel, max);
    if (canBoost) {
      p.stamina = Math.max(0, p.stamina - P.staminaDrain * dt);
      p.boostDelay = P.staminaDelay;
      if (p.stamina === 0) p.exhausted = true;   // 탈진: 깜빡이는 재부스트 방지
    }
  }
  if (!p.boosting) {
    if (p.boostDelay > 0) p.boostDelay -= dt;
    else p.stamina = Math.min(P.staminaMax, p.stamina + P.staminaRegen * dt);
  }
  addTo(p.pos, p.vel, dt);
  confineArena(p.pos, p.vel, 0);
  if (p.isHuman) p.facing = dirFrom(p.aimYaw, p.aimPitch);
  else if (len(p.vel) > 1) p.facing = norm(p.vel);
}

// 정지 목표: 도착 감속 / 움직이는 목표(targetVel 있음): 속도를 맞추며 추격 (감속하면 놓친다)
function steer(p, target, targetVel) {
  const d = sub(target, p.pos);
  const L = len(d);
  const max = roleCfg(p).maxSpeed * 1.5;
  if (targetVel) return add(targetVel, scale(norm(d), Math.min(max, L * 3 + 4)));
  const sp = L < 4 ? (L / 4) * roleCfg(p).maxSpeed : max;
  return scale(norm(d), sp);
}

function humanDesired(p, inp) {
  const max = roleCfg(p).maxSpeed * 1.5;
  const fwd = dirFrom(p.aimYaw, p.aimPitch);
  const right = v(-Math.sin(p.aimYaw), 0, Math.cos(p.aimYaw));
  const m = inp.move || { f: 0, s: 0, u: 0 };
  const f = m.f > 0 ? m.f : m.f * 0.5;
  const d = add(add(scale(fwd, f * max), scale(right, m.s * max * 0.7)), v(0, m.u * max * 0.7, 0));
  return d;
}

// ─────────────────────────── 메인 스텝 ───────────────────────────

export function step(s, input = {}, dt = CFG.dt) {
  if (s.over) return;
  s.events.length = 0;
  s.time += dt;
  s.switchCd = Math.max(0, s.switchCd - dt);

  for (const p of s.players) set(p.prev, p.pos);
  set(s.comet.prev, s.comet.pos);
  for (const st of s.stones) set(st.prev, st.pos);
  set(s.orb.prev, s.orb.pos);

  // 사람 입력 (명령)
  if (s.humanId != null) {
    if (input.switchRole) switchRole(s);
    const h = s.players[s.humanId];
    if (input.yaw != null) h.aimYaw = input.yaw;
    if (input.pitch != null) h.aimPitch = input.pitch;
    if (h.stunned <= 0) {
      const aim = dirFrom(h.aimYaw, h.aimPitch);
      if (input.shoot != null) shoot(s, h, aim, input.shoot);
      if (input.pass) pass(s, h, passTargetByAim(s, h, aim));
      if (input.tackle) tryTackle(s, h);
    }
  }

  // 선수 타이머 · AI 판단 · 이동
  for (const p of s.players) {
    p.stunned = Math.max(0, p.stunned - dt);
    p.tackleCd = Math.max(0, p.tackleCd - dt);
    p.batCd = Math.max(0, p.batCd - dt);
    if (s.comet.holder === p.id) p.holdT += dt; else p.holdT = 0;
    let desired, boost;
    if (p.isHuman) {
      desired = humanDesired(p, input);
      boost = !!input.boost;
    } else if (s.debug && s.debug.freezeOthers) {   // 테스트 전용: 사람 외 선수 정지
      desired = v(); boost = false;
    } else {
      p.ai.thinkT -= dt;
      if (p.ai.thinkT <= 0) { p.ai.thinkT = thinkInterval(s, p); think(s, p); }
      if (p.role === 'keeper') keeperTick(s, p);
      desired = steer(p, p.ai.target, p.ai.targetVel);
      boost = p.ai.boost;
    }
    movePlayer(s, p, desired, boost, dt);
  }
  separatePlayers(s);
  // 밀어내기가 경계/가디언 반경을 깨지 않도록 제약을 마지막에 다시 적용
  for (const p of s.players) {
    confineArena(p.pos, p.vel, 0);
    if (p.role === 'keeper') leashKeeper(p);
  }

  updateComet(s, dt);
  updateStones(s, dt);
  updateOrb(s, dt);
  checkEnd(s);
}

function leashKeeper(p) {
  const home = v(-attackSign(p.team) * CFG.rings.x, 14, 0);
  const d = sub(p.pos, home);
  const L = len(d), max = CFG.roles.keeper.leash;
  if (L > max) {
    set(p.pos, add(home, scale(d, max / L)));
    const n = scale(d, 1 / L);
    const vn = dot(p.vel, n);
    if (vn > 0) addTo(p.vel, n, -vn);
  }
}

function separatePlayers(s) {
  const P = s.players, minD = CFG.player.radius * 2;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const d = sub(P[j].pos, P[i].pos);
    const L = len(d);
    if (L < minD && L > 1e-6) {
      const push = scale(d, ((minD - L) / L) * 0.5);
      addTo(P[i].pos, push, -1);
      addTo(P[j].pos, push, 1);
    }
  }
}

// ─────────────────────────── 코멧볼 ───────────────────────────

function updateComet(s, dt) {
  const c = s.comet, C = CFG.comet;
  if (c.noPickup.t > 0) c.noPickup.t -= dt;

  if (c.holder != null) {
    const h = s.players[c.holder];
    // 링 앞 금지 구역(크리스) 반칙
    const end = attackSign(h.team);
    if (h.pos.x * end > CFG.rings.x - CFG.rings.crease) {
      const keeper = s.players.find((p) => p.team !== h.team && p.role === 'keeper');
      c.holder = keeper.id; keeper.holdT = 0; c.passTo = null; c.shot = null;
      s.stats.creaseFouls = (s.stats.creaseFouls || 0) + 1;
      s.events.push({ t: s.time, type: 'crease', team: h.team, id: h.id });
      return updateComet(s, 0);
    }
    set(c.pos, add(h.pos, scale(h.facing, 1.1)));
    set(c.vel, h.vel);
    c.airborne = false;
    if (h.stunned > 0) releaseBall(s, h, add(scale(h.vel, 0.5), v(0, 2, 0)), 0.6);
  } else {
    if (c.airborne) {
      const sp = len(c.vel);
      if (sp < C.flySpeed) c.vel.y -= C.gravity * dt;
      c.vel = scale(c.vel, 1 - C.drag * dt);
    }
    addTo(c.pos, c.vel, dt);
    checkGoal(s);
    confineArena(c.pos, c.vel, 0.6);
    if (c.pos.y <= 0.51) { c.vel.x *= 0.96; c.vel.z *= 0.96; }

    // 줍기
    let best = null, bd = C.pickup;
    for (const p of s.players) {
      if (!canHandleBall(p) || p.stunned > 0) continue;
      if (c.noPickup.t > 0 && c.noPickup.id === p.id) continue;
      const d = dist(p.pos, c.pos) - (p.role === 'keeper' ? C.keeperReach - C.pickup : 0);
      if (d <= bd) { bd = d; best = p; }
    }
    if (best) {
      if (c.shot && c.shot.team !== best.team && best.role === 'keeper') {
        s.stats.saves[best.team]++;
        s.events.push({ t: s.time, type: 'save', team: best.team, id: best.id });
      }
      c.holder = best.id; c.passTo = null; c.shot = null; c.airborne = false; best.holdT = 0;
    }
  }

  // 교착 감시: 아무도 볼 근처(4u)에 없는 연속 시간
  const near = c.holder != null || s.players.some((p) => dist(p.pos, c.pos) < 4);
  s.noTouchT = near ? 0 : s.noTouchT + dt;
  s.stats.maxNoTouch = Math.max(s.stats.maxNoTouch, s.noTouchT);
}

function checkGoal(s) {
  const c = s.comet, R = CFG.rings;
  for (const end of [1, -1]) {
    const X = end * R.x;
    const a = c.prev.x - X, b = c.pos.x - X;
    if (!(a * end < 0 && b * end >= 0)) continue; // 바깥 방향으로 평면 통과
    const t = a / (a - b);
    const y = c.prev.y + (c.pos.y - c.prev.y) * t;
    const z = c.prev.z + (c.pos.z - c.prev.z) * t;
    for (let i = 0; i < R.zs.length; i++) {
      if (Math.hypot(y - R.ys[i], z - R.zs[i]) < R.radius) {
        const team = end === 1 ? 0 : 1;   // +x 링에 넣으면 청록 득점
        s.score[team] += CFG.comet.goal;
        s.stats.goals[team]++;
        s.events.push({ t: s.time, type: 'goal', team, ring: i });
        const keeper = s.players.find((p) => p.team !== team && p.role === 'keeper');
        c.holder = keeper.id; c.passTo = null; c.shot = null; c.airborne = false; keeper.holdT = 0;
        set(c.pos, keeper.pos); c.vel = v();
        return;
      }
    }
  }
}

// ─────────────────────────── 스톰스톤 ───────────────────────────

function updateStones(s, dt) {
  const S = CFG.stone;
  if (s.debug && s.debug.freezeStones) return;   // 테스트 전용: 입력 검사 중 간섭 제거
  for (const st of s.stones) {
    st.hitCd = Math.max(0, st.hitCd - dt);
    st.ownerT = Math.max(0, st.ownerT - dt);
    st.retargetT -= dt;
    let tgt = st.target != null ? s.players[st.target] : null;
    if (st.retargetT <= 0 || !tgt || tgt.stunned > 0) {
      let best = null, bd = 1e9;
      for (const p of s.players) {
        if (p.stunned > 0) continue;
        const d = dist(p.pos, st.pos);
        if (d < bd) { bd = d; best = p; }
      }
      st.target = best ? best.id : null;
      st.retargetT = S.retarget;
      tgt = best;
    }
    if (st.ownerT <= 0 && tgt) {
      const want = scale(norm(sub(tgt.pos, st.pos)), S.speed);
      addTo(st.vel, clampLen(sub(want, st.vel), S.accel * dt));
      const sp = len(st.vel);
      if (sp > S.speed) st.vel = scale(st.vel, Math.max(S.speed / sp, 1 - 2 * dt));
    }
    addTo(st.pos, st.vel, dt);
    confineArena(st.pos, st.vel, 0.8);
    if (st.pos.y < 2) st.vel.y += 20 * dt;

    // 브레이커 타격
    for (const p of s.players) {
      if (p.role !== 'breaker' || p.stunned > 0 || p.batCd > 0) continue;
      if (st.ownerT > 0 && st.ownerTeam === p.team) continue;
      if (dist(p.pos, st.pos) > S.batRange) continue;
      const foe = pickBatTarget(s, p);
      if (!foe) continue;
      st.vel = scale(norm(sub(add(foe.pos, scale(foe.vel, 0.4)), st.pos)), S.batSpeed);
      st.ownerTeam = p.team; st.ownerT = S.ownerTime; st.target = foe.id; st.retargetT = S.ownerTime + 0.5;
      st.hitCd = 0; p.batCd = S.batCd;
      s.stats.bats++;
      s.events.push({ t: s.time, type: 'bat', team: p.team, id: p.id, at: foe.id });
    }

    // 선수 피격
    if (st.hitCd > 0) continue;
    for (const p of s.players) {
      if (p.stunned > 0) continue;
      if (st.ownerT > 0 && st.ownerTeam === p.team) continue;
      if (dist(p.pos, st.pos) > S.hitRange) continue;
      p.stunned = CFG.player.stunTime;
      st.vel = scale(st.vel, -0.5);
      st.hitCd = S.hitCd; st.ownerT = 0; st.retargetT = 0.6;
      s.stats.stoneHits++;
      s.events.push({ t: s.time, type: 'stun', team: p.team, id: p.id });
      break;
    }
  }
}

function pickBatTarget(s, p) {
  const c = s.comet;
  if (c.holder != null && s.players[c.holder].team !== p.team && s.players[c.holder].stunned <= 0)
    return s.players[c.holder];
  if (s.orb.active) {
    const h = s.players.find((q) => q.team !== p.team && q.role === 'hunter' && q.stunned <= 0);
    if (h) return h;
  }
  let best = null, bd = 1e9;
  for (const q of s.players) {
    if (q.team === p.team || q.stunned > 0) continue;
    const d = dist(q.pos, p.pos);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

// ─────────────────────────── 골든 오브 ───────────────────────────

function updateOrb(s, dt) {
  const o = s.orb, O = CFG.orb;
  if (!o.active) {
    if (s.time >= O.appear) {
      o.active = true;
      const a = s.r() * Math.PI * 2;
      set(o.pos, v(Math.cos(a) * 30, 15 + s.r() * 15, Math.sin(a) * 15));
      set(o.prev, o.pos);
      o.turnT = 0;
      s.events.push({ t: s.time, type: 'orb_appear' });
    }
    return;
  }
  o.mul = s.time > O.slowStart ? Math.max(O.minMul, 1 - O.slowPerMin * (s.time - O.slowStart) / 60) : 1;
  o.turnT -= dt;
  const hunters = s.players.filter((p) => p.role === 'hunter');
  if (o.turnT <= 0) {
    o.turnT = O.turnMin + s.r() * (O.turnMax - O.turnMin);
    let d = norm(v(s.r() * 2 - 1, (s.r() * 2 - 1) * 0.6, s.r() * 2 - 1));
    let near = null, nd = O.fleeRange;
    for (const h of hunters) { const dd = dist(h.pos, o.pos); if (dd < nd) { nd = dd; near = h; } }
    if (near) d = add(d, scale(norm(sub(o.pos, near.pos)), O.fleeWeight));
    const { rx, rz } = CFG.arena;
    const q = (o.pos.x / rx) ** 2 + (o.pos.z / rz) ** 2;
    if (q > 0.55) d = add(d, scale(norm(v(-o.pos.x, 0, -o.pos.z)), 1.5 * q));
    if (o.pos.y < 8) d.y += 1;
    if (o.pos.y > 36) d.y -= 1;
    o.hover = s.r() < O.hoverChance;   // 가끔 잠깐 맴돈다 (헌터에게 기회)
    o.vel = scale(norm(d), O.speed * o.mul * (o.hover ? O.hoverMul : 1));
  } else if (!o.hover) {
    o.vel = scale(norm(o.vel), O.speed * o.mul);
  }
  addTo(o.pos, o.vel, dt);
  confineArena(o.pos, o.vel, 1);

  for (const h of hunters) {
    if (h.stunned <= 0 && dist(h.pos, o.pos) < O.catchRange) h.catchT += dt;
    else h.catchT = 0;
    if (h.catchT >= O.catchHold) {
      s.score[h.team] += O.points;
      s.orbCatcher = h.team;
      s.events.push({ t: s.time, type: 'catch', team: h.team, id: h.id });
      finish(s, 'orb');
      return;
    }
  }
}

function checkEnd(s) {
  if (!s.over && s.time >= CFG.match.hardLimit) finish(s, 'time');
}

function finish(s, reason) {
  s.over = true;
  s.endReason = reason;
  if (s.score[0] !== s.score[1]) s.winner = s.score[0] > s.score[1] ? 0 : 1;
  else s.winner = s.orbCatcher;   // 동점 → 오브 잡은 팀 (없으면 무승부 null)
  s.events.push({ t: s.time, type: 'end', winner: s.winner, reason });
}

// 테스트·디버그용
export function runFor(s, seconds, inputFn) {
  const n = Math.round(seconds / CFG.dt);
  for (let i = 0; i < n && !s.over; i++) step(s, inputFn ? inputFn(s, i) : {});
}
