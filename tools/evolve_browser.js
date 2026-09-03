/* 평가 가중치(Genome) 진화 — 브라우저에서 돌리는 유전 알고리즘.
 *
 * tools/arena_browser.js 가 유전자 두 벌을 붙였다면, 이건 개체군을 만들어
 * 세대를 굴린다. 사람이 손으로 값을 정하는 대신 승률로 고르게 한다.
 *
 * 쓰는 법 — 게임 페이지(FRONTIER.html)를 열고 콘솔에서:
 *   const c = await fetch('/tools/evolve_browser.js').then(r=>r.text()); (0,eval)(c);
 *   evolveRun({ generations: 50 });          // 뒤에서 돌아간다
 *   evolveStatus();                          // 진행 상황
 *   evolveStop();                            // 중단 (지금까지 최고는 보존)
 *
 * 결과는 localStorage 'frontier_evolved_genome' 에 남는다.
 *
 * ⚠ 적합도는 낮은 사고시간(기본 100ms)에서 잰다. 그래야 세대를 굴릴 수 있다.
 *   낮은 깊이에서 좋은 가중치가 1200ms에서도 좋다는 보장은 없으므로,
 *   끝나면 evolveVerify()로 실제 사고시간에서 챔피언 대 기본값을 다시 재라.
 */
(() => {
  // 진화 대상 = DEFAULT_GENOME의 숫자 필드 전부
  const GENES = Object.keys(DEFAULT_GENOME).filter(k => typeof DEFAULT_GENOME[k] === 'number');

  // 유전자별 허용 범위. 음수 가중치는 의미가 없고(=반대로 두게 된다),
  // fragileMul은 '깎는 배율'이라 0~1을 벗어나면 안 된다.
  // threat5는 사실상 '이겼다' 점수라 너무 낮아지면 5목을 안 만든다.
  const BOUNDS = {
    fragileMul: [0, 1],
    threat5:    [10000, 1e6],
    handRatio:  [0, 5]
  };
  const boundsOf = g => BOUNDS[g] || [0, Math.max(10, DEFAULT_GENOME[g] * 20)];

  const clamp = (g, v) => {
    const [lo, hi] = boundsOf(g);
    return Math.min(hi, Math.max(lo, v));
  };

  // 숨겨진/백그라운드 탭에서 setTimeout(0)은 1초 이상으로 스로틀된다.
  // 실측: 10회에 45초 초과 = 회당 4.5초. 그 상태로 판마다 양보하면
  // AI가 아니라 대기가 전체 시간을 먹는다. MessageChannel은 스로틀되지 않는다.
  const _chan = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
  function yieldSoon(){
    if(!_chan) return Promise.resolve();
    return new Promise(res => { _chan.port1.onmessage = () => res(); _chan.port2.postMessage(0); });
  }

  // 표준정규 (Box-Muller)
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // 돌연변이는 유전자 '자기 크기'에 비례해야 한다. Q:90과 fragileMul:0.35에
  // 같은 절대량을 더하면 하나는 꿈쩍도 안 하고 하나는 박살난다.
  // 0에서 시작하는 유전자(openThree 등)는 비례식이 영원히 0이므로 하한을 준다.
  function mutate(genome, rate, sigma) {
    const out = { ...genome };
    for (const g of GENES) {
      if (Math.random() > rate) continue;
      const scale = Math.max(Math.abs(DEFAULT_GENOME[g]), boundsOf(g)[1] * 0.02);
      // 가끔은 크게 흔든다 — 작은 변이만으로는 국소 최적에서 못 빠져나온다
      const big = Math.random() < 0.15;
      out[g] = clamp(g, out[g] + gauss() * scale * sigma * (big ? 6 : 1));
    }
    return out;
  }

  // BLX-α 교배: 두 부모 값 사이(+바깥 α만큼)에서 고른다.
  // 실수값에는 '한쪽을 통째로 고르기'보다 이쪽이 탐색이 넓다.
  function crossover(a, b) {
    const out = {};
    const alpha = 0.3;
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

  // 한 판. 무승부/최대수 도달은 0.5로 친다.
  // 반환: white 기준 득점 (1 승 / 0.5 무 / 0 패)
  async function playGame(whiteG, blackG, opts) {
    board = makeEmptyBoard();
    const h = parseHandStr(opts.hand);
    hands = { w: { ...h }, b: { ...h } };
    kingPlaced = { w: false, b: false };
    turn = 'w'; moveHistory = []; actionHistory = [];
    totalChecks = { w: 0, b: 0 }; checkStreak = { w: 0, b: 0 };
    gameOver = false; SEL = null; HIGHLIGHTS = [];
    if (typeof xlEscapeUsed !== 'undefined') xlEscapeUsed = { w: false, b: false };

    for (let ply = 0; ply < opts.maxPly; ply++) {
      const list = allLegalActions(turn);
      if (!list.length) return turn === 'w' ? 0 : 1;      // 둘 수 없으면 패
      let a;
      try { a = aiHard(list, turn, turn === 'w' ? whiteG : blackG); }
      catch (e) { return 0.5; }
      if (!a) a = list[0];
      if (a.type === 'move') {
        const p = board[a.fr][a.fc];
        if (p && p.kind === 'P' && ((turn === 'w' && a.tr === 0) || (turn === 'b' && a.tr === LAST_IDX))) a.promote = 'Q';
      }
      a.color = turn;
      const r = applyAction(a);
      if (!r.ok) return 0.5;
      if (r.fiveWin) return r.fiveWin === 'w' ? 1 : 0;
      if (r.checkmate) return r.checkmate === 'w' ? 1 : 0;
      if (r.suicide) return r.winner === 'w' ? 1 : 0;
      if (r.stalemate || r.repetition) return 0.5;
      if (ply % 8 === 0) await yieldSoon();   // 이벤트 루프 양보 (스로틀 안 되는 방식)
    }
    return 0.5;
  }

  // 도전자 vs 챔피언. 색을 번갈아 줘 선공 이득을 상쇄한다.
  async function matchVs(challenger, champion, games, opts) {
    let score = 0;
    for (let i = 0; i < games; i++) {
      const asWhite = (i % 2 === 0);
      const s = await playGame(asWhite ? challenger : champion,
                              asWhite ? champion : challenger, opts);
      score += asWhite ? s : (1 - s);
      if (ST.stop) break;
    }
    return score / games;
  }

  const ST = {
    running: false, stop: false, gen: 0, generations: 0,
    champion: null, championScore: null, history: [], startedAt: 0, games: 0
  };

  window.evolveStop = function () { ST.stop = true; return '중단 요청됨'; };

  window.evolveStatus = function () {
    const mins = ST.startedAt ? ((Date.now() - ST.startedAt) / 60000).toFixed(1) : 0;
    return {
      진행중: ST.running,
      세대: ST.gen + '/' + ST.generations,
      경과분: mins,
      총판수: ST.games,
      최근: ST.history.slice(-5),
      챔피언: ST.champion
    };
  };

  window.evolveBest = function () { return ST.champion; };

  /* 실제 사고시간에서 챔피언이 기본값보다 나은지 다시 잰다.
     진화는 100ms에서 했으므로 이 확인 없이는 믿으면 안 된다. */
  window.evolveVerify = async function (games = 20, timeMs = 1200) {
    if (!ST.champion) return '아직 챔피언이 없다';
    const prev = AI_HARD_TIME_MS;
    AI_HARD_TIME_MS = timeMs;
    const opts = { hand: 'K1Q1R2B2N2P8SH1SN1JP1RM0', maxPly: 160 };
    const rate = await matchVs(ST.champion, DEFAULT_GENOME, games, opts);
    AI_HARD_TIME_MS = prev;
    const se = Math.sqrt(rate * (1 - rate) / games);
    return {
      사고시간: timeMs + 'ms', 판수: games,
      챔피언_득점률: (rate * 100).toFixed(1) + '%',
      오차: '±' + (se * 196).toFixed(1) + '%',
      판정: rate - se * 1.96 > 0.5 ? '기본값보다 낫다'
          : rate + se * 1.96 < 0.5 ? '기본값보다 나쁘다'
          : '판단 불가 (판수를 늘려라)'
    };
  };

  window.evolveRun = async function (opts = {}) {
    if (ST.running) return '이미 돌고 있다. evolveStop() 후 다시.';
    const cfg = {
      popSize: opts.popSize || 14,
      generations: opts.generations || 40,
      gamesPerEval: opts.gamesPerEval || 4,   // 도전자당 챔피언과 몇 판
      elite: opts.elite || 2,
      mutRate: opts.mutRate ?? 0.3,
      sigma: opts.sigma ?? 0.25,
      timeMs: opts.timeMs || 100,
      maxPly: opts.maxPly || 120,
      hand: opts.hand || 'K1Q1R2B2N2P8SH1SN1JP1RM0'
    };
    const prevTime = AI_HARD_TIME_MS;
    AI_HARD_TIME_MS = cfg.timeMs;

    Object.assign(ST, {
      running: true, stop: false, gen: 0, generations: cfg.generations,
      history: [], startedAt: Date.now(), games: 0
    });
    // 챔피언 시작점은 기본값. 진화가 헛돌아도 기본값보다 나빠지지 않는다.
    ST.champion = { ...DEFAULT_GENOME };

    // 초기 개체군: 기본값 1 + 변이 N-1
    let pop = [{ ...DEFAULT_GENOME }];
    while (pop.length < cfg.popSize) pop.push(mutate(DEFAULT_GENOME, 0.6, 0.4));

    try {
      for (let gen = 0; gen < cfg.generations && !ST.stop; gen++) {
        ST.gen = gen + 1;
        // --- 적합도: 각자 챔피언과 대결 ---
        const scores = [];
        for (const ind of pop) {
          if (ST.stop) break;
          const s = await matchVs(ind, ST.champion, cfg.gamesPerEval, cfg);
          scores.push(s);
          ST.games += cfg.gamesPerEval;
          if (typeof window.__evolveTick === 'function') window.__evolveTick(ST);
        }
        if (ST.stop) break;

        // --- 순위 ---
        const order = pop.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
        const bestIdx = order[0];
        const bestScore = scores[bestIdx];

        // 챔피언 교체는 신중히 — 4판 요행으로 바뀌면 개체군이 표류한다.
        // 확실히 이겼을 때(> 60%)만, 그것도 재대결로 확인하고 바꾼다.
        let replaced = false;
        if (bestScore > 0.6) {
          const confirm = await matchVs(pop[bestIdx], ST.champion, cfg.gamesPerEval * 2, cfg);
          ST.games += cfg.gamesPerEval * 2;
          if (confirm > 0.55) { ST.champion = { ...pop[bestIdx] }; replaced = true; }
        }

        ST.history.push({
          세대: gen + 1,
          최고: +bestScore.toFixed(3),
          평균: +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3),
          챔피언교체: replaced
        });

        // --- 다음 세대 ---
        const next = order.slice(0, cfg.elite).map(i => ({ ...pop[i] }));   // 엘리트 보존
        while (next.length < cfg.popSize) {
          const p1 = tournament(pop, scores), p2 = tournament(pop, scores);
          next.push(mutate(crossover(p1, p2), cfg.mutRate, cfg.sigma));
        }
        pop = next;

        try {
          localStorage.setItem('frontier_evolved_genome', JSON.stringify({
            genome: ST.champion, gen: ST.gen, at: Date.now(), cfg
          }));
        } catch (_) {}
      }
    } finally {
      AI_HARD_TIME_MS = prevTime;
      ST.running = false;
    }
    return evolveStatus();
  };

  console.info('진화 도구 준비됨 — evolveRun() / evolveStatus() / evolveStop() / evolveVerify()');
})();
