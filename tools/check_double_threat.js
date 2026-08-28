/* countWinningSquares 자체 점검 — node tools/check_double_threat.js
 * engine.js는 브라우저 전역 스크립트라 통째로 못 부른다.
 * 이 함수는 board/BOARD_N/inBounds만 쓰므로 소스만 떼어내 스텁 위에서 돌린다.
 * ponytail: 함수 하나만 떼어 검사. 평가함수 전체를 재려면 tools/arena_browser.js.
 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../js/game/engine.js', 'utf-8');
const m = src.match(/function countWinningSquares\(col\)\{[\s\S]*?\n\}/);
if (!m) throw new Error('countWinningSquares를 engine.js에서 못 찾음');

let board, BOARD_N = 8;
const inBounds = (r, c) => r >= 0 && c >= 0 && r < BOARD_N && c < BOARD_N;
const countWinningSquares = eval('(' + m[0].replace(/^function /, 'function ') + ')');

const blank = () => Array.from({length: BOARD_N}, () => Array(BOARD_N).fill(null));
const put = (b, r, c, col) => { b[r][c] = {color: col, kind: 'P'}; };
const assert = (cond, msg) => { if (!cond) { console.error('실패: ' + msg); process.exitCode = 1; } };

// 열린 4 (.XXXX.) → 양끝 두 칸 모두 5목을 만든다 = 이중 위협
board = blank();
for (const c of [2, 3, 4, 5]) put(board, 4, c, 'w');
assert(countWinningSquares('w') === 2, `열린4는 승리칸 2개여야 (받음 ${countWinningSquares('w')})`);

// 닫힌 4 (벽XXXX.) → 한쪽만 열림 = 단일 위협, 상대가 막으면 끝
board = blank();
for (const c of [0, 1, 2, 3]) put(board, 4, c, 'w');
assert(countWinningSquares('w') === 1, `닫힌4는 승리칸 1개여야 (받음 ${countWinningSquares('w')})`);

// 3개짜리는 한 수로 5가 안 된다
board = blank();
for (const c of [2, 3, 4]) put(board, 4, c, 'w');
assert(countWinningSquares('w') === 0, `3목은 승리칸 0개여야 (받음 ${countWinningSquares('w')})`);

// 교차하는 두 방향의 4 — 실제 이중 위협의 전형
board = blank();
for (const c of [1, 2, 3]) put(board, 4, c, 'w');   // 가로: (4,5)에 놓으면? 아직 4개뿐
put(board, 4, 5, 'w');                               // 가로 XXX.X → (4,4)가 승리칸
for (const r of [0, 1, 2, 3]) put(board, r, 7, 'w'); // 세로 → (4,7)이 승리칸
assert(countWinningSquares('w') === 2, `가로+세로 이중위협은 2개여야 (받음 ${countWinningSquares('w')})`);

// 상대 돌은 세지 않는다
assert(countWinningSquares('b') === 0, '흑은 승리칸이 없어야');

// 이미 채워진 칸은 후보가 아니다 (5목이 이미 완성된 판)
board = blank();
for (const c of [1, 2, 3, 4, 5]) put(board, 4, c, 'w');
assert(countWinningSquares('w') === 2, `5목 양끝 연장칸 2개 (받음 ${countWinningSquares('w')})`);

if (!process.exitCode) console.log('countWinningSquares 점검 통과');
