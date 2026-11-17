// 진입점: 고정 타임스텝 루프 + 명령 처리
import { Game } from './sim/game.js';
import { SIM_HZ } from './config.js';
import { isBuildable, BUILD_CELLS } from './sim/board.js';
import { Renderer } from './render/renderer.js';
import { HUD } from './ui/hud.js';
import { Input } from './input.js';

const STEP = 1 / SIM_HZ;

class App {
  constructor() {
    const params = new URLSearchParams(location.search);
    this.seed = +(params.get('seed') || (Date.now() % 1e9));
    this.game = new Game({ seed: this.seed });
    this.selection = new Set();
    this.speed = 1;
    this.paused = false;
    this.renderer = new Renderer(document.getElementById('view'));
    this.hud = new HUD(this);
    this.input = new Input(this);
    this.acc = 0;
    this.last = performance.now();
    this.fps = 60; this.frameMs = 16;
    requestAnimationFrame((t) => this.frame(t));
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= STEP && n < 12) { this.game.tick(); this.acc -= STEP; n++; }
      if (n >= 12) this.acc = 0;
    }
    this.input.update(dt);
    // 사라진 유닛은 선택에서 제거
    for (const id of this.selection) if (!this.game.unitById(id)) this.selection.delete(id);
    const ev = this.game.events;
    this.renderer.consume(ev);
    this.hud.consume(ev);
    ev.length = 0;
    const t0 = performance.now();
    this.renderer.render(this.game, this.paused ? 1 : this.acc / STEP, this.paused ? 0 : dt, this.selection);
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    this.hud.update(this.game, this.selection);
    requestAnimationFrame((t) => this.frame(t));
  }

  select(ids, add = false) {
    if (!add) this.selection.clear();
    for (const id of ids) this.selection.add(id);
  }
  selectType(type) { this.select(this.game.units.filter(u => u.type === type).map(u => u.id)); }

  cmd(name, arg) {
    const g = this.game;
    let r;
    const sel = [...this.selection];
    switch (name) {
      case 'draw': r = g.draw(); break;
      case 'merge': {
        const prim = sel[0];
        if (prim == null) { r = { ok: false, reason: '유닛을 선택하세요' }; break; }
        r = g.merge(prim, sel);
        if (r.ok) this.select([r.unit.id]);
        break;
      }
      case 'sell': {
        if (!sel.length) { r = { ok: false, reason: '유닛을 선택하세요' }; break; }
        let total = 0, any = false, last;
        for (const id of sel) { last = g.sell(id); if (last.ok) { total += last.price; any = true; } }
        r = any ? { ok: true } : last;
        if (any) this.hud.toast(`판매 +${total} 광물`, '#5fd0ff');
        break;
      }
      case 'upgrade': r = g.upgrade(arg); break;
      case 'exchange': r = g.exchange(arg); break;
      case 'mission': r = g.summonMission(arg); break;
    }
    if (r && !r.ok && r.reason) this.hud.toast(r.reason, '#ff8f8f');
    return r;
  }

  // 우클릭 이동: 첫 유닛은 클릭한 칸, 나머지는 가까운 빈 칸에
  moveSelection(cx, cy) {
    const g = this.game;
    const units = [...this.selection].map(id => g.unitById(id)).filter(Boolean);
    if (!units.length) return;
    if (units.length === 1) {
      const r = g.move(units[0].id, cx, cy);
      if (!r.ok) this.hud.toast(r.reason, '#ff8f8f');
      return;
    }
    const free = BUILD_CELLS.filter(c => !g.unitAt(c.cx, c.cy))
      .sort((a, b) => (Math.hypot(a.cx - cx, a.cy - cy) - Math.hypot(b.cx - cx, b.cy - cy)));
    let i = 0;
    for (const u of units) { const c = free[i++]; if (!c) break; g.move(u.id, c.cx, c.cy); }
  }

  togglePause() { this.paused = !this.paused; }
  toggleSpeed() { this.speed = this.speed === 1 ? 2 : 1; }
  restart() {
    this.game = new Game({ seed: (this.seed = (this.seed * 7 + 13) % 1e9) });
    this.selection.clear();
    this.renderer.reset();
    this.paused = false;
    this.hud.last = {};
  }
}

const app = new App();
window.__app = app;   // 브라우저 테스트용
