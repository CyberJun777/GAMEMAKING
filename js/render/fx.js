// 공격선·충격파·파편 이펙트. 전부 InstancedMesh (가산 혼합) — 종류당 draw call 1개.
import * as THREE from '../../vendor/three.module.js';
import { FACTIONS, GRADES } from '../config.js';

const MAX_BEAM = 400, MAX_RING = 120, MAX_PART = 500;
const facCol = Object.fromEntries(FACTIONS.map(f => [f.key, new THREE.Color(f.color)]));
const gradeCol = GRADES.map(g => new THREE.Color(g.color));
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color();
const Z = new THREE.Vector3(0, 0, 1);

function addMesh(scene, geo, n) {
  const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, new THREE.Color());
  m.count = 0; m.frustumCulled = false; m.renderOrder = 10;
  scene.add(m);
  return m;
}

export class Fx {
  constructor(scene) {
    this.beamMesh = addMesh(scene, new THREE.BoxGeometry(1, 1, 1), MAX_BEAM);
    this.ringMesh = addMesh(scene, new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2), MAX_RING);
    this.partMesh = addMesh(scene, new THREE.OctahedronGeometry(0.06, 0), MAX_PART);
    this.beams = []; this.rings = []; this.parts = [];
  }
  clear() { this.beams.length = this.rings.length = this.parts.length = 0; }

  attack(e) {
    const col = facCol[e.f].clone().lerp(gradeCol[e.gr], 0.4);
    const w = 0.03 + e.gr * 0.018;
    const y0 = 0.45, y1 = 0.3;
    if (e.kind === 'field') { this.ring(e.x, e.z, e.r, col, 0.4, 0.5); return; }
    if (this.beams.length < MAX_BEAM) this.beams.push({ a: new THREE.Vector3(e.x, y0, e.z), b: new THREE.Vector3(e.tx, y1, e.tz), col, w, life: 0.14, max: 0.14 });
    if (e.kind === 'splash') this.ring(e.tx, e.tz, e.r, col, 0.3);
    else if (e.gr >= 1) this.burst(e.tx, e.tz, col, 2 + e.gr, 0.25);
  }
  ring(x, z, r, col, life = 0.3, op = 1, delay = 0) {
    if (this.rings.length >= MAX_RING) return;
    this.rings.push({ x, z, r, col: new THREE.Color(col).multiplyScalar(op), life, max: life, delay });
  }
  // 합성 연출: 등급이 높을수록 크고 길게. 빛기둥 + 시간차 고리 여러 겹 + 파편 (기존 인스턴스 재사용 → draw call 증가 없음)
  mergeBlast(x, z, g) {
    const col = gradeCol[g];
    const h = 1.6 + g * 0.7, life = 0.55 + g * 0.18;
    if (this.beams.length < MAX_BEAM) this.beams.push({ a: new THREE.Vector3(x, 0.05, z), b: new THREE.Vector3(x, h, z), col: col.clone().multiplyScalar(1.4), w: 0.16 + g * 0.06, life, max: life, pillar: true });
    for (let i = 0; i <= g + 1; i++) this.ring(x, z, 1.0 + i * 0.55 + g * 0.2, col, 0.45 + g * 0.08, 1.2 - i * 0.15, i * 0.09);
    this.burst(x, z, col, 12 + g * 8, 0.7 + g * 0.15);
  }
  // 보스 등장 경고: 붉은 고리 연속
  bossWarn(x, z) {
    const col = new THREE.Color('#ff3040');
    for (let i = 0; i < 5; i++) this.ring(x, z, 2.6 - i * 0.35, col, 0.6, 1.3, i * 0.14);
  }
  burst(x, z, col, n, speed = 1) {
    const c = new THREE.Color(col);
    for (let i = 0; i < n && this.parts.length < MAX_PART; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.8 + Math.random() * 1.6) * speed;
      this.parts.push({ p: new THREE.Vector3(x, 0.35, z), v: new THREE.Vector3(Math.cos(a) * v, 1.5 + Math.random() * 2 * speed, Math.sin(a) * v), col: c, life: 0.5, max: 0.5 });
    }
  }

  update(dt) {
    // 공격선
    let n = 0;
    const bm = this.beamMesh;
    this.beams = this.beams.filter(b => (b.life -= dt) > 0);
    for (const b of this.beams) {
      const k = b.life / b.max;
      const d = P.subVectors(b.b, b.a); const len = d.length();
      Q.setFromUnitVectors(Z, d.normalize());
      const w = b.pillar ? b.w * Math.min(1, k * 2.5) : b.w * (0.5 + k);
      M.compose(P.addVectors(b.a, b.b).multiplyScalar(0.5), Q, S.set(w, w, len));
      bm.setMatrixAt(n, M); bm.setColorAt(n++, C.copy(b.col).multiplyScalar(0.4 + k * 1.4));
    }
    bm.count = n; bm.instanceMatrix.needsUpdate = true; if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
    // 충격파
    n = 0; const rm = this.ringMesh;
    this.rings = this.rings.filter(r => r.delay > 0 ? ((r.delay -= dt), true) : (r.life -= dt) > 0);
    for (const r of this.rings) {
      if (r.delay > 0) continue;
      const k = r.life / r.max, s = r.r * (1.1 - k * 0.5);
      Q.identity(); M.compose(P.set(r.x, 0.08, r.z), Q, S.set(s, 1, s));
      rm.setMatrixAt(n, M); rm.setColorAt(n++, C.copy(r.col).multiplyScalar(k));
    }
    rm.count = n; rm.instanceMatrix.needsUpdate = true; if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
    // 파편
    n = 0; const pm = this.partMesh;
    this.parts = this.parts.filter(p => (p.life -= dt) > 0);
    for (const p of this.parts) {
      p.v.y -= 9 * dt; p.p.addScaledVector(p.v, dt);
      if (p.p.y < 0.05) { p.p.y = 0.05; p.v.y *= -0.3; p.v.x *= 0.6; p.v.z *= 0.6; }
      const k = p.life / p.max;
      Q.identity(); M.compose(p.p, Q, S.setScalar(0.6 + k));
      pm.setMatrixAt(n, M); pm.setColorAt(n++, C.copy(p.col).multiplyScalar(k * 1.5));
    }
    pm.count = n; pm.instanceMatrix.needsUpdate = true; if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
  }
}
