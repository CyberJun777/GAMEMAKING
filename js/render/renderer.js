// Three.js 렌더러. 시뮬레이션 상태를 읽기만 한다 (상태를 바꾸지 않음).
import * as THREE from '../../vendor/three.module.js';
import { BOARD, GRADES, FACTIONS, UNITS } from '../config.js';
import { UNIT_SHAPES, ANIM } from './unitShapes.js';
import { cellToWorld } from '../sim/board.js';
import { buildBoard } from './board.js';
import { Fx } from './fx.js';

const MAX_UNITS = 220, MAX_MON = 160;
const MODEL_SCALE = 1.22;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const gradeCol = GRADES.map(g => new THREE.Color(g.color));
const facCol = Object.fromEntries(FACTIONS.map(f => [f.key, new THREE.Color(f.color)]));

function inst(geo, mat, n) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, new THREE.Color(1, 1, 1));
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = true;
  return m;
}

// 여러 지오메트리를 하나로 합침 (위치·노멀만)
function merge(geos) {
  const parts = geos.map(g => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
const tr = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; };

export function detectLowSpec(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch { return false; }
}

export class Renderer {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.lowSpec = detectLowSpec(r.getContext());
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.lowSpec ? 1 : 2));
    r.setSize(container.clientWidth, container.clientHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = this.lowSpec ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    r.info.autoReset = false;
    container.appendChild(r.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0e16');
    scene.fog = new THREE.Fog('#0a0e16', 26, 48);

    // 카메라: 고정 각도 쿼터뷰, 방향키로 이동, 휠로 줌
    this.camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.5, 120);
    this.camTarget = new THREE.Vector3(0.9, 0, 1.2);
    this.camDist = 23;
    this.camPolar = THREE.MathUtils.degToRad(40);   // 수직에서 기울어진 각
    this.updateCamera();

    // 조명
    scene.add(new THREE.HemisphereLight('#a9c4ff', '#262a33', 0.85));   // 지면 바운스 = 현무암 바닥 톤
    const sun = this.sun = new THREE.DirectionalLight('#fff1dc', 2.3);
    sun.position.set(-8, 16, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 11; Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    this.board = buildBoard(scene);
    this.buildUnits();
    this.buildMonsters();
    this.buildOverlays();
    this.fx = new Fx(scene);

    this.unitYaw = new Map();   // 유닛 id → 포신 방향
    this.clock = 0;
    window.addEventListener('resize', () => this.resize());
  }

  updateCamera() {
    const half = BOARD.size / 2;
    this.camTarget.x = THREE.MathUtils.clamp(this.camTarget.x, -half, half);
    this.camTarget.z = THREE.MathUtils.clamp(this.camTarget.z, -half, half + 2);
    this.camDist = THREE.MathUtils.clamp(this.camDist, 11, 32);
    const c = this.camera, t = this.camTarget;
    c.position.set(t.x, t.y + Math.cos(this.camPolar) * this.camDist, t.z + Math.sin(this.camPolar) * this.camDist);
    c.lookAt(t);
  }
  pan(dx, dz) { this.camTarget.x += dx; this.camTarget.z += dz; this.updateCamera(); }
  zoom(f) { this.camDist *= f; this.updateCamera(); }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ───────── 유닛: 15종마다 고유 실루엣. 몸체(진영색) + 장식(등급색) = 종마다 InstancedMesh 2개
  buildUnits() {
    const std = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.2, ...o });
    const glow = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.45, ...o });
    const P = this.parts = {};
    P.base = inst(new THREE.CylinderGeometry(0.4, 0.45, 0.14, 10).translate(0, 0.07, 0), glow({ emissiveIntensity: 0.22 }), MAX_UNITS);
    // 전설·신 후광
    P.halo = inst(new THREE.TorusGeometry(0.5, 0.035, 6, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.9, toneMapped: false }), MAX_UNITS);
    P.halo.castShadow = false;
    // 재질은 진영별 1개씩 공유 (몸체), 장식은 1개 공유
    const bodyMat = { mech: std({ metalness: 0.6, roughness: 0.38 }), bio: std({ roughness: 0.75, metalness: 0 }), arc: std({ flatShading: true, roughness: 0.3, emissive: '#6a2fb0', emissiveIntensity: 0.5 }) };
    const trimMat = glow();
    this.typeMesh = {};
    for (const def of UNITS) {
      const shape = UNIT_SHAPES[def.id]();
      const body = inst(merge(shape.body), bodyMat[def.faction], MAX_UNITS);
      const trim = inst(merge(shape.trim), trimMat, MAX_UNITS);
      body.name = `unit-${def.id}-body`; trim.name = `unit-${def.id}-trim`;
      P[`${def.id}B`] = body; P[`${def.id}T`] = trim;
      this.typeMesh[def.id] = { body, trim, anim: shape.anim || ANIM[def.faction], hover: shape.hover || 0 };
    }
    for (const m of Object.values(P)) this.scene.add(m);
  }

  buildMonsters() {
    this.monMesh = inst(new THREE.IcosahedronGeometry(0.21, 0), new THREE.MeshStandardMaterial({ roughness: 0.5, flatShading: true, emissive: '#2a1440', emissiveIntensity: 0.6 }), MAX_MON);
    this.scene.add(this.monMesh);
    // 보스·미션 보스 (동시에 최대 1마리씩)
    const bossGeo = merge([new THREE.IcosahedronGeometry(0.42, 1), ...[0, 1, 2, 3, 4, 5].map(i => { const a = i * Math.PI / 3; return tr(new THREE.ConeGeometry(0.09, 0.4, 5), Math.cos(a) * 0.42, 0.1, Math.sin(a) * 0.42, 0, 0, 0).rotateY(0); })]);
    this.bossMesh = new THREE.Mesh(bossGeo, new THREE.MeshStandardMaterial({ color: '#c3263b', roughness: 0.4, flatShading: true, emissive: '#5a0010', emissiveIntensity: 0.8 }));
    this.missionMesh = new THREE.Mesh(bossGeo, new THREE.MeshStandardMaterial({ color: '#e0a72c', roughness: 0.35, metalness: 0.4, flatShading: true, emissive: '#4a3000', emissiveIntensity: 0.8 }));
    for (const m of [this.bossMesh, this.missionMesh]) { m.castShadow = true; m.visible = false; this.scene.add(m); }
    // 체력바 (카메라를 보는 평면)
    const barGeo = new THREE.PlaneGeometry(1, 1);
    this.barBg = inst(barGeo, new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.6, depthWrite: false }), MAX_MON + 2);
    this.barFg = inst(barGeo, new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false }), MAX_MON + 2);
    this.barBg.castShadow = this.barFg.castShadow = false;
    this.barBg.renderOrder = 5; this.barFg.renderOrder = 6;
    this.scene.add(this.barBg, this.barFg);
  }

  buildOverlays() {
    const flat = (inner, outer, col, op) => new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false }));
    this.selRings = inst(new THREE.RingGeometry(0.44, 0.52, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7dff9a', toneMapped: false, depthWrite: false }), MAX_UNITS);
    this.selRings.castShadow = false;
    this.rangeRing = flat(0.97, 1, '#7dff9a', 0.55);
    this.rangeFill = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7dff9a', transparent: true, opacity: 0.06, depthWrite: false }));
    this.hover = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false }));
    for (const m of [this.rangeRing, this.rangeFill, this.hover]) { m.visible = false; m.position.y = 0.03; this.scene.add(m); }
    this.selRings.position.y = 0.02;
    this.scene.add(this.selRings);
  }

  setHover(cell, ok) {
    if (!cell) { this.hover.visible = false; return; }
    const { x, z } = cellToWorld(cell.cx, cell.cy);
    this.hover.position.set(x, 0.03, z);
    this.hover.material.color.set(ok ? '#ffffff' : '#ff5d5d');
    this.hover.visible = true;
  }

  // 시뮬레이션 이벤트 → 이펙트
  consume(events) {
    for (const e of events) {
      if (e.t === 'atk') {
        if (e.uid) this.unitYaw.set(e.uid, Math.atan2(e.tx - e.x, e.tz - e.z));
        this.fx.attack(e);
      } else if (e.t === 'die') this.fx.burst(e.x, e.z, e.kind === 'normal' ? '#ff6a7a' : '#ffd34d', e.kind === 'normal' ? 6 : 30);
      else if (e.t === 'merge') { this.fx.ring(e.x, e.z, 1.4, gradeCol[e.g], 0.5); this.fx.burst(e.x, e.z, GRADES[e.g].color, 14, 0.6); }
      else if (e.t === 'unit') this.fx.ring(e.x, e.z, 0.7, gradeCol[e.g], 0.35);
      else if (e.t === 'escape') this.fx.burst(e.x, e.z, '#888', 20);
    }
  }

  render(game, alpha, dt, selection) {
    this.clock += dt;
    const t = this.clock;
    this.renderer.info.reset();
    this.board.pathMat.emissiveIntensity = 0.85 + Math.sin(t * 1.6) * 0.25;
    this.drawUnits(game, t, selection);
    this.drawMonsters(game, alpha, t);
    this.fx.update(dt, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  drawUnits(game, t, selection) {
    const P = this.parts;
    for (const k in P) P[k].count = 0;
    const put = (mesh, x, y, z, sc, yaw, col, sx = sc, sy = sc, sz = sc) => {
      const i = mesh.count++;
      tmpQ.setFromAxisAngle(UP, yaw);
      tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
      mesh.setMatrixAt(i, tmpM);
      mesh.setColorAt(i, col);
    };
    let si = 0;
    for (const u of game.units) {
      const g = u.def.grade, f = u.def.faction;
      const sc = 0.82 + g * 0.11;
      const born = Math.min(1, (game.time - u.born) * 4 + 0.2);
      const s = sc * (born < 1 ? 0.5 + born * 0.5 : 1);
      const gc = gradeCol[g], fc = facCol[f];
      put(P.base, u.x, 0, u.z, s, 0, gc, s * 1.05, 1, s * 1.05);
      const tm = this.typeMesh[u.type];
      let y = tm.hover * s, yaw = 0, sx = s, sy = s;
      if (tm.anim === 'aim') { yaw = this.unitYaw.get(u.id) ?? 0; if (tm.hover) y += Math.sin(t * 3 + u.id) * 0.04; }
      else if (tm.anim === 'pulse') { const p = 1 + Math.sin(t * 3 + u.id) * 0.04; sx = s * p; sy = s / p; yaw = u.id * 1.3; }
      else { y += 0.06 + Math.sin(t * 2 + u.id) * 0.06; yaw = t * 0.9 + u.id; }
      const k = MODEL_SCALE;   // 받침보다 모델을 크게 → 실루엣이 먼저 보이게
      put(tm.body, u.x, y, u.z, s, yaw, fc, sx * k, sy * k, sx * k);
      put(tm.trim, u.x, y, u.z, s, yaw, gc, sx * k, sy * k, sx * k);
      if (g >= 3) put(P.halo, u.x, 0.95 * s + Math.sin(t * 2 + u.id) * 0.04, u.z, s * (g === 4 ? 1.1 : 0.85), t, gc);
      if (selection.has(u.id)) {
        tmpM.makeTranslation(u.x, 0, u.z);
        this.selRings.setMatrixAt(si++, tmpM);
      }
    }
    this.selRings.count = si;
    for (const k in P) { P[k].instanceMatrix.needsUpdate = true; if (P[k].instanceColor) P[k].instanceColor.needsUpdate = true; }
    this.selRings.instanceMatrix.needsUpdate = true;

    // 대표 선택 유닛 사거리 표시
    const prim = selection.size ? game.unitById([...selection][0]) : null;
    if (prim && prim.def.range < 50) {
      const r = prim.def.range;
      for (const m of [this.rangeRing, this.rangeFill]) { m.visible = true; m.position.set(prim.x, 0.03, prim.z); m.scale.set(r, 1, r); }
    } else { this.rangeRing.visible = this.rangeFill.visible = false; }
  }

  drawMonsters(game, alpha, t) {
    const mm = this.monMesh; mm.count = 0;
    const bg = this.barBg, fg = this.barFg; bg.count = fg.count = 0;
    this.bossMesh.visible = this.missionMesh.visible = false;
    const camQ = this.camera.quaternion;
    // 몬스터 색: 붉은 용암 길과 대비되는 밝은 보라~자홍 (라운드마다 조금씩 변화)
    const monCol = new THREE.Color().setHSL(0.74 + ((game.round * 0.037) % 0.14), 0.75, 0.66);
    const slowCol = new THREE.Color('#79c8ff');
    const bar = (x, y, z, w, ratio, col) => {
      tmpM.compose(tmpP.set(x, y, z), camQ, tmpS.set(w, 0.07, 1));
      bg.setMatrixAt(bg.count++, tmpM);
      // 왼쪽 정렬: 카메라 오른쪽 벡터로 이동
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQ);
      tmpP.set(x, y, z).addScaledVector(right, -w * (1 - ratio) / 2);
      tmpM.compose(tmpP, camQ, tmpS.set(Math.max(0.001, w * ratio), 0.07, 1));
      fg.setMatrixAt(fg.count, tmpM); fg.setColorAt(fg.count++, col);
    };
    for (const m of game.monsters) {
      if (!m.alive) continue;
      const x = m.px + (m.x - m.px) * alpha, z = m.pz + (m.z - m.pz) * alpha;
      if (m.kind === 'normal') {
        if (mm.count >= MAX_MON) continue;
        const bob = 0.24 + Math.abs(Math.sin(t * 6 + m.id)) * 0.08;
        tmpE.set(t * 2 + m.id, t * 3, 0); tmpQ.setFromEuler(tmpE);
        tmpM.compose(tmpP.set(x, bob, z), tmpQ, tmpS.setScalar(1));
        mm.setMatrixAt(mm.count, tmpM);
        mm.setColorAt(mm.count++, m.slow > 0 ? slowCol : monCol);
        if (m.hp < m.maxHp) bar(x, 0.62, z, 0.5, m.hp / m.maxHp, tmpC.setRGB(1 - m.hp / m.maxHp, 0.85, 0.25));
      } else {
        const mesh = m.kind === 'boss' ? this.bossMesh : this.missionMesh;
        mesh.visible = true;
        mesh.position.set(x, 0.55 + Math.sin(t * 2) * 0.06, z);
        mesh.rotation.y = t * 0.8;
        mesh.scale.setScalar(1.0);
        bar(x, 1.25, z, 1.2, Math.max(0, m.hp / m.maxHp), tmpC.set(m.kind === 'boss' ? '#ff5d5d' : '#ffd34d'));
      }
    }
    mm.instanceMatrix.needsUpdate = true; if (mm.instanceColor) mm.instanceColor.needsUpdate = true;
    bg.instanceMatrix.needsUpdate = true; fg.instanceMatrix.needsUpdate = true; if (fg.instanceColor) fg.instanceColor.needsUpdate = true;
  }

  // 화면 좌표 → 칸
  pickCell(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(UP, 0), hit)) return null;
    const half = (BOARD.size - 1) / 2;
    const cx = Math.round(hit.x + half), cy = Math.round(hit.z + half);
    if (cx < 0 || cy < 0 || cx >= BOARD.size || cy >= BOARD.size) return null;
    return { cx, cy };
  }
  // 월드 → 화면 좌표 (박스 선택용)
  toScreen(x, y, z) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
  }
  stats() {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, lowSpec: this.lowSpec };
  }
  reset() { this.unitYaw.clear(); this.fx.clear(); }
}
