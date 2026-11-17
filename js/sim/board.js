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
export const BUILD_CELLS = [];
for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
  if (isBuildable(cx, cy)) BUILD_CELLS.push({ cx, cy, inner: isInner(cx, cy), dp: distToPath(cx, cy) });
}
export const PLACE_ORDER = [...BUILD_CELLS].sort((a, b) =>
  (a.dp - b.dp) || ((b.inner ? 1 : 0) - (a.inner ? 1 : 0)) || (a.cy - b.cy) || (a.cx - b.cx));
