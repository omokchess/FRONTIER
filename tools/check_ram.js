/* 공성추 경로/충돌 규칙 자체 점검 — node tools/check_ram.js
 * engine.js는 브라우저 전역 스크립트라 통째로 못 부른다.
 * ramPath / ramShoveAlly / ramResolve 만 떼어내 스텁 위에서 돌린다.
 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../js/game/engine.js', 'utf-8');
const grab = name => {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'));
  if (!m) throw new Error(name + ' 를 engine.js에서 못 찾음');
  return m[0];
};

let board, BOARD_N = 8, lastMove = null;
const inBounds = (r, c) => r >= 0 && c >= 0 && r < BOARD_N && c < BOARD_N;
const RAM_CHARGE_DELAY = 1;
eval(grab('ramStaircase'));
eval(grab('ramPath') + '\n' + grab('ramShoveAlly') + '\n' + grab('ramResolve'));

const blank = () => Array.from({length: BOARD_N}, () => Array(BOARD_N).fill(null));
const put = (r, c, color, kind) => { board[r][c] = {color, kind}; };
const ram = (r, c, tr, tc) => { board[r][c] = {color:'w', kind:'RM', charge:{tr, tc, wait:0}}; };
let bad = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.error(`실패: ${msg}\n  기대 ${w}\n  실제 ${g}`); bad++; }
};
const at = (r, c) => board[r][c] ? board[r][c].color + board[r][c].kind : null;

// 경로: 가로
board = blank();
eq(ramPath(4, 1, 4, 5), [[4,2],[4,3],[4,4],[4,5]], '가로 경로');
// 경로: 대각도 계단이 된다 — 대각으로 한 칸에 건너뛰면 인접 두 칸을
// 검사 없이 지나쳐 막고 선 기물 사이로 빠져나간다.
eq(ramPath(0, 0, 2, 2), [[1,0],[1,1],[2,1],[2,2]], '대각은 계단');
// 매 스텝이 정확히 상하좌우 한 칸
{
  let pr = 0, pc = 0, ok = true;
  for (const [r, c] of ramPath(0, 0, 3, 5)) {
    if (Math.abs(r - pr) + Math.abs(c - pc) !== 1) ok = false;
    pr = r; pc = c;
  }
  eq(ok, true, '모든 스텝이 상하좌우 한 칸');
}
// 어느 쪽에서 출발하든 같은 칸을 지난다 (사슬 = 출발칸 + 경로)
{
  const chain = (a,b,c,d) => [[a,b], ...ramPath(a,b,c,d)].map(x=>x.join(',')).sort().join(' ');
  eq(chain(1,1,4,6) === chain(4,6,1,1), true, 'A→B와 B→A가 같은 칸을 지난다');
}
// 경로: 비직선(나이트형) — 브레젠험이 한 줄로 이어줘야 한다
const p = ramPath(0, 0, 2, 5);
eq(p[p.length - 1], [2, 5], '비직선도 목표에 도달');
eq(p.every(([r, c]) => inBounds(r, c)), true, '경로가 판 안에 머문다');

// 빈 길 → 목표까지 그대로
board = blank(); ram(4, 0, 4, 6);
let res = ramResolve(4, 0);
eq([res.tr, res.tc], [4, 6], '빈 길이면 목표 도착');
eq(at(4, 6), 'wRM', '공성추가 목표 칸에 있다');
eq(at(4, 0), null, '출발 칸은 비었다');

// 적 하나 → 잡고 목적지까지 계속
board = blank(); ram(4, 0, 4, 6); put(4, 3, 'b', 'P');
res = ramResolve(4, 0);
eq([res.tr, res.tc], [4, 6], '적 하나는 잡고 계속 간다');
eq(res.captured.length, 1, '1개 잡음');
eq(at(4, 3), null, '잡힌 자리는 빈다');

// 적 둘 → 두 번째를 잡고 정지
board = blank(); ram(4, 0, 4, 7); put(4, 2, 'b', 'P'); put(4, 5, 'b', 'R');
res = ramResolve(4, 0);
eq([res.tr, res.tc], [4, 5], '두 번째 적 자리에서 정지');
eq(res.captured.length, 2, '2개 잡음');
eq(at(4, 7), null, '목표까지 가지 않았다');

// 아군 → 방향 끝까지 밀리고, 공성추는 계속 간다
board = blank(); ram(4, 0, 4, 5); put(4, 2, 'w', 'P');
res = ramResolve(4, 0);
eq([res.tr, res.tc], [4, 5], '아군은 잡지 않고 지나간다');
eq(at(4, 7), 'wP', '아군은 라인 끝까지 밀린다');

// 아군이 밀리다 적을 만나면 그 적을 잡고 정지
board = blank(); ram(4, 0, 4, 5); put(4, 2, 'w', 'P'); put(4, 6, 'b', 'N');
res = ramResolve(4, 0);
eq(at(4, 6), 'wP', '밀린 아군이 적을 잡고 그 자리에 선다');
eq([res.tr, res.tc], [4, 5], '공성추는 목표까지 간다');

// 판 끝 밖으로는 안 밀린다
board = blank(); ram(4, 3, 4, 4); put(4, 7, 'w', 'P'); put(4, 4, 'w', 'B');
res = ramResolve(4, 3);
eq(at(4, 7), 'wP', '끝의 아군은 그대로');
eq(at(4, 6), 'wB', '밀린 아군은 막힌 앞 칸에 선다');

// 밀려난 아군이 착지 칸에 멈추면, 공성추는 덮어쓰지 않고 뒤로 물러선다
board = blank(); ram(4, 1, 4, 7); put(4, 6, 'w', 'B');
res = ramResolve(4, 1);
eq(at(4, 7), 'wB', '밀린 아군이 목표 칸을 차지한다');
eq([res.tr, res.tc], [4, 6], '공성추는 그 앞 칸에 선다');
eq(at(4, 6), 'wRM', '공성추가 실제로 그 칸에 있다');

// 회귀: 앞을 막고 선 두 기물 사이를 대각으로 빠져나가면 안 된다
board = blank(); ram(3, 1, 4, 3); put(3, 2, 'b', 'P'); put(4, 2, 'b', 'P');
res = ramResolve(3, 1);
eq(res.captured.length > 0, true, '막고 선 기물을 그냥 지나치지 않는다');

// 예약이 없으면 아무 일도 없다
board = blank(); put(2, 2, 'w', 'RM');
eq(ramResolve(2, 2), null, '예약 없으면 null');

if (!bad) console.log('공성추 규칙 점검 통과');
process.exitCode = bad ? 1 : 0;
