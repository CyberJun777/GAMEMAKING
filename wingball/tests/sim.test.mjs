// Headless 시뮬레이션 테스트 — design/plan.md 완료 기준 중 (H) 항목.
// 실행: node tests/sim.test.mjs
import { CFG } from '../js/config.js';
import { createMatch, runFor, step } from '../js/sim/match.js';
import { shoot, tryTackle } from '../js/sim/actions.js';
import { dist, v } from '../js/sim/vec.js';

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) pass++; else fail++;
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const freeBall = (s, pos, vel = v()) => {
  const c = s.comet;
  c.holder = null; c.pos = { ...pos }; c.prev = { ...pos }; c.vel = { ...vel }; c.airborne = true;
  c.noPickup = { id: -1, t: 0 }; c.shot = null; c.passTo = null;
};
const clearAround = (s, keepIds, center, r = 25) => {
  // 테스트 대상 외 선수를 멀리 치워 간섭 제거
  for (const p of s.players) if (!keepIds.includes(p.id) && dist(p.pos, center) < r) {
    p.pos = v(0, 40, p.team ? 40 : -40); p.prev = { ...p.pos }; p.vel = v(); p.stunned = 0;
  }
};
const freeze = (s) => { for (const st of s.stones) { st.pos = v(0, 44, 0); st.vel = v(); st.retargetT = 1e9; st.target = null; } };

// ── 1. 경계: 60초 무작위 비행 동안 모든 선수가 경기장 안
{
  const s = createMatch({ seed: 11, humanTeam: 0 });
  let r = 7, out = 0, worst = 0;
  const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let inp = {};
  for (let i = 0; i < 60 * 30; i++) {
    if (i % 15 === 0) inp = { move: { f: 1, s: rnd() * 2 - 1, u: rnd() * 2 - 1 }, boost: rnd() < 0.5, yaw: rnd() * 6.28, pitch: rnd() * 2 - 1 };
    step(s, inp);
    for (const p of s.players) {
      const q = (p.pos.x / CFG.arena.rx) ** 2 + (p.pos.z / CFG.arena.rz) ** 2;
      worst = Math.max(worst, q);
      if (q > 1.0001 || p.pos.y < CFG.arena.floor - 1e-6 || p.pos.y > CFG.arena.ceil + 1e-6) out++;
    }
    if (s.over) break;
  }
  check('경계: 60초 무작위 비행 후 전원 경기장 안', out === 0, `위반 ${out}회, 최대 타원값 ${worst.toFixed(4)}`);
}

// ── 2. 줍기: 빈 볼 2u 이내 → 소유
{
  const s = createMatch({ seed: 2, humanTeam: null });
  freeze(s);
  const p = s.players.find((q) => q.team === 0 && q.role === 'runner');
  clearAround(s, [p.id], p.pos);
  freeBall(s, v(p.pos.x + 1.8, p.pos.y, p.pos.z));
  step(s);
  check('줍기: 빈 코멧볼 1.8u 거리 → 소유권 획득', s.comet.holder === p.id, `holder=${s.comet.holder}`);
  const s2 = createMatch({ seed: 2, humanTeam: null });
  freeze(s2);
  const p2 = s2.players.find((q) => q.team === 0 && q.role === 'runner');
  clearAround(s2, [p2.id], p2.pos);
  p2.vel = v(); p2.ai.thinkT = 1e9; p2.ai.target = { ...p2.pos };
  freeBall(s2, v(p2.pos.x, p2.pos.y + 3, p2.pos.z));
  s2.comet.airborne = false;
  step(s2);
  check('줍기: 3u 거리에서는 소유하지 않음', s2.comet.holder !== p2.id, `holder=${s2.comet.holder}`);
}

// ── 3·4. 링 득점 / 빗나감 / 득점 후 재개
{
  const s = createMatch({ seed: 3, humanTeam: null });
  freeze(s);
  const X = CFG.rings.x, y = CFG.rings.ys[1], z = CFG.rings.zs[1];
  freeBall(s, v(X - 1, y, z), v(40, 0, 0));
  s.comet.noPickup = { id: -1, t: 0 };
  for (const p of s.players) if (p.role === 'keeper') { p.pos = v(p.team ? 60 : -60, 30, 20); p.prev = { ...p.pos }; }
  step(s);
  check('득점: 링 정중앙 통과 → 청록 +10', s.score[0] === 10 && s.stats.goals[0] === 1, `score=${s.score}`);
  const keeper1 = s.players.find((p) => p.team === 1 && p.role === 'keeper');
  check('득점 후 재개: 실점 팀(주황) 가디언이 볼 소유', s.comet.holder === keeper1.id, `holder=${s.comet.holder}`);

  const s2 = createMatch({ seed: 3, humanTeam: null });
  freeze(s2);
  for (const p of s2.players) if (p.role === 'keeper') { p.pos = v(p.team ? 60 : -60, 30, 20); p.prev = { ...p.pos }; }
  freeBall(s2, v(X - 1, y + CFG.rings.radius + 0.6, z), v(40, 0, 0));   // 테두리 바로 밖
  step(s2);
  check('빗나감: 링 테두리 밖 통과 → 0점', s2.score[0] === 0 && s2.score[1] === 0, `score=${s2.score}`);

  const s3 = createMatch({ seed: 3, humanTeam: null });
  freeze(s3);
  for (const p of s3.players) if (p.role === 'keeper') { p.pos = v(p.team ? 60 : -60, 30, 20); p.prev = { ...p.pos }; }
  freeBall(s3, v(-X + 1, CFG.rings.ys[0], CFG.rings.zs[0]), v(-40, 0, 0));
  step(s3);
  check('득점: -x 링 통과 → 주황 +10', s3.score[1] === 10, `score=${s3.score}`);
}

// ── 5. 태클: 성공 시 소유권 이동 + 2초 쿨다운
{
  const s = createMatch({ seed: 5, humanTeam: null });
  freeze(s);
  const h = s.players.find((q) => q.team === 1 && q.role === 'runner');
  const a = s.players.find((q) => q.team === 0 && q.role === 'runner');
  s.comet.holder = h.id;
  a.pos = { x: h.pos.x - 2, y: h.pos.y, z: h.pos.z };
  const realR = s.r; s.r = () => 0;   // 성공 확정
  const ok = tryTackle(s, a);
  check('태클: 성공 시 소유권이 태클한 선수에게', ok && s.comet.holder === a.id, `holder=${s.comet.holder}`);
  s.comet.holder = h.id;
  const again = tryTackle(s, a);
  check('태클: 쿨다운 2초 안 재태클 불가', !again && s.comet.holder === h.id && Math.abs(a.tackleCd - 2) < 1e-9);
  a.tackleCd = 0;
  s.r = () => 0.99;   // 실패 확정
  const miss = tryTackle(s, a);
  check('태클: 실패 시 소유권 유지 + 쿨다운 적용', !miss && s.comet.holder === h.id && a.tackleCd > 0);
  s.r = realR;
}

// ── 6~10, 13. 전체 경기 시나리오 (AI vs AI, 여러 시드)
{
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  let allShoot = true, allScore = true, leashMax = 0, maxNoTouch = 0, hitIn60 = true, batIn60 = true, endBy = true, latest = 0;
  const detail = [];
  for (const seed of seeds) {
    const s = createMatch({ seed, humanTeam: null });
    let firstHit = null, firstBat = null;
    while (!s.over) {
      step(s);
      for (const e of s.events) {
        if (e.type === 'stun' && firstHit == null) firstHit = s.time;
        if (e.type === 'bat' && firstBat == null) firstBat = s.time;
      }
      for (const p of s.players) if (p.role === 'keeper') {
        const home = v((p.team === 0 ? -1 : 1) * CFG.rings.x, 14, 0);
        leashMax = Math.max(leashMax, dist(p.pos, home));
      }
      if (s.time > 600) break;
    }
    if (s.stats.shots[0] < 1 || s.stats.shots[1] < 1) allShoot = false;
    if (s.stats.goals[0] + s.stats.goals[1] < 1) allScore = false;
    if (firstHit == null || firstHit > 60) hitIn60 = false;
    if (firstBat == null || firstBat > 60) batIn60 = false;
    if (!s.over || s.time > CFG.match.hardLimit + 1e-6) endBy = false;
    maxNoTouch = Math.max(maxNoTouch, s.stats.maxNoTouch);
    latest = Math.max(latest, s.time);
    detail.push(`s${seed}:${Math.round(s.time)}s ${s.score.join('-')}`);
  }
  check('AI: 양 팀 러너가 매 경기 슛을 1회 이상', allShoot);
  check('AI: 매 경기 득점이 1회 이상 발생', allScore, detail.join(' '));
  check('AI: 가디언이 링 앞 반경 14u 밖으로 나가지 않음', leashMax <= CFG.roles.keeper.leash + 1e-6, `최대 ${leashMax.toFixed(3)}u`);
  check('스톰스톤: 60초 안에 선수 피격 발생', hitIn60);
  check('브레이커: 60초 안에 스톤 타격 발생', batIn60);
  check('교착 없음: 볼 근처 4u에 아무도 없는 구간 < 30초', maxNoTouch < 30, `최대 ${maxNoTouch.toFixed(1)}s`);
  check('9분 안에 반드시 종료', endBy, `가장 긴 경기 ${latest.toFixed(1)}s`);
}

// ── 8b. 스톤 피격 → 1.2초 기절 + 볼 떨어뜨림
{
  const s = createMatch({ seed: 9, humanTeam: null });
  const p = s.players.find((q) => q.team === 0 && q.role === 'runner');
  clearAround(s, [p.id], p.pos, 30);
  s.comet.holder = p.id;
  const st = s.stones[0];
  st.pos = { x: p.pos.x + 1.0, y: p.pos.y, z: p.pos.z }; st.prev = { ...st.pos }; st.vel = v(-5, 0, 0);
  st.hitCd = 0; st.ownerT = 0;
  s.stones[1].pos = v(0, 44, 40);
  step(s);
  check('피격: 기절 1.2초 적용', Math.abs(p.stunned - CFG.player.stunTime) < CFG.dt + 1e-9, `stunned=${p.stunned.toFixed(3)}`);
  step(s);
  check('피격: 들고 있던 코멧볼을 떨어뜨림', s.comet.holder !== p.id, `holder=${s.comet.holder}`);
  const y0 = p.pos.y;
  runFor(s, 0.5);
  check('피격: 기절 중 하강', p.pos.y < y0, `${y0.toFixed(2)} → ${p.pos.y.toFixed(2)}`);
  runFor(s, 0.8);
  check('피격: 1.2초 후 회복', p.stunned === 0);
}

// ── 11. 골든 오브 등장 시각
{
  const s = createMatch({ seed: 4, humanTeam: null });
  let activeBefore = false;
  while (s.time < CFG.orb.appear - CFG.dt * 1.5) { step(s); if (s.orb.active) activeBefore = true; if (s.over) break; }
  check('골든 오브: 90초 전에는 없음', !activeBefore && !s.orb.active, `t=${s.time.toFixed(2)}`);
  runFor(s, CFG.dt * 3);
  check('골든 오브: 90초에 등장', s.orb.active && s.time < CFG.orb.appear + 0.2, `t=${s.time.toFixed(2)}`);
}

// ── 12. 헌터 포획 → +100 & 즉시 종료
{
  const s = createMatch({ seed: 6, humanTeam: null });
  runFor(s, 91);
  const hunter = s.players.find((q) => q.team === 1 && q.role === 'hunter');
  const before = s.score[1];
  let steps = 0;
  while (!s.over && steps < 30) {
    hunter.pos = { ...s.orb.pos }; hunter.stunned = 0;
    step(s); steps++;
  }
  check('포획: 1.5u 안 0.3초 유지 → +100 & 종료', s.over && s.endReason === 'orb' && s.score[1] - before === 100 && s.orbCatcher === 1,
    `over=${s.over} reason=${s.endReason} +${s.score[1] - before} steps=${steps}`);
  check('포획: 0.3초(≈9~10스텝) 유지 필요', steps >= 9 && steps <= 11, `steps=${steps}`);
  check('포획 후 step 호출해도 상태 불변', (() => { const t = s.time; step(s); return s.time === t; })());
}

// ── 14. 승자 판정
{
  const mk = () => { const s = createMatch({ seed: 8, humanTeam: null }); s.time = CFG.match.hardLimit - CFG.dt / 2; return s; };
  let s = mk(); s.score = [30, 20]; step(s);
  check('판정: 시간 종료, 점수 높은 청록 승', s.over && s.endReason === 'time' && s.winner === 0);
  s = mk(); s.score = [20, 50]; step(s);
  check('판정: 시간 종료, 점수 높은 주황 승', s.winner === 1);
  s = mk(); s.score = [40, 40]; s.orbCatcher = 1; step(s);
  check('판정: 동점 → 오브 잡은 팀 승', s.winner === 1);
  s = mk(); s.score = [40, 40]; step(s);
  check('판정: 동점 + 오브 없음 → 무승부', s.over && s.winner === null);
}

// ── 추가: 금지 구역 반칙, 사람 슛
{
  const s = createMatch({ seed: 10, humanTeam: null });
  freeze(s);
  const p = s.players.find((q) => q.team === 0 && q.role === 'runner');
  s.comet.holder = p.id;
  p.ai.thinkT = 1e9;   // AI가 금지 구역 직전에 먼저 슛해 버리지 않도록 판단 정지
  p.pos = v(CFG.rings.x - CFG.rings.crease + 1, 14, 0);
  step(s);
  const k1 = s.players.find((q) => q.team === 1 && q.role === 'keeper');
  check('금지 구역: 볼을 들고 진입 → 상대 가디언 볼', s.comet.holder === k1.id, `holder=${s.comet.holder}`);

  const s2 = createMatch({ seed: 10, humanTeam: 0 });
  const h = s2.players[s2.humanId];
  s2.comet.holder = h.id;
  step(s2, { shoot: 1, yaw: 0, pitch: 0 });
  const sp = Math.hypot(s2.comet.vel.x, s2.comet.vel.y, s2.comet.vel.z);
  check('사람 슛: 풀차지 → 볼이 조준 방향(+x)으로 ~55u/s', s2.comet.holder == null && s2.comet.vel.x > 40 && sp > 50 && sp <= 56, `v=${sp.toFixed(1)}`);
}

// ── 밸런스 기록 (단언 아님, 참고 수치)
{
  let g = 0, T = 0;
  for (let seed = 100; seed < 120; seed++) { const s = createMatch({ seed, humanTeam: null }); runFor(s, 600); g += s.stats.goals[1]; T += s.time; }
  results.push(`INFO  밸런스: 주황(AI, 보통) 6분당 ${(g / T * 360).toFixed(1)}골 (목표 3~6)`);
}

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
