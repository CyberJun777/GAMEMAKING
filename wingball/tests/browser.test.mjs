// 브라우저 테스트 — design/plan.md 완료 기준 중 (B) 항목 + 콘솔 에러 + 성능 예산.
// 실행: (wingball 폴더에서) python3 -m http.server 8123 & node tests/browser.test.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8123/';
const SHOTS = process.env.SHOTS || '';   // 스크린샷 저장 폴더(선택)
let pass = 0, fail = 0;
const out = [];
const check = (name, cond, detail = '') => { cond ? pass++ : fail++; out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleIssues = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleIssues.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => consoleIssues.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => consoleIssues.push(`requestfailed: ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) consoleIssues.push(`http ${r.status()}: ${r.url()}`); });

const G = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
// 게임 시간 기준 대기 (소프트웨어 렌더러는 프레임이 멈출 수 있어 벽시계 기준은 부정확)
const waitSim = async (sec) => {
  const t0 = await page.evaluate(() => __wingball.state.time);
  await page.waitForFunction((t) => __wingball.state.time >= t, t0 + sec, { timeout: 60000, polling: 16 });
};
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

await page.goto(BASE + '?quality=high');
await page.waitForFunction(() => window.__wingball && window.__wingball.state.time > 0.5, null, { timeout: 20000 });
check('부팅: 시작 화면 표시 + 뒤에서 AI 시연 진행', await G(() => !document.getElementById('startScreen').classList.contains('hidden') && __wingball.mode === 'menu'));
await shot('01_menu');

await page.click('#startBtn');
await wait(300);
check('시작: 경기 모드 진입, HUD 표시, 사람 선수 지정', await G(() => __wingball.mode === 'play' && !document.getElementById('hud').classList.contains('hidden') && __wingball.state.humanId != null));

// 스톤 간섭 제거 유틸 (입력 검사 동안만)
const calm = () => G(() => { const s = __wingball.state; s.debug = { freezeStones: true, freezeOthers: true }; for (const st of s.stones) { st.pos = { x: 0, y: 44, z: 40 }; st.prev = { ...st.pos }; st.vel = { x: 0, y: 0, z: 0 }; } for (const p of s.players) p.stunned = 0; });
const uncalm = () => G(() => { __wingball.state.debug = null; });

// ── 1. W 1초 → 바라보는 방향으로 이동, 최고속도 22 이하
await calm();
const before = await G(() => { const s = __wingball.state, h = s.players[s.humanId]; __wingball.input.view.yaw = 0; __wingball.input.view.pitch = 0; return { ...h.pos }; });
await page.keyboard.down('KeyW');
let maxSpd = 0;
for (let i = 0; i < 10; i++) { await waitSim(0.1); maxSpd = Math.max(maxSpd, await G(() => { const s = __wingball.state, h = s.players[s.humanId]; return Math.hypot(h.vel.x, h.vel.y, h.vel.z); })); }
await page.keyboard.up('KeyW');
const after = await G(() => { const s = __wingball.state; return { ...s.players[s.humanId].pos }; });
const holding = await G(() => __wingball.state.comet.holder === __wingball.state.humanId);
check('비행: W 1초 → 바라보는 방향(+x)으로 전진', after.x - before.x > 5, `Δx=${(after.x - before.x).toFixed(1)}`);
check('비행: 최고속도 22u/s 이하', maxSpd <= 22.01, `최대 ${maxSpd.toFixed(2)}${holding ? ' (볼 소유)' : ''}`);

// ── 2. Shift 부스트: 속도 1.5배, 스태미나 소모, 0이면 멈춤
await calm();
await G(() => { const s = __wingball.state, h = s.players[s.humanId]; h.pos = { x: -60, y: 20, z: 0 }; h.prev = { ...h.pos }; h.stamina = 100; if (s.comet.holder === h.id) s.comet.holder = null; s.comet.pos = { x: 50, y: 5, z: 30 }; });
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
let boostMax = 0, staminaMin = 100, seenEmpty = false;
for (let i = 0; i < 80 && !seenEmpty; i++) {
  await waitSim(0.1);
  const r = await G(() => { const s = __wingball.state, h = s.players[s.humanId]; __wingball.input.view.yaw = 0; __wingball.input.view.pitch = 0; if (h.pos.x > 50) { h.pos.x = -60; h.prev.x = -60; h.pos.z = 0; h.prev.z = 0; } return { sp: Math.hypot(h.vel.x, h.vel.y, h.vel.z), st: h.stamina }; });
  boostMax = Math.max(boostMax, r.sp); staminaMin = Math.min(staminaMin, r.st);
  if (r.st === 0) seenEmpty = true;
}
// 0 도달 후 Shift를 계속 누른 채 관찰 — 탈진(exhausted) 동안에는 부스트가 절대 켜지면 안 된다
let reBoost = false, speedAtEmpty = 99, exStart = null, exEnd = null;
for (let i = 0; i < 40; i++) {
  await waitSim(0.05);
  const r = await G(() => { const s = __wingball.state, h = s.players[s.humanId]; if (h.pos.x > 50) { h.pos.x = -60; h.prev.x = -60; }
    return { ex: h.exhausted, b: h.boosting, sp: Math.hypot(h.vel.x, h.vel.y, h.vel.z), t: s.time }; });
  if (!r.ex) break;                  // 25까지 회복 → 탈진 해제 (정상)
  exStart ??= r.t; exEnd = r.t;
  if (r.b) reBoost = true;
  speedAtEmpty = r.sp;               // 탈진 중 마지막 속도 (부스트 없이 감속 완료됐는지)
}
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
const boostingNow = reBoost;
check('부스트: 속도가 최고속도의 1.5배(33)까지 상승', boostMax > 28 && boostMax <= 33.01, `최대 ${boostMax.toFixed(1)}`);
check('부스트: 스태미나가 줄어 0에 도달', seenEmpty, `최저 ${staminaMin.toFixed(1)}`);
check('부스트: 스태미나 0이면 부스트 정지 (탈진 중 재부스트 없음, 속도 ≤ 22)', exEnd - exStart >= 1.0 && speedAtEmpty <= 22.01 && !boostingNow, `탈진 관찰 ${(exEnd - exStart).toFixed(1)}s(게임 시간), 마지막 속도 ${speedAtEmpty.toFixed(1)}, 재부스트=${boostingNow}`);

// ── 3. E 패스 → 시선에 가장 가까운 동료가 받는다
await calm();
const passRes = await G(() => {
  const s = __wingball.state, h = s.players[s.humanId];
  const mate = s.players.find((q) => q.team === h.team && q.role === 'runner' && q.id !== h.id);
  h.pos = { x: -20, y: 15, z: 0 }; h.prev = { ...h.pos }; h.vel = { x: 0, y: 0, z: 0 };
  mate.pos = { x: -5, y: 15, z: 6 }; mate.prev = { ...mate.pos }; mate.vel = { x: 0, y: 0, z: 0 };
  mate.ai.thinkT = 1e9; mate.ai.target = { ...mate.pos }; mate.ai.targetVel = null;   // 받기 전 자리 이동·재패스 방지(테스트 고립)
  for (const q of s.players) if (q.team !== h.team) { q.pos = { x: q.pos.x, y: 42, z: 40 }; q.prev = { ...q.pos }; }
  s.comet.holder = h.id; h.holdT = 0;
  __wingball.input.view.yaw = Math.atan2(mate.pos.z - h.pos.z, mate.pos.x - h.pos.x); __wingball.input.view.pitch = 0;
  return mate.id;
});
await page.keyboard.press('KeyE');
const recv = await page.waitForFunction((id) => __wingball.state.comet.holder === id, passRes, { timeout: 30000, polling: 16 })
  .then(() => passRes).catch(() => page.evaluate(() => __wingball.state.comet.holder));
await G(() => { const s = __wingball.state; for (const p of s.players) if (!p.isHuman) p.ai.thinkT = 0; });   // AI 복구
check('패스: E → 시선 방향 동료가 볼을 받음', recv === passRes, `holder=${recv}, 기대=${passRes}`);

// ── 4. 좌클릭 슛 (차지)
await calm();
await page.mouse.move(640, 360);   // 커서 이동이 시선을 돌리지 않도록 먼저 옮겨 둔다
await wait(100);
await G(() => { const s = __wingball.state, h = s.players[s.humanId];
  h.pos = { x: -30, y: 15, z: 0 }; h.prev = { ...h.pos };
  for (const q of s.players) if (q.team !== h.team) { q.pos = { x: q.pos.x, y: 42, z: 40 }; q.prev = { ...q.pos }; }   // 차지 중 스틸 방지
  s.comet.holder = h.id; __wingball.input.view.yaw = 0; __wingball.input.view.pitch = 0.05; });
await page.mouse.down();
await wait(600);
const chargeUI = await G(() => document.getElementById('crosshair').classList.contains('charging'));
await page.mouse.up();
await waitSim(0.07);   // 슛 입력이 최소 1스텝 처리될 때까지 (게임 시간 기준)
const shotRes = await G(() => { const c = __wingball.state.comet; return { free: c.holder == null, sp: Math.hypot(c.vel.x, c.vel.y, c.vel.z), vx: c.vel.x }; });
check('슛: 좌클릭 홀드 시 차지 게이지 표시', chargeUI);
check('슛: 놓으면 볼이 조준 방향으로 발사 (차지 ~0.6 → 40~50u/s)', shotRes.free && shotRes.vx > 25 && shotRes.sp > 38 && shotRes.sp < 52, `v=${shotRes.sp.toFixed(1)}`);
// 포인터 락 해제(슛 클릭으로 걸렸을 수 있음) 시 일시정지되면 복귀
if (await G(() => __wingball.mode === 'paused')) await G(() => __wingball.setPaused(false));

// ── 5. Tab 전환 + 3초 쿨다운
await G(() => { const s = __wingball.state; s.time = Math.max(s.time, 92); });   // 오브 등장 이후로
await waitSim(0.15);
const r0 = await G(() => __wingball.state.players[__wingball.state.humanId].role);
await page.keyboard.press('Tab'); await waitSim(0.1);
const r1 = await G(() => __wingball.state.players[__wingball.state.humanId].role);
await page.keyboard.press('Tab'); await waitSim(0.1);
const r2 = await G(() => __wingball.state.players[__wingball.state.humanId].role);
await waitSim(3.1);
await page.keyboard.press('Tab'); await waitSim(0.1);
const r3 = await G(() => __wingball.state.players[__wingball.state.humanId].role);
check('전환: Tab → 러너에서 헌터로', r0 === 'runner' && r1 === 'hunter', `${r0}→${r1}`);
check('전환: 3초 쿨다운 중 재전환 불가', r2 === 'hunter', `즉시 Tab 후 ${r2}`);
check('전환: 쿨다운 후 다시 러너로', r3 === 'runner', `${r3}`);

// ── 6. HUD가 실제 상태와 일치
await wait(300);
const hud = await G(() => {
  const s = __wingball.state, h = s.players[s.humanId];
  const t = Math.floor(s.time);
  const clock = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const mini = document.getElementById('minimap');
  const data = mini.getContext('2d').getImageData(0, 0, mini.width, mini.height).data;
  let teal = 0; for (let i = 0; i < data.length; i += 4) if (data[i] < 60 && data[i + 1] > 150 && data[i + 2] > 140) teal++;
  return {
    s0: document.getElementById('score0').textContent === String(s.score[0]),
    s1: document.getElementById('score1').textContent === String(s.score[1]),
    clock: Math.abs(parseInt(document.getElementById('clock').textContent.slice(3)) - parseInt(clock.slice(3))) <= 1,
    st: Math.abs(parseFloat(document.getElementById('staminaFill').style.width) - h.stamina) < 3,
    role: document.getElementById('role').textContent.startsWith(h.role === 'runner' ? '러너' : '헌터'),
    teal,
  };
});
check('HUD: 스코어보드가 state.score와 일치', hud.s0 && hud.s1);
check('HUD: 경기 시계가 state.time과 일치', hud.clock);
check('HUD: 스태미나 바·역할 표시가 일치', hud.st && hud.role);
check('HUD: 미니맵에 선수 점이 그려짐', hud.teal > 20, `청록 픽셀 ${hud.teal}`);

// ── 7. 화면 밖 볼/오브 → 가장자리 화살표
await G(() => { const s = __wingball.state, h = s.players[s.humanId]; if (s.comet.holder === h.id) s.comet.holder = null;
  __wingball.input.view.yaw = Math.atan2(s.comet.pos.z - h.pos.z, s.comet.pos.x - h.pos.x) + Math.PI; __wingball.input.view.pitch = 0; });
await wait(700);
const arrows = await G(() => ({ comet: getComputedStyle(document.getElementById('arrowComet')).display, orb: getComputedStyle(document.getElementById('arrowOrb')).display,
  orbBehind: (() => { const s = __wingball.state; const p = __wingball.gfx.project(s.orb.pos); return p.behind || Math.abs(p.x) > 1 || Math.abs(p.y) > 1; })() }));
check('화살표: 등 뒤의 코멧볼 방향 화살표 표시', arrows.comet === 'block');
check('화살표: 오브가 화면 밖이면 오브 화살표 표시', !arrows.orbBehind || arrows.orb === 'block', `orb밖=${arrows.orbBehind} display=${arrows.orb}`);
await shot('02_play');

await uncalm();
// ── 8. 성능: 최악 장면 (14명 한 링 앞 밀집 + 스톤 + 오브 + 파티클 + 관중 전체 시야)
const perf = await G(async () => {
  const s = __wingball.state;
  s.players.forEach((p, i) => { p.pos = { x: 55 + (i % 4) * 2, y: 12 + (i % 3) * 2, z: -6 + (i >> 2) * 3 }; p.prev = { ...p.pos }; p.boosting = true; });
  s.stones.forEach((st, i) => { st.pos = { x: 58, y: 16 + i, z: 4 }; });
  s.orb.active = true; s.orb.pos = { x: 60, y: 18, z: 0 };
  __wingball.gfx.onEvent(s, { type: 'goal', team: 0, ring: 1 });
  __wingball.gfx.onEvent(s, { type: 'catch', team: 0 });
  const h = s.players[s.humanId];
  h.pos = { x: 20, y: 25, z: 0 }; h.prev = { ...h.pos };
  __wingball.input.view.yaw = 0; __wingball.input.view.pitch = -0.15;
  __wingball.setPaused(true);           // 상태 고정 후 몇 프레임 렌더
  await new Promise((r) => setTimeout(r, 600));
  let calls = 0, tris = 0;
  for (let i = 0; i < 5; i++) { await new Promise((r) => requestAnimationFrame(r)); const d = __wingball.drawInfo(); calls = Math.max(calls, d.calls); tris = Math.max(tris, d.triangles); }
  // 측정용: 일시정지 오버레이가 프레임 측정에 영향 없음 (DOM)
  const t0 = performance.now(); let frames = 0;
  while (performance.now() - t0 < 1000) { await new Promise((r) => requestAnimationFrame(r)); frames++; }
  __wingball.setPaused(false);
  return { calls, tris, frames, lowSpec: __wingball.gfx.lowSpec };
});
check('성능: 최악 장면 draw call ≤ 200', perf.calls <= 200, `${perf.calls} calls (quality=high, 그림자 포함)`);
check('성능: 최악 장면 삼각형 ≤ 30만', perf.tris <= 300000, `${perf.tris} tris`);
out.push(`INFO  소프트웨어 렌더러(SwiftShader) fps: ${perf.frames} — GPU 없는 CI 환경이라 실기기 fps 지표 아님`);
await shot('03_worst');

// ── 9. 경기 종료 오버레이 + 다시하기
await G(() => { const s = __wingball.state; s.score = [50, 20]; s.time = 539.9; });
await page.waitForFunction(() => __wingball.mode === 'over', null, { timeout: 5000 }).catch(() => {});
const endUI = await G(() => ({ mode: __wingball.mode, visible: !document.getElementById('endScreen').classList.contains('hidden'),
  title: document.getElementById('endTitle').textContent, score: document.getElementById('endScore').textContent }));
check('종료: 오버레이 + 결과(승리) + 최종 점수 표시', endUI.mode === 'over' && endUI.visible && endUI.title === '승리!' && endUI.score.includes('50'), JSON.stringify(endUI));
await shot('04_end');
await page.click('#restartBtn');
await wait(500);
const restarted = await G(() => ({ mode: __wingball.mode, t: __wingball.state.time, score: __wingball.state.score.join(','), hidden: document.getElementById('endScreen').classList.contains('hidden') }));
check('종료: 다시하기 → 새 경기(0:0, 시간 리셋)', restarted.mode === 'play' && restarted.t < 2 && restarted.score === '0,0' && restarted.hidden, JSON.stringify(restarted));

// ── 10. 실제 플레이 15초 (사람 입력 섞어서) 후에도 정상
await page.keyboard.down('KeyW');
for (let i = 0; i < 15; i++) { await page.keyboard.press(i % 3 ? 'KeyE' : 'KeyF'); await wait(1000); if (await G(() => __wingball.mode === 'paused')) await G(() => __wingball.setPaused(false)); }
await page.keyboard.up('KeyW');
const alive = await G(() => ({ t: __wingball.state.time, mode: __wingball.mode }));
check('연속 플레이 15초: 시뮬레이션 진행 + 모드 유지', alive.t > 12 && (alive.mode === 'play' || alive.mode === 'over'), JSON.stringify(alive));

// ── 11. 콘솔 에러·경고 0건 (전 과정)
check('콘솔: 부팅→플레이→종료→다시하기 전 과정 에러·경고 0건', consoleIssues.length === 0, consoleIssues.slice(0, 5).join(' | '));

await browser.close();
console.log(out.join('\n'));
console.log(`\n${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
