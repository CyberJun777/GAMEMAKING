// 진입점: 고정 타임스텝 루프 (시뮬 30Hz, 렌더는 보간)
import { CFG } from './config.js';
import { createMatch, step } from './sim/match.js';
import { createRenderer } from './render/scene.js';
import { createInput } from './input.js';
import { createUI } from './ui.js';
import { loadTextures } from './render/textures.js';

const canvas = document.getElementById('game');
const ui = createUI();
const input = createInput(canvas);
const textures = await loadTextures();
const gfx = createRenderer(canvas, { textures });

let difficulty = 'normal';
let state = createMatch({ difficulty, seed: 1, humanTeam: null });   // 시작 화면 뒤에서 AI끼리 시연
let mode = 'menu';            // menu | play | paused | over
let acc = 0, last = performance.now();
const DT = CFG.dt;

document.querySelectorAll('.diff button').forEach((b) => b.addEventListener('click', () => {
  difficulty = b.dataset.diff;
  document.querySelectorAll('.diff button').forEach((x) => x.classList.toggle('sel', x === b));
}));
document.getElementById('startBtn').addEventListener('click', start);
document.getElementById('restartBtn').addEventListener('click', start);
document.getElementById('pauseScreen').addEventListener('click', () => setPaused(false));
document.addEventListener('pointerlockchange', () => {
  document.getElementById('lockHint').classList.toggle('hidden', input.isLocked());
  if (!input.isLocked() && mode === 'play' && wasLocked) setPaused(true);
  wasLocked = input.isLocked();
});
let wasLocked = false;

function start() {
  state = createMatch({ difficulty, seed: (Math.random() * 1e9) | 0, humanTeam: 0 });
  const h = state.players[state.humanId];
  input.view.yaw = h.aimYaw; input.view.pitch = 0;
  ui.show('start', false); ui.show('end', false); ui.show('pause', false); ui.show('hud', true);
  input.setEnabled(true);
  mode = 'play';
  acc = 0;
  canvas.requestPointerLock?.();
}

function setPaused(p) {
  if (mode !== 'play' && mode !== 'paused') return;
  mode = p ? 'paused' : 'play';
  ui.show('pause', p);
  input.setEnabled(!p);
  if (!p) canvas.requestPointerLock?.();
  else if (input.isLocked()) document.exitPointerLock();
}
window.addEventListener('keydown', (e) => { if (e.code === 'KeyP' && mode === 'paused') setPaused(false); });

function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  if (mode === 'play' || mode === 'menu') {
    input.update(dt);
    const edges = input.takeUiEdges();
    if (edges.pause && mode === 'play') setPaused(true);
    if (edges.snap && state.humanId != null) {
      const h = state.players[state.humanId];
      const target = h.role === 'hunter' && state.orb.active ? state.orb.pos : state.comet.pos;
      input.lookAt(h.pos, target);
    }
    acc += dt;
    while (acc >= DT && mode !== 'paused') {
      step(state, mode === 'play' ? input.consume() : {});
      for (const e of state.events) { gfx.onEvent(state, e); if (mode === 'play') ui.onEvent(state, e); }
      acc -= DT;
      if (state.over) {
        if (mode === 'play') { mode = 'over'; input.setEnabled(false); if (input.isLocked()) document.exitPointerLock(); ui.showEnd(state); }
        else state = createMatch({ difficulty: 'normal', seed: (Math.random() * 1e9) | 0, humanTeam: null });
        break;
      }
    }
  }
  const view = state.humanId != null ? input.view : { yaw: 0, pitch: 0 };
  gfx.render(state, mode === 'paused' || mode === 'over' ? 1 : acc / DT, dt, view);
  if (mode !== 'menu') ui.update(state, dt, input, gfx.project);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 테스트·디버그용 훅
window.__wingball = {
  get state() { return state; }, get mode() { return mode; },
  input, gfx, start, setPaused,
  drawInfo: () => ({ calls: gfx.info.render.calls, triangles: gfx.info.render.triangles }),
};
