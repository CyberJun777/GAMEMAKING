// Web Audio로 즉석 합성하는 간단한 효과음. 파일 없음.
// AudioContext는 첫 사용자 입력(키·마우스) 때 만든다 → 브라우저 자동재생 경고 없음.
const KEY = 'prismring.muted';

export class Sfx {
  constructor() {
    this.ctx = null; this.master = null;
    this.log = [];            // 재생 요청 기록 (테스트·디버그용, 음소거여도 기록)
    this.lastAt = {};
    try { this.muted = localStorage.getItem(KEY) === '1'; } catch { this.muted = false; }
  }
  // 사용자 입력 핸들러 안에서 호출
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.22;
    this.master.connect(this.ctx.destination);
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.22, this.ctx.currentTime, 0.02);
    try { localStorage.setItem(KEY, this.muted ? '1' : '0'); } catch { /* 저장 불가 환경 */ }
    return this.muted;
  }

  // 음 하나: 주파수 f(→f2로 미끄러짐), 시작 지연 at, 길이 dur
  tone(f, at, dur, { type = 'triangle', f2 = f, vol = 0.6, lp = 0 } = {}) {
    const c = this.ctx, t0 = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let out = o;
    if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); out = fl; }
    out.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  play(name, arg = 0) {
    const now = performance.now();
    if (now - (this.lastAt[name] || 0) < 60) return;   // 같은 소리 연타 방지
    this.lastAt[name] = now;
    this.log.push(name); if (this.log.length > 60) this.log.shift();
    if (!this.ctx || this.muted) return;
    const T = (f, at, dur, o) => this.tone(f, at, dur, o);
    switch (name) {
      case 'draw': T(660, 0, 0.09, { type: 'square', f2: 990, vol: 0.25 }); break;
      case 'merge': {   // 상승 아르페지오, 등급이 높을수록 높고 길게
        const base = 330 * Math.pow(2, arg / 4);
        [1, 1.25, 1.5, 2, 2.5].slice(0, 3 + Math.min(2, arg)).forEach((r, i) => T(base * r, i * 0.06, 0.18, { vol: 0.45 }));
        break;
      }
      case 'hero': {    // 영웅 이상 획득 팡파르 (전설·신은 한 음 더)
        const b = arg >= 4 ? 523 : arg >= 3 ? 440 : 392;
        [[1, 0], [1.25, 0.1], [1.5, 0.2], [2, 0.32]].concat(arg >= 3 ? [[2.5, 0.46]] : []).forEach(([r, at]) => { T(b * r, at, 0.35, { type: 'square', vol: 0.18, lp: 2400 }); T(b * r, at, 0.4, { vol: 0.3 }); });
        break;
      }
      case 'boss':      // 낮은 경보 3번
        for (let i = 0; i < 3; i++) T(150, i * 0.36, 0.3, { type: 'sawtooth', f2: 90, vol: 0.5, lp: 900 });
        break;
      case 'victory': [523, 659, 784, 1047].forEach((f, i) => T(f, i * 0.14, i === 3 ? 0.8 : 0.22, { vol: 0.45 })); break;
      case 'defeat': [392, 330, 262, 196].forEach((f, i) => T(f, i * 0.2, i === 3 ? 0.9 : 0.3, { type: 'sawtooth', vol: 0.3, lp: 1200 })); break;
    }
  }

  // 시뮬레이션 이벤트 → 소리. 합성 결과 유닛은 'draw' 소리를 내지 않는다.
  consume(events) {
    let merged = false;
    for (const e of events) if (e.t === 'merge') merged = true;
    for (const e of events) {
      if (e.t === 'merge') this.play('merge', e.g);
      else if (e.t === 'unit') { if (e.g >= 2) this.play('hero', e.g); else if (!merged) this.play('draw'); }
      else if (e.t === 'spawn' && e.kind === 'boss') this.play('boss');
      else if (e.t === 'end') this.play(e.state === 'victory' ? 'victory' : 'defeat');
    }
  }
}
