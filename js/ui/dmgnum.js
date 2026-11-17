// 떠오르는 피해 숫자. DOM 요소 풀(최대 MAX개)을 재사용 → draw call 0, 개수 상한 고정.
// 보스·미션 보스: 0.35초마다 체력 감소량을 합쳐 1개. 일반 몬스터: 큰 한 방(최대 체력 50%↑)만, 초당 최대 8개.
const MAX = 24, LIFE = 0.9, BOSS_EVERY = 0.35, NORMAL_PER_SEC = 8;
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));

export class DamageNumbers {
  constructor(root) {
    this.root = root;
    this.pool = []; this.active = [];
    for (let i = 0; i < MAX; i++) {
      const el = document.createElement('div');
      el.className = 'dmg'; el.style.display = 'none';
      root.appendChild(el); this.pool.push(el);
    }
    this.bossSeen = new Map();   // 몬스터 id → { hp, acc, t }
    this.normalBudget = NORMAL_PER_SEC;
  }
  spawn(x, y, z, v, cls) {
    let n = this.pool.pop();
    if (!n) {
      // 풀이 비었으면 보스 숫자만 가장 오래된 일반 숫자를 밀어낸다
      if (cls === 'normal') return;
      const i = this.active.findIndex(a => a.cls === 'normal');
      if (i < 0) return;
      n = this.active.splice(i, 1)[0].el;
    }
    n.textContent = fmt(v);
    n.className = 'dmg ' + cls;
    n.style.display = 'block';
    this.active.push({ el: n, x, y, z, life: LIFE, cls, dx: (Math.random() - 0.5) * 0.4 });
  }
  consume(events) {
    for (const e of events) {
      if (e.t === 'bighit' && this.normalBudget >= 1) { this.normalBudget--; this.spawn(e.x, 0.7, e.z, e.v, e.gr >= 3 ? 'normal big' : 'normal'); }
    }
  }
  update(game, renderer, dt) {
    this.normalBudget = Math.min(NORMAL_PER_SEC, this.normalBudget + dt * NORMAL_PER_SEC);
    // 보스류 체력 감소량 합산
    const alive = new Set();
    for (const m of game.monsters) {
      if (m.kind === 'normal') continue;
      alive.add(m.id);
      let s = this.bossSeen.get(m.id);
      if (!s) { s = { hp: m.maxHp, acc: 0, t: 0 }; this.bossSeen.set(m.id, s); }
      const hp = Math.max(0, m.hp);
      s.acc += s.hp - hp; s.hp = hp; s.t += dt;
      if (s.acc > 0 && (s.t >= BOSS_EVERY || !m.alive)) { this.spawn(m.x, 1.45, m.z, s.acc, m.kind === 'boss' ? 'boss' : 'mission'); s.acc = 0; s.t = 0; }
    }
    for (const id of this.bossSeen.keys()) if (!alive.has(id)) this.bossSeen.delete(id);
    // 위치·투명도
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.life -= dt;
      if (a.life <= 0) { a.el.style.display = 'none'; this.pool.push(a.el); this.active.splice(i, 1); continue; }
      const k = 1 - a.life / LIFE;
      const p = renderer.toScreen(a.x + a.dx * k, a.y + k * 0.9, a.z);
      a.el.style.transform = `translate(${p.x | 0}px, ${p.y | 0}px) translate(-50%, -50%) scale(${1 + (k < 0.15 ? (0.15 - k) * 4 : 0)})`;
      a.el.style.opacity = String(Math.min(1, a.life / LIFE * 2.2));
    }
  }
  clear() {
    for (const a of this.active) { a.el.style.display = 'none'; this.pool.push(a.el); }
    this.active.length = 0; this.bossSeen.clear();
  }
}
