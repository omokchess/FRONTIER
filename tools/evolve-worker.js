/* 진화용 대국 워커 — 부모(tools/evolve.js)가 fork 해서 쓴다.
 *
 * 적합도 평가는 개체마다 독립이라 그냥 나눠 돌리면 된다.
 * 엔진 로드는 프로세스당 한 번만 하고, 이후엔 유전자만 받아 대국을 둔다.
 *
 * 프로토콜
 *   부모 → 워커 : {id, type:'match', a, b, games, maxPly, hand, time}
 *   워커 → 부모 : {id, score}            // a 기준 득점률 (색 교대 적용)
 *   부모 → 워커 : {id, type:'games', a, b, n, ...}
 *   워커 → 부모 : {id, results:[0|0.5|1]} // a 기준, SPRT가 순차로 소비
 */
'use strict';
const { createEngineContext } = require('./headless');

let E = null;
let cur = { hand: null, time: null };

function ensure(hand, time) {
  if (!E) E = createEngineContext({ query: { mode: 'local', hand } });
  if (cur.time !== time) { E.__setThinkTime(time); cur.time = time; }
  cur.hand = hand;
}

function playGame(whiteG, blackG, maxPly, hand) {
  E.__newGame(hand);
  for (let ply = 0; ply < maxPly; ply++) {
    const r = E.__step(whiteG, blackG);
    if (r.done) return r.score;
  }
  return 0.5;
}

// a 기준 득점. 색을 번갈아 줘 선공 이득을 상쇄한다.
function oneGame(a, b, i, maxPly, hand) {
  const asWhite = i % 2 === 0;
  const s = playGame(asWhite ? a : b, asWhite ? b : a, maxPly, hand);
  return asWhite ? s : 1 - s;
}

process.on('message', msg => {
  try {
    ensure(msg.hand, msg.time);
    if (msg.type === 'match') {
      let s = 0;
      for (let i = 0; i < msg.games; i++) s += oneGame(msg.a, msg.b, i, msg.maxPly, msg.hand);
      process.send({ id: msg.id, score: s / msg.games });
    } else if (msg.type === 'games') {
      // SPRT용: 결과를 낱개로 돌려준다. 부모가 순서대로 우도비에 넣는다.
      const results = [];
      for (let i = 0; i < msg.n; i++) results.push(oneGame(msg.a, msg.b, msg.offset + i, msg.maxPly, msg.hand));
      process.send({ id: msg.id, results });
    }
  } catch (e) {
    process.send({ id: msg.id, error: e.message });
  }
});
