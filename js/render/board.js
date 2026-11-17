// 보드(지형) 메시. 텍스처 단계에서 재질만 교체할 수 있게 재질을 돌려준다.
import * as THREE from '../../vendor/three.module.js';
import { BOARD } from '../config.js';
import { cellToWorld, isPath } from '../sim/board.js';

const N = BOARD.size;
const loader = new THREE.TextureLoader();

// 반복 타일 텍스처 로드 (색상맵만 sRGB)
function tex(name, repeatX, repeatY = repeatX, srgb = false) {
  const t = loader.load(`textures/${name}.png`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function pbr(name, rx, ry = rx, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex(`${name}_basecolor`, rx, ry, true),
    normalMap: tex(`${name}_normal`, rx, ry),
    roughnessMap: tex(`${name}_roughness`, rx, ry),
    color: '#ffffff', roughness: 1, metalness: 0.05, ...extra
  });
}

export function buildBoard(scene) {
  const out = {};
  // 바깥 땅 (보드 주변)
  out.groundMat = pbr('ground', 8);                 // 80유닛 / 8 = 타일당 10유닛
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), out.groundMat);
  ground.position.y = -0.36; ground.receiveShadow = true;
  scene.add(ground);

  // 보드 받침 (단상)
  out.plinthMat = pbr('metal', 4, 0.5, { metalness: 0.55 });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(N + 0.6, 0.36, N + 0.6), out.plinthMat);
  plinth.position.y = -0.19; plinth.receiveShadow = true; plinth.castShadow = true;
  scene.add(plinth);

  // 배치 칸 바닥: 보드 전체를 덮는 한 장 + 격자 (repeat = 칸 수)
  // 텍스처 1장 = 4x4 판석 → repeat N/4 이면 판석 1장이 정확히 1칸
  out.floorMat = pbr('floor', N / 4, N / 4, { normalScale: new THREE.Vector2(0.8, 0.8) });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(N, N).rotateX(-Math.PI / 2), out.floorMat);
  floor.receiveShadow = true;
  scene.add(floor);

  // 몬스터 길: 칸마다 살짝 낮은 판을 하나의 InstancedMesh로
  out.pathMat = pbr('path', 1, 1, { emissive: '#ff7a3a', emissiveMap: tex('path_emissive', 1, 1, true), emissiveIntensity: 1.0 });
  const cells = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (isPath(x, y)) cells.push(cellToWorld(x, y));
  const PATH_UV = 4;   // 텍스처 1장이 4칸을 덮음
  const pos = [], uv = [], nor = [], idx = [];
  cells.forEach((p, i) => {
    const y = 0.012;
    for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const x = p.x + dx, z = p.z + dz;
      pos.push(x, y, z); nor.push(0, 1, 0); uv.push((x + N / 2) / PATH_UV, -(z + N / 2) / PATH_UV);
    }
    const o = i * 4; idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  });
  const pg0 = new THREE.BufferGeometry();
  pg0.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pg0.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  pg0.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  pg0.setIndex(idx);
  const path = new THREE.Mesh(pg0, out.pathMat);
  const m = new THREE.Matrix4();
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
