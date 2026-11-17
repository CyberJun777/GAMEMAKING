// Three.js 렌더링. 시뮬레이션 상태(state)를 읽어서 그리기만 한다 (상태를 바꾸지 않음).
import * as THREE from '../../vendor/three.module.js';
import { CFG } from '../config.js';

export const TEAM_COLORS = [0x18b5a8, 0xf08a24];       // 청록 / 주황
const ROLE_SHADE = { runner: 1.0, keeper: 0.62, breaker: 0.8, hunter: 1.25 };

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();
const tmpV = new THREE.Vector3();

export function detectLowSpec(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    return /swiftshader|llvmpipe|software/i.test(String(name));
  } catch { return false; }
}

export function createRenderer(canvas, { textures = {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  // ?quality=high 로 강제 고품질(성능 예산 측정용), ?quality=low 로 강제 저사양
  const q = new URLSearchParams(location.search).get('quality');
  const lowSpec = q === 'high' ? false : q === 'low' ? true : detectLowSpec(renderer);
  renderer.shadowMap.enabled = !lowSpec;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const SKY_TOP = new THREE.Color(0x3b6fb6), SKY_BOT = new THREE.Color(0xcfe3f0);
  scene.fog = new THREE.Fog(0xbcd3e6, 140, 420);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
  camera.position.set(-40, 20, 0);

  // ── 하늘 (그라데이션 돔, draw call 1)
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(800, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: SKY_TOP }, bot: { value: SKY_BOT } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y*1.4+0.15,0.,1.); gl_FragColor = vec4(mix(bot, top, h),1.); }',
    }));
  scene.add(sky);

  // ── 조명
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a6b3a, 0.85));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(-60, 110, 50);
  sun.castShadow = !lowSpec;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 60, bottom: -60, near: 10, far: 300 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const { rx, rz } = CFG.arena;

  // ── 경기장 바닥: 타원 필드 + 바깥 땅
  const fieldGeo = new THREE.CircleGeometry(1, 96);
  fieldGeo.rotateX(-Math.PI / 2);
  fieldGeo.scale(rx, 1, rz);
  // 텍스처 UV를 월드 좌표 기반으로 (repeat 밀도 = 맵크기/12 규칙)
  const uv = fieldGeo.attributes.uv, pos = fieldGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 12, pos.getZ(i) / 12);
  const fieldMat = new THREE.MeshStandardMaterial({ color: 0x4f8f3a, roughness: 0.95 });
  if (textures.field) applyTiling(fieldMat, textures.field);   // UV가 이미 월드/12 → repeat 1
  const field = new THREE.Mesh(fieldGeo, fieldMat);
  field.receiveShadow = true;
  scene.add(field);

  const outer = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x5d7f45, roughness: 1 }));
  outer.position.y = -0.05;
  scene.add(outer);

  // 라인: 센터 서클 + 금지 구역 선 (한 메시로 병합)
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf3f7ee, transparent: true, opacity: 0.75 });
  const lines = [];
  const center = new THREE.RingGeometry(7.6, 8, 64).rotateX(-Math.PI / 2);
  lines.push(center);
  for (const end of [1, -1]) {
    const cx = end * (CFG.rings.x - CFG.rings.crease);
    const zMax = rz * Math.sqrt(1 - (cx / rx) ** 2);
    const g = new THREE.PlaneGeometry(0.4, zMax * 2).rotateX(-Math.PI / 2);
    g.translate(cx, 0, 0);
    lines.push(g);
  }
  const lineMesh = new THREE.Mesh(mergeGeos(lines), lineMat);
  lineMesh.position.y = 0.03;
  scene.add(lineMesh);

  // ── 관중석 (타원 경사 스탠드) + 관중 인스턴스
  const profile = [[1.06, 0], [1.06, 3], [1.34, 17], [1.40, 17], [1.40, 0]].map(([r, y]) => new THREE.Vector2(r, y));
  const standGeo = new THREE.LatheGeometry(profile, 96);
  standGeo.scale(rx, 1, rz);
  const standMat = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.8, metalness: 0.1 });
  // 관중석 Lathe UV는 0..1 → 둘레 ~474u, 단면 ~50u 이므로 타일 하나 ≈ 12u 가 되게 repeat (40, 4)
  if (textures.stand) applyTiling(standMat, textures.stand, true, [40, 4]);
  const stand = new THREE.Mesh(standGeo, standMat);
  stand.receiveShadow = true;
  scene.add(stand);

  const CROWD = lowSpec ? 1200 : 3000;
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 1.0, 0.55), new THREE.MeshLambertMaterial(), CROWD);
  const palette = [TEAM_COLORS[0], TEAM_COLORS[1], 0xe8e2d0, 0x3d4a66, 0x9c3d3d, 0xd8c35a];
  for (let i = 0; i < CROWD; i++) {
    const a = Math.random() * Math.PI * 2;
    const t = Math.random();
    const r = 1.075 + t * 0.255;
    const y = 3 + t * 14 + 0.55;
    tmpObj.position.set(Math.cos(a) * rx * r, y, Math.sin(a) * rz * r);
    tmpObj.rotation.set(0, -a + Math.PI / 2, 0);
    tmpObj.scale.setScalar(0.85 + Math.random() * 0.3);
    tmpObj.updateMatrix();
    crowd.setMatrixAt(i, tmpObj.matrix);
    // 각 팀 응원석: 자기 링 쪽 관중은 팀색 비율이 높다
    const side = Math.cos(a) < 0 ? 0 : 1;
    const c = Math.random() < 0.55 ? TEAM_COLORS[side] : palette[(Math.random() * palette.length) | 0];
    crowd.setColorAt(i, tmpColor.set(c).lerp(new THREE.Color(0x8a8f99), 0.35).multiplyScalar(0.7 + Math.random() * 0.25));
  }
  scene.add(crowd);

  // ── 링 게이트 6개 + 기둥 (각각 인스턴싱 1 draw call)
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.85, roughness: 0.3 });
  if (textures.ring) applyTiling(ringMat, textures.ring, false);
  const ringMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(CFG.rings.radius, 0.22, 10, 40), ringMat, 6);
  const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 1, 10), ringMat, 6);
  let ri = 0;
  for (const end of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const x = end * CFG.rings.x, y = CFG.rings.ys[i], z = CFG.rings.zs[i];
      tmpObj.position.set(x, y, z); tmpObj.rotation.set(0, Math.PI / 2, 0); tmpObj.scale.setScalar(1);
      tmpObj.updateMatrix(); ringMesh.setMatrixAt(ri, tmpObj.matrix);
      const h = y - CFG.rings.radius;
      tmpObj.position.set(x, h / 2, z); tmpObj.rotation.set(0, 0, 0); tmpObj.scale.set(1, h, 1);
      tmpObj.updateMatrix(); poleMesh.setMatrixAt(ri, tmpObj.matrix);
      ri++;
    }
  }
  ringMesh.castShadow = poleMesh.castShadow = true;
  scene.add(ringMesh, poleMesh);

  // 링 뒤 팀색 배너 (각 끝 1장, 어느 팀 링인지 표시)
  for (const end of [1, -1]) {
    const team = end === 1 ? 1 : 0;   // +x 링은 주황 팀이 지킨다
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(22, 5),
      new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], side: THREE.DoubleSide, roughness: 0.7 }));
    banner.position.set(end * (CFG.rings.x + 5.5), 27, 0);
    banner.rotation.y = Math.PI / 2;
    scene.add(banner);
  }

  // ── 선수 (부위별 InstancedMesh: 몸·머리·빗자루·솔·배턴 → 5 draw call)
  const N = 14;
  const bodyGeo = new THREE.CapsuleGeometry(0.36, 0.7, 4, 10); bodyGeo.translate(0, 0.35, 0); bodyGeo.rotateZ(-0.25);
  const headGeo = new THREE.SphereGeometry(0.27, 14, 10); headGeo.translate(0.25, 1.18, 0);
  const stickGeo = new THREE.CylinderGeometry(0.055, 0.055, 2.6, 6); stickGeo.rotateZ(Math.PI / 2); stickGeo.translate(0.2, -0.32, 0);
  const brushGeo = new THREE.ConeGeometry(0.32, 0.9, 8); brushGeo.rotateZ(Math.PI / 2); brushGeo.translate(-1.45, -0.32, 0);
  const batGeo = new THREE.CylinderGeometry(0.05, 0.09, 1.1, 6); batGeo.rotateZ(-0.9); batGeo.translate(0.35, 0.65, 0.5);
  const parts = {
    body: new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), N),
    head: new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xe6c3a0, roughness: 0.7 }), N),
    stick: new THREE.InstancedMesh(stickGeo, new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.8 }), N),
    brush: new THREE.InstancedMesh(brushGeo, new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 0.9 }), N),
    bat: new THREE.InstancedMesh(batGeo, new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.6 }), 4),
  };
  for (const m of Object.values(parts)) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }

  // 내 선수 표시 화살표
  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 4),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  marker.rotation.x = Math.PI;
  scene.add(marker);

  // ── 볼들
  const comet = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0xb3262e, roughness: 0.55 }));
  comet.castShadow = true;
  const stoneMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.62, 1),
    new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.35, metalness: 0.6, flatShading: true }), CFG.stone.count);
  stoneMesh.castShadow = true;
  const orb = new THREE.Group();
  const orbCore = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffb300, emissiveIntensity: 1.6, metalness: 0.9, roughness: 0.2 }));
  const wingGeo = new THREE.PlaneGeometry(0.9, 0.35); wingGeo.translate(0.5, 0, 0);
  const wingMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const wingL = new THREE.Mesh(wingGeo, wingMat), wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.rotation.y = Math.PI;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd36b, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(3.2);
  orb.add(orbCore, wingL, wingR, glow);
  orb.visible = false;
  scene.add(comet, stoneMesh, orb);

  // ── 파티클 (Points 1 draw call): 오브 꼬리, 부스트, 골 폭죽
  const PMAX = 300;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture(), sizeAttenuation: true }));
  points.frustumCulled = false;
  scene.add(points);
  const particles = [];   // {x,y,z,vx,vy,vz,life,max,r,g,b}

  function emit(x, y, z, n, color, speed, life) {
    tmpColor.set(color);
    for (let i = 0; i < n; i++) {
      if (particles.length >= PMAX) particles.shift();
      const a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1);
      const sp = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x, y, z, vx: Math.sin(b) * Math.cos(a) * sp, vy: Math.cos(b) * sp, vz: Math.sin(b) * Math.sin(a) * sp,
        life, max: life, r: tmpColor.r, g: tmpColor.g, b: tmpColor.b });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vy -= 2 * dt;
    }
    for (let i = 0; i < PMAX; i++) {
      const p = particles[i];
      if (p) {
        const k = p.life / p.max;
        pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
        pCol[i * 3] = p.r * k; pCol[i * 3 + 1] = p.g * k; pCol[i * 3 + 2] = p.b * k;
      } else { pPos[i * 3 + 1] = -999; }
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    pGeo.setDrawRange(0, Math.max(1, particles.length));
  }

  // ── 카메라 상태
  const cam = { pos: new THREE.Vector3(-40, 20, 0), look: new THREE.Vector3(), fov: 70, shake: 0 };

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const lerp3 = (a, b, t) => tmpV.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

  function render(s, alpha, dt, view) {
    const time = performance.now() / 1000;
    // 선수
    let bi = 0;
    for (const p of s.players) {
      const P = lerp3(p.prev, p.pos, alpha);
      const yaw = Math.atan2(p.facing.z, p.facing.x);
      const pitch = Math.max(-0.5, Math.min(0.5, Math.asin(Math.max(-1, Math.min(1, p.facing.y)))));
      // 좌우 이동에 따른 기울기(뱅크)
      const right = { x: -Math.sin(yaw), z: Math.cos(yaw) };
      const lat = p.vel.x * right.x + p.vel.z * right.z;
      const bob = Math.sin(time * 2 + p.id) * 0.12;
      tmpObj.position.set(P.x, P.y + bob, P.z);
      tmpObj.rotation.set(-lat * 0.03 + (p.stunned > 0 ? time * 12 : 0), -yaw, pitch, 'YZX');
      tmpObj.scale.setScalar(1.25);
      tmpObj.updateMatrix();
      for (const k of ['body', 'head', 'stick', 'brush']) parts[k].setMatrixAt(p.id, tmpObj.matrix);
      if (p.role === 'breaker') parts.bat.setMatrixAt(bi++, tmpObj.matrix);
      const shade = ROLE_SHADE[p.role];
      tmpColor.set(TEAM_COLORS[p.team]).multiplyScalar(shade);
      if (p.stunned > 0) tmpColor.lerp(new THREE.Color(0x777777), 0.5);
      parts.body.setColorAt(p.id, tmpColor);
      if (p.boosting && Math.random() < 0.5) {
        emit(P.x - p.facing.x * 2.2, P.y - 0.3, P.z - p.facing.z * 2.2, 1, TEAM_COLORS[p.team], 1.5, 0.5);
      }
      if (p.isHuman) marker.position.set(P.x, P.y + 2.6 + Math.sin(time * 4) * 0.15, P.z);
    }
    for (const k of Object.keys(parts)) {
      parts[k].instanceMatrix.needsUpdate = true;
      if (parts[k].instanceColor) parts[k].instanceColor.needsUpdate = true;
    }
    marker.visible = false;   // 3인칭 추적 시점에선 불필요(조준점을 가림) — 관전 모드용으로만 남겨둠

    const C = lerp3(s.comet.prev, s.comet.pos, alpha);
    comet.position.copy(C);
    comet.rotation.x += dt * 4; comet.rotation.z += dt * 3;

    s.stones.forEach((st, i) => {
      const P = lerp3(st.prev, st.pos, alpha);
      tmpObj.position.copy(P); tmpObj.rotation.set(time * 3 + i, time * 2, 0); tmpObj.scale.setScalar(1);
      tmpObj.updateMatrix(); stoneMesh.setMatrixAt(i, tmpObj.matrix);
    });
    stoneMesh.instanceMatrix.needsUpdate = true;

    orb.visible = s.orb.active;
    if (s.orb.active) {
      const O = lerp3(s.orb.prev, s.orb.pos, alpha);
      orb.position.copy(O);
      orb.rotation.y = -Math.atan2(s.orb.vel.z, s.orb.vel.x) + Math.PI / 2;
      const flap = Math.sin(time * 40) * 0.8;
      wingL.rotation.x = flap; wingR.rotation.x = -flap;
      if (Math.random() < 0.7) emit(O.x, O.y, O.z, 1, 0xffd36b, 0.6, 0.6);
    }

    updateParticles(dt);
    updateCamera(s, alpha, dt, view);
    renderer.render(scene, camera);
  }

  function updateCamera(s, alpha, dt, view) {
    const k = 1 - Math.exp(-8 * dt);
    if (s.humanId != null) {
      const h = s.players[s.humanId];
      const P = lerp3(h.prev, h.pos, alpha).clone();
      const yaw = view.yaw, pitch = view.pitch;
      const fwd = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
      const want = P.clone().addScaledVector(fwd, -7.5).add(new THREE.Vector3(0, 3.0, 0));
      want.y = Math.max(0.8, want.y);
      cam.pos.lerp(want, k);
      // 시선 목표를 살짝 위로 → 내 선수가 화면 아래쪽에 위치해 조준점을 가리지 않는다
      cam.look.lerp(P.clone().addScaledVector(fwd, 14).add(new THREE.Vector3(0, 2.6, 0)), Math.min(1, k * 1.5));
      const speed = Math.hypot(h.vel.x, h.vel.y, h.vel.z);
      cam.fov += ((70 + Math.min(15, speed * 0.45)) - cam.fov) * k;
    } else {
      const t = performance.now() / 1000 * 0.08;
      cam.pos.lerp(new THREE.Vector3(Math.cos(t) * 95, 38, Math.sin(t) * 60), k);
      cam.look.lerp(s.comet.pos, k);
    }
    camera.position.copy(cam.pos);
    if (cam.shake > 0) {
      cam.shake = Math.max(0, cam.shake - dt);
      camera.position.x += (Math.random() - 0.5) * cam.shake;
      camera.position.y += (Math.random() - 0.5) * cam.shake;
    }
    camera.lookAt(cam.look);
    if (Math.abs(camera.fov - cam.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  }

  function onEvent(s, e) {
    if (e.type === 'goal') {
      const end = e.team === 0 ? 1 : -1;
      emit(end * CFG.rings.x, CFG.rings.ys[e.ring], CFG.rings.zs[e.ring], 70, TEAM_COLORS[e.team], 9, 1.4);
    } else if (e.type === 'stun') {
      const p = s.players[e.id];
      emit(p.pos.x, p.pos.y + 1, p.pos.z, 14, 0xffffff, 4, 0.5);
      if (e.id === s.humanId) cam.shake = 0.5;
    } else if (e.type === 'catch') {
      emit(s.orb.pos.x, s.orb.pos.y, s.orb.pos.z, 90, 0xffd34d, 10, 1.6);
    } else if (e.type === 'orb_appear') {
      emit(s.orb.pos.x, s.orb.pos.y, s.orb.pos.z, 40, 0xffd34d, 6, 1.0);
    }
  }

  // 화면 좌표 투영 (UI 화살표용): {x,y in -1..1, behind}
  function project(p) {
    tmpV.set(p.x, p.y, p.z).project(camera);
    const behind = tmpV.z > 1;
    return { x: tmpV.x, y: tmpV.y, behind };
  }

  resize();
  window.addEventListener('resize', resize);
  return { renderer, scene, camera, render, onEvent, project, resize, lowSpec, info: renderer.info };
}

function applyTiling(mat, tex, color = true, repeat = [1, 1]) {
  for (const [slot, t] of Object.entries(tex)) {
    if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 8;
    if (slot === 'map') t.colorSpace = THREE.SRGBColorSpace;
    mat[slot] = t;
  }
  if (color && tex.map) mat.color.set(0xffffff);
  mat.needsUpdate = true;
}

let _glow;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

function mergeGeos(geos) {
  // 인덱스/비인덱스 섞인 간단 병합 (position/normal/uv)
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const size = parts[0].attributes[name].itemSize;
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of parts) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
