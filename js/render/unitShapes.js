// 유닛 15종 실루엣 정의. 종마다 { body: 진영색 부품들, trim: 등급색 부품들 }.
// 좌표: 받침 윗면 y≈0.14, 앞쪽 = +z (기계 유닛은 이 방향이 표적을 향함). 종당 삼각형 ≤ 1,500.
import * as THREE from '../../vendor/three.module.js';

const tr = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; };
const box = (w, h, d, x, y, z, rx, ry, rz) => tr(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
const cyl = (r0, r1, h, seg, x, y, z, rx, ry, rz) => tr(new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z, rx, ry, rz);
const cone = (r, h, seg, x, y, z, rx, ry, rz) => tr(new THREE.ConeGeometry(r, h, seg), x, y, z, rx, ry, rz);
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 10, hs = 7) => tr(new THREE.SphereGeometry(r, ws, hs).scale(sx, sy, sz), x, y, z);
const ring = (r, t, x, y, z, rx = Math.PI / 2, ry = 0, rz = 0, seg = 20) => tr(new THREE.TorusGeometry(r, t, 5, seg), x, y, z, rx, ry, rz);
const around = (n, fn) => Array.from({ length: n }, (_, i) => fn(i * Math.PI * 2 / n, i));

// 진영 기본 애니메이션: 기계 = 표적 조준, 생체 = 숨쉬기, 비전 = 떠서 회전
export const ANIM = { mech: 'aim', bio: 'pulse', arc: 'float' };

export const UNIT_SHAPES = {
  // ───── 기계 (사각·포신 실루엣)
  // 포탑병: 작은 상자 차체 + 짧은 포신 1개
  m0: () => ({
    body: [box(0.42, 0.22, 0.42, 0, 0.25, 0), box(0.26, 0.14, 0.26, 0, 0.43, 0)],
    trim: [cyl(0.05, 0.05, 0.34, 6, 0, 0.43, 0.3, Math.PI / 2), box(0.44, 0.04, 0.44, 0, 0.36, 0)]
  }),
  // 저격드론: 떠 있는 납작한 원반 + 프로펠러 팔 4개 + 아래로 긴 총열
  m1: () => ({
    hover: 0.25,
    body: [cyl(0.2, 0.24, 0.1, 8, 0, 0.35, 0), ...around(4, a => box(0.05, 0.04, 0.42, Math.sin(a + Math.PI / 4) * 0.22, 0.36, Math.cos(a + Math.PI / 4) * 0.22, 0, a + Math.PI / 4))],
    trim: [...around(4, a => cyl(0.1, 0.1, 0.02, 10, Math.sin(a + Math.PI / 4) * 0.4, 0.4, Math.cos(a + Math.PI / 4) * 0.4)), cyl(0.03, 0.03, 0.6, 5, 0, 0.27, 0.22, Math.PI / 2)]
  }),
  // 레일캐논: 길고 낮은 차체 + 평행 레일 2줄
  m2: () => ({
    body: [box(0.5, 0.2, 0.6, 0, 0.24, -0.04), box(0.3, 0.18, 0.3, 0, 0.42, -0.1)],
    trim: [box(0.06, 0.07, 0.85, -0.1, 0.46, 0.25), box(0.06, 0.07, 0.85, 0.1, 0.46, 0.25), box(0.3, 0.04, 0.06, 0, 0.46, 0.55)]
  }),
  // 궤도포대: 높은 탑 + 위에 위성 접시
  m3: () => ({
    body: [cyl(0.14, 0.26, 0.6, 8, 0, 0.44, 0), box(0.4, 0.1, 0.4, 0, 0.19, 0)],
    trim: [tr(new THREE.SphereGeometry(0.3, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2.6).rotateX(Math.PI * 0.62), 0, 0.82, 0.05), cyl(0.02, 0.02, 0.36, 4, 0, 0.88, 0.18, Math.PI * 0.62), ball(0.05, 0, 0.98, 0.32)]
  }),
  // 종말병기: 넓은 전차 + 큰 포탑 + 3연장 포신 + 옆 날개
  m4: () => ({
    body: [box(0.62, 0.22, 0.62, 0, 0.26, 0), cyl(0.24, 0.28, 0.22, 8, 0, 0.48, -0.02), box(0.14, 0.3, 0.5, -0.36, 0.3, 0), box(0.14, 0.3, 0.5, 0.36, 0.3, 0)],
    trim: [...[-0.1, 0, 0.1].map((x, i) => cyl(0.045, 0.05, 0.6, 6, x, i === 1 ? 0.56 : 0.48, 0.38, Math.PI / 2)), box(0.04, 0.32, 0.3, -0.45, 0.42, -0.08, 0, 0, -0.4), box(0.04, 0.32, 0.3, 0.45, 0.42, -0.08, 0, 0, 0.4)]
  }),

  // ───── 생체 (둥근 몸·가시·다리)
  // 가시벌레: 길게 누운 몸 + 등의 가시 한 줄
  b0: () => ({
    body: [ball(0.2, 0, 0.3, 0, 0.9, 0.7, 1.6), ball(0.12, 0, 0.3, 0.33)],
    trim: [...[-0.18, -0.06, 0.06, 0.18].map(z => cone(0.06, 0.22, 5, 0, 0.5, z, -0.3)), cone(0.03, 0.14, 4, -0.06, 0.32, 0.45, Math.PI / 2), cone(0.03, 0.14, 4, 0.06, 0.32, 0.45, Math.PI / 2)]
  }),
  // 산성거미: 둥근 몸 + 굽은 다리 8개 (등급색)
  b1: () => ({
    body: [ball(0.2, 0, 0.36, -0.06, 1, 0.8, 1.15), ball(0.11, 0, 0.32, 0.2)],
    trim: around(8, (a) => box(0.035, 0.035, 0.36, Math.sin(a) * 0.26, 0.3, Math.cos(a) * 0.26, 0.5, a)).concat(around(8, a => box(0.03, 0.22, 0.03, Math.sin(a) * 0.42, 0.18, Math.cos(a) * 0.42)))
  }),
  // 독안개꽃: 줄기 + 봉오리 + 바깥으로 벌어진 꽃잎 6장
  b2: () => ({
    body: [cyl(0.05, 0.08, 0.4, 6, 0, 0.32, 0), ball(0.13, 0, 0.58, 0), ...around(2, a => tr(new THREE.SphereGeometry(0.1, 6, 4).scale(1.6, 0.25, 0.8), Math.sin(a) * 0.15, 0.3, Math.cos(a) * 0.15, 0, a + Math.PI / 2))],
    trim: around(6, a => tr(new THREE.SphereGeometry(0.12, 6, 4).scale(0.6, 0.18, 1.5).rotateX(-0.6), Math.sin(a) * 0.2, 0.62, Math.cos(a) * 0.2, 0, a))
  }),
  // 군체여왕: 위로 쌓인 마디 몸 + 날개 2장 + 왕관 가시
  b3: () => ({
    body: [ball(0.22, 0, 0.3, 0, 1, 0.7, 1), ball(0.16, 0, 0.55, 0), ball(0.11, 0, 0.75, 0.02)],
    trim: [...around(5, a => cone(0.035, 0.18, 4, Math.sin(a) * 0.08, 0.9, Math.cos(a) * 0.08)), tr(new THREE.SphereGeometry(0.2, 6, 4).scale(1.4, 0.12, 0.6), -0.26, 0.6, -0.08, 0, 0, 0.5), tr(new THREE.SphereGeometry(0.2, 6, 4).scale(1.4, 0.12, 0.6), 0.26, 0.6, -0.08, 0, 0, -0.5)]
  }),
  // 세계수: 굵은 줄기 + 큰 수관 + 뿌리 + 열매
  b4: () => ({
    body: [cyl(0.08, 0.14, 0.5, 7, 0, 0.38, 0), tr(new THREE.IcosahedronGeometry(0.32, 1), 0, 0.85, 0), tr(new THREE.IcosahedronGeometry(0.2, 1), 0.24, 0.72, 0.08), tr(new THREE.IcosahedronGeometry(0.2, 1), -0.22, 0.74, -0.1)],
    trim: [...around(5, a => cone(0.05, 0.3, 4, Math.sin(a) * 0.17, 0.2, Math.cos(a) * 0.17, Math.cos(a) * 1.2, 0, -Math.sin(a) * 1.2)), ...around(6, (a, i) => ball(0.05, Math.sin(a) * 0.3, 0.75 + (i % 2) * 0.2, Math.cos(a) * 0.3, 1, 1, 1, 6, 4))]
  }),

  // ───── 비전 (떠 있는 결정·고리)
  // 불씨술사: 작은 구슬 + 위에 불꽃 원뿔
  a0: () => ({
    body: [ball(0.17, 0, 0.36, 0, 1, 1, 1, 8, 6)],
    trim: [cone(0.13, 0.34, 6, 0, 0.66, 0), cone(0.06, 0.18, 5, 0.1, 0.56, 0.04, 0, 0, -0.5), cone(0.06, 0.18, 5, -0.1, 0.56, -0.04, 0, 0, 0.5)]
  }),
  // 번개구슬: 구 + 주위를 도는 작은 구슬 3개 + 기울어진 고리
  a1: () => ({
    body: [tr(new THREE.IcosahedronGeometry(0.19, 1), 0, 0.45, 0)],
    trim: [ring(0.32, 0.02, 0, 0.45, 0, Math.PI / 2 + 0.4), ...around(3, a => ball(0.06, Math.sin(a) * 0.32, 0.45 + Math.cos(a) * 0.12, Math.cos(a) * 0.3, 1, 1, 1, 6, 4))]
  }),
  // 유성술사: 뾰족한 로브(원뿔) + 머리 위에 떠 있는 바위
  a2: () => ({
    body: [cone(0.24, 0.6, 6, 0, 0.42, 0), ball(0.1, 0, 0.74, 0, 1, 1, 1, 6, 5)],
    trim: [tr(new THREE.DodecahedronGeometry(0.15, 0), 0, 1.0, 0), cone(0.05, 0.22, 4, 0.08, 0.86, 0, 0, 0, 0.6), ring(0.26, 0.018, 0, 0.3, 0)]
  }),
  // 폭풍핵: 위아래 쌍원뿔(방추) + 교차된 고리 2개
  a3: () => ({
    body: [cone(0.2, 0.36, 6, 0, 0.72, 0), cone(0.2, 0.36, 6, 0, 0.36, 0, Math.PI)],
    trim: [ring(0.34, 0.025, 0, 0.54, 0, 0.3, 0, 0), ring(0.34, 0.025, 0, 0.54, 0, Math.PI - 0.3, 0, 0), ring(0.34, 0.025, 0, 0.54, 0, Math.PI / 2)]
  }),
  // 프리즘 신: 큰 팔면체 프리즘 + 둘레의 작은 프리즘 4개 + 넓은 고리
  a4: () => ({
    body: [tr(new THREE.OctahedronGeometry(0.28, 0).scale(1, 1.6, 1), 0, 0.68, 0)],
    trim: [...around(4, a => tr(new THREE.OctahedronGeometry(0.09, 0).scale(1, 1.8, 1), Math.sin(a) * 0.42, 0.68, Math.cos(a) * 0.42)), ring(0.42, 0.02, 0, 0.68, 0, Math.PI / 2, 0, 0, 28), ring(0.24, 0.02, 0, 0.3, 0)]
  })
};
