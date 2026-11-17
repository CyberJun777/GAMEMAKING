// 시뮬레이션 전용 최소 벡터 수학 (DOM·Three.js 의존 없음 → Node에서 테스트 가능)
export const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const copy = (a) => ({ x: a.x, y: a.y, z: a.z });
export const set = (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const dist = (a, b) => len(sub(a, b));
export const norm = (a) => { const l = len(a); return l > 1e-9 ? scale(a, 1 / l) : v(0, 0, 0); };
export const addTo = (o, a, s = 1) => { o.x += a.x * s; o.y += a.y * s; o.z += a.z * s; return o; };
export const clampLen = (a, m) => { const l = len(a); return l > m ? scale(a, m / l) : a; };
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

// yaw: y축 회전(0 = +x 방향), pitch: 위아래
export const dirFrom = (yaw, pitch) => ({
  x: Math.cos(pitch) * Math.cos(yaw),
  y: Math.sin(pitch),
  z: Math.cos(pitch) * Math.sin(yaw),
});
export const yawOf = (d) => Math.atan2(d.z, d.x);

// 결정적 난수 (테스트 재현용)
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 각도 오차를 준 방향 (deg)
export function jitterDir(d, deg, r) {
  const a = (deg * Math.PI) / 180;
  const yaw = yawOf(d) + (r() * 2 - 1) * a;
  const pitch = Math.asin(Math.max(-1, Math.min(1, d.y))) + (r() * 2 - 1) * a;
  return dirFrom(yaw, pitch);
}
