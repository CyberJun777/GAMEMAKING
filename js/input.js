// 마우스·키보드 입력. 키는 e.code(물리 키)로 받는다 → 한글 입력 상태에서도 D/F/G가 동작.
import { isBuildable } from './sim/board.js';

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

  onDown(e) {
    if (e.button !== 0) return;
    this.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: false, shift: e.shiftKey };
  }
  onMove(e) {
    const a = this.app;
    const cell = e.target === this.canvas ? a.renderer.pickCell(e.clientX, e.clientY) : null;
    a.renderer.setHover(cell, cell && isBuildable(cell.cx, cell.cy));
    const d = this.drag;
    if (!d) return;
    d.x1 = e.clientX; d.y1 = e.clientY;
    if (Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0) > 6) d.moved = true;
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
