// HUD · 미니맵 · 화면 밖 화살표 · 배너 · 시작/종료 화면 (DOM)
import { CFG } from './config.js';

const TEAM_NAME = ['청록', '주황'];
const TEAM_CSS = ['#18b5a8', '#f08a24'];
const ROLE_NAME = { runner: '러너', keeper: '가디언', breaker: '브레이커', hunter: '헌터' };

const $ = (id) => document.getElementById(id);

export function createUI() {
  const el = {
    hud: $('hud'), score0: $('score0'), score1: $('score1'), clock: $('clock'),
    stamina: $('staminaFill'), role: $('role'), hold: $('hold'), switchHint: $('switchHint'),
    crosshair: $('crosshair'), banner: $('banner'), mini: $('minimap'),
    arrowComet: $('arrowComet'), arrowOrb: $('arrowOrb'),
    start: $('startScreen'), end: $('endScreen'), endTitle: $('endTitle'), endScore: $('endScore'),
    endReason: $('endReason'), pause: $('pauseScreen'),
  };
  const mctx = el.mini.getContext('2d');
  let bannerT = 0;

  function banner(text, color = '#fff', time = 1.5) {
    el.banner.textContent = text;
    el.banner.style.color = color;
    el.banner.classList.add('show');
    bannerT = time;
  }

  function onEvent(s, e) {
    switch (e.type) {
      case 'goal': banner(`GOAL!  ${TEAM_NAME[e.team]} +${CFG.comet.goal}`, TEAM_CSS[e.team]); break;
      case 'orb_appear': banner('골든 오브 등장!', '#ffd34d', 2.2); break;
      case 'stun': if (e.id === s.humanId) banner('기절!', '#ff6b6b', 1.0); break;
      case 'save': if (s.players[e.id].team === 0 || s.humanId != null) banner(`${TEAM_NAME[e.team]} 가디언 선방!`, TEAM_CSS[e.team], 1.0); break;
      case 'steal': if (e.id === s.humanId) banner('스틸!', '#fff', 0.8); break;
      case 'crease': banner('금지 구역 반칙 — 공격권 넘어감', '#ffb3b3', 1.4); break;
      case 'switch': banner(`${ROLE_NAME[e.role]}로 전환`, '#fff', 0.9); break;
      case 'catch': banner(`${TEAM_NAME[e.team]} 팀이 골든 오브를 잡았다!  +${CFG.orb.points}`, '#ffd34d', 3); break;
    }
  }

  function update(s, dt, input, project) {
    el.score0.textContent = s.score[0];
    el.score1.textContent = s.score[1];
    const t = Math.floor(s.time);
    el.clock.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    el.clock.classList.toggle('late', s.time > CFG.orb.slowStart);

    const h = s.humanId != null ? s.players[s.humanId] : null;
    if (h) {
      el.stamina.style.width = `${(h.stamina / CFG.player.staminaMax) * 100}%`;
      el.stamina.classList.toggle('low', h.stamina < 25);
      el.role.textContent = ROLE_NAME[h.role] + (h.stunned > 0 ? ' · 기절' : '');
      const holding = s.comet.holder === h.id;
      el.hold.textContent = holding ? '● 코멧볼 소유 — 좌클릭 슛 / E 패스' : (h.role === 'hunter' ? '골든 오브에 1.5u 안으로 붙어라' : '');
      el.switchHint.textContent = s.switchCd > 0 ? `Tab 전환 ${s.switchCd.toFixed(1)}s` : (s.orb.active ? 'Tab: 러너 ↔ 헌터' : '');
      const c = holding ? input.charge() : 0;
      el.crosshair.style.setProperty('--charge', `${c * 360}deg`);
      el.crosshair.classList.toggle('charging', c > 0);
    }

    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) el.banner.classList.remove('show'); }

    drawMinimap(s);
    edgeArrow(el.arrowComet, project(s.comet.pos), s.comet.holder === s.humanId);
    edgeArrow(el.arrowOrb, project(s.orb.pos), !s.orb.active);
  }

  function edgeArrow(node, pr, hide) {
    const on = !hide && (pr.behind || Math.abs(pr.x) > 1 || Math.abs(pr.y) > 1);
    node.style.display = on ? 'block' : 'none';
    if (!on) return;
    let x = pr.x, y = pr.y;
    if (pr.behind) { x = -x; y = -y; }
    const ang = Math.atan2(y, x);
    const m = Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)));
    const ex = (Math.cos(ang) / m) * 0.9, ey = (Math.sin(ang) / m) * 0.86;
    node.style.left = `${(ex * 0.5 + 0.5) * 100}%`;
    node.style.top = `${(-ey * 0.5 + 0.5) * 100}%`;
    node.style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
  }

  function drawMinimap(s) {
    const W = el.mini.width, H = el.mini.height;
    const { rx, rz } = CFG.arena;
    const sx = (x) => W / 2 + (x / rx) * (W / 2 - 6);
    const sz = (z) => H / 2 + (z / rz) * (H / 2 - 6);
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = 'rgba(30,70,35,0.85)';
    mctx.beginPath(); mctx.ellipse(W / 2, H / 2, W / 2 - 4, H / 2 - 4, 0, 0, Math.PI * 2); mctx.fill();
    mctx.strokeStyle = 'rgba(255,255,255,0.5)'; mctx.lineWidth = 1; mctx.stroke();
    // 금지 구역 선
    for (const end of [1, -1]) {
      const x = sx(end * (CFG.rings.x - CFG.rings.crease));
      mctx.beginPath(); mctx.moveTo(x, 12); mctx.lineTo(x, H - 12); mctx.stroke();
    }
    // 링
    mctx.fillStyle = '#e6c46a';
    for (const end of [1, -1]) for (const z of CFG.rings.zs) mctx.fillRect(sx(end * CFG.rings.x) - 1.5, sz(z) - 1.5, 3, 3);
    // 선수
    for (const p of s.players) {
      mctx.fillStyle = TEAM_CSS[p.team];
      mctx.globalAlpha = p.stunned > 0 ? 0.4 : 1;
      mctx.beginPath(); mctx.arc(sx(p.pos.x), sz(p.pos.z), p.isHuman ? 4 : 2.6, 0, Math.PI * 2); mctx.fill();
      if (p.isHuman) { mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5; mctx.stroke(); }
    }
    mctx.globalAlpha = 1;
    mctx.fillStyle = '#222';
    for (const st of s.stones) { mctx.beginPath(); mctx.arc(sx(st.pos.x), sz(st.pos.z), 2.4, 0, Math.PI * 2); mctx.fill(); }
    mctx.fillStyle = '#fff';
    mctx.beginPath(); mctx.arc(sx(s.comet.pos.x), sz(s.comet.pos.z), 2.6, 0, Math.PI * 2); mctx.fill();
    if (s.orb.active) {
      mctx.fillStyle = '#ffd34d';
      mctx.beginPath(); mctx.arc(sx(s.orb.pos.x), sz(s.orb.pos.z), 3, 0, Math.PI * 2); mctx.fill();
    }
  }

  function showEnd(s) {
    const human = s.humanId != null ? s.players[s.humanId].team : 0;
    const win = s.winner === human, draw = s.winner == null;
    el.endTitle.textContent = draw ? '무승부' : win ? '승리!' : '패배';
    el.endTitle.className = draw ? '' : win ? 'win' : 'lose';
    el.endScore.innerHTML = `<span style="color:${TEAM_CSS[0]}">청록 ${s.score[0]}</span> : <span style="color:${TEAM_CSS[1]}">${s.score[1]} 주황</span>`;
    el.endReason.textContent = s.endReason === 'orb'
      ? `${TEAM_NAME[s.orbCatcher]} 팀이 골든 오브를 잡아 경기 종료 (${Math.floor(s.time / 60)}분 ${Math.floor(s.time % 60)}초)`
      : '경기 시간 종료 (9분)';
    el.end.classList.remove('hidden');
  }

  return {
    onEvent, update, showEnd, banner,
    show(name, on) { el[name].classList.toggle('hidden', !on); },
  };
}
