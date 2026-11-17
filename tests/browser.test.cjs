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
    // HUD는 다음 프레임에 갱신됨 → 벽시계 대신 조건 대기 (소프트웨어 GL은 프레임이 느림)
    await page.waitForFunction(() => /외 1기/.test(document.getElementById('sel').innerText), null, { timeout: 5000 }).catch(() => {});
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
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction((x0) => window.__app.renderer.camTarget.x > x0 + 0.5, before.cam, { timeout: 10000 }).catch(() => {});
    await page.keyboard.up('ArrowRight');
    const after = await ev(() => ({ cam: window.__app.renderer.camTarget.x, m: window.__app.game.minerals, n: window.__app.game.units.length, sel: window.__app.selection.size }));
    assert.ok(after.cam > before.cam + 0.5, `카메라 이동 ${before.cam} → ${after.cam}`);
    assert.equal(after.m, before.m); assert.equal(after.n, before.n); assert.equal(after.sel, before.sel);
    await page.keyboard.down('ArrowLeft');
    await page.waitForFunction((x0) => window.__app.renderer.camTarget.x <= x0, before.cam, { timeout: 10000 }).catch(() => {});
    await page.keyboard.up('ArrowLeft');
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

  await check('29. 유닛 15종 실루엣이 전부 다름 (종마다 고유 InstancedMesh, 몸체=진영색 · 장식=등급색)', async () => {
    const r = await ev(async () => {
      const a = window.__app, g = a.game;
      const { UNITS, GRADES, FACTIONS } = await import('/js/config.js');
      for (const u of [...g.units]) g.removeUnit(u);
      UNITS.forEach((d, i) => g.addUnit(d.id, 3 + (i % 5) * 2, 3 + Math.floor(i / 5) * 2));
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const out = {};
      for (const d of UNITS) {
        const tm = a.renderer.typeMesh[d.id];
        const sig = [tm.body, tm.trim].map(m => { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; return [m.geometry.attributes.position.count, b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +(+v).toFixed(3)).join(','); }).join('|');
        const tri = (tm.body.geometry.attributes.position.count + tm.trim.geometry.attributes.position.count) / 3;
        out[d.id] = { sig, tri, count: [tm.body.count, tm.trim.count], faction: d.faction, grade: d.grade };
      }
      const facHex = Object.fromEntries(FACTIONS.map(f => [f.key, f.color]));
      const col = (m) => { const c = m.instanceColor.array; return [c[0], c[1], c[2]]; };
      const tmB = a.renderer.typeMesh.a0;
      const want = (hex) => { const c = new (a.renderer.typeMesh.a0.body.material.color.constructor)(hex); return [c.r, c.g, c.b]; };
      const colors = { body: col(tmB.body), trim: col(tmB.trim), fac: want(facHex.arc), grade: want(GRADES[0].color) };
      for (const u of [...g.units]) g.removeUnit(u);
      return { out, colors };
    });
    const sigs = Object.values(r.out).map(o => o.sig);
    assert.equal(new Set(sigs).size, 15, '15종 지오메트리가 서로 달라야 함');
    for (const [id, o] of Object.entries(r.out)) {
      assert.deepEqual(o.count, [1, 1], `${id} 인스턴스 1기`);
      assert.ok(o.tri <= 1500, `${id} 삼각형 ${o.tri} ≤ 1500`);
    }
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.01);
    assert.ok(near(r.colors.body, r.colors.fac), '몸체 = 진영색');
    assert.ok(near(r.colors.trim, r.colors.grade), '장식 = 등급색');
    console.log('  종별 삼각형:', Object.entries(r.out).map(([k, o]) => `${k}:${o.tri}`).join(' '));
  });

  const raf2 = () => ev(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))));

  await check('30. 합성 연출: 등급 색 빛기둥 + 시간차 고리 + 파편 (영웅↑은 화면 섬광, 효과음 merge/hero)', async () => {
    const r = await ev(async () => {
      const a = window.__app, g = a.game; a.paused = true;
      for (const u of [...g.units]) g.removeUnit(u);
      a.renderer.fx.clear();
      const blast = async (type, cx) => {
        const u1 = g.addUnit(type, cx, 4), u2 = g.addUnit(type, cx + 1, 4);
        a.renderer.fx.clear();
        const res = g.merge(u1.id, [u2.id]);
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        const fx = a.renderer.fx;
        const pillar = fx.beams.find(b => b.pillar);
        return { ok: res.ok, g: res.unit.def.grade, pillarH: pillar ? +pillar.b.y.toFixed(2) : 0, pillarCol: pillar ? pillar.col.getHexString() : '', rings: fx.rings.length, parts: fx.parts.length };
      };
      const lo = await blast('m0', 3), hi = await blast('b1', 6);
      const { GRADES } = await import('/js/config.js');
      return { lo, hi, flash: document.getElementById('flash').className, log: a.audio.log.slice(-6), calls: a.renderer.stats().calls };
    });
    assert.ok(r.lo.ok && r.hi.ok);
    assert.equal(r.lo.g, 1); assert.equal(r.hi.g, 2);
    assert.ok(r.lo.pillarH > 0 && r.hi.pillarH > r.lo.pillarH, `빛기둥 높이 희귀 ${r.lo.pillarH} < 영웅 ${r.hi.pillarH}`);
    assert.ok(r.hi.rings >= 4 && r.hi.rings > r.lo.rings, `고리 ${r.lo.rings} → ${r.hi.rings}`);
    assert.ok(r.hi.parts > r.lo.parts, '파편도 더 많음');
    assert.match(r.flash, /on/, '영웅 합성 → 화면 섬광');
    assert.ok(r.log.includes('merge') && r.log.includes('hero'), r.log.join(','));
  });

  await check('31. 보스 등장 경고: 배너 + 비네트 + 붉은 고리 + 카메라 흔들림 + 경고음', async () => {
    const r = await ev(async () => {
      const a = window.__app, g = a.game; a.paused = true;
      g.time = 5 + 35 * 9 - 0.01; g.round = 9; g.tick();
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const w = document.getElementById('bossWarn');
      const red = a.renderer.fx.rings.filter(r => r.col.r > 0.9 && r.col.g < 0.2).length;
      return { boss: !!g.boss, round: g.round, on: w.classList.contains('on'), vis: getComputedStyle(w).display, text: w.innerText, red, shake: a.renderer.shake, log: a.audio.log.slice(-3), cam: a.renderer.camTarget.x };
    });
    assert.ok(r.boss && r.round === 10, JSON.stringify(r));
    assert.ok(r.on && r.vis !== 'none', '경고 배너 표시');
    assert.match(r.text, /10라운드 보스 등장/);
    assert.ok(r.red >= 5, `붉은 경고 고리 ${r.red}`);
    assert.ok(r.shake > 0, '카메라 흔들림 중');
    assert.ok(r.log.includes('boss'), r.log.join(','));
    // 흔들림이 끝나면 카메라는 원래 자리 (camTarget 불변)
    await ev(() => { window.__app.paused = false; });
    await page.waitForFunction(() => window.__app.renderer.shake === -1, null, { timeout: 20000 });
    await ev(() => { window.__app.paused = true; });
    const cam = await ev(() => { const c = window.__app.renderer; const p = c.camera.position.clone(); c.updateCamera(); return p.distanceTo(c.camera.position); });
    assert.ok(cam < 1e-6, `흔들림 후 카메라 복귀 (오차 ${cam})`);
    await page.waitForFunction(() => !document.getElementById('bossWarn').classList.contains('on'), null, { timeout: 8000 });
  });

  await check('32. 피해 숫자: 보스는 묶어서 표시, 일반은 큰 한 방만 · 초당·동시 개수 상한', async () => {
    const r = await ev(async () => {
      const a = window.__app, g = a.game;
      const boss = g.boss.m;
      a.paused = false; a.speed = 1;
      boss.hp -= boss.maxHp * 0.1;
      const t0 = performance.now();
      while (!document.querySelector('.dmg.boss[style*="block"]') && performance.now() - t0 < 8000) await new Promise(res => requestAnimationFrame(res));
      a.paused = true;
      const bossNum = document.querySelector('.dmg.boss[style*="block"]')?.textContent || '';
      // 큰 한 방 200개가 한꺼번에 와도 일반 숫자는 초당 8개, 전체 24개 상한
      for (let i = 0; i < 200; i++) g.emit({ t: 'bighit', x: 0, z: 0, v: 999, gr: 0 });
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const shown = [...document.querySelectorAll('.dmg')].filter(e => e.style.display === 'block');
      const res = { bossNum, normal: shown.filter(e => e.classList.contains('normal')).length, total: shown.length, pool: document.querySelectorAll('.dmg').length };
      g.killMonster(boss); g.boss = null; g.cleanupDead();
      return res;
    });
    assert.ok(r.bossNum.length > 0, '보스 피해 숫자 표시');
    assert.ok(r.normal >= 1 && r.normal <= 8, `일반 숫자 ${r.normal} (≤8)`);
    assert.ok(r.total <= 24 && r.pool === 24, JSON.stringify(r));
  });

  await check('33. 효과음: Web Audio 생성 · 뽑기 소리 · M 음소거 토글 (게임 상태 불변)', async () => {
    await ev(() => { window.__app.game.minerals = 1000; window.__app.audio.lastAt = {}; });
    await page.keyboard.press('KeyD');
    await page.waitForFunction(() => window.__app.audio.log.slice(-1)[0] === 'draw' || window.__app.audio.log.slice(-1)[0] === 'hero', null, { timeout: 5000 }).catch(() => {});
    let s = await ev(() => { const a = window.__app; return { ctx: !!a.audio.ctx, state: a.audio.ctx && a.audio.ctx.state, last: a.audio.log.slice(-2), muted: a.audio.muted }; });
    assert.ok(s.ctx, 'AudioContext 생성 (사용자 입력 후)');
    assert.ok(s.last.includes('draw') || s.last.includes('hero'), s.last.join(','));
    assert.equal(s.muted, false);
    const before = await ev(() => { const a = window.__app; return JSON.stringify({ m: a.game.minerals, n: a.game.units.length, p: a.paused, sp: a.speed, sel: a.selection.size }); });
    await page.keyboard.press('KeyM');
    await page.waitForFunction(() => /🔇/.test(document.getElementById('sound').textContent), null, { timeout: 5000 }).catch(() => {});
    assert.equal(await ev(() => window.__app.audio.muted), true);
    assert.match(await text('#sound'), /🔇/);
    assert.equal(await ev(() => window.__app.audio.master.gain.value < 0.22 || window.__app.audio.muted), true);
    assert.equal(await ev(() => localStorage.getItem('prismring.muted')), '1');
    await page.keyboard.press('KeyM');
    await page.waitForFunction(() => /🔊/.test(document.getElementById('sound').textContent), null, { timeout: 5000 }).catch(() => {});
    assert.equal(await ev(() => window.__app.audio.muted), false);
    assert.match(await text('#sound'), /🔊/);
    const after = await ev(() => { const a = window.__app; return JSON.stringify({ m: a.game.minerals, n: a.game.units.length, p: a.paused, sp: a.speed, sel: a.selection.size }); });
    assert.equal(after, before, 'M은 게임 상태를 바꾸지 않음');
  });

  await check('34. 끌어다 놓기 이동: 빈 칸 O, 찬 칸·길 X (박스 선택과 구분)', async () => {
    const id = await ev(() => { const a = window.__app, g = a.game; a.paused = true; for (const u of [...g.units]) g.removeUnit(u); g.addUnit('m0', 4, 4); g.addUnit('b0', 6, 6); a.selection.clear(); return g.unitAt(4, 4).id; });
    await page.waitForTimeout(200);
    const dragTo = async (cx, cy) => {
      const p = await screenOf(id), q = await cellScreen(cx, cy);
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.mouse.move(q.x, q.y, { steps: 6 }); await page.mouse.up();
      return ev((id) => { const u = window.__app.game.unitById(id); return [u.cx, u.cy]; }, id);
    };
    assert.deepEqual(await dragTo(6, 6), [4, 4], '찬 칸으로는 안 감');
    assert.deepEqual(await dragTo(1, 5), [4, 4], '길로는 안 감');
    assert.deepEqual(await dragTo(8, 5), [8, 5], '빈 칸으로 이동');
    assert.deepEqual(await ev(() => [...window.__app.selection]), [id], '옮긴 유닛이 선택됨');
  });

  await check('35. 상단 버튼: 배속·일시정지·소리를 마우스로', async () => {
    await ev(() => { const a = window.__app; a.speed = 1; a.paused = false; });
    await page.click('#bSpeed');
    assert.equal(await ev(() => window.__app.speed), 2);
    await page.waitForFunction(() => /2×/.test(document.getElementById('speed').textContent), null, { timeout: 5000 }).catch(() => {});
    assert.match(await text('#speed'), /2×/);
    await page.click('#bSpeed');
    assert.equal(await ev(() => window.__app.speed), 1);
    await page.click('#bPause');
    assert.equal(await ev(() => window.__app.paused), true);
    await page.click('#bPause');
    assert.equal(await ev(() => window.__app.paused), false);
    const m0 = await ev(() => window.__app.audio.muted);
    await page.click('#bSound');
    assert.equal(await ev(() => window.__app.audio.muted), !m0);
    await page.click('#bSound');
    assert.equal(await ev(() => window.__app.audio.muted), m0);
    // 버튼을 누른 뒤 Space/Tab이 버튼을 다시 누르지 않음 (회귀 방지)
    await page.keyboard.press('Tab');
    assert.equal(await ev(() => window.__app.speed), 2, 'Tab 1번 = 배속 1번만 바뀜');
    await page.keyboard.press('Tab');
    await ev(() => { window.__app.paused = true; });
  });

  await check('36. 구분 보조: 마우스 올리면 이름표, 선택하면 같은 종류에 노란 고리, 뽑기 확률 표시', async () => {
    const id = await ev(() => { const a = window.__app, g = a.game; for (const u of [...g.units]) g.removeUnit(u); g.addUnit('a0', 4, 4); g.addUnit('a0', 9, 9); g.addUnit('a0', 11, 4); g.addUnit('m0', 6, 9); a.selection.clear(); return g.unitAt(4, 4).id; });
    const p = await screenOf(id);
    await page.mouse.move(p.x, p.y);
    await page.mouse.move(p.x + 1, p.y + 1);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('tip')).display !== 'none', null, { timeout: 5000 }).catch(() => {});
    assert.match(await text('#tip'), /불씨술사.*일반.*비전[\s\S]*보유 3기/);
    await page.mouse.click(p.x, p.y);
    await raf2(); await raf2();
    assert.equal(await ev(() => window.__app.renderer.sameRings.count), 2, '같은 종류 2기에 노란 고리');
    assert.match(await text('#odds'), /일반 82% · 희귀 15% · 영웅 3%/);
    assert.match(await text('#odds'), /전설·신은 합성으로만/);
    await page.mouse.move(5, 300);
  });

  await check('28. 최악 장면 성능 예산 (draw call ≤ 200, 삼각형 ≤ 40만)', async () => {
    const r = await ev(async () => {
      const a = window.__app, g = a.game;
      const { spawnMonster } = await import('/js/sim/waves.js');
      const { BUILD_CELLS } = await import('/js/sim/board.js');
      const { UNITS, WAVES } = await import('/js/config.js');
      const savedFirst = WAVES.firstRoundAt; WAVES.firstRoundAt = 1e9;   // 측정 중 새 라운드가 끼어들지 않게 라운드 시계 정지
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
      WAVES.firstRoundAt = savedFirst;
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
    const tick = await ev(async () => { const { WAVES } = await import('/js/config.js'); const f = WAVES.firstRoundAt; WAVES.firstRoundAt = 1e9; const g = window.__app.game; const t0 = performance.now(); for (let i = 0; i < 60; i++) g.tick(); WAVES.firstRoundAt = f; return (performance.now() - t0) / 60; });
    console.log('  틱당 ms:', tick.toFixed(3));
    assert.ok(tick <= 2, `tick ${tick}ms`);
  });

  await check('18/19 → 패배 오버레이 + 26. 다시 하기', async () => {
    await ev(() => window.__app.game.lose('테스트 패배'));
    await page.waitForSelector('#overlay:not(.hidden)');
    assert.equal(await text('#ovTitle'), '패배');
    assert.match(await text('#ovReason'), /테스트 패배/);
    assert.ok((await ev(() => window.__app.audio.log)).includes('defeat'), '패배 효과음');
    await page.click('#bRestart');
    await page.waitForFunction(() => window.__app.game.state === 'playing');
    const s = await ev(() => ({ st: window.__app.game.state, r: window.__app.game.round, m: window.__app.game.minerals, u: window.__app.game.units.length }));
    assert.deepEqual(s, { st: 'playing', r: 0, m: 200, u: 0 });
    assert.ok(await page.locator('#overlay').evaluate(el => el.classList.contains('hidden')));
  });

  await check('20 → 승리 오버레이', async () => {
    await ev(() => { const g = window.__app.game; g.time = 5 + 35 * 39 - 0.01; g.round = 39; g.tick(); g.killMonster(g.boss.m); });
    await page.waitForSelector('#overlay:not(.hidden)');
    assert.equal(await text('#ovTitle'), '승리!');
    assert.ok((await ev(() => window.__app.audio.log)).includes('victory'), '승리 효과음');
    await page.click('#bRestart');
    await page.waitForSelector('#overlay.hidden', { state: 'attached' });
  });

  await check('실제 플레이: 성실 플레이 60초 동안 몬스터 처치·라운드 진행 (화면 포함)', async () => {
    await ev(() => { const a = window.__app; a.paused = false; a.speed = 2; a.game.minerals = 600; });
    for (let i = 0; i < 12; i++) await page.keyboard.press('KeyD');
    assert.equal(await ev(() => window.__app.game.units.length), 12, 'D 12번 = 유닛 12기');
    // 벽시계가 아니라 게임 시간 기준으로 대기 (GPU 없는 환경은 프레임이 느림)
    await page.waitForFunction(() => window.__app.game.time >= 30, null, { timeout: 90000 });
    const s = await ev(() => ({ k: window.__app.game.stats.kills, r: window.__app.game.round, st: window.__app.game.state, t: window.__app.game.time }));
    assert.ok(s.k >= 20 && s.r >= 1 && s.st === 'playing', JSON.stringify(s));
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
