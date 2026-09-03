/* 평가 가중치 진화 — Node 헤드리스 러너.
 *
 *   node tools/evolve.js --gens 100 --pop 14 --games 6 --time 100
 *   node tools/evolve.js --resume            # 이어서
 *
 * 브라우저판(tools/evolve_browser.js)과 알고리즘은 같다. 다른 점은 두 가지다.
 *   1) 탭이 닫혀도 안 죽는다. 브라우저에서 돌렸다가 몇 십 분치를 통째로 날렸다.
 *   2) 세대마다 models/evolve-state.json 에 저장한다 — 중간에 끊겨도 이어간다.
 *
 * 적합도는 낮은 사고시간에서 잰다(기본 100ms). 그래야 세대가 굴러간다.
 * 낮은 깊이에서 좋은 값이 실전 1200ms에서도 좋다는 보장은 없으므로,
 * 끝나면 반드시 검증한다:  node tools/evolve.js --verify 40
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngineContext } = require('./headless');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, 'models', 'evolve-state.json');

// ---------- 인자 ----------
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : (isNaN(+v) ? v : +v);
};
const CFG = {
  gens:   arg('gens', 60),
  pop:    arg('pop', 14),
  games:  arg('games', 6),
  elite:  arg('elite', 2),
  mutRate: arg('mutRate', 0.3),
  sigma:  arg('sigma', 0.25),
  time:   arg('time', 100),
  maxPly: arg('maxPly', 120),
  hand:   arg('hand', 'K1Q1R2B2N2P8SH1SN1JP1RM0'),
  resume: !!arg('resume', false),
  verify: arg('verify', 0)
};

// ---------- 엔진 ----------
const E = createEngineContext({ query: { mode: 'local', hand: CFG.hand } });
const GENES = Object.keys(E.DEFAULT_GENOME).filter(k => typeof E.DEFAULT_GENOME[k] === 'number');

const BOUNDS = { fragileMul: [0, 1], threat5: [10000, 1e6], handRatio: [0, 5] };
const boundsOf = g => BOUNDS[g] || [0, Math.max(10, E.DEFAULT_GENOME[g] * 20)];
const clamp = (g, v) => {
  const [lo, hi] = boundsOf(g);
  return Math.min(hi, Math.max(lo, v));
};

const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// 변이는 유전자 자기 크기에 비례해야 한다. Q:90과 fragileMul:0.35에 같은
// 절대량을 더하면 하나는 꿈쩍 안 하고 하나는 박살난다.
function mutate(genome, rate, sigma) {
  const out = { ...genome };
  for (const g of GENES) {
    if (Math.random() > rate) continue;
    const scale = Math.max(Math.abs(E.DEFAULT_GENOME[g]), boundsOf(g)[1] * 0.02);
    const big = Math.random() < 0.15;      // 가끔 크게 흔들어 국소 최적 탈출
    out[g] = clamp(g, out[g] + gauss() * scale * sigma * (big ? 6 : 1));
  }
  return out;
}

function crossover(a, b) {
  const out = {}, alpha = 0.3;             // BLX-alpha
  for (const g of GENES) {
    const lo = Math.min(a[g], b[g]), hi = Math.max(a[g], b[g]);
    const d = (hi - lo) * alpha;
    out[g] = clamp(g, lo - d + Math.random() * (hi - lo + 2 * d));
  }
  return out;
}

function tournament(pop, scores, k = 3) {
  let best = -1;
  for (let i = 0; i < k; i++) {
    const idx = Math.floor(Math.random() * pop.length);
    if (best < 0 || scores[idx] > scores[best]) best = idx;
  }
  return pop[best];
}

// ---------- 대국 ----------
// board/turn/hands는 engine.js의 어휘 스코프 let이라 밖에서 못 바꾼다.
// (그래서 처음엔 모든 대국이 0수 만에 무승부로 끝났다.)
// 상태 조작은 headless.js가 컨텍스트 안에 심어둔 __newGame/__step으로 한다.
function playGame(whiteG, blackG) {
  E.__newGame(CFG.hand);
  for (let ply = 0; ply < CFG.maxPly; ply++) {
    const r = E.__step(whiteG, blackG);
    if (r.done) return r.score;
  }
  return 0.5;
}

// 색을 번갈아 줘 선공 이득을 상쇄한다
function matchVs(challenger, champion, games) {
  let s = 0;
  for (let i = 0; i < games; i++) {
    const asWhite = i % 2 === 0;
    const r = playGame(asWhite ? challenger : champion, asWhite ? champion : challenger);
    s += asWhite ? r : 1 - r;
  }
  return s / games;
}

// ---------- 저장/복원 ----------
function save(state) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
}
function load() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf-8')); } catch (_) { return null; }
}

// ---------- 검증 ----------
function verify(games, timeMs) {
  const st = load();
  if (!st || !st.champion) { console.error('저장된 챔피언이 없다.'); process.exit(1); }
  E.__setThinkTime(timeMs);
  const rate = matchVs(st.champion, E.DEFAULT_GENOME, games);
  const se = Math.sqrt(rate * (1 - rate) / games);
  const lo = rate - se * 1.96, hi = rate + se * 1.96;
  console.log(`\n검증 — 사고시간 ${timeMs}ms, ${games}판 (진화는 ${st.cfg.time}ms에서 했다)`);
  console.log(`  챔피언 득점률 ${(rate * 100).toFixed(1)}% (95% 구간 ${(lo * 100).toFixed(1)}~${(hi * 100).toFixed(1)}%)`);
  console.log(`  판정: ${lo > 0.5 ? '기본값보다 낫다' : hi < 0.5 ? '기본값보다 나쁘다' : '판단 불가 — 판수를 늘려라'}`);
}

// ---------- 본 루프 ----------
function run() {
  let pop, champion, gen0 = 0, history = [], totalGames = 0;
  const prev = CFG.resume ? load() : null;
  if (prev) {
    ({ champion, history, totalGames } = prev);
    gen0 = prev.gen;
    pop = prev.pop;
    console.log(`이어서 시작 — ${gen0}세대까지 완료, 누적 ${totalGames}판`);
  } else {
    champion = { ...E.DEFAULT_GENOME };   // 시작점이 기본값이라 더 나빠질 수 없다
    pop = [{ ...E.DEFAULT_GENOME }];
    while (pop.length < CFG.pop) pop.push(mutate(E.DEFAULT_GENOME, 0.6, 0.4));
  }

  E.__setThinkTime(CFG.time);
  const t0 = Date.now();

  for (let gen = gen0; gen < CFG.gens; gen++) {
    const scores = pop.map(ind => {
      const s = matchVs(ind, champion, CFG.games);
      totalGames += CFG.games;
      return s;
    });

    const order = pop.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const bestIdx = order[0], bestScore = scores[bestIdx];

    // 적은 판수의 요행으로 챔피언이 바뀌면 개체군이 표류한다 → 재대결로 확인
    let replaced = false;
    if (bestScore > 0.6) {
      const confirm = matchVs(pop[bestIdx], champion, CFG.games * 2);
      totalGames += CFG.games * 2;
      if (confirm > 0.55) { champion = { ...pop[bestIdx] }; replaced = true; }
    }

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    history.push({ gen: gen + 1, best: +bestScore.toFixed(3), avg: +avg.toFixed(3), replaced });
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`[${gen + 1}/${CFG.gens}] 최고 ${bestScore.toFixed(2)} 평균 ${avg.toFixed(2)}` +
                `${replaced ? '  ★챔피언 교체' : ''}  (${totalGames}판, ${mins}분)`);

    const next = order.slice(0, CFG.elite).map(i => ({ ...pop[i] }));
    while (next.length < CFG.pop) next.push(mutate(crossover(tournament(pop, scores), tournament(pop, scores)), CFG.mutRate, CFG.sigma));
    pop = next;

    save({ gen: gen + 1, champion, pop, history, totalGames, cfg: CFG, at: Date.now() });
  }

  console.log(`\n완료 — ${CFG.gens}세대, ${totalGames}판, ${((Date.now() - t0) / 60000).toFixed(1)}분`);
  const changed = GENES.filter(g => Math.abs(champion[g] - E.DEFAULT_GENOME[g]) > Math.abs(E.DEFAULT_GENOME[g]) * 0.02 + 1e-9);
  console.log('바뀐 유전자:', changed.length ? changed.map(g => `${g} ${E.DEFAULT_GENOME[g]}→${+champion[g].toFixed(2)}`).join(', ') : '없음');
  console.log(`\n다음: node tools/evolve.js --verify 40   (실전 사고시간에서 재측정)`);
}

if (CFG.verify) verify(+CFG.verify, 1200);
else run();
process.exit(0);
