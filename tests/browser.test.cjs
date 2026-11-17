// 브라우저 테스트 — 기획서 ⑥ 완료 기준 22~28 (+ 승패 오버레이)
// 실행: python3 -m http.server 8765 & node tests/browser.test.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const URL = process.env.URL || 'http://localhost:8765/?seed=11';
const results = [];
const logs = [];

async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
  page.on('response', r => { if (r.status() >= 400) logs.push(`http ${r.status()} ${r.url()}`); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__app && window.__app.renderer.stats().calls > 0);

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const screenOf = (id) => ev((id) => { const a = window.__app; const u = a.game.unitById(id); return a.renderer.toScreen(u.x, 0.25, u.z); }, id);
  const cellScreen = (cx, cy) => ev(([cx, cy]) => window.__app.renderer.toScreen(cx - 7.5, 0, cy - 7.5), [cx, cy]);
  const text = (sel) => page.locator(sel).innerText();

  await check('부팅: 캔버스 렌더 + 초기 HUD', async () => {
    assert.equal(await page.locator('#view canvas').count(), 1);
    assert.equal(await text('#round'), '0/40');
    assert.equal(await text('#minerals'), '200');
  });

  await check('24a. D 키 뽑기 (버튼과 동일)', async () => {
    await page.keyboard.press('KeyD');
    await page.keyboard.press('KeyD');
    const s = await ev(() => ({ u: window.__app.game.units.length, m: window.__app.game.minerals }));
    assert.equal(s.u, 2); assert.equal(s.m, 100);
    await page.click('#bDraw');
    assert.equal(await ev(() => window.__app.game.units.length), 3);
  });

  // 유닛을 원하는 칸에 배치해 두고 조작 테스트
  await ev(() => {
    const g = window.__app.game; window.__app.paused = true;
    for (const u of [...g.units]) g.removeUnit(u);
    g.addUnit('m0', 4, 4); g.addUnit('m0', 6, 4); g.addUnit('b1', 8, 8); g.addUnit('a0', 10, 10);
    g.minerals = 1000; g.gas = 1000;
  });
  await page.waitForTimeout(200);

  await check('22a. 클릭으로 1기 선택 → 선택 정보 갱신', async () => {
    const id = await ev(() => window.__app.game.unitAt(8, 8).id);
    const p = await screenOf(id);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(150);
    assert.deepEqual(await ev(() => [...window.__app.selection]), [id]);
    assert.match(await text('#sel'), /산성거미/);
  });

  await check('22b. 드래그 박스로 여러 기 선택', async () => {
    const a = await cellScreen(3, 3), b = await cellScreen(7, 5);
    await page.mouse.move(Math.min(a.x, b.x) - 30, Math.min(a.y, b.y) - 30);
    await page.mouse.down();
    await page.mouse.move(Math.max(a.x, b.x) + 30, Math.max(a.y, b.y) + 30, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const types = await ev(() => [...window.__app.selection].map(id => window.__app.game.unitById(id).type).sort());
    assert.deepEqual(types, ['m0', 'm0']);
    assert.match(await text('#sel'), /외 1기/);
  });

  await check('22c. 더블클릭으로 같은 종류 전체 선택', async () => {
    await page.keyboard.press('Escape');
    const id = await ev(() => window.__app.game.unitAt(4, 4).id);
    const p = await screenOf(id);
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(150);
    assert.equal(await ev(() => window.__app.selection.size), 2);
  });

  await check('23. 우클릭: 빈 칸 이동 O, 길·찬 칸 이동 X', async () => {
    const id = await ev(() => window.__app.game.unitAt(10, 10).id);
    let p = await screenOf(id);
    await page.mouse.click(p.x, p.y);
    const path = await cellScreen(14, 10);
    await page.mouse.click(path.x, path.y, { button: 'right' });
    assert.deepEqual(await ev((id) => { const u = window.__app.game.unitById(id); return [u.cx, u.cy]; }, id), [10, 10], '길로 이동하면 안 됨');
    const full = await cellScreen(8, 8);
    await page.mouse.click(full.x, full.y, { button: 'right' });
    assert.deepEqual(await ev((id) => { const u = window.__app.game.unitById(id); return [u.cx, u.cy]; }, id), [10, 10], '찬 칸으로 이동하면 안 됨');
    const empty = await cellScreen(11, 12);
    await page.mouse.click(empty.x, empty.y, { button: 'right' });
    assert.deepEqual(await ev((id) => { const u = window.__app.game.unitById(id); return [u.cx, u.cy]; }, id), [11, 12]);
  });

  await check('24b. F 합성 / G 판매', async () => {
    const id = await ev(() => window.__app.game.unitAt(4, 4).id);
    const p = await screenOf(id);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('KeyF');
    const after = await ev(() => ({ n: window.__app.game.units.length, sel: [...window.__app.selection].map(i => window.__app.game.unitById(i).def.grade) }));
    assert.equal(after.n, 3); assert.deepEqual(after.sel, [1], '합성 결과(희귀)가 선택됨');
    const m0 = await ev(() => window.__app.game.minerals);
    await page.keyboard.press('KeyG');
    const s = await ev(() => ({ n: window.__app.game.units.length, m: window.__app.game.minerals }));
    assert.equal(s.n, 2); assert.equal(s.m - m0, 60);
  });

  await check('24c. 1/2/3 업그레이드, Z 미션, Space 일시정지, Tab 배속', async () => {
    await page.keyboard.press('Digit1'); await page.keyboard.press('Digit2'); await page.keyboard.press('Digit3');
    assert.deepEqual(await ev(() => window.__app.game.upgrades), { mech: 1, bio: 1, arc: 1 });
    await page.keyboard.press('KeyZ');
    assert.ok(await ev(() => !!window.__app.game.mission));
    const p0 = await ev(() => window.__app.paused);
    await page.keyboard.press('Space');
    assert.equal(await ev(() => window.__app.paused), !p0);
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    assert.equal(await ev(() => window.__app.speed), 2);
    await page.keyboard.press('Tab');
    assert.equal(await ev(() => window.__app.speed), 1);
  });

  await check('회귀: 버튼을 클릭한 뒤 Space를 눌러도 버튼이 다시 눌리지 않음', async () => {
    await ev(() => { window.__app.paused = true; });
    await page.click('#bDraw');
    const n = await ev(() => window.__app.game.units.length);
    await page.keyboard.press('Space'); await page.keyboard.press('Space');
    assert.equal(await ev(() => window.__app.game.units.length), n);
    assert.equal(await ev(() => window.__app.paused), true);
  });

  await check('24d. 방향키는 카메라만 움직임 (게임 상태 불변)', async () => {
    const before = await ev(() => ({ cam: window.__app.renderer.camTarget.x, m: window.__app.game.minerals, n: window.__app.game.units.length, sel: window.__app.selection.size }));
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(400); await page.keyboard.up('ArrowRight');
    const after = await ev(() => ({ cam: window.__app.renderer.camTarget.x, m: window.__app.game.minerals, n: window.__app.game.units.length, sel: window.__app.selection.size }));
    assert.ok(after.cam > before.cam + 0.5, `카메라 이동 ${before.cam} → ${after.cam}`);
    assert.equal(after.m, before.m); assert.equal(after.n, before.n); assert.equal(after.sel, before.sel);
    await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(400); await page.keyboard.up('ArrowLeft');
  });

  await check('25. HUD 숫자 = 게임 상태 (플레이 10초 후)', async () => {
    await ev(() => { const a = window.__app; a.paused = false; a.speed = 2; for (let i = 0; i < 10; i++) a.game.draw(); });
    await page.waitForTimeout(6000);
    await ev(() => { window.__app.paused = true; });
    await page.waitForTimeout(300);
    const s = await ev(() => { const g = window.__app.game; return { r: g.round, m: Math.floor(g.minerals), gas: Math.floor(g.gas), n: g.normalCount, c: g.countsByType() }; });
    assert.equal(await text('#round'), `${s.r}/40`);
    assert.equal((await text('#minerals')).replace(/,/g, ''), String(s.m));
    assert.equal((await text('#gas')).replace(/,/g, ''), String(s.gas));
    assert.equal(await text('#gaugeText'), `${s.n} / 70`);
    for (const [type, c] of Object.entries(s.c)) {
      assert.equal(await page.locator(`.dx[data-type="${type}"] .c`).innerText(), String(c), `도감 ${type}`);
    }
  });

  await check('28. 최악 장면 성능 예산 (draw call ≤ 200, 삼각형 ≤ 40만)', async () => {
    const r = await ev(async () => {
      const a = window.__app, g = a.game;
      const { spawnMonster } = await import('/js/sim/waves.js');
      const { BUILD_CELLS } = await import('/js/sim/board.js');
      const { UNITS } = await import('/js/config.js');
      for (const u of [...g.units]) g.removeUnit(u);
      for (const m of g.monsters) m.alive = false; g.cleanupDead(); g.boss = g.mission = null; g.spawnLeft = 0;
      BUILD_CELLS.slice(0, 120).forEach((c, i) => g.addUnit(UNITS[i % 15].id, c.cx, c.cy));
      for (let i = 0; i < 68; i++) { const m = spawnMonster(g, 'normal', 1e12, 0, 1.6); m.d = i * 0.7; } // 한도 70 바로 아래 + 보스 2 = 70마리
      spawnMonster(g, 'boss', 1e12, 0, 0.9); spawnMonster(g, 'mission', 1e12, 0, 1);
      g.boss = { m: g.monsters.find(m => m.kind === 'boss'), timer: 1e9, round: 10 };
      g.mission = { m: g.monsters.find(m => m.kind === 'mission'), timer: 1e9, idx: 0 };
      a.select(g.units.map(u => u.id));
      a.paused = false; a.speed = 2;
      await new Promise(res => setTimeout(res, 2500));
      let maxCalls = 0, maxTri = 0;
      for (let i = 0; i < 30; i++) { await new Promise(res => requestAnimationFrame(res)); const s = a.renderer.stats(); maxCalls = Math.max(maxCalls, s.calls); maxTri = Math.max(maxTri, s.triangles); }
      const fx = a.renderer.fx;
      return { maxCalls, maxTri, beams: fx.beams.length, parts: fx.parts.length, units: g.units.length, mons: g.monsters.length, fps: a.fps, frameMs: a.frameMs, lowSpec: a.renderer.lowSpec };
    });
    console.log('  최악 장면:', JSON.stringify(r));
    results.perf = r;
    assert.ok(r.units === 120 && r.mons >= 70, JSON.stringify(r));
    assert.equal(await ev(() => window.__app.game.state), 'playing');
    assert.ok(r.beams > 0 && r.parts > 0, '이펙트가 실제로 나오는 중');
    assert.ok(r.maxCalls <= 200, `draw calls ${r.maxCalls}`);
    assert.ok(r.maxTri <= 400000, `triangles ${r.maxTri}`);
    // 시뮬레이션 틱 비용 (최악 장면)
    const tick = await ev(() => { const g = window.__app.game; const t0 = performance.now(); for (let i = 0; i < 60; i++) g.tick(); return (performance.now() - t0) / 60; });
    console.log('  틱당 ms:', tick.toFixed(3));
    assert.ok(tick <= 2, `tick ${tick}ms`);
  });

  await check('18/19 → 패배 오버레이 + 26. 다시 하기', async () => {
    await ev(() => window.__app.game.lose('테스트 패배'));
    await page.waitForSelector('#overlay:not(.hidden)');
    assert.equal(await text('#ovTitle'), '패배');
    assert.match(await text('#ovReason'), /테스트 패배/);
    await page.click('#bRestart');
    await page.waitForTimeout(200);
    const s = await ev(() => ({ st: window.__app.game.state, r: window.__app.game.round, m: window.__app.game.minerals, u: window.__app.game.units.length }));
    assert.deepEqual(s, { st: 'playing', r: 0, m: 200, u: 0 });
    assert.ok(await page.locator('#overlay').evaluate(el => el.classList.contains('hidden')));
  });

  await check('20 → 승리 오버레이', async () => {
    await ev(() => { const g = window.__app.game; g.time = 5 + 35 * 39 - 0.01; g.round = 39; g.tick(); g.killMonster(g.boss.m); });
    await page.waitForSelector('#overlay:not(.hidden)');
    assert.equal(await text('#ovTitle'), '승리!');
    await page.click('#bRestart');
  });

  await check('실제 플레이: 성실 플레이 60초 동안 몬스터 처치·라운드 진행 (화면 포함)', async () => {
    await ev(() => { const a = window.__app; a.paused = false; a.speed = 2; a.game.minerals = 600; });
    for (let i = 0; i < 12; i++) await page.keyboard.press('KeyD');
    await page.waitForTimeout(12000);
    const s = await ev(() => ({ k: window.__app.game.stats.kills, r: window.__app.game.round, st: window.__app.game.state }));
    assert.ok(s.k >= 10 && s.r >= 1 && s.st === 'playing', JSON.stringify(s));
    await page.screenshot({ path: process.env.SHOT || 'test-results/play.png' });
  });

  await check('27. 콘솔 에러·경고 0건 (전 과정)', async () => {
    assert.equal(logs.length, 0, logs.join(' | '));
  });

  await browser.close();
  for (const r of results) console.log(r[0] === 'PASS' ? '✔' : '✘', r[1], r[2] ? `→ ${r[2]}` : '');
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} 통과`);
  process.exit(fails ? 1 : 0);
})();
