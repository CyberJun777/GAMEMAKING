import { BOARD } from '../config.js';

// 칸 좌표(cx, cy) ↔ 월드 좌표(x, z). 1칸 = 1 월드 유닛, 보드 중심이 원점.
const N = BOARD.size;
const [R0, R1] = BOARD.ringIndex;
const HALF = (N - 1) / 2;

export const cellToWorld = (cx, cy) => ({ x: cx - HALF, z: cy - HALF });
export const worldToCell = (x, z) => ({ cx: Math.round(x + HALF), cy: Math.round(z + HALF) });
export const cellIndex = (cx, cy) => cy * N + cx;
export const inBoard = (cx, cy) => cx >= 0 && cy >= 0 && cx < N && cy < N;

export function isPath(cx, cy) {
  const onCol = (cx === R0 || cx === R1) && cy >= R0 && cy <= R1;
  const onRow = (cy === R0 || cy === R1) && cx >= R0 && cx <= R1;
  return onCol || onRow;
}
export const isInner = (cx, cy) => cx > R0 && cx < R1 && cy > R0 && cy < R1;
export const isBuildable = (cx, cy) => inBoard(cx, cy) && !isPath(cx, cy);

// 몬스터 경로: 고리 모서리 4개를 시계 방향(위에서 볼 때 +x → +z)으로 순환
const corners = [[R0, R0], [R1, R0], [R1, R1], [R0, R1]].map(([cx, cy]) => cellToWorld(cx, cy));
const segLen = R1 - R0;
export const PATH_LENGTH = segLen * 4;

export function pathPos(d) {
  d = ((d % PATH_LENGTH) + PATH_LENGTH) % PATH_LENGTH;
  const seg = Math.floor(d / segLen);
  const t = (d - seg * segLen) / segLen;
  const a = corners[seg], b = corners[(seg + 1) % 4];
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

// 배치 칸 목록 (뽑기 시 자동 배치 우선순위: 길에 가까운 칸 → 안쪽 우선)
function distToPath(cx, cy) {
  let best = Infinity;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!isPath(x, y)) continue;
    const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
    if (d < best) best = d;
  }
  return best;
}
// 칸이 고리 길의 어디쯤 붙어 있는지 (0~1, 생성 지점부터 시계 방향 둘레 비율)
export function ringParam(cx, cy) {
  const { x, z } = cellToWorld(cx, cy);
  let best = Infinity, bestD = 0;
  for (let s = 0; s < 4; s++) {
    const a = corners[s], b = corners[(s + 1) % 4];
    const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / L2));
    const px = a.x + vx * t - x, pz = a.z + vz * t - z, dd = px * px + pz * pz;
    if (dd < best - 1e-9) { best = dd; bestD = (s + t) * segLen; }
  }
  return bestD / PATH_LENGTH;
}
export const BUILD_CELLS = [];
for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
  if (isBuildable(cx, cy)) BUILD_CELLS.push({ cx, cy, inner: isInner(cx, cy), dp: distToPath(cx, cy), rp: ringParam(cx, cy) });
}
// 뽑기 자동 배치 순서: 우선순위(길에 가까운 칸 → 안쪽)는 그대로, 같은 우선순위 안에서는
// 황금비 수열로 고리 둘레 위치를 골라 연속 배치가 한쪽에 몰리지 않고 둘레 전체에 고르게 퍼진다.
function spreadAlongRing(cells) {
  const left = [...cells].sort((a, b) => a.rp - b.rp || a.cy - b.cy || a.cx - b.cx);
  const out = [];
  const PHI = 0.6180339887;
  for (let k = 0; left.length; k++) {
    const target = (k * PHI) % 1;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = Math.abs(left[i].rp - target), w = Math.min(d, 1 - d);
      if (w < bd - 1e-9) { bd = w; bi = i; }
    }
    out.push(left.splice(bi, 1)[0]);
  }
  return out;
}
const tiers = new Map();
for (const c of BUILD_CELLS) {
  const key = c.dp * 2 + (c.inner ? 0 : 1);
  if (!tiers.has(key)) tiers.set(key, []);
  tiers.get(key).push(c);
}
export const PLACE_ORDER = [...tiers.keys()].sort((a, b) => a - b).flatMap(k => spreadAlongRing(tiers.get(k)));
