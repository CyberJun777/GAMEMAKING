// 마우스·키보드 입력. 키는 e.code(물리 키)로 받는다 → 한글 입력 상태에서도 D/F/G가 동작.
import { isBuildable } from './sim/board.js';
import { GRADES, FACTIONS } from './config.js';

const KEYMAP = {
  KeyD: ['draw'], KeyF: ['merge'], KeyG: ['sell'],
  Digit1: ['upgrade', 'mech'], Digit2: ['upgrade', 'bio'], Digit3: ['upgrade', 'arc'],
  Numpad1: ['upgrade', 'mech'], Numpad2: ['upgrade', 'bio'], Numpad3: ['upgrade', 'arc'],
  KeyZ: ['mission', 0], KeyX: ['mission', 1], KeyC: ['mission', 2]
};
const PAN = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export class Input {
  constructor(app) {
    this.app = app;
    const canvas = app.renderer.renderer.domElement;
    this.canvas = canvas;
    this.box = document.getElementById('box');
    this.tip = document.getElementById('tip');
    this.tipKey = '';
    this.drag = null;
    this.held = new Set();

    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDbl(e));
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onRight(e); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); app.renderer.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1); }, { passive: false });
    window.addEventListener('keydown', (e) => { app.audio.unlock(); this.onKey(e); });
    window.addEventListener('pointerdown', () => app.audio.unlock());
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  onKey(e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const a = this.app;
    if (PAN[e.code]) { e.preventDefault(); this.held.add(e.code); return; }
    if (e.code === 'Space') { e.preventDefault(); a.togglePause(); return; }
    if (e.code === 'Tab') { e.preventDefault(); a.toggleSpeed(); return; }
    if (e.code === 'Escape') { a.selection.clear(); return; }
    if (e.code === 'KeyM') { if (!e.repeat) a.toggleMute(); return; }   // 음소거 (기존 단축키와 겹치지 않음)
    if (e.repeat) return;
    const k = KEYMAP[e.code];
    if (k) { e.preventDefault(); a.cmd(...k); }
  }

  // 매 프레임: 방향키로 카메라 이동 (카메라는 방향키만 사용)
  update(dt) {
    let dx = 0, dz = 0;
    for (const c of this.held) if (PAN[c]) { dx += PAN[c][0]; dz += PAN[c][1]; }
    if (dx || dz) this.app.renderer.pan(dx * dt * 10, dz * dt * 10);
  }

  // 유닛 위에서 누르고 끌면 = 그 유닛 옮기기, 빈 곳에서 끌면(또는 Shift+끌기) = 박스 선택
  onDown(e) {
    if (e.button !== 0) return;
    const cell = this.app.renderer.pickCell(e.clientX, e.clientY);
    const u = !e.shiftKey && cell && this.app.game.unitAt(cell.cx, cell.cy);
    this.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: false, shift: e.shiftKey, unit: u ? u.id : null };
  }
  onMove(e) {
    const a = this.app;
    const cell = e.target === this.canvas ? a.renderer.pickCell(e.clientX, e.clientY) : null;
    const d = this.drag;
    const dragging = d && d.unit != null && d.moved;
    a.renderer.setHover(cell, cell && isBuildable(cell.cx, cell.cy) && (!dragging || !a.game.unitAt(cell.cx, cell.cy) || a.game.unitAt(cell.cx, cell.cy).id === d.unit));
    this.showTip(e, cell && !dragging ? a.game.unitAt(cell.cx, cell.cy) : null);
    if (!d) return;
    d.x1 = e.clientX; d.y1 = e.clientY;
    if (Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0) > 6) d.moved = true;
    if (d.moved && d.unit != null) { this.canvas.style.cursor = 'grabbing'; return; }
    if (d.moved) {
      Object.assign(this.box.style, { display: 'block', left: Math.min(d.x0, d.x1) + 'px', top: Math.min(d.y0, d.y1) + 'px', width: Math.abs(d.x1 - d.x0) + 'px', height: Math.abs(d.y1 - d.y0) + 'px' });
    }
  }
  onUp(e) {
    const d = this.drag;
    if (!d || e.button !== 0) return;
    this.drag = null;
    this.box.style.display = 'none';
    const a = this.app;
    if (d.moved && d.unit != null) {
      // 끌어다 놓기 이동
      this.canvas.style.cursor = '';
      const cell = a.renderer.pickCell(e.clientX, e.clientY);
      if (!a.game.unitById(d.unit)) return;
      a.select([d.unit]);
      if (cell) a.moveSelection(cell.cx, cell.cy);
      return;
    }
    if (d.moved) {
      const [l, r] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)], [t, b] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)];
      const ids = a.game.units.filter(u => { const p = a.renderer.toScreen(u.x, 0.3, u.z); return p.x >= l && p.x <= r && p.y >= t && p.y <= b; }).map(u => u.id);
      a.select(ids, d.shift);
    } else {
      const cell = a.renderer.pickCell(e.clientX, e.clientY);
      const u = cell && a.game.unitAt(cell.cx, cell.cy);
      if (u) {
        if (d.shift && a.selection.has(u.id)) { a.selection.delete(u.id); }
        else a.select([u.id], d.shift);
      } else if (!d.shift) a.selection.clear();
    }
  }
  // 마우스를 올린 유닛 이름표
  showTip(e, u) {
    const t = this.tip;
    if (!u) { if (this.tipKey) { t.style.display = 'none'; this.tipKey = ''; } return; }
    const key = String(u.id);
    if (this.tipKey !== key) {
      this.tipKey = key;
      const gr = GRADES[u.def.grade], fac = FACTIONS.find(f => f.key === u.def.faction);
      const same = this.app.game.units.filter(o => o.type === u.type).length;
      t.innerHTML = `<b style="color:${gr.color}">${u.def.name}</b> <span style="color:${gr.color}">${gr.name}</span> · <span style="color:${fac.color}">${fac.name}</span><small>보유 ${same}기${same >= 2 && u.def.grade < 4 ? ' · 합성 가능 (F)' : ''} · 끌어서 이동</small>`;
      t.style.display = 'block';
    }
    t.style.left = e.clientX + 'px'; t.style.top = e.clientY + 'px';
  }
  onDbl(e) {
    const cell = this.app.renderer.pickCell(e.clientX, e.clientY);
    const u = cell && this.app.game.unitAt(cell.cx, cell.cy);
    if (u) this.app.selectType(u.type);
  }
  onRight(e) {
    const cell = this.app.renderer.pickCell(e.clientX, e.clientY);
    if (cell) this.app.moveSelection(cell.cx, cell.cy);
  }
}
