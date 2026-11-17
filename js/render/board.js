// 보드(지형) 메시. 텍스처 단계에서 재질만 교체할 수 있게 재질을 돌려준다.
import * as THREE from '../../vendor/three.module.js';
import { BOARD } from '../config.js';
import { cellToWorld, isPath } from '../sim/board.js';

const N = BOARD.size;

// 칸 격자선 텍스처 (절차적, 텍스처 파일 없이도 동작)
function gridTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 4; g.strokeRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.0)';
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildBoard(scene) {
  const out = {};
  // 바깥 땅 (보드 주변)
  out.groundMat = new THREE.MeshStandardMaterial({ color: '#1a2130', roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), out.groundMat);
  ground.position.y = -0.36; ground.receiveShadow = true;
  scene.add(ground);

  // 보드 받침 (단상)
  out.plinthMat = new THREE.MeshStandardMaterial({ color: '#2a3344', roughness: 0.7, metalness: 0.3 });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(N + 0.6, 0.36, N + 0.6), out.plinthMat);
  plinth.position.y = -0.19; plinth.receiveShadow = true; plinth.castShadow = true;
  scene.add(plinth);

  // 배치 칸 바닥: 보드 전체를 덮는 한 장 + 격자 (repeat = 칸 수)
  const grid = gridTexture(); grid.repeat.set(N, N);
  out.floorMat = new THREE.MeshStandardMaterial({ color: '#3b4a5e', map: grid, roughness: 0.9, metalness: 0.05 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(N, N).rotateX(-Math.PI / 2), out.floorMat);
  floor.receiveShadow = true;
  scene.add(floor);

  // 몬스터 길: 칸마다 살짝 낮은 판을 하나의 InstancedMesh로
  out.pathMat = new THREE.MeshStandardMaterial({ color: '#4a2f3a', roughness: 0.85, emissive: '#2a0812', emissiveIntensity: 0.35 });
  const cells = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (isPath(x, y)) cells.push(cellToWorld(x, y));
  const path = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 1), out.pathMat, cells.length);
  const m = new THREE.Matrix4();
  cells.forEach((p, i) => { m.makeTranslation(p.x, 0.005, p.z); path.setMatrixAt(i, m); });
  path.receiveShadow = true;
  scene.add(path);
  out.path = path;

  // 길 가장자리 발광선 (안쪽·바깥쪽 사각 테두리)
  const lineMat = new THREE.MeshBasicMaterial({ color: '#ff3a6a', toneMapped: false, transparent: true, opacity: 0.55 });
  const [r0, r1] = BOARD.ringIndex;
  const edge = (a, b) => {
    const A = cellToWorld(a, a), B = cellToWorld(b, b);
    const lo = A.x - 0.5, hi = B.x + 0.5, w = hi - lo, c = (lo + hi) / 2;
    const geos = [];
    for (const [px, pz, sx, sz] of [[c, lo, w, 0.04], [c, hi, w, 0.04], [lo, c, 0.04, w], [hi, c, 0.04, w]]) {
      const g = new THREE.BoxGeometry(sx, 0.02, sz); g.translate(px, 0.045, pz); geos.push(g);
    }
    return geos;
  };
  for (const g of [...edge(r0, r1), ...edge(r0 + 1, r1 - 1)]) scene.add(new THREE.Mesh(g, lineMat));

  // 생성 지점 표시 (왼쪽 위 모서리) — 화살표
  const sp = cellToWorld(r0, r0);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 3).rotateZ(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff5d7a', toneMapped: false }));
  arrow.position.set(sp.x + 0.1, 0.35, sp.z);
  scene.add(arrow);
  out.arrow = arrow;

  // 모서리 기둥 4개
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#56637a', metalness: 0.6, roughness: 0.35 });
  const pg = new THREE.CylinderGeometry(0.22, 0.3, 1.2, 8);
  const pillars = new THREE.InstancedMesh(pg, pillarMat, 4);
  const h = N / 2 + 0.05;
  [[-h, -h], [h, -h], [h, h], [-h, h]].forEach(([x, z], i) => { m.makeTranslation(x, 0.4, z); pillars.setMatrixAt(i, m); });
  pillars.castShadow = true;
  scene.add(pillars);
  return out;
}
