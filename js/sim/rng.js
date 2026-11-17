// 시드 고정 난수 (mulberry32). 같은 시드 → 같은 게임.
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return rng;
}
