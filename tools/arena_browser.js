/* 브라우저 AI A/B 대조 — 유전자 두 벌을 맞붙여 승률을 잰다.
 *
 * 스톡피시가 Fishtest로 하는 것과 같은 발상: 평가함수를 고쳤으면
 * "그럴듯하다"가 아니라 승률로 증명한다. 색을 번갈아 주어 선공 이득을 상쇄한다.
 *
 * 쓰는 법: 게임 페이지(FRONTIER.html)를 열고 콘솔에 붙여넣은 뒤
 *   await arenaRun({games: 40})
 */
// 숨겨진 탭에서 setTimeout(0)은 1초 이상으로 스로틀된다(실측 4.5초).
// 24판 아레나가 27분 걸린 진짜 이유였다. MessageChannel은 스로틀되지 않는다.
const _arenaChan = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
function yieldSoon(){
  if(!_arenaChan) return Promise.resolve();
  return new Promise(res => { _arenaChan.port1.onmessage = () => res(); _arenaChan.port2.postMessage(0); });
}

window.arenaRun = async function arenaRun(opts = {}){
  const games   = opts.games   || 20;
  const maxPly  = opts.maxPly  || 160;
  const hand    = opts.hand    || 'K1Q1R2B2N2P8SH1SN1JP1';
  // B = 현재 평가, A = 거기서 opts.off 항목만 꺼둔 것.
  // 한 번에 한 기능만 끄고 재야 그 기능의 효과가 분리된다.
  const off = opts.off || ['openThree', 'openFour'];
  const B = Object.assign({}, DEFAULT_GENOME, opts.base || {});   // base는 양쪽 공통
  const A = Object.assign({}, B);
  for(const k of off) A[k] = 0;
  // 사고 시간은 양쪽 동일 — 낮추면 AI가 약해질 뿐 비교는 공정하다.
  // 기본 1200ms면 판당 1분 넘어 40판 측정이 비현실적이다.
  const prevTime = AI_HARD_TIME_MS;
  if(opts.timeMs) AI_HARD_TIME_MS = opts.timeMs;


  const res = { A:0, B:0, draw:0, plies:[], reasons:{}, done:0, games };
  window.__arenaLive = res;                                  // 진행 상황 들여다보기용
  for(let gi = 0; gi < games; gi++){
    // 색 교대 — 짝수 판은 A가 백, 홀수 판은 B가 백
    const whiteGenome = (gi % 2 === 0) ? A : B;
    const blackGenome = (gi % 2 === 0) ? B : A;
    const whiteName   = (gi % 2 === 0) ? 'A' : 'B';
    const blackName   = (gi % 2 === 0) ? 'B' : 'A';

    board = makeEmptyBoard();
    const h = parseHandStr(hand);
    hands = { w:{...h}, b:{...h} };
    kingPlaced = { w:false, b:false };
    turn = 'w'; moveHistory = []; actionHistory = [];
    totalChecks = { w:0, b:0 }; checkStreak = { w:0, b:0 };
    gameOver = false; SEL = null; HIGHLIGHTS = [];
    if(typeof xlEscapeUsed !== 'undefined') xlEscapeUsed = { w:false, b:false };

    let winner = null, reason = 'max', ply = 0;
    for(; ply < maxPly; ply++){
      const g = (turn === 'w') ? whiteGenome : blackGenome;
      const list = allLegalActions(turn);
      if(!list.length){ reason = 'nolegal'; break; }
      let a;
      try { a = aiHard(list, turn, g); } catch(e){ reason = 'error:' + e.message; break; }
      if(!a) a = list[0];
      if(a.type === 'move'){
        const p = board[a.fr][a.fc];
        if(p && p.kind === 'P' && ((turn==='w' && a.tr===0)||(turn==='b' && a.tr===LAST_IDX))) a.promote = 'Q';
      }
      a.color = turn;
      const r = applyAction(a);
      if(!r.ok){ reason = 'illegal:' + r.err; break; }
      if(r.fiveWin){ winner = r.fiveWin; reason = 'five'; break; }
      if(r.checkmate){ winner = r.checkmate; reason = 'mate'; break; }
      if(r.suicide){ winner = r.winner; reason = 'suicide'; break; }
      if(r.stalemate || r.repetition){ reason = r.stalemate ? 'stale' : 'rep'; break; }
      // 물약/타이쿤 없음 — 순수 대국
      if(ply % 8 === 0) await yieldSoon();   // 이벤트 루프 양보 (스로틀 안 되는 방식)
    }
    res.plies.push(ply); res.done = gi + 1;
    res.reasons[reason] = (res.reasons[reason] || 0) + 1;
    if(!winner) res.draw++;
    else res[(winner === 'w') ? whiteName : blackName]++;
    if(opts.log) console.log(`[${gi+1}/${games}] ${whiteName}(백) vs ${blackName}(흑) → ${winner||'draw'} (${reason}, ${ply}수)`);
  }
  AI_HARD_TIME_MS = prevTime;
  const n = res.A + res.B + res.draw;
  const score = (res.B + res.draw * 0.5) / n;          // B 기준 득점률
  // 표준오차 기반 대략적 신뢰구간 (판수가 적으면 넓다)
  const se = Math.sqrt(score * (1 - score) / n);
  res.summary = `B 득점률 ${(score*100).toFixed(1)}% ± ${(se*196).toFixed(1)}%  ` +
                `(B승 ${res.B} / A승 ${res.A} / 무 ${res.draw}, 평균 ${Math.round(res.plies.reduce((x,y)=>x+y,0)/n)}수)`;
  return res;
};
