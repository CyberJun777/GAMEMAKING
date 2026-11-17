// 키보드·마우스 → 시뮬레이션 입력. 마우스(포인터 락) 또는 방향키로 시선 조작.
const SENS = 0.0022;
const KEY_TURN = 2.2;            // 방향키 회전 속도 (rad/s)
const PITCH_MAX = 1.2;

export function createInput(canvas) {
  const keys = new Set();
  const view = { yaw: 0, pitch: 0 };
  const edge = { pass: false, tackle: false, switchRole: false, snap: false, pause: false };
  let chargeStart = null;      // 좌클릭 누른 시각
  let shootRelease = null;     // 놓았을 때 차지값
  let enabled = false;

  const isLocked = () => document.pointerLockElement === canvas;

  window.addEventListener('keydown', (e) => {
    if (!enabled) return;
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyE') edge.pass = true;
    if (e.code === 'Tab') edge.switchRole = true;
    if (e.code === 'KeyQ') edge.snap = true;
    if (e.code === 'KeyP') edge.pause = true;
    if (e.code === 'KeyF' && chargeStart == null) chargeStart = performance.now();  // 키보드 슛(대체)
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'KeyF' && chargeStart != null && enabled) release();
  });
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('mousedown', (e) => {
    if (!enabled) return;
    if (!isLocked()) { canvas.requestPointerLock?.(); }
    if (e.button === 0) chargeStart = performance.now();
    if (e.button === 2) edge.tackle = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0 && chargeStart != null && enabled) release();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // 포인터 락이 걸리는 순간 브라우저가 커서 위치 전체만큼의 가짜 movement를 보내는 경우가 있어
  // (시선이 홱 돌아감) 잠금 직후 짧은 시간과 비정상적으로 큰 한 번의 이동은 무시한다.
  let lockedAt = 0;
  document.addEventListener('pointerlockchange', () => { lockedAt = performance.now(); });
  document.addEventListener('mousemove', (e) => {
    if (!enabled || !isLocked()) return;
    if (performance.now() - lockedAt < 120) return;
    if (Math.abs(e.movementX) > 200 || Math.abs(e.movementY) > 200) return;
    view.yaw += e.movementX * SENS;
    view.pitch = clampPitch(view.pitch - e.movementY * SENS);
  });

  function release() {
    shootRelease = charge();
    chargeStart = null;
  }
  function charge() {
    return chargeStart == null ? 0 : Math.min(1, (performance.now() - chargeStart) / 1000);
  }
  function clampPitch(p) { return Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p)); }

  // 프레임마다 방향키 회전 반영
  function update(dt) {
    if (!enabled) return;
    if (keys.has('ArrowLeft')) view.yaw -= KEY_TURN * dt;
    if (keys.has('ArrowRight')) view.yaw += KEY_TURN * dt;
    if (keys.has('ArrowUp')) view.pitch = clampPitch(view.pitch + KEY_TURN * 0.6 * dt);
    if (keys.has('ArrowDown')) view.pitch = clampPitch(view.pitch - KEY_TURN * 0.6 * dt);
  }

  // 시뮬레이션 한 스텝분 입력. 엣지 입력(패스·태클·슛 등)은 한 번만 전달.
  function consume() {
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const u = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') || keys.has('ControlLeft') ? 1 : 0);
    const out = {
      move: { f, s, u },
      boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      yaw: view.yaw, pitch: view.pitch,
      shoot: shootRelease,
      pass: edge.pass, tackle: edge.tackle, switchRole: edge.switchRole,
    };
    shootRelease = null;
    edge.pass = edge.tackle = edge.switchRole = false;
    return out;
  }

  function takeUiEdges() {
    const r = { snap: edge.snap, pause: edge.pause };
    edge.snap = edge.pause = false;
    return r;
  }

  return {
    view, keys, update, consume, takeUiEdges, charge, isLocked,
    setEnabled(v) { enabled = v; if (!v) { keys.clear(); chargeStart = null; } },
    lookAt(from, to) {   // Q 스냅
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      view.yaw = Math.atan2(dz, dx);
      view.pitch = clampPitch(Math.atan2(dy, Math.hypot(dx, dz)));
    },
  };
}
