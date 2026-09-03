/* engine.js를 Node에서 띄우기 위한 최소 DOM 스텁.
 *
 * 왜 필요한가: 진화(tools/evolve_browser.js)를 브라우저 탭에서 돌렸더니
 * 탭이 닫히는 순간 몇 십 분치 계산이 통째로 날아갔다. 미리보기 브라우저는
 * 프로필도 매번 새로 만들어 localStorage조차 안 남는다.
 * 규칙과 AI는 순수 계산이므로, DOM만 흉내 내면 Node에서 돌릴 수 있다.
 *
 * 방식: engine.js는 모듈이 아니라 고전 스크립트다(최상위 const/let/function).
 * vm 컨텍스트에 스텁을 전역으로 깔고 통째로 실행하면 그 안의 심볼을 그대로 쓴다.
 *
 * 스텁은 '삼키는' 프록시다 — 무슨 속성을 읽든 호출 가능한 프록시를 돌려준다.
 * 렌더링 코드가 뭘 만지든 조용히 무시되고, 규칙·AI 계산만 진짜로 돈다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSink() {
  const fn = function () { return sink; };
  const sink = new Proxy(fn, {
    get(_t, prop) {
      // 몇몇은 진짜 값을 줘야 코드가 굴러간다
      if (prop === 'style' || prop === 'dataset' || prop === 'classList') return sink;
      if (prop === 'length') return 0;
      if (prop === 'textContent' || prop === 'innerHTML' || prop === 'value') return '';
      if (prop === 'children' || prop === 'childNodes') return [];
      if (prop === Symbol.iterator) return function* () {};
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then') return undefined;          // await 될 때 thenable로 오인 방지
      return sink;
    },
    set() { return true; },
    apply() { return sink; },
    has() { return true; }
  });
  return sink;
}

function createEngineContext(opts = {}) {
  const sink = makeSink();
  const store = new Map();

  const documentStub = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'getElementById') return () => sink;
      if (prop === 'querySelector') return () => sink;
      if (prop === 'querySelectorAll') return () => [];
      if (prop === 'createElement') return () => sink;
      if (prop === 'addEventListener') return () => {};
      if (prop === 'body' || prop === 'documentElement' || prop === 'head') return sink;
      if (prop === 'hidden') return false;
      if (prop === 'visibilityState') return 'visible';
      if (prop === 'title') return '';
      return sink;
    },
    set() { return true; }
  });

  const localStorageStub = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    clear: () => store.clear()
  };

  // engine.js는 URL 쿼리로 모드를 정한다. 헤드리스에선 여기서 넘긴다.
  const search = '?' + new URLSearchParams(opts.query || { mode: 'local' }).toString();

  const ctx = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Math, Date, JSON, Object, Array, String, Number, Boolean,
    Map, Set, Promise, RegExp, Error, isNaN, parseInt, parseFloat,
    URLSearchParams, performance,
    document: documentStub,
    localStorage: localStorageStub,
    sessionStorage: localStorageStub,
    location: { href: 'http://localhost/FRONTIER.html' + search, search, pathname: '/FRONTIER.html' },
    navigator: { userAgent: 'node', clipboard: { writeText: () => Promise.resolve() } },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: cb => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    alert: () => {}, confirm: () => true, prompt: () => null,
    fetch: () => Promise.reject(new Error('headless: fetch 없음')),
    Audio: function () { return sink; },
    Image: function () { return sink; },
    MessageChannel: undefined,      // evolve 쪽이 Promise.resolve()로 떨어지게
    Peer: function () { return sink; },
    firebase: sink
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;

  // network.js / firebase.js는 외부 라이브러리를 전제해 못 싣는다.
  // engine.js의 init()이 부르는 함수만 빈 껍데기로 채운다.
  for (const n of ['netInit', 'publishGameState', 'sendToPeer', 'requestResync',
                   'initSpectator', 'saveMatchLog', 'applyEloChange']) {
    if (typeof ctx[n] === 'undefined') ctx[n] = () => {};
  }

  vm.createContext(ctx);

  const root = path.join(__dirname, '..');
  // FRONTIER.html이 engine.js보다 먼저 읽는 것들. 순서가 곧 의존성이다.
  // 네트워크(firebase/peerjs)는 스텁으로 삼키므로 뺀다.
  // FRONTIER.html이 engine.js보다 먼저 읽는 것들. 순서가 곧 의존성이다.
  // firebase.js / network.js / python-ai-client.js는 외부 라이브러리(firebase, Peer)를
  // 전제하므로 뺀다 — 규칙·AI 계산에는 필요 없다.
  for (const rel of ['js/game/utils.js', 'js/game/pieces.js', 'js/game/timer.js',
                     'js/game/chat.js', 'js/game/elo.js', 'js/quests.js',
                     'js/game/engine.js']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf-8');
    try {
      vm.runInContext(src, ctx, { filename: rel });
    } catch (e) {
      throw new Error(`${rel} 로드 실패: ${e.message}`);
    }
  }
  // 최상위 const/let은 vm 컨텍스트의 '어휘 스코프'에 들어가 전역 객체에 안 붙는다.
  // (function 선언만 전역에 붙는다.) 밖에서 쓰려면 컨텍스트 안에서 꺼내야 한다.
  const EXPORTS = ['BOARD_N', 'LAST_IDX', 'LINE_WIN', 'DEFAULT_GENOME', 'DEFAULT_HAND',
                   'ZONES', 'IS_XL', 'IS_POTION', 'AI_HARD_TIME_MS'];
  vm.runInContext(
    EXPORTS.map(n => `try{ globalThis.${n} = ${n}; }catch(e){}`).join(' '),
    ctx, { filename: 'headless-export' });

  // board/turn/hands 같은 판 상태도 전부 어휘 스코프의 let이다.
  // 밖에서 ctx.turn='b' 해봐야 엔진은 못 본다(실제로 그래서 모든 대국이
  // 무승부로 끝났다). 상태를 만지는 일은 전부 컨텍스트 '안'에서 해야 한다.
  vm.runInContext(`
    globalThis.__setThinkTime = function(ms){ AI_HARD_TIME_MS = ms; };

    // 새 판 시작 — 대국 루프가 매번 부른다
    globalThis.__newGame = function(handStr){
      board = makeEmptyBoard();
      const h = parseHandStr(handStr);
      hands = { w:{...h}, b:{...h} };
      kingPlaced = { w:false, b:false };
      turn = 'w'; moveHistory = []; actionHistory = [];
      totalChecks = { w:0, b:0 }; checkStreak = { w:0, b:0 };
      gameOver = false; SEL = null; HIGHLIGHTS = []; lastMove = null;
      if(typeof xlEscapeUsed !== 'undefined') xlEscapeUsed = { w:false, b:false };
    };

    // 한 수 두기. 밖에서 유전자만 넘기면 안에서 현재 차례로 판단한다.
    // 반환: {done, score} — score는 백 기준 (1 승 / 0.5 무 / 0 패)
    globalThis.__step = function(whiteG, blackG){
      const list = allLegalActions(turn);
      if(!list.length) return { done:true, score: turn === 'w' ? 0 : 1 };
      let a;
      try { a = aiHard(list, turn, turn === 'w' ? whiteG : blackG); }
      catch(e){ return { done:true, score:0.5, err:e.message }; }
      if(!a) a = list[0];
      if(a.type === 'move'){
        const p = board[a.fr][a.fc];
        if(p && p.kind === 'P' && ((turn==='w' && a.tr===0)||(turn==='b' && a.tr===LAST_IDX))) a.promote = 'Q';
      }
      a.color = turn;
      const r = applyAction(a);
      if(!r.ok) return { done:true, score:0.5, err:r.err };
      if(r.fiveWin)   return { done:true, score: r.fiveWin === 'w' ? 1 : 0 };
      if(r.checkmate) return { done:true, score: r.checkmate === 'w' ? 1 : 0 };
      if(r.suicide)   return { done:true, score: r.winner === 'w' ? 1 : 0 };
      if(r.stalemate || r.repetition) return { done:true, score:0.5 };
      return { done:false };
    };
  `, ctx, { filename: 'headless-export' });

  return ctx;
}

module.exports = { createEngineContext };

// 직접 실행하면 자가 점검
if (require.main === module) {
  const ctx = createEngineContext({ query: { mode: 'local', hand: 'K1Q1R2B2N2P8SH1SN1JP1RM1' } });
  const need = ['aiHard', 'allLegalActions', 'applyAction', 'makeEmptyBoard',
                'parseHandStr', 'DEFAULT_GENOME', 'checkFiveInRow', 'BOARD_N'];
  const missing = need.filter(n => typeof ctx[n] === 'undefined');
  if (missing.length) { console.error('빠진 심볼:', missing); process.exit(1); }
  console.log('engine 로드 성공 — BOARD_N =', ctx.BOARD_N,
              '/ LINE_WIN =', ctx.LINE_WIN,
              '/ 유전자', Object.keys(ctx.DEFAULT_GENOME).length, '개');
  // init()이 setInterval을 걸어둬 그냥 두면 프로세스가 안 끝난다.
  process.exit(0);
}
