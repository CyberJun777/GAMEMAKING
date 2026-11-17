// 밸런스 측정: node tests/balance.js [seeds]
import { Game } from '../js/sim/game.js';
import { diligentBot } from './bots.js';
const seeds = +(process.argv[2] || 8);
const res = [];
for (let s = 1; s <= seeds; s++) {
  const g = new Game({ seed: s });
  let peak = 0, peakR = 0; const bossLog = [];
  g.run(60 * 40, (g) => {
    diligentBot(g);
    if (g.normalCount > peak) { peak = g.normalCount; peakR = g.round; }
  });
  const best = g.units.reduce((m, u) => Math.max(m, u.def.grade), -1);
  res.push(`seed ${s}: ${g.state.padEnd(8)} R${g.round} t=${g.time.toFixed(0)}s lives=${g.lives} peak=${peak}@R${peakR} best=${best} units=${g.units.length} upg=${JSON.stringify(g.upgrades)} kills=${g.stats.kills} boss=${g.stats.bossKills} miss=${g.stats.missionKills} ${g.defeatReason}`);
}
console.log(res.join('\n'));
