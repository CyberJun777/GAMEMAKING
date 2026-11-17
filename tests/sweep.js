// 체력 성장률 스윕: node tests/sweep.js 1.19 1.21 ...
import { WAVES, MISSIONS } from '../js/config.js';
import { Game } from '../js/sim/game.js';
import { diligentBot } from './bots.js';
if (process.env.BM) WAVES.bossHpMult = +process.env.BM;
const mf = +(process.env.MF || 1); for (const m of MISSIONS) m.hp *= mf;
for (const gr of process.argv.slice(2).map(Number)) {
  WAVES.normalHp = (r) => 25 * Math.pow(gr, r - 1);
  const out = [];
  for (let s = 1; s <= 4; s++) {
    const g = new Game({ seed: s }); let peak = 0;
    g.run(60 * 40, g => { diligentBot(g); peak = Math.max(peak, g.normalCount); });
    out.push(`${g.state[0]}R${g.round} pk${peak} L${g.lives} m${g.stats.missionKills}`);
  }
  console.log(gr, out.join(' | '));
}
