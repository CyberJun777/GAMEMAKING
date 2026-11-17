// HTML HUD. 게임 상태를 읽어 DOM에 반영한다.
import { GRADES, FACTIONS, UNITS, WAVES, ECON, MISSIONS, MISSION_RULES } from '../config.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString('ko-KR');
const fmtBig = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : fmt(n);

export class HUD {
  constructor(app) {
    this.app = app;
    this.last = {};
    this.buildDex();
    this.buildOdds();
    this.bindButtons();
    for (let i = 0; i < 3; i++) $(`bMis${i}`).querySelector('small').textContent = `광물 ${MISSIONS[i].reward.minerals} · 가스 ${MISSIONS[i].reward.gas}`;
  }

  buildDex() {
    const grid = $('dexGrid');
    grid.innerHTML = '';
    this.dexCells = {};
    for (let g = 0; g < GRADES.length; g++) {
      for (const f of FACTIONS) {
        const def = UNITS.find(u => u.grade === g && u.faction === f.key);
        const el = document.createElement('div');
        el.className = 'dx zero';
        el.style.color = GRADES[g].color;
        el.dataset.type = def.id;
        el.title = `${GRADES[g].name} · ${f.name} · ${def.name}`;
        el.innerHTML = `<span class="n">${def.name}</span><span class="c">0</span>`;
        el.addEventListener('click', () => this.app.selectType(def.id));
        grid.appendChild(el);
        this.dexCells[def.id] = el;
      }
    }
  }

  // 뽑기 확률 (config의 drawWeight에서 계산 → 수치를 바꾸면 화면도 같이 바뀜)
  buildOdds() {
    const total = GRADES.reduce((s, g) => s + g.drawWeight, 0);
    const parts = GRADES.filter(g => g.drawWeight > 0).map(g => `<span style="color:${g.color}">${g.name} ${+(g.drawWeight / total * 100).toFixed(2)}%</span>`);
    const mergeOnly = GRADES.filter(g => g.drawWeight === 0).map(g => g.name).join('·');
    $('odds').innerHTML = `뽑기 확률: ${parts.join(' · ')}${mergeOnly ? `<br>${mergeOnly}은 합성으로만 획득` : ''}`;
  }

  bindButtons() {
    const a = this.app;
    // 버튼이 포커스를 가져가면 Space 키가 그 버튼을 눌러버린다 → 포커스를 받지 않게
    for (const btn of document.querySelectorAll('button')) {
      btn.tabIndex = -1;
      btn.addEventListener('mousedown', (e) => e.preventDefault());
    }
    $('bDraw').onclick = () => a.cmd('draw');
    $('bMerge').onclick = () => a.cmd('merge');
    $('bSell').onclick = () => a.cmd('sell');
    FACTIONS.forEach((f, i) => { $(`bUp${i}`).onclick = () => a.cmd('upgrade', f.key); });
    $('bM2G').onclick = () => a.cmd('exchange', 'm2g');
    $('bG2M').onclick = () => a.cmd('exchange', 'g2m');
    $('bC2G').onclick = () => a.cmd('exchange', 'c2g');
    for (let i = 0; i < 3; i++) $(`bMis${i}`).onclick = () => a.cmd('mission', i);
    $('bRestart').onclick = () => a.restart();
    // 상단 바: 배속·일시정지·소리도 마우스로 (키: Tab / Space / M)
    $('bSpeed').onclick = () => a.toggleSpeed();
    $('bPause').onclick = () => a.togglePause();
    $('bSound').onclick = () => { a.audio.unlock(); a.toggleMute(); };
  }

  toast(text, color = '#fff') {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast'; el.style.color = color; el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => el.remove(), 2600);
  }

  consume(events) {
    for (const e of events) {
      if (e.t === 'toast') this.toast(e.text, e.color);
      else if (e.t === 'merge' && e.g >= 2) this.flash(GRADES[e.g].color, e.g);
      else if (e.t === 'spawn' && e.kind === 'boss') this.bossWarning(this.app.game.round);
    }
  }
  // 영웅 이상 합성: 화면 테두리가 등급 색으로 번쩍
  flash(color, g) {
    const el = $('flash');
    el.style.setProperty('--c', color);
    el.style.setProperty('--dur', `${0.5 + g * 0.15}s`);
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }
  // 보스 등장 경고: 배너 + 붉은 비네트 (약 3초)
  bossWarning(round) {
    const el = $('bossWarn');
    $('bossWarnText').textContent = `${round}라운드 보스 등장`;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(this.warnT);
    this.warnT = setTimeout(() => el.classList.remove('on'), 3200);
  }

  set(id, v, prop = 'textContent') { if (this.last[id] !== v) { this.last[id] = v; $(id)[prop] = v; } }

  update(game, selection) {
    const g = game;
    this.set('round', `${g.round}/${WAVES.rounds}`);
    const nr = g.nextRoundIn();
    this.set('timer', g.round >= WAVES.rounds ? '최종' : `다음 ${Math.max(0, Math.ceil(nr))}초`);
    this.set('minerals', fmt(g.minerals));
    this.set('gas', fmt(g.gas));
    this.set('crystals', fmt(g.crystals));
    this.set('lives', '♥'.repeat(Math.max(0, g.lives)) + '♡'.repeat(Math.max(0, WAVES.lives - g.lives)));
    const lim = WAVES.monsterLimit;
    this.set('gaugeText', `${g.normalCount} / ${lim}`);
    $('gaugeFill').style.width = `${Math.min(100, g.normalCount / lim * 100)}%`;
    $('gauge').className = g.normalCount >= 60 ? 'crit' : g.normalCount >= 50 ? 'warn' : '';
    this.set('speed', `${this.app.speed}× 배속`);
    this.set('paused', this.app.paused ? '▶ 계속' : '⏸ 일시정지');
    this.set('sound', this.app.audio.muted ? '🔇 소리' : '🔊 소리');
    $('bSpeed').classList.toggle('on', this.app.speed > 1);
    $('bPause').classList.toggle('on', this.app.paused);

    // 보스/미션 바
    const bossBar = $('bossbar');
    if (g.boss) {
      bossBar.classList.remove('hidden');
      this.set('bossName', `${g.boss.round}R 보스`);
      $('bossFill').style.width = `${Math.max(0, g.boss.m.hp / g.boss.m.maxHp * 100)}%`;
      this.set('bossTime', `${Math.ceil(g.boss.timer)}초`);
    } else bossBar.classList.add('hidden');
    const misBar = $('missionbar');
    if (g.mission) {
      misBar.classList.remove('hidden');
      this.set('missionName', MISSIONS[g.mission.idx].name);
      $('missionFill').style.width = `${Math.max(0, g.mission.m.hp / g.mission.m.maxHp * 100)}%`;
      this.set('missionTime', `${Math.ceil(g.mission.timer)}초`);
    } else misBar.classList.add('hidden');

    // 버튼 상태
    $('bDraw').disabled = !g.canDraw().ok;
    const sel = [...selection].map(id => g.unitById(id)).filter(Boolean);
    const prim = sel[0];
    $('bMerge').disabled = !prim || !g.canMerge(prim.id, sel.map(u => u.id)).ok;
    const sellable = sel.filter(u => GRADES[u.def.grade].sell > 0);
    $('bSell').disabled = sellable.length === 0;
    this.set('sellPrice', sellable.length ? `+${sellable.reduce((s, u) => s + GRADES[u.def.grade].sell, 0)}` : '-');
    FACTIONS.forEach((f, i) => {
      const b = $(`bUp${i}`); const lv = g.upgrades[f.key];
      const max = lv >= ECON.upgradeMaxLevel, cost = g.upgradeCost(f.key);
      b.disabled = max || g.gas < cost || g.state !== 'playing';
      const s = `Lv${lv} · ${max ? '최대' : '가스 ' + cost}`;
      if (this.last[`up${i}`] !== s) { this.last[`up${i}`] = s; b.querySelector('small').textContent = s; }
    });
    $('bM2G').disabled = g.minerals < ECON.mineralsToGas.pay;
    $('bG2M').disabled = g.gas < ECON.gasToMinerals.pay;
    $('bC2G').disabled = g.crystals < 1;
    for (let i = 0; i < 3; i++) {
      const b = $(`bMis${i}`);
      b.disabled = !g.canSummon(i).ok;
      b.querySelector('.cd').style.height = `${g.missionCd[i] / MISSION_RULES.cooldown * 100}%`;
    }

    // 도감
    const counts = g.countsByType();
    for (const [id, el] of Object.entries(this.dexCells)) {
      const c = counts[id];
      const can = c >= 2 && UNITS.find(u => u.id === id).grade < GRADES.length - 1;
      const cls = 'dx' + (c === 0 ? ' zero' : '') + (can ? ' can' : '');
      if (el.className !== cls) el.className = cls;
      const ce = el.lastChild; if (ce.textContent !== String(c)) ce.textContent = c;
    }

    this.updateSelection(g, sel);
    this.updateOverlay(g);
  }

  updateSelection(g, sel) {
    const key = sel.map(u => u.id).join(',') + '|' + (sel[0] ? Math.floor(sel[0].dealt) : '') + '|' + JSON.stringify(g.upgrades);
    if (this.last.selKey === key) return;
    this.last.selKey = key;
    const box = $('sel');
    if (!sel.length) { box.innerHTML = '<div class="empty">유닛을 선택하세요<br><small>클릭 · 드래그 · 더블클릭</small></div>'; return; }
    const u = sel[0], d = u.def, gr = GRADES[d.grade], fac = FACTIONS.find(f => f.key === d.faction);
    const dmg = d.dmg * g.dmgMult(d.faction);
    const kindName = { single: '단일', splash: `범위 ${d.splash}`, chain: `연쇄 ${d.chain}`, pierce: '관통', field: '장판' }[d.kind] + (d.kind === 'splash' && d.chain ? ` + 연쇄 ${d.chain}` : '');
    const extra = [d.slow ? `둔화 ${d.slow * 100}%` : '', d.aura ? `오라: 공속 +${d.aura.atkSpeed * 100}%` : '', u.aura ? `(공속 +${u.aura * 100}% 적용 중)` : ''].filter(Boolean).join(' · ');
    box.innerHTML = `
      <div><span class="title" style="color:${gr.color}">${d.name}</span><span class="tag" style="color:${gr.color}">${gr.name}</span><span class="tag" style="color:${fac.color}">${fac.name}</span>${sel.length > 1 ? `<span class="tag" style="color:#aaa">외 ${sel.length - 1}기</span>` : ''}</div>
      <dl>
        <dt>공격력</dt><dd>${fmtBig(dmg)}</dd><dt>공격</dt><dd>${kindName}</dd>
        <dt>공속</dt><dd>${d.cd}초</dd><dt>사거리</dt><dd>${d.range >= 50 ? '전체' : d.range}</dd>
        <dt>누적 피해</dt><dd>${fmtBig(u.dealt)}</dd><dt>판매</dt><dd>${gr.sell || '불가'}</dd>
      </dl>
      ${extra ? `<div style="font-size:11px;color:#9fb">${extra}</div>` : ''}
      ${sel.length > 1 ? `<div class="multi">${sel.slice(0, 40).map(s => `<span style="background:${GRADES[s.def.grade].color}"></span>`).join('')}</div>` : ''}`;
  }

  updateOverlay(g) {
    const ov = $('overlay');
    if (g.state === 'playing') { if (!ov.classList.contains('hidden')) ov.classList.add('hidden'); return; }
    if (!ov.classList.contains('hidden')) return;
    ov.className = g.state;
    $('ovTitle').textContent = g.state === 'victory' ? '승리!' : '패배';
    $('ovReason').textContent = g.state === 'victory' ? '40라운드 최종 보스를 쓰러뜨렸습니다' : g.defeatReason;
    const best = g.units.reduce((m, u) => Math.max(m, u.def.grade), -1);
    const mm = Math.floor(g.time / 60), ss = Math.floor(g.time % 60);
    $('ovStats').innerHTML = [
      ['도달 라운드', `${g.round} / ${WAVES.rounds}`], ['플레이 시간', `${mm}분 ${ss}초`], ['처치 수', fmt(g.stats.kills)],
      ['보스 / 미션', `${g.stats.bossKills} / ${g.stats.missionKills}`], ['뽑기 횟수', fmt(g.stats.draws)],
      ['최고 등급', best >= 0 ? GRADES[best].name : '-'], ['업적', `${g.achieved.size}개`]
    ].map(([k, v]) => `<li>${k}</li><li><b>${v}</b></li>`).join('');
  }
}
