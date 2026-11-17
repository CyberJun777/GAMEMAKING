// 텍스처 로더. textures/manifest.json 이 있으면 그 목록을 읽고, 없으면 텍스처 없이(단색) 진행한다.
// (텍스처는 4단계 game-texture 에서 추가한다 — 404 콘솔 에러를 내지 않도록 manifest 방식)
import * as THREE from '../../vendor/three.module.js';

export async function loadTextures() {
  let manifest;
  try {
    const r = await fetch('textures/manifest.json', { cache: 'no-cache' });
    if (!r.ok) return {};
    manifest = await r.json();
  } catch { return {}; }
  const loader = new THREE.TextureLoader();
  const load = (url) => new Promise((res) => loader.load(url, res, undefined, () => res(null)));
  const out = {};
  for (const [surface, slots] of Object.entries(manifest)) {
    out[surface] = {};
    for (const [slot, file] of Object.entries(slots)) out[surface][slot] = await load(`textures/${file}`);
  }
  return out;
}
