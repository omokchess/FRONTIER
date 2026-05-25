'use strict';

// ===================================================================
// 1. URL 파라미터 파싱 + 글로벌 상태
// ===================================================================
const Q = new URLSearchParams(location.search);
// 모드 결정: ?role=host/guest 같이 온라인 신호가 있으면 online, 없으면 ?mode 우선, 둘 다 없으면 local 기본
// ?role=replay 면 리플레이 모드
const _explicitMode = Q.get('mode');
const _hasRole = !!Q.get('role');
const _isReplay = Q.get('role') === 'replay';
const MODE      = _isReplay ? 'replay' : (_explicitMode || (_hasRole ? 'online' : 'local'));   // local | ai | online | replay
const NET_ROLE  = (_isReplay ? null : Q.get('role')) || null;       // host | guest | spectator
const REPLAY_ID = Q.get('rid') || null;
const ROOM_CODE = (Q.get('room') || '').toUpperCase();
const DIFF      = Q.get('difficulty') || 'normal';
const TIME_LIMIT_RAW = Q.get('time') || 'unlimited';
const MY_UID    = Q.get('uid') || ('local-' + Math.random().toString(36).slice(2,8));
const MY_NICK_P = Q.get('nick') || (MODE==='ai' ? '플레이어' : '나');
const MY_TAG_P  = Q.get('tag') || '';
let MY_ELO_P  = parseInt(Q.get('elo') || '1200');
const MY_TITLE_NAME = Q.get('title') || '';
const MY_TITLE_COLOR = Q.get('titleColor') || '#f5c842';
const MY_TITLE_GRADIENT = Q.get('titleGradient') || '';
const MY_PHOTO_URL = Q.get('photo') || '';
// INIT_HAND must be declared BEFORE parsing _handParam to avoid ReferenceError
const DEFAULT_HAND = {K:1, Q:1, R:2, B:2, N:2, P:8, SH:0, SN:0, JP:0};
function parseHandStr(s){
  if(!s) return {...DEFAULT_HAND};
  const out = {...DEFAULT_HAND};
  // Format: K1Q1R2B2N2P8SH1SN0JP0
  const re = /([A-Z]{1,2})(\d+)/g;
  let m;
  while((m = re.exec(s)) !== null){
    if(out.hasOwnProperty(m[1])) out[m[1]] = parseInt(m[2]);
  }
  return out;
}
const INIT_HAND = parseHandStr(Q.get('hand'));

// 색 결정
//   local: 화면 항상 백 시점, 백/흑 번갈아 둠
//   ai:    플레이어=백, AI=흑
//   online host: 백
//   online guest: 흑
//   spectator: 백 시점
let MY_COLOR = 'w';
if(NET_ROLE === 'guest') MY_COLOR = 'b';
const _ORIG_MY_COLOR = MY_COLOR; // 리매치 시 원복용 (조커로 swap된 경우 대비)
const IS_LOCAL = (MODE === 'local');
const IS_AI    = (MODE === 'ai');
const IS_AIVAI = (MODE === 'aivai');
const IS_NET   = (NET_ROLE === 'host' || NET_ROLE === 'guest');
const IS_SPEC  = (NET_ROLE === 'spectator');
const IS_REPLAY = (MODE === 'replay');
// 변형 모드는 상호 배타 — 동시에 여러 개가 켜지면 우선순위(타이쿤 > 농민봉기 > 물약)로 하나만 적용
const IS_TYCOON = (Q.get('tycoon') === '1');                                   // 타이쿤 (골드 경제)
const IS_PEASANT = (Q.get('peasant') === '1') && !IS_TYCOON;                   // 농민 봉기
const IS_POTION  = (Q.get('potion') === '1') && !IS_TYCOON && !IS_PEASANT;     // 물약 모드

// ===== 타이쿤 모드 상수 =====
const TYCOON_TURN_INCOME = 5;   // 매 턴 시작 시 골드 수입
const TYCOON_SKIP_BONUS  = 5;   // 턴 스킵 시 추가 골드 (스킵 턴 = 수입 5 + 보너스 5 = 10)
const TYCOON_WIN_GOLD    = 50;  // 골드 승리 임계치
const TYCOON_SN_RANGE    = 8;   // 사거리 강화 후 스나이퍼 사거리(모든 방향)
const TYCOON_SN_UPGRADE_COST = 5;  // 스나이퍼 사거리 강화 비용 (진영당 1회)
const TYCOON_PROMO_COST  = 5;   // 폰 승급 비용
const TYCOON_PROMO_AGE   = 3;   // 승급 가능 폰의 최소 생존 턴 수
// 구매 가격 (킹은 기본 지급, 퀸은 구매 불가 — 승급으로만 획득)
const TYCOON_PRICES = { P:5, SN:5, B:10, R:10, N:10, JP:10, SH:10 };
const TYCOON_SN_MIN_TURN = 2;   // 스나이퍼는 그 진영의 2번째 턴부터 구매 가능
const TYCOON_HAND = { K:1, Q:0, R:0, B:0, N:0, P:0, SH:0, SN:0, JP:0 };  // 시작 손패: 킹만

// ===== 물약 모드 =====
const POTION_TYPES = {
  revive: { name:'부활 물약', icon:'🧪', color:'#5ac8fa', cost: 0,
            desc:'죽은 기물 1개 부활. 비용 = 기물점수/2 (올림)',
            mergeDesc:'(합체) 부활 비용 50% 할인' },
  block:  { name:'차단 물약', icon:'🚫', color:'#ff453a', cost: 2,
            desc:'빈 칸 1개를 3턴간 차단. 이동·배치 불가, 통과는 가능',
            mergeDesc:'(합체) 차단 칸 2개 동시 선택' },
  joker:  { name:'조커 포션', icon:'🃏', color:'#bf5af2', cost: 3,
            desc:'양쪽 진영 색 교환 + 시점 회전',
            mergeDesc:'(합체) 색 교환 후 본인 한 번 더 둘 수 있음' },
  time:   { name:'시간 물약', icon:'⏰', color:'#30d158', cost: 1,
            desc:'본인 시간 +3분',
            mergeDesc:'(합체) 상대 시간 -2분' },
  peek:   { name:'엿보기 물약', icon:'👁', color:'#f5c842', cost: 1,
            desc:'상대 물약 인벤토리 한 번 공개',
            mergeDesc:'(합체) 상대 물약 하나 훔치기' }
};
const POTION_KEYS = ['revive','block','joker','time','peek'];

// 물약 상태 (게임 시작 후 초기화)
let myInventory = [];      // [{id, type, level (1=일반 2=합체), color}]
let oppInventoryCount = 0; // 상대 인벤토리 개수만 (엿보기 안 쓰면 종류 비공개)
let oppInventoryRevealed = null; // 엿보기 사용 후 상대 인벤토리 (배열 또는 null)
let myPoints = 10;
let oppPoints = 10;
let blockedCells = []; // [{r, c, turnsLeft, owner}]
let _potionAwardedThisTurn = { w: false, b: false }; // 턴 시작 시 자동 획득 중복 방지
const MAX_INVENTORY_SIZE = 8; // 인벤토리 최대 개수
let _potionIdCounter = 0;

// AI 난이도 — AI 모드는 단일, AI vs AI는 양쪽 별도
const W_DIFF = Q.get('wdiff') || DIFF;
const B_DIFF = Q.get('bdiff') || DIFF;

// 시간 제한 (Fischer-style 총 시간)
const TIME_LIMIT = TIME_LIMIT_RAW === 'unlimited' || TIME_LIMIT_RAW === '0'
  ? 0 : parseInt(TIME_LIMIT_RAW);
// 증분 (한 수 완료 시 추가되는 시간, 초 단위)
const TIME_INC = parseInt(Q.get('inc') || '0') || 0;

// ===================================================================
// 2. 기물 정의
// ===================================================================
const SYMBOLS = {
  w:{K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',SH:'⬢',SN:'⊕',JP:'✦',GK:'♚'},
  b:{K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟',SH:'⬢',SN:'⊕',JP:'✦',GK:'♚'}
};
const PIECE_NAMES = {K:'킹',Q:'퀸',R:'룩',B:'비숍',N:'나이트',P:'폰',SH:'방패',SN:'스나이퍼',JP:'어쌔신'};
const SPECIAL_KINDS = ['SH','SN','JP'];

// ===================================================================
// 3. 게임 상태
// ===================================================================
let board = makeEmptyBoard();
let hands = IS_TYCOON ? { w:{...TYCOON_HAND}, b:{...TYCOON_HAND} } : { w:{...INIT_HAND}, b:{...INIT_HAND} };
let turn = 'w';                 // 현재 차례
let kingPlaced = { w:false, b:false };  // 킹 배치 여부
let lastMove = null;            // {fr, fc, tr, tc} 강조용
let moveHistory = [];           // 무승부 판정용 (직렬화 상태 리스트)
let actionHistory = [];          // 리플레이용 액션 기록 (실제 적용된 액션만)
let snapshots = [];             // undo 또는 5회 체크 초과 시 복원용
let checkStreak = { w:0, b:0 }; // 연속 체크 (이쪽이 받은)
let totalChecks = { w:0, b:0 }; // 총 체크 (이쪽이 건)
let minsim = { w:0, b:0 };      // 농민 봉기: 민심 게이지 0~100 (진영당, ≥50% 봉기 발동)
let gold = { w:0, b:0 };        // 타이쿤: 진영별 골드
let snUpgraded = { w:false, b:false };  // 타이쿤: 스나이퍼 사거리 강화 여부 (진영당)
let tycoonTurn = { w:0, b:0 };  // 타이쿤: 진영별 진행 턴 수 (스나이퍼 2턴 제한용)
let gameOver = false;
let myRoomCode = null;          // 페이지 이탈 시 정리할 방 코드

function makeEmptyBoard(){
  const b = [];
  for(let r=0;r<8;r++){ b.push(new Array(8).fill(null)); }
  return b;
}

// ===================================================================
// 4. 좌표 / 헬퍼
// ===================================================================
const inBounds = (r,c)=> r>=0 && r<8 && c>=0 && c<8;
const fileLabel = c => 'abcdefgh'[c];
const rankLabel = r => '87654321'[r];   // row 0 = rank 8 (top)
const algebraic = (r,c) => fileLabel(c) + rankLabel(r);
const opp = c => c === 'w' ? 'b' : 'w';

// 일반 배치 영역: 6x4 (b~g, 3~6행) = cols 1-6, rows 2-5
function inGeneralZone(r,c){ return r>=2 && r<=5 && c>=1 && c<=6; }
// 킹 배치 영역: 4x4 (c~f, 3~6행) = cols 2-5, rows 2-5
function inKingZone(r,c){ return r>=2 && r<=5 && c>=2 && c<=5; }
// 스나이퍼 배치: 4꼭짓점
function inCornerZone(r,c){ return (r===0||r===7) && (c===0||c===7); }

// ===================================================================
// 5. 기물 이동 / 공격 가능 좌표
// ===================================================================
// 한 기물에 대해 (이동 가능 좌표, 공격 가능 좌표) 반환
//  - 이동: 그 칸이 비어있어야 갈 수 있음
//  - 공격: 그 칸에 상대 기물이 있어야 잡을 수 있음
function pieceMoves(r, c, piece){
  const moves = [];   // 빈 칸 이동
  const attacks = []; // 적 기물 공격
  const k = piece.kind;
  const col = piece.color;

  if(k === 'K'){
    if(peasantActive(col)){
      // 농민 봉기 변형: 최대 2칸 이동(5×5), 폰이 있는 칸은 제외(못 가고 못 지나감)
      for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){
        for(let dist=1; dist<=2; dist++){
          const nr=r+dr*dist, nc=c+dc*dist;
          if(!inBounds(nr,nc)) break;
          const t = board[nr][nc];
          if(!t){ moves.push([nr,nc]); continue; }
          if(t.kind === 'P') break;                 // 폰 칸 제외 + 차단
          if(t.color !== col) attacks.push([nr,nc]);
          break;                                     // 비-폰 기물 만나면 정지
        }
      }
    } else {
      for(let dr=-1; dr<=1; dr++){
        for(let dc=-1; dc<=1; dc++){
          if(dr===0&&dc===0) continue;
          const nr=r+dr, nc=c+dc;
          if(!inBounds(nr,nc)) continue;
          const t = board[nr][nc];
          if(!t) moves.push([nr,nc]);
          else if(t.color !== col) attacks.push([nr,nc]);
        }
      }
    }
  } else if(k === 'Q' || k === 'R' || k === 'B'){
    const dirs = [];
    if(k!=='B') dirs.push([-1,0],[1,0],[0,-1],[0,1]);
    if(k!=='R') dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
    for(const [dr,dc] of dirs){
      let nr=r+dr, nc=c+dc;
      while(inBounds(nr,nc)){
        const t = board[nr][nc];
        if(!t){ moves.push([nr,nc]); }
        else { if(t.color !== col || (k==='Q' && peasantActive(col) && t.kind==='P')) attacks.push([nr,nc]); break; }
        nr+=dr; nc+=dc;
      }
    }
  } else if(k === 'N'){
    const offs = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for(const [dr,dc] of offs){
      const nr=r+dr, nc=c+dc;
      if(!inBounds(nr,nc)) continue;
      const t = board[nr][nc];
      if(!t) moves.push([nr,nc]);
      else if(t.color !== col) attacks.push([nr,nc]);
    }
  } else if(k === 'P'){
    const dy = (col === 'w') ? -1 : 1;
    const startRow = (col === 'w') ? 6 : 1;
    const r1 = r+dy;
    if(inBounds(r1,c) && !board[r1][c]){
      moves.push([r1,c]);
      const r2 = r+2*dy;
      if(r === startRow && inBounds(r2,c) && !board[r2][c]){
        moves.push([r2,c]);
      }
    }
    for(const dc of [-1,1]){
      const nr=r+dy, nc=c+dc;
      if(!inBounds(nr,nc)) continue;
      const t = board[nr][nc];
      if(t && t.color !== col) attacks.push([nr,nc]);
    }
    // 농민 봉기: 폰의 킹 사냥은 "전진 대각 사정거리에 들어온 킹을 매 수 자동 처치"로 처리됨
    //           (resolvePeasantKingHunt 참고). 봉기 폰의 위협은 체크로 인식하지 않음(isInCheck 참고).
  } else if(k === 'SH'){
    // 방패: 앞/뒤 1칸만 이동. 인접 적은 밀기 = 공격으로 처리 (킹 체크 가능)
    const dy = (col === 'w') ? -1 : 1;
    for(const ddy of [dy, -dy]){
      const nr = r+ddy;
      if(!inBounds(nr,c)) continue;
      const t = board[nr][c];
      if(!t){
        moves.push([nr,c]);
      } else {
        // 적 기물 — 밀기로 공격 가능
        if(t.color !== col){
          attacks.push([nr,c]);
        }
        moves.push([nr,c]); // 이동 처리는 trySHMove
      }
    }
  } else if(k === 'SN'){
    // 스나이퍼: 이동 불가. 십자 4칸 / 대각 3칸 시야의 적을 저격. 시야가 막히면 정지.
    // 타이쿤 사거리 강화 시: 모든 방향 TYCOON_SN_RANGE(8)칸.
    const up = IS_TYCOON && snUpgraded[col];
    const R8 = TYCOON_SN_RANGE;
    const dirs = up ? [
      [-1,0,R8],[1,0,R8],[0,-1,R8],[0,1,R8],
      [-1,-1,R8],[-1,1,R8],[1,-1,R8],[1,1,R8]
    ] : [
      [-1, 0, 4],[ 1, 0, 4],[ 0,-1, 4],[ 0, 1, 4],   // 십자 4방향: 4칸
      [-1,-1, 3],[-1, 1, 3],[ 1,-1, 3],[ 1, 1, 3]    // 대각 4방향: 3칸
    ];
    for(const [dr,dc,maxDist] of dirs){
      for(let dist=1; dist<=maxDist; dist++){
        const nr = r + dr*dist, nc = c + dc*dist;
        if(!inBounds(nr,nc)) break;
        const t = board[nr][nc];
        if(t){
          if(t.color !== col) attacks.push([nr,nc]); // 적이면 저격 가능
          break; // 첫 기물(적/우군) 만나면 정지 — 그 너머는 못 봄
        }
      }
    }
  } else if(k === 'JP'){
    // 어쌔신: 상하좌우 2칸 점프
    const offs = [[-2,0],[2,0],[0,-2],[0,2]];
    for(const [dr,dc] of offs){
      const nr=r+dr, nc=c+dc;
      if(!inBounds(nr,nc)) continue;
      const t = board[nr][nc];
      if(!t) moves.push([nr,nc]);
      else if(t.color !== col) attacks.push([nr,nc]);
    }
  } else if(k === 'GK'){
    // 회색 킹(농민 봉기): 나이트 + 킹 이동 합침
    const offs = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1],
                  [-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for(const [dr,dc] of offs){
      const nr=r+dr, nc=c+dc;
      if(!inBounds(nr,nc)) continue;
      const t = board[nr][nc];
      if(!t) moves.push([nr,nc]);
      else if(t.color !== col) attacks.push([nr,nc]);
    }
  }

  return { moves, attacks };
}

// 단순히 "그 칸을 공격할 수 있는가"만 체크 (체크 판정용)
// skipPawnKingEat=true 이면, (tr,tc)의 킹을 "먹을 수 있는" 폰의 공격은 체크로 치지 않음
// (농민 봉기 ≥50%: 폰의 킹 위협은 체크가 아니라 자동 처치로 해소되므로)
function canAttack(byColor, tr, tc, skipPawnKingEat){
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const p = board[r][c];
      if(!p || p.color !== byColor) continue;
      if(skipPawnKingEat && p.kind === 'P'){
        const tgt = board[tr][tc];
        if(tgt && tgt.kind === 'K' && pawnCanEatKing(p.color, tgt.color)) continue;
      }
      const {attacks} = pieceMoves(r, c, p);
      for(const [ar,ac] of attacks){
        if(ar===tr && ac===tc) return true;
      }
    }
  }
  return false;
}

function findKing(color){
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p = board[r][c];
    if(p && p.color===color && p.kind==='K') return [r,c];
  }
  return null;
}

function isInCheck(color){
  const k = findKing(color);
  if(!k) return false;
  // 농민 봉기: 이 킹을 먹을 수 있는 상대 폰의 위협은 체크로 인식하지 않음 (자동 처치로 해소)
  return canAttack(opp(color), k[0], k[1], true);
}

// ===================================================================
// 6. 5연속 (오목) 검출
// ===================================================================
function checkFiveInRow(){
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const p = board[r][c];
      if(!p) continue;
      for(const [dr,dc] of dirs){
        let count = 1;
        let nr=r+dr, nc=c+dc;
        while(inBounds(nr,nc) && board[nr][nc] && board[nr][nc].color===p.color){
          count++;
          nr+=dr; nc+=dc;
        }
        if(count >= 5) return p.color;
      }
    }
  }
  return null;
}

// ===================================================================
// 7. 직렬화 / 스냅샷 (반복 검출 + 5회 체크 복원)
// ===================================================================
function serializeBoard(){
  let s = turn + '|';
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p = board[r][c];
    s += p ? (p.color + p.kind + ',') : '.';
  }
  s += '|h:' + ['w','b'].map(col =>
    Object.entries(hands[col]).map(([k,v])=>k+v).join('')
  ).join('/');
  return s;
}
function snapshotState(){
  return {
    board: board.map(row => row.map(c => c ? {...c} : null)),
    hands: { w:{...hands.w}, b:{...hands.b} },
    turn, kingPlaced:{...kingPlaced},
    lastMove: lastMove ? {...lastMove} : null,
    checkStreak:{...checkStreak},
    totalChecks:{...totalChecks},
    moveHistory:[...moveHistory],
    minsim:{...minsim},
    gold:{...gold},
    snUpgraded:{...snUpgraded},
    tycoonTurn:{...tycoonTurn}
  };
}
function restoreState(s){
  board = s.board.map(row => row.map(c => c ? {...c} : null));
  hands = { w:{...s.hands.w}, b:{...s.hands.b} };
  turn = s.turn;
  kingPlaced = {...s.kingPlaced};
  lastMove = s.lastMove ? {...s.lastMove} : null;
  checkStreak = {...s.checkStreak};
  totalChecks = {...s.totalChecks};
  moveHistory = [...s.moveHistory];
  minsim = s.minsim ? {...s.minsim} : { w:0, b:0 };
  gold = s.gold ? {...s.gold} : { w:0, b:0 };
  snUpgraded = s.snUpgraded ? {...s.snUpgraded} : { w:false, b:false };
  tycoonTurn = s.tycoonTurn ? {...s.tycoonTurn} : { w:0, b:0 };
}
// 농민 봉기: 민심 게이지 증감 (0~100 클램프)
function addMinsim(color, delta){
  if(!IS_PEASANT) return;
  minsim[color] = Math.max(0, Math.min(100, (minsim[color]||0) + delta));
}
// 농민 봉기: 해당 진영의 민심이 발동 임계치(50%) 이상인가 (봉기 발동: 킹 2칸 이동·퀸의 아군 폰 처치·폰의 킹 사냥)
function peasantActive(color){
  return IS_PEASANT && (minsim[color]||0) >= 50;
}
// 농민 봉기: pawnColor의 폰이 kingColor의 킹을 먹을 수 있는가 (봉기 임계치 50% 기준)
//   · 한 진영만 ≥50%: 그 진영의 폰이 "자기 진영의 킹"을 먹을 수 있음 (봉기)
//   · 두 진영 모두 ≥50%: 어떤 폰이든 어떤 킹이든 먹을 수 있음 (대혼란)
function pawnCanEatKing(pawnColor, kingColor){
  if(!IS_PEASANT) return false;
  if(peasantActive('w') && peasantActive('b')) return true;
  if(pawnColor === kingColor && peasantActive(kingColor)) return true;
  return false;
}

// ===================================================================
// 8. 액션 (place, move, push, snipe) 실행
// ===================================================================
//   action: { type:'place', kind, r, c, color, [promote] }
//           { type:'move',  fr, fc, tr, tc, [promote] }
function applyAction(action, opts={}){
  const { silent = false } = opts;
  // 스냅샷 (체크 카운팅 5회 초과 시 복원용)
  const snap = snapshotState();

  if(action.type === 'place'){
    const { kind, r, c, color } = action;
    if(!hands[color][kind] || hands[color][kind] <= 0) return { ok:false, err:'손패 없음' };
    if(board[r][c]) return { ok:false, err:'점유됨' };
    // 차단 칸 검사 (물약 모드)
    if(IS_POTION && isCellBlocked(r, c)) return { ok:false, err:'차단된 칸' };
    // 첫 수: 반드시 킹부터
    if(!kingPlaced[color] && kind !== 'K') return { ok:false, err:'첫 수는 킹' };
    // 킹은 4x4
    if(kind === 'K' && !inKingZone(r,c)) return { ok:false, err:'킹 영역 밖' };
    // 스나이퍼: 4꼭짓점
    if(kind === 'SN' && !inCornerZone(r,c)) return { ok:false, err:'꼭짓점만' };
    // 그 외 일반: 6x4 영역
    if(kind !== 'K' && kind !== 'SN' && !inGeneralZone(r,c)) return { ok:false, err:'배치 영역 밖' };

    board[r][c] = (kind === 'SN') ? { color, kind, attacks: 0 } : { color, kind };
    hands[color][kind]--;
    if(kind === 'K') kingPlaced[color] = true;
    lastMove = { fr:-1, fc:-1, tr:r, tc:c, type:'place' };
  } else if(action.type === 'move'){
    const { fr, fc, tr, tc } = action;
    const p = board[fr][fc];
    if(!p) return { ok:false, err:'기물 없음' };
    if(p.color !== turn) return { ok:false, err:'본인 기물 아님' };
    // 차단 칸 검사 (물약 모드) — 목적지가 차단 칸이면 이동 불가 (통과는 후속 pieceMoves에서 알아서 처리)
    if(IS_POTION && isCellBlocked(tr, tc)) return { ok:false, err:'차단된 칸' };
    // 양쪽 킹 모두 배치 안 됨 → 이동 불가
    if(!kingPlaced.w || !kingPlaced.b) return { ok:false, err:'킹 미배치' };

    // 방패는 별도 처리 (밀기 가능)
    if(p.kind === 'SH'){
      const result = trySHMove(fr, fc, tr, tc, p.color);
      if(!result.ok) return result;
    } else if(p.kind === 'SN'){
      // 스나이퍼는 이동 불가, 공격만
      const { attacks } = pieceMoves(fr, fc, p);
      const isAtk = attacks.some(([r,c]) => r===tr && c===tc);
      if(!isAtk) return { ok:false, err:'공격 불가 위치' };
      const target = board[tr][tc];
      // 타깃은 영구 제거 (손패 회수 X)
      if(target && IS_POTION) awardCapturePoints(target.kind, p.color);
      if(IS_PEASANT && target) addMinsim(target.color, 10);  // 기물 잃은 쪽 민심 +10%
      board[tr][tc] = null;
      // 스나이퍼 공격 카운터 증가, 3회 도달 시 후퇴 (자기 손패로 회수)
      p.attacks = (p.attacks || 0) + 1;
      if(p.attacks >= 3){
        // 후퇴: SN을 보드에서 제거하고 소유자의 손패로 복귀
        board[fr][fc] = null;
        hands[p.color]['SN'] = (hands[p.color]['SN'] || 0) + 1;
        lastMove = { fr, fc, tr, tc, type:'snipe', retreat:true };
      } else {
        lastMove = { fr, fc, tr, tc, type:'snipe' };
      }
    } else {
      const { moves, attacks } = pieceMoves(fr, fc, p);
      const isMove = moves.some(([r,c]) => r===tr && c===tc);
      const isAtk  = attacks.some(([r,c]) => r===tr && c===tc);
      if(!isMove && !isAtk) return { ok:false, err:'이동 불가' };
      const target = board[tr][tc];
      // 농민 봉기: 회색 킹을 잡으면 즉시 승리 (먼저 잡는 쪽 승)
      if(IS_PEASANT && target && target.kind === 'GK'){
        board[tr][tc] = p; board[fr][fc] = null;
        lastMove = { fr, fc, tr, tc, type:'move' };
        if(!silent) endGame('⚔️', '회색 킹 처치!', (window.t ? window.t('{c}이(가) 회색 킹을 잡아 승리했습니다!', {c:window.t(turn==='w'?'백':'흑')}) : `${turn==='w'?'백':'흑'}이(가) 회색 킹을 잡아 승리했습니다!`), turn);
        return { ok:true, winner: turn, grayKingKilled:true };
      }
      // 농민 봉기: 기물을 잃은 쪽 민심 +10% (봉기 고조)
      if(IS_PEASANT && target) addMinsim(target.color, 10);
      // 농민 봉기: 퀸이 기물을 잡으면 그 진영 민심 −5%
      if(IS_PEASANT && target && p.kind === 'Q') addMinsim(p.color, -5);
      // 이동 (일반 캡처: 잡힌 기물은 영구 제거 — 손패 회수 X)
      if(target && IS_POTION) awardCapturePoints(target.kind, p.color);
      board[tr][tc] = p;
      board[fr][fc] = null;
      // 농민 봉기: 폰이 전진로의 적 킹을 잡으면 → 회색 킹으로 변신 + 그 진영에 룩 1개 지급
      if(IS_PEASANT && p.kind === 'P' && target && target.kind === 'K'){
        board[tr][tc] = { color: p.color, kind: 'GK' };
        hands[p.color]['R'] = (hands[p.color]['R'] || 0) + 1;
        lastMove = { fr, fc, tr, tc, type:'move', toGrayKing:true };
      } else {
        // 폰 프로모션
        if(p.kind === 'P'){
          if((p.color === 'w' && tr === 0) || (p.color === 'b' && tr === 7)){
            const promoTo = action.promote || 'Q';
            board[tr][tc] = { color: p.color, kind: promoTo };
          }
        }
        lastMove = { fr, fc, tr, tc, type:'move' };
      }
    }
  } else if(action.type === 'skip'){
    // 타이쿤: 턴 스킵 (+5G 보너스 후 턴 넘김)
    if(!IS_TYCOON) return { ok:false, err:'스킵 불가' };
    if(!kingPlaced.w || !kingPlaced.b) return { ok:false, err:'킹 미배치' };
    if(isInCheck(turn)) return { ok:false, err:'체크 중에는 스킵 불가' };
    gold[turn] = (gold[turn]||0) + TYCOON_SKIP_BONUS;
    lastMove = { fr:-1, fc:-1, tr:-1, tc:-1, type:'skip' };
    return finalizeAfterMove(false, snap, silent);
  } else {
    return { ok:false, err:'알 수 없는 액션' };
  }

  // 자기 킹 체크 노출 금지
  if(kingPlaced[turn] && isInCheck(turn)){
    restoreState(snap);
    return { ok:false, err:'자기 킹이 체크됨' };
  }

  // 체크 부여 처리: 상대가 체크에 빠짐 → 체크한 쪽 totalChecks 증가, 받은 쪽 streak 증가
  const next = opp(turn);
  let opponentInCheck = false;
  if(kingPlaced[next] && isInCheck(next)){
    opponentInCheck = true;
    if(IS_PEASANT) addMinsim(next, 20);   // 농민 봉기: 킹이 체크당한 진영의 민심 +20%
    totalChecks[turn]++;
    checkStreak[next]++;
    // 5회 체크 초과 → 이 수 무효 (스냅샷 복원)
    if(totalChecks[turn] > 5){
      restoreState(snap);
      return { ok:false, err:'5회 체크 한도 초과 (이전 턴으로 복원)' };
    }
    // 3회 연속 체크 → 체크 건 쪽 자멸
    if(checkStreak[next] >= 3){
      // 자멸: turn이 패배
      moveHistory.push(serializeBoard());
      // 차례 넘기지 않고 즉시 종료
      lastMove.causedSuicide = true;
      finalizeAfterMove(opponentInCheck, snap, silent);
      if(!silent){
        const winnerColor = next;
        endGame('🚫', '반칙패!',
          (window.t ? window.t('{c}이 3회 연속 체크로 자멸했습니다.', {c:window.t(turn==='w'?'백':'흑')}) : `${turn==='w'?'백':'흑'}이 3회 연속 체크로 자멸했습니다.`), winnerColor);
      }
      return { ok:true, suicide:true, winner: next };
    }
  } else {
    // 체크가 안 들어갔으면 받은 쪽 streak 리셋
    // (turn이 next에게 체크를 안 줬으니 turn → next 공격 streak 끊김)
    checkStreak[next] = 0;
  }
  // 주의: checkStreak[turn] (자기가 받은 streak)은 여기서 건드리면 안 됨!
  // 자기 streak는 상대 turn에서 상대가 체크 주냐 안 주냐로 결정됨.
  // 자기 turn에 리셋하면 상대가 연속 체크하다가 자기가 한 번 해소만 해도 streak가 사라짐.

  return finalizeAfterMove(opponentInCheck, snap, silent);
}

// ===== 물약 모드 핵심 함수 =====
function genPotionId(){ return 'p_' + (++_potionIdCounter) + '_' + Math.random().toString(36).slice(2,5); }

function awardRandomPotion(forColor){
  // 로컬: 양쪽 인벤 별도 관리 (window._localInv)
  if(IS_LOCAL){
    if(!window._localInv) window._localInv = { w:[], b:[] };
    if(window._localInv[forColor].length >= MAX_INVENTORY_SIZE) return null;
    const type = POTION_KEYS[Math.floor(Math.random() * POTION_KEYS.length)];
    const newPotion = { id: genPotionId(), type, level: 1, color: forColor };
    window._localInv[forColor].push(newPotion);
    // turn 색의 인벤을 myInventory에 동기
    syncLocalInventory();
    renderPotionUI();
    return newPotion;
  }
  // 일반 모드
  if(forColor === MY_COLOR){
    if(myInventory.length >= MAX_INVENTORY_SIZE) return null;
  }
  const type = POTION_KEYS[Math.floor(Math.random() * POTION_KEYS.length)];
  const newPotion = { id: genPotionId(), type, level: 1, color: forColor };
  if(forColor === MY_COLOR){
    myInventory.push(newPotion);
    renderPotionUI();
  } else if(!IS_AI){
    oppInventoryCount = Math.min(oppInventoryCount + 1, MAX_INVENTORY_SIZE);
    renderPotionUI();
  } else {
    // AI: 별도 변수
    if(!window._localOppInv) window._localOppInv = [];
    if(window._localOppInv.length < MAX_INVENTORY_SIZE){
      window._localOppInv.push(newPotion);
    }
    renderPotionUI();
  }
  return newPotion;
}

// 로컬 모드: turn 색의 인벤을 myInventory로 동기 (현재 둘 사람의 인벤 표시)
function syncLocalInventory(){
  if(!IS_LOCAL) return;
  if(!window._localInv) window._localInv = { w:[], b:[] };
  if(!window._localPts) window._localPts = { w:5, b:5 };
  myInventory = window._localInv[turn];
  myPoints = window._localPts[turn];
  oppInventoryCount = window._localInv[opp(turn)].length;
}

function handlePotionTurnStart(newTurnColor){
  // 차단 칸 카운트다운 — 등록한 색의 턴 시작 시만 -1 (1라운드 = 양쪽 다 한 번씩 = -1)
  if(blockedCells.length){
    blockedCells = blockedCells.map(c => {
      if(c.owner === newTurnColor){
        return {...c, turnsLeft: c.turnsLeft - 1};
      }
      return c;
    }).filter(c => c.turnsLeft > 0);
    drawBlockedOverlay();
  }
  // 로컬: turn 색 인벤 동기 (자기 인벤만 보이게)
  if(IS_LOCAL) syncLocalInventory();
  if(_potionAwardedThisTurn[newTurnColor]) return;
  _potionAwardedThisTurn[newTurnColor] = true;
  _potionAwardedThisTurn[opp(newTurnColor)] = false;
  awardRandomPotion(newTurnColor);
  updatePointsUI();
}

// 기물 잡았을 때 P 획득 — 비활성화 (사용자 요청)
function awardCapturePoints(capturedKind, captorColor){
  // no-op: 기물 캡처로 P 획득 안 함
  return;
}

function initPotionMode(){
  if(!IS_POTION) return;
  myInventory = [];
  oppInventoryCount = 0;
  oppInventoryRevealed = null;
  myPoints = 5;
  oppPoints = 5;
  blockedCells = [];
  _potionAwardedThisTurn = { w:false, b:false };
  // 로컬: 양쪽 인벤/포인트 별도 변수
  if(IS_LOCAL){
    window._localInv = { w:[], b:[] };
    window._localPts = { w:5, b:5 };
  }
  // 게임 시작 시 양쪽 손에 첫 물약 1개씩
  awardRandomPotion('w');
  awardRandomPotion('b');
  // 시작 시 자기 턴 (white)이라면 미리 1개 더 (자기 턴 첫 시작도 자동 획득)
  _potionAwardedThisTurn.w = false;
  // 로컬: turn 색 인벤 동기
  if(IS_LOCAL) syncLocalInventory();
  renderPotionUI();
  updatePointsUI();
}

// ===================================================================
// 타이쿤 모드 (골드 경제)
// ===================================================================
let _tycoonPromote = false;   // 폰 승급 선택 대기 상태

function initTycoonMode(){
  if(!IS_TYCOON) return;
  gold = { w:0, b:0 };
  snUpgraded = { w:false, b:false };
  tycoonTurn = { w:0, b:0 };
  _tycoonPromote = false;
  handleTycoonIncome('w');   // 백 첫 턴 수입
  renderTycoon();
}

// 어느 색이 지금 상점/스킵을 조작하는가 (로컬은 현재 턴, 그 외엔 내 색)
function tycoonActor(){ return IS_LOCAL ? turn : MY_COLOR; }
// 지금 타이쿤 액션(구매/스킵/승급)을 할 수 있는가
function tycoonCanAct(){
  return IS_TYCOON && !gameOver && !IS_SPEC && !IS_REPLAY
      && turn === tycoonActor() && isMyTurnLocked();
}

// 해당 색의 폰 나이(생존 턴 수) +1
function agePawns(color){
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p = board[r][c];
    if(p && p.color === color && p.kind === 'P') p.age = (p.age||0) + 1;
  }
}

// 턴 시작 수입: +5G, 턴 카운트 +1, 폰 나이 +1
function handleTycoonIncome(color){
  if(!IS_TYCOON) return;
  tycoonTurn[color] = (tycoonTurn[color]||0) + 1;
  gold[color] = (gold[color]||0) + TYCOON_TURN_INCOME;
  agePawns(color);
  renderTycoon();
}

// 기물 구매 (골드 차감 → 손패 추가). 턴을 소모하지 않는 자유 행동.
function buyPiece(kind){
  if(!tycoonCanAct()) return;
  const actor = tycoonActor();
  const price = TYCOON_PRICES[kind];
  if(price == null){ showFlash('구매할 수 없는 기물'); return; }
  if(kind === 'SN' && (tycoonTurn[actor]||0) < TYCOON_SN_MIN_TURN){
    showFlash('🎯 스나이퍼는 2번째 턴부터 구매 가능'); return;
  }
  if((gold[actor]||0) < price){ showFlash('💰 골드 부족'); return; }
  gold[actor] -= price;
  hands[actor][kind] = (hands[actor][kind]||0) + 1;
  if(IS_NET) sendToPeer({ t:'TYCOON_BUY', color:actor, kind });
  if(NET_ROLE === 'host') publishGameState();
  showFlash((window.t ? window.t('🛒 {p} 구매 (-{g}G)', {p:window.t(PIECE_NAMES[kind]||kind), g:price}) : `🛒 ${PIECE_NAMES[kind]||kind} 구매 (-${price}G)`), 1400);
  renderAll();
}

// 스나이퍼 사거리 강화 (진영당 1회)
function upgradeSniper(){
  if(!tycoonCanAct()) return;
  const actor = tycoonActor();
  if(snUpgraded[actor]){ showFlash('이미 강화됨'); return; }
  if((gold[actor]||0) < TYCOON_SN_UPGRADE_COST){ showFlash('💰 골드 부족'); return; }
  gold[actor] -= TYCOON_SN_UPGRADE_COST;
  snUpgraded[actor] = true;
  if(IS_NET) sendToPeer({ t:'TYCOON_UPGRADE', color:actor });
  if(NET_ROLE === 'host') publishGameState();
  showFlash((window.t ? window.t('🎯 스나이퍼 사거리 강화! (모든 방향 {n}칸)', {n:TYCOON_SN_RANGE}) : '🎯 스나이퍼 사거리 강화! (모든 방향 ' + TYCOON_SN_RANGE + '칸)'));
  renderAll();
}

// 턴 스킵 (+5G 보너스 후 턴 넘김) — 턴 소모 액션
function skipTurn(){
  if(!tycoonCanAct()) return;
  submitAction({ type:'skip' });
}

// 폰 승급 모드 진입 (이후 폰 클릭 → tryTycoonPromote)
function startTycoonPromote(){
  if(!tycoonCanAct()) return;
  const actor = tycoonActor();
  if((gold[actor]||0) < TYCOON_PROMO_COST){ showFlash('💰 골드 부족'); return; }
  _tycoonPromote = true;
  HIGHLIGHTS = []; SEL = null;
  showFlash((window.t ? window.t('⬆ 승급할 폰을 클릭하세요 ({n}턴 이상 생존)', {n:TYCOON_PROMO_AGE}) : `⬆ 승급할 폰을 클릭하세요 (${TYCOON_PROMO_AGE}턴 이상 생존)`), 2600);
  renderAll();
}

// (r,c)의 폰을 승급 시도. 성공하면 true.
function tryTycoonPromote(r, c){
  const actor = tycoonActor();
  const p = board[r][c];
  if(!p || p.color !== actor || p.kind !== 'P'){ showFlash('자기 폰을 선택하세요'); return false; }
  if((p.age||0) < TYCOON_PROMO_AGE){
    showFlash((window.t ? window.t('{a}턴 이상 생존한 폰만 승급 가능 (현재 {b}턴)', {a:TYCOON_PROMO_AGE, b:(p.age||0)}) : `${TYCOON_PROMO_AGE}턴 이상 생존한 폰만 승급 가능 (현재 ${p.age||0}턴)`)); return false;
  }
  if((gold[actor]||0) < TYCOON_PROMO_COST){ showFlash('💰 골드 부족'); return false; }
  promptPromotion(actor).then(promo => {
    if(!tycoonCanAct()) return;
    if((gold[actor]||0) < TYCOON_PROMO_COST) return;
    const cur = board[r][c];
    if(!cur || cur.color !== actor || cur.kind !== 'P') return;   // 그새 바뀌었으면 취소
    gold[actor] -= TYCOON_PROMO_COST;
    board[r][c] = { color: actor, kind: promo };
    if(IS_NET) sendToPeer({ t:'TYCOON_PROMOTE', color:actor, r, c, promo });
    if(NET_ROLE === 'host') publishGameState();
    showFlash('⬆ 폰 승급 완료!');
    renderAll();
  });
  return true;
}

// 타이쿤 상단 바 (골드 + 상점/스킵/승급 버튼) — minsimBar 처럼 동적 주입
function renderTycoon(){
  if(!IS_TYCOON) return;
  let el = document.getElementById('tycoonBar');
  if(!el){
    el = document.createElement('div');
    el.id = 'tycoonBar';
    // 위치/스타일은 CSS(#tycoonBar)가 담당 — 데스크탑은 fixed(상단바 아래), 모바일은 손패 아래 흐름 배치.
    // 모바일 흐름 배치를 위해 손패 카드 안(손패 목록 다음)에 삽입.
    const myHand = document.getElementById('myHand');
    const handCard = myHand ? myHand.closest('.hand-card') : null;
    if(handCard){
      handCard.appendChild(el);
    } else {
      (document.querySelector('.side.right') || document.body).appendChild(el);
    }
  }
  const T = (s,p)=> (window.t ? window.t(s,p) : s);
  const goldLbl = `<span style="color:#ffd60a">💰 ${T('백')} ${gold.w||0}G</span> <span style="color:#666">·</span> <span style="color:#ffd60a">${T('흑')} ${gold.b||0}G</span> <span style="color:#888;font-size:10px">(${T('{n}G 승리',{n:TYCOON_WIN_GOLD})})</span>`;
  let shop = '';
  if(tycoonCanAct()){
    const actor = tycoonActor();
    const g = gold[actor]||0;
    const btn = (label, enabled, onclick) => `<button ${enabled?`onclick="${onclick}"`:'disabled'} style="padding:4px 7px;border-radius:6px;border:1px solid ${enabled?'#6a5a2a':'#2e2e2e'};background:${enabled?'#2a2410':'#191919'};color:${enabled?'#ffd60a':'#555'};font-size:11px;cursor:${enabled?'pointer':'default'}">${label}</button>`;
    const order = ['P','SN','B','R','N','JP','SH'];
    shop = order.map(k => {
      const price = TYCOON_PRICES[k];
      const snLocked = (k==='SN' && (tycoonTurn[actor]||0) < TYCOON_SN_MIN_TURN);
      return btn(`${T(PIECE_NAMES[k]||k)} ${price}G`, g >= price && !snLocked, `buyPiece('${k}')`);
    }).join('');
    shop += btn(snUpgraded[actor] ? T('저격강화 ✓') : `${T('저격강화')} ${TYCOON_SN_UPGRADE_COST}G`, !snUpgraded[actor] && g >= TYCOON_SN_UPGRADE_COST, 'upgradeSniper()');
    shop += btn(`${T('⬆폰승급')} ${TYCOON_PROMO_COST}G`, g >= TYCOON_PROMO_COST, 'startTycoonPromote()');
    shop += btn(`${T('⏭스킵')} +${TYCOON_SKIP_BONUS}G`, true, 'skipTurn()');
    shop = `<span style="color:#888;font-size:10px;white-space:nowrap;margin-right:2px">${T('{c} 상점 (턴 소모 없이 구매)',{c:T(actor==='w'?'백':'흑')})}</span>` + shop;
  }
  // 2줄: 윗줄=골드, 아랫줄=상점
  el.innerHTML = `<div class="tyc-gold">${goldLbl}</div>` + (shop ? `<div class="tyc-shop">${shop}</div>` : '');
}

// ===== 차단 칸 검증 =====
function isCellBlocked(r, c){
  if(!IS_POTION) return false;
  return blockedCells.some(b => b.r === r && b.c === c);
}

function drawBlockedOverlay(){
  if(!IS_POTION) return;
  document.querySelectorAll('.cell.blocked-cell').forEach(el => el.classList.remove('blocked-cell'));
  blockedCells.forEach(({r, c, turnsLeft}) => {
    const sq = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    if(sq){
      sq.classList.add('blocked-cell');
      sq.dataset.blockTurns = turnsLeft;
    }
  });
}

// 5종 물약 SVG (플라스크 모양, 색깔로 구분)
function potionSvg(type, size = 32){
  const c = POTION_TYPES[type].color;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
      <!-- 플라스크 몸체 -->
      <path d="M11 4 L11 12 L6 24 Q5 28 9 28 L23 28 Q27 28 26 24 L21 12 L21 4 Z"
            fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>
      <!-- 플라스크 액체 -->
      <path d="M8.5 18 L23.5 18 L26 24 Q27 28 23 28 L9 28 Q5 28 6 24 Z"
            fill="${c}" opacity="0.7"/>
      <!-- 플라스크 코르크 -->
      <rect x="10" y="2" width="12" height="3" rx="1" fill="${c}" opacity="0.9"/>
      <!-- 빛 반사 -->
      <ellipse cx="13" cy="22" rx="1.5" ry="3" fill="#fff" opacity="0.5"/>
    </svg>
  `;
}

function renderPotionUI(){
  const container = document.getElementById('potionInvContainer');
  const fab = document.getElementById('potionFab');
  if(IS_POTION){
    if(container) container.style.display = 'block';
    if(fab){
      fab.classList.add('show-potion'); // CSS가 모바일에서만 display:flex
      fab.style.display = ''; // inline 제거 (이전 호출 잔재)
      const badge = document.getElementById('potionFabBadge');
      const myCount = myInventory.length;
      if(badge){
        if(myCount > 0){
          badge.textContent = myCount;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      }
    }
  } else {
    if(container) container.style.display = 'none';
    if(fab){ fab.classList.remove('show-potion'); fab.style.display = 'none'; }
    return;
  }
  if(!container) return;
  const myCount = myInventory.length;
  const oppCount = IS_LOCAL || IS_AI ? (window._localOppInv || []).length : oppInventoryCount;
  container.innerHTML = `
    <button class="potion-open-btn" onclick="openPotionInventoryModal()">
      <div class="pot-btn-icon">${potionSvg('revive', 48)}</div>
      <div class="pot-btn-label">물약</div>
      <div class="pot-btn-meta">
        <span class="pot-btn-count">${myCount}/${MAX_INVENTORY_SIZE}</span>
        <span class="pot-btn-p">💰 ${myPoints}P</span>
      </div>
      ${myCount > 0 ? `<div class="pot-btn-badge">${myCount}</div>` : ''}
    </button>
    <div class="pot-opp-summary">
      <span>상대</span>
      <span>🧪 ${oppCount}</span>
      <span>💰 ${IS_LOCAL || IS_AI ? oppPoints + 'P' : '???'}</span>
    </div>
  `;
}

// 인벤토리 모달
window.openPotionInventoryModal = function(){
  if(!IS_POTION) return;
  document.getElementById('potionInvModal').classList.add('show');
  renderPotionInventoryModal();
};
window.closePotionInventoryModal = function(){
  document.getElementById('potionInvModal').classList.remove('show');
  _pendingMergeSelection = null;
};

let _pendingMergeSelection = null; // 합성 대기 (출발 물약 id)

function renderPotionInventoryModal(){
  const grid = document.getElementById('potionInvGrid');
  const oppEl = document.getElementById('potionInvOppList');
  const pEl = document.getElementById('potionInvPoints');
  if(!grid) return;
  pEl.textContent = myPoints + 'P';
  grid.innerHTML = myInventory.length === 0
    ? '<div class="pot-grid-empty">인벤토리 비어있음 — 매 턴 1개씩 자동 획득</div>'
    : myInventory.map(p => renderPotionCard(p)).join('');
  // 상대 인벤 (엿보기 공개 시만)
  const oppRevealed = oppInventoryRevealed;
  if(oppEl){
    if(oppRevealed && oppRevealed.length > 0){
      oppEl.innerHTML = '<div class="pot-grid-sub">👁 상대 인벤 (공개됨)</div>' +
        '<div class="pot-grid">' + oppRevealed.map(p => renderPotionCard(p, true)).join('') + '</div>';
    } else if(oppRevealed && oppRevealed.length === 0){
      oppEl.innerHTML = '<div class="pot-grid-empty">상대 인벤 비어있음</div>';
    } else {
      oppEl.innerHTML = '';
    }
  }
}

function renderPotionCard(p, isOpp = false){
  const t = POTION_TYPES[p.type];
  const isMergeTarget = _pendingMergeSelection && _pendingMergeSelection !== p.id &&
                        myInventory.find(x => x.id === _pendingMergeSelection)?.type === p.type &&
                        p.level === 1 &&
                        myInventory.find(x => x.id === _pendingMergeSelection)?.level === 1;
  const isMergeSource = _pendingMergeSelection === p.id;
  const cls = ['pot-card'];
  if(p.level > 1) cls.push('lv2');
  if(isMergeTarget) cls.push('merge-target');
  if(isMergeSource) cls.push('merge-source');
  if(isOpp) cls.push('opp');
  return `
    <div class="${cls.join(' ')}" 
         ${isOpp ? '' : `onclick="onPotionCardClick('${p.id}')"`}
         data-id="${p.id}"
         data-type="${p.type}"
         style="--pot-color:${t.color}">
      <div class="pot-card-img">${potionSvg(p.type, 56)}</div>
      <div class="pot-card-name">${t.name}${p.level > 1 ? ' ★' : ''}</div>
      <div class="pot-card-desc">${p.level > 1 ? t.mergeDesc : t.desc}</div>
      <div class="pot-card-cost">
        ${getPotionCost(p) > 0 ? `<b style="color:var(--gold)">${getPotionCost(p)}P</b>` : '<span style="color:var(--green)">무료</span>'}
      </div>
      ${isMergeTarget ? '<div class="pot-card-overlay">↑ 합성</div>' : ''}
      ${isMergeSource ? '<div class="pot-card-overlay">선택됨</div>' : ''}
    </div>
  `;
}

// 물약 클릭 처리 — 사용/합성 메뉴 또는 합성 대상 선택
window.onPotionCardClick = function(potionId){
  if(!IS_POTION) return;
  if(!isMyTurnForPotion()){
    showFlash('자기 턴에만 물약 사용 가능');
    return;
  }
  // 합성 모드 중이면 합성 대상으로 처리
  if(_pendingMergeSelection){
    if(_pendingMergeSelection === potionId){
      // 같은 거 다시 누름 → 합성 취소
      _pendingMergeSelection = null;
      renderPotionInventoryModal();
      return;
    }
    const src = myInventory.find(p => p.id === _pendingMergeSelection);
    const tgt = myInventory.find(p => p.id === potionId);
    if(src && tgt && src.type === tgt.type && src.level === 1 && tgt.level === 1){
      mergePotions(_pendingMergeSelection, potionId);
      _pendingMergeSelection = null;
      renderPotionInventoryModal();
    } else {
      showFlash('같은 종류 + 레벨 1 끼리만 합성 가능');
    }
    return;
  }
  // 메뉴 열기
  openPotionActionMenu(potionId);
};

// 액션 메뉴 (사용 / 합성)
window.openPotionActionMenu = function(potionId){
  const p = myInventory.find(x => x.id === potionId);
  if(!p) return;
  const t = POTION_TYPES[p.type];
  // 합성 가능 여부 — 같은 종류 + 레벨 1 + 인벤에 2개 이상
  const sameType = myInventory.filter(x => x.type === p.type && x.level === 1);
  const canMerge = sameType.length >= 2 && p.level === 1;
  const cost = getPotionCost(p);
  const canUse = myPoints >= cost && !(p.type === 'joker' && IS_AI);
  
  const menu = document.getElementById('potionActionMenu');
  document.getElementById('pamIcon').innerHTML = potionSvg(p.type, 48);
  document.getElementById('pamName').textContent = t.name + (p.level > 1 ? ' ★' : '');
  const aiBlockNote = (p.type === 'joker' && IS_AI) 
    ? '<br><span style="color:var(--red);font-size:11px">⚠ AI 대전에선 사용 불가</span>' 
    : '';
  document.getElementById('pamDesc').innerHTML = (p.level > 1 ? t.mergeDesc : t.desc) + aiBlockNote;
  document.getElementById('pamCost').innerHTML = cost > 0 ? `비용 <b style="color:var(--gold)">${cost}P</b>` : '<span style="color:var(--green)">무료</span>';
  const useBtn = document.getElementById('pamUseBtn');
  useBtn.disabled = !canUse;
  useBtn.onclick = () => {
    closePotionActionMenu();
    usePotion(potionId);
  };
  const mergeBtn = document.getElementById('pamMergeBtn');
  if(canMerge){
    mergeBtn.style.display = '';
    mergeBtn.onclick = () => {
      closePotionActionMenu();
      _pendingMergeSelection = potionId;
      renderPotionInventoryModal();
      showFlash('합성할 같은 종류 물약을 선택하세요');
    };
  } else {
    mergeBtn.style.display = 'none';
  }
  menu.classList.add('show');
};
window.closePotionActionMenu = function(){
  document.getElementById('potionActionMenu').classList.remove('show');
};

function updatePointsUI(){
  renderPotionUI();
  // 모달이 열려있으면 그것도 갱신
  if(document.getElementById('potionInvModal')?.classList.contains('show')){
    renderPotionInventoryModal();
  }
}

function updatePointsUI(){ renderPotionUI(); }

// ===== 인벤토리 클릭 → 사용/취소 메뉴 =====
let _pendingPotion = null; // 현재 선택된 물약 (사용 대기)
let _pendingMerge = null;  // 합체 대기 (드래그 출발)

function isMyTurnForPotion(){
  if(IS_REPLAY || IS_SPEC || gameOver) return false;
  if(IS_LOCAL) return true;
  return turn === MY_COLOR;
}

function getPotionCost(potion){
  const base = POTION_TYPES[potion.type].cost || 0;
  // 합체는 cost는 같지만 효과 다름 (level 2)
  return base;
}

function mergePotions(srcId, tgtId){
  const src = myInventory.find(p => p.id === srcId);
  const tgt = myInventory.find(p => p.id === tgtId);
  if(!src || !tgt) return;
  if(src.type !== tgt.type){
    showFlash('같은 종류 물약끼리만 합성 가능');
    return;
  }
  if(src.level > 1 || tgt.level > 1){
    showFlash('이미 강화된 물약은 합성 불가');
    return;
  }
  // 합성: src 제거 + tgt level 2로
  myInventory = myInventory.filter(p => p.id !== srcId);
  tgt.level = 2;
  showFlash(`✨ ${POTION_TYPES[tgt.type].name} 강화!`, 1500);
  renderPotionUI();
  if(IS_NET) sendToPeer({ t:'POTION_MERGE', srcId, tgtId });
}

// ===== 상점 =====
const SHOP_PRICES = {
  revive: { buy: 5, sell: 2 },
  block:  { buy: 4, sell: 2 },
  joker:  { buy: 8, sell: 3 },
  time:   { buy: 3, sell: 1 },
  peek:   { buy: 2, sell: 1 }
};
const GACHA_COST = 3;
let _shopTab = 'buy';

window.openPotionShop = function(){
  if(!IS_POTION) return;
  if(!isMyTurnForPotion()){
    showFlash('자기 턴에만 상점 이용 가능');
    return;
  }
  closePotionInventoryModal();
  document.getElementById('potionShopModal').classList.add('show');
  _shopTab = 'buy';
  renderShop();
};
window.closePotionShop = function(){
  document.getElementById('potionShopModal').classList.remove('show');
};
window.switchShopTab = function(tab){
  _shopTab = tab;
  document.querySelectorAll('.shop-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.shopTab === tab);
  });
  renderShop();
};

function renderShop(){
  document.getElementById('shopPoints').textContent = myPoints + 'P';
  const content = document.getElementById('shopContent');
  if(_shopTab === 'buy'){
    content.innerHTML = `
      <div class="shop-grid">
        ${POTION_KEYS.map(type => {
          const t = POTION_TYPES[type];
          const price = SHOP_PRICES[type].buy;
          const canBuy = myPoints >= price && myInventory.length < MAX_INVENTORY_SIZE;
          return `
            <div class="shop-card ${canBuy?'':'disabled'}" style="--pot-color:${t.color}">
              <div class="shop-card-img">${potionSvg(type, 48)}</div>
              <div class="shop-card-name">${t.name}</div>
              <div class="shop-card-desc">${t.desc}</div>
              <button class="shop-card-btn buy" ${canBuy?'':'disabled'} onclick="shopBuy('${type}')">
                💰 ${price}P 구매
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else if(_shopTab === 'sell'){
    if(myInventory.length === 0){
      content.innerHTML = '<div class="shop-empty">판매할 물약이 없습니다</div>';
      return;
    }
    content.innerHTML = `
      <div class="shop-grid">
        ${myInventory.map(p => {
          const t = POTION_TYPES[p.type];
          const price = SHOP_PRICES[p.type].sell * (p.level === 2 ? 2 : 1);
          return `
            <div class="shop-card" style="--pot-color:${t.color}">
              <div class="shop-card-img">${potionSvg(p.type, 48)}</div>
              <div class="shop-card-name">${t.name}${p.level > 1 ? ' ★' : ''}</div>
              <div class="shop-card-desc">레벨 ${p.level}</div>
              <button class="shop-card-btn sell" onclick="shopSell('${p.id}')">
                💰 ${price}P 판매
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else if(_shopTab === 'gacha'){
    const canPull = myPoints >= GACHA_COST && myInventory.length < MAX_INVENTORY_SIZE;
    content.innerHTML = `
      <div class="shop-gacha">
        <div class="shop-gacha-icon">
          <svg width="120" height="120" viewBox="0 0 32 32" fill="none">
            <path d="M11 4 L11 12 L6 24 Q5 28 9 28 L23 28 Q27 28 26 24 L21 12 L21 4 Z"
                  fill="url(#gachaGrad)" stroke="#bf5af2" stroke-width="2" stroke-linejoin="round"/>
            <rect x="10" y="2" width="12" height="3" rx="1" fill="#bf5af2"/>
            <defs>
              <linearGradient id="gachaGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#5ac8fa" stop-opacity=".6"/>
                <stop offset="33%" stop-color="#bf5af2" stop-opacity=".6"/>
                <stop offset="66%" stop-color="#ff453a" stop-opacity=".6"/>
                <stop offset="100%" stop-color="#f5c842" stop-opacity=".6"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h3>랜덤 뽑기</h3>
        <p style="color:var(--muted);font-size:13px;margin:8px 0 14px">
          5종 물약 중 하나를 무작위로 획득합니다.
        </p>
        <button class="shop-gacha-btn ${canPull?'':'disabled'}" ${canPull?'':'disabled'} onclick="shopGacha()">
          💰 ${GACHA_COST}P — 뽑기!
        </button>
        ${myInventory.length >= MAX_INVENTORY_SIZE ? '<div style="color:var(--red);font-size:11px;margin-top:8px">인벤토리 가득참</div>' : ''}
      </div>
    `;
  }
}

window.shopBuy = function(type){
  const price = SHOP_PRICES[type].buy;
  if(myPoints < price){ showFlash('포인트 부족'); return; }
  if(myInventory.length >= MAX_INVENTORY_SIZE){ showFlash('인벤토리 가득참'); return; }
  myPoints -= price;
  const newP = { id: genPotionId(), type, level: 1, color: IS_LOCAL ? turn : MY_COLOR };
  myInventory.push(newP);
  // 로컬: _localInv/_localPts도 갱신
  if(IS_LOCAL){
    window._localInv[turn] = myInventory;
    window._localPts[turn] = myPoints;
  }
  showFlash(`✓ ${POTION_TYPES[type].name} 구매!`);
  renderShop();
  renderPotionUI();
  if(IS_NET) sendToPeer({ t:'POTION_SHOP_BUY' });
};

window.shopSell = function(potionId){
  const p = myInventory.find(x => x.id === potionId);
  if(!p) return;
  const price = SHOP_PRICES[p.type].sell * (p.level === 2 ? 2 : 1);
  myInventory = myInventory.filter(x => x.id !== potionId);
  myPoints += price;
  if(IS_LOCAL){
    window._localInv[turn] = myInventory;
    window._localPts[turn] = myPoints;
  }
  showFlash(`✓ +${price}P (${POTION_TYPES[p.type].name} 판매)`);
  renderShop();
  renderPotionUI();
  if(IS_NET) sendToPeer({ t:'POTION_SHOP_SELL' });
};

window.shopGacha = function(){
  if(myPoints < GACHA_COST){ showFlash('포인트 부족'); return; }
  if(myInventory.length >= MAX_INVENTORY_SIZE){ showFlash('인벤토리 가득참'); return; }
  myPoints -= GACHA_COST;
  const type = POTION_KEYS[Math.floor(Math.random() * POTION_KEYS.length)];
  myInventory.push({ id: genPotionId(), type, level: 1, color: IS_LOCAL ? turn : MY_COLOR });
  if(IS_LOCAL){
    window._localInv[turn] = myInventory;
    window._localPts[turn] = myPoints;
  }
  showFlash(`🎰 ${POTION_TYPES[type].name} 획득!`, 2000);
  renderShop();
  renderPotionUI();
  if(IS_NET) sendToPeer({ t:'POTION_SHOP_BUY' });
};

// ===== 물약 사용 =====
function usePotion(potionId){
  const p = myInventory.find(x => x.id === potionId);
  if(!p) return;
  const cost = getPotionCost(p);
  if(myPoints < cost){
    showFlash('포인트 부족');
    return;
  }
  // AI 모드 + 조커 차단 (AI 색 swap 미지원)
  if(p.type === 'joker' && IS_AI){
    showFlash('AI 대전에서는 조커 포션을 사용할 수 없습니다', 2500);
    return;
  }
  
  // 모든 인벤 관련 모달 닫고 메인 보드로 복귀
  closePotionInventoryModal();
  closePotionActionMenu();
  
  // 타입별 사용 분기
  switch(p.type){
    case 'revive': openReviveModal(potionId); break;
    case 'block':  openBlockSelect(potionId); break;
    case 'joker':  applyJokerPotion(potionId); break;
    case 'time':   applyTimePotion(potionId); break;
    case 'peek':   applyPeekPotion(potionId); break;
  }
}

function consumePotion(potionId, cost){
  // NaN/undefined 가드
  if(typeof cost !== 'number' || isNaN(cost)) cost = 0;
  if(typeof myPoints !== 'number' || isNaN(myPoints)) myPoints = 0;
  myInventory = myInventory.filter(p => p.id !== potionId);
  myPoints = Math.max(0, myPoints - cost);
  if(IS_LOCAL){
    window._localInv[turn] = myInventory;
    window._localPts[turn] = myPoints;
  }
  renderPotionUI();
  if(IS_NET){
    sendToPeer({ t:'POTION_USED', potionId });
  }
}

// ----- 부활 물약 -----
function openReviveModal(potionId){
  const p = myInventory.find(x => x.id === potionId);
  if(!p) return;
  const myColor = IS_LOCAL ? turn : MY_COLOR;
  // 죽은 기물 = DEFAULT_HAND - hands[myColor] - 보드 위 기물
  const myDead = countDeadPieces(myColor);
  const deadList = Object.entries(myDead).filter(([k,v]) => v > 0 && k !== 'K');
  if(deadList.length === 0){
    showFlash('부활할 죽은 기물 없음');
    return;
  }
  const modal = document.getElementById('reviveModal');
  const html = deadList.map(([kind, count]) => {
    const v = PIECE_VALUES[kind] || 10;
    const cost = Math.ceil(v / 2) * (p.level === 2 ? 0.5 : 1);
    const actualCost = Math.ceil(cost);
    const piece = pieceGlyph(myColor, kind);
    return `
      <div class="revive-opt ${myPoints < actualCost ? 'disabled' : ''}" 
           onclick="${myPoints >= actualCost ? `confirmRevive('${potionId}','${kind}',${actualCost})` : ''}">
        <div class="revive-piece" style="color:${myColor==='w'?'#fff':'#000'};text-shadow:${myColor==='w'?'0 0 4px rgba(0,0,0,.8)':'0 0 4px rgba(255,255,255,.4)'}">${piece}</div>
        <div class="revive-info">
          <div class="revive-name">${getPieceName(kind)}</div>
          <div class="revive-meta">남은 ${count}개 · 비용 <b style="color:var(--gold)">${actualCost}P</b></div>
        </div>
      </div>
    `;
  }).join('');
  document.getElementById('reviveList').innerHTML = html;
  document.getElementById('reviveTitle').textContent = '부활할 기물 선택' + (p.level === 2 ? ' (50% 할인 적용)' : '');
  modal.classList.add('show');
}
window.closeReviveModal = function(){
  document.getElementById('reviveModal').classList.remove('show');
};
window.confirmRevive = function(potionId, kind, cost){
  closeReviveModal();
  // 부활 위치 자동: 그 기물 종류의 시작 위치 또는 같은 색 시작 영역 첫 빈 칸
  const myColor = IS_LOCAL ? turn : MY_COLOR;
  const placePos = findRevivePosition(kind, myColor);
  if(!placePos){
    showFlash('부활 위치 없음 (보드 가득)');
    return;
  }
  // 보드에 배치
  board[placePos.r][placePos.c] = (kind === 'SN') ? { color: myColor, kind, attacks: 0 } : { color: myColor, kind };
  consumePotion(potionId, cost);
  renderAll();
  showFlash(`✨ ${getPieceName(kind)} 부활!`);
  playSnd('place');
  if(IS_NET) sendToPeer({ t:'POTION_REVIVE', kind, r: placePos.r, c: placePos.c, color: myColor });
}
function countDeadPieces(color){
  // INIT_HAND 기준 - 보드 위 현재 + 손패
  const total = {...INIT_HAND};
  const onBoard = {};
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p = board[r][c];
    if(p && p.color === color){
      onBoard[p.kind] = (onBoard[p.kind] || 0) + 1;
    }
  }
  const dead = {};
  Object.keys(total).forEach(k => {
    dead[k] = total[k] - (onBoard[k]||0) - (hands[color][k]||0);
    if(dead[k] < 0) dead[k] = 0;
  });
  return dead;
}
function findRevivePosition(kind, color){
  // 우선 그 색 진영 시작 영역에서 빈 칸 찾기
  // white 진영: r=5,6,7 / black 진영: r=0,1,2
  const myRows = color === 'w' ? [7,6,5,4] : [0,1,2,3];
  for(const r of myRows){
    for(let c=0;c<8;c++){
      if(!board[r][c] && !isCellBlocked(r,c)){
        if(kind === 'SN' && !inCornerZone(r,c)) continue;
        return {r, c};
      }
    }
  }
  // 진영에 없으면 아무 빈 칸
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    if(!board[r][c] && !isCellBlocked(r,c)) return {r, c};
  }
  return null;
}
function getPieceName(kind){
  return {K:'킹',Q:'퀸',R:'룩',B:'비숍',N:'나이트',P:'폰',SH:'방패',SN:'스나이퍼',JP:'어쌔신'}[kind] || kind;
}
function pieceGlyph(color, kind){
  const G = {
    w:{K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',SH:'⬢',SN:'⊕',JP:'✦',GK:'♚'},
    b:{K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟',SH:'⬢',SN:'⊕',JP:'✦',GK:'♚'}
  };
  return G[color][kind] || '?';
}

// ----- 차단 물약 -----
let _pendingBlockPotion = null;
let _pendingBlockClicksLeft = 0;
function openBlockSelect(potionId){
  const p = myInventory.find(x => x.id === potionId);
  if(!p) return;
  _pendingBlockPotion = potionId;
  _pendingBlockClicksLeft = p.level === 2 ? 2 : 1;
  showFlash(`🚫 차단할 빈 칸을 선택하세요 ${_pendingBlockClicksLeft}개`, 3000);
  // 사용자가 보드 클릭 시 onCellClick 에서 처리 (밑에서 별도 hook)
}
function tryBlockCellClick(r, c){
  if(!_pendingBlockPotion) return false;
  // 빈 칸만 차단 가능
  if(board[r][c]){
    showFlash('빈 칸만 차단 가능');
    return true; // 클릭은 소비 (취소 안 됨)
  }
  if(isCellBlocked(r,c)){
    showFlash('이미 차단된 칸');
    return true;
  }
  const myColor = IS_LOCAL ? turn : MY_COLOR;
  blockedCells.push({r, c, turnsLeft: 3, owner: myColor});
  _pendingBlockClicksLeft--;
  drawBlockedOverlay();
  if(IS_NET) sendToPeer({ t:'POTION_BLOCK', r, c, color: myColor });
  if(_pendingBlockClicksLeft <= 0){
    const cost = POTION_TYPES.block.cost;
    consumePotion(_pendingBlockPotion, cost);
    _pendingBlockPotion = null;
    playSnd('place');
    showFlash('✓ 차단 완료');
  } else {
    showFlash(`${_pendingBlockClicksLeft}개 더 선택`);
  }
  return true;
}

// ----- 조커 포션 (색 swap + 보드 회전) -----
function applyJokerPotion(potionId){
  const p = myInventory.find(x => x.id === potionId);
  if(!p) return;
  const cost = POTION_TYPES.joker.cost;
  // 모든 기물 색 swap
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    if(board[r][c]) board[r][c].color = opp(board[r][c].color);
  }
  // 손패도 swap
  const tmpHand = {...hands.w}; hands.w = {...hands.b}; hands.b = tmpHand;
  // kingPlaced swap
  const tmpKP = kingPlaced.w; kingPlaced.w = kingPlaced.b; kingPlaced.b = tmpKP;
  // 차단 칸 소유자 swap
  blockedCells.forEach(b => { b.owner = opp(b.owner); });
  // 시간도 swap (각자 자기 시계)
  const tmpT = _wTimeLeft; _wTimeLeft = _bTimeLeft; _bTimeLeft = tmpT;
  // 내 색 swap (네트워크/AI만 — 로컬은 양쪽 다 본인이라 안 함)
  if(!IS_LOCAL){
    MY_COLOR = opp(MY_COLOR);
    document.body.classList.toggle('board-flipped');
  }
  consumePotion(potionId, cost);
  
  if(p.level === 2){
    showFlash('🃏 조커 강화! 한 번 더 둘 수 있음');
    renderAll();
    // turn 안 넘김 — 자기 차례 유지
  } else {
    showFlash('🃏 진영 교환!');
    // 한 수로 처리 → turn 넘김
    turn = opp(turn);
    if(IS_POTION) handlePotionTurnStart(turn);
    renderAll();
    // AI 차례면 AI가 두도록
    if(IS_AI && turn !== MY_COLOR){
      setTimeout(()=> { if(typeof aiTurn === 'function') aiTurn(); }, 300);
    }
  }
  playSnd('move');
  if(IS_NET) sendToPeer({ t:'POTION_JOKER', level: p.level });
}

// ----- 시간 물약 -----
function applyTimePotion(potionId){
  const p = myInventory.find(x => x.id === potionId);
  if(!p) return;
  const myColor = IS_LOCAL ? turn : MY_COLOR;
  const oppColor = opp(myColor);
  if(myColor === 'w'){
    _wTimeLeft += 180 * 1000;
    if(p.level === 2) _bTimeLeft = Math.max(0, _bTimeLeft - 120 * 1000);
  } else {
    _bTimeLeft += 180 * 1000;
    if(p.level === 2) _wTimeLeft = Math.max(0, _wTimeLeft - 120 * 1000);
  }
  consumePotion(potionId, POTION_TYPES.time.cost);
  showFlash(p.level === 2 ? '⏰ 내 +3분, 상대 -2분!' : '⏰ +3분');
  renderTimer();
  if(IS_NET) sendToPeer({ t:'POTION_TIME', level: p.level, color: myColor });
}

// ----- 엿보기 물약 -----
function applyPeekPotion(potionId){
  const p = myInventory.find(x => x.id === potionId);
  if(!p) return;
  
  // 상대 인벤 가져오기
  let oppInv = null;
  if(IS_LOCAL){
    oppInv = (window._localInv && window._localInv[opp(turn)]) || [];
  } else if(IS_AI){
    oppInv = window._localOppInv || [];
  } else {
    // 네트워크: 요청 보냄
    sendToPeer({ t:'POTION_PEEK_REQ' });
    showFlash('👁 상대 인벤토리 요청...', 1500);
  }
  
  // 즉시 표시 (네트워크는 응답 대기)
  if(oppInv !== null){
    oppInventoryRevealed = oppInv.map(x => ({...x}));
    showPeekFloatingCard(oppInventoryRevealed);
  }
  
  // 합체: 훔치기
  if(p.level === 2){
    let stealFrom = null;
    if(IS_LOCAL) stealFrom = window._localInv[opp(turn)];
    else if(IS_AI) stealFrom = window._localOppInv;
    
    if(stealFrom && stealFrom.length > 0 && myInventory.length < MAX_INVENTORY_SIZE){
      const idx = Math.floor(Math.random() * stealFrom.length);
      const stolen = stealFrom.splice(idx, 1)[0];
      stolen.id = genPotionId(); // 새 id 부여
      stolen.color = (IS_LOCAL ? turn : MY_COLOR);
      myInventory.push(stolen);
      if(IS_LOCAL){
        window._localInv[turn] = myInventory;
      }
      showFlash(`👁 강화: ${POTION_TYPES[stolen.type].name} 훔침!`, 2000);
    } else if(!IS_LOCAL && !IS_AI){
      sendToPeer({ t:'POTION_STEAL_REQ' });
    } else if(!stealFrom || stealFrom.length === 0){
      showFlash('상대 인벤이 비어있음');
    }
  }
  
  consumePotion(potionId, POTION_TYPES.peek.cost);
  // 12초 후 정리
  setTimeout(()=>{ 
    oppInventoryRevealed = null; 
    hidePeekFloatingCard();
  }, 12000);
}

function showPeekFloatingCard(inv){
  let el = document.getElementById('peekFloating');
  if(!el){
    el = document.createElement('div');
    el.id = 'peekFloating';
    el.className = 'peek-floating';
    document.body.appendChild(el);
  }
  const items = inv && inv.length > 0
    ? inv.map(p => `
        <div class="peek-fl-item" style="--pot-color:${POTION_TYPES[p.type].color}">
          ${potionSvg(p.type, 36)}
          <div class="peek-fl-name">${POTION_TYPES[p.type].name}${p.level>1?' ★':''}</div>
        </div>
      `).join('')
    : '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:12px">비어있음</div>';
  el.innerHTML = `
    <div class="peek-fl-header">👁 상대 인벤 <span class="peek-fl-timer">12s</span></div>
    <div class="peek-fl-grid">${items}</div>
  `;
  el.classList.add('show');
  // 타이머 카운트다운
  let remain = 12;
  if(el._peekTimer) clearInterval(el._peekTimer);
  el._peekTimer = setInterval(()=>{
    remain--;
    const t = el.querySelector('.peek-fl-timer');
    if(t) t.textContent = remain + 's';
    if(remain <= 0){
      clearInterval(el._peekTimer);
      hidePeekFloatingCard();
    }
  }, 1000);
}
function hidePeekFloatingCard(){
  const el = document.getElementById('peekFloating');
  if(el){
    if(el._peekTimer) clearInterval(el._peekTimer);
    el.classList.remove('show');
  }
}

function renderTimer(){
  // 타이머 즉시 갱신용 — 실제 함수는 별도 있음. 그게 자동 갱신.
}

// 농민 봉기: 봉기 게이지가 임계치(≥50%) 찬 진영의 폰이, 전진 대각 사정거리 안의 (먹을 수 있는) 킹을
//            자동으로 처치 → 그 킹은 "회색 킹"으로 전복되고, 봉기한 진영(폰의 색)에 룩 +1.
//            처치된 킹의 색 목록을 반환(없으면 빈 배열). 회색 킹 처치=승리 규칙은 기존대로 유지.
function resolvePeasantKingHunt(){
  if(!IS_PEASANT) return [];
  const hunted = [];
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p = board[r][c];
    if(!p || p.kind !== 'P') continue;
    const dy = (p.color === 'w') ? -1 : 1;
    for(const dc of [-1,1]){
      const nr = r+dy, nc = c+dc;
      if(!inBounds(nr,nc)) continue;
      const t = board[nr][nc];
      if(t && t.kind === 'K' && pawnCanEatKing(p.color, t.color)){
        board[nr][nc] = { color: t.color, kind: 'GK' };   // 킹 → 회색 킹 (색 유지)
        hands[p.color]['R'] = (hands[p.color]['R'] || 0) + 1;  // 봉기한 진영에 룩 +1
        hunted.push(t.color);
      }
    }
  }
  return hunted;
}

function finalizeAfterMove(opponentInCheck, snap, silent=false){
  // 차례 넘김
  turn = opp(turn);

  // 농민 봉기: 봉기(≥50%) 폰의 자동 킹 사냥 (silent 합법성 검증 호출은 제외)
  if(IS_PEASANT && !silent){
    const hunted = resolvePeasantKingHunt();
    for(const col of hunted){
      showFlash((window.t ? window.t('🔥 {c} 킹이 봉기한 농민에게 처치되어 회색 킹이 되었습니다!', {c:window.t(col==='w'?'백':'흑')}) : `🔥 ${col==='w'?'백':'흑'} 킹이 봉기한 농민에게 처치되어 회색 킹이 되었습니다!`), 3500);
    }
  }

  // 타이쿤: 새 턴 색에 골드 수입 +5G, 폰 나이 +1, 50G 선점 승리 체크 (silent 제외)
  if(IS_TYCOON && !silent){
    handleTycoonIncome(turn);
    if((gold.w||0) >= TYCOON_WIN_GOLD) return { ok:true, tycoonWin:'w' };
    if((gold.b||0) >= TYCOON_WIN_GOLD) return { ok:true, tycoonWin:'b' };
  }

  // 물약 모드: 새 턴 색에 물약 자동 지급 + 차단 칸 감소 (silent 검증 호출은 제외)
  if(IS_POTION && !silent){
    handlePotionTurnStart(turn);
  }

  // 5연속 검사 — 단순 보드 스캔, 재귀 없음 → silent에서도 안전하게 검사
  const fiveWin = checkFiveInRow();
  if(fiveWin){
    if(!silent) moveHistory.push(serializeBoard());
    return { ok:true, fiveWin };
  }

  // silent (allLegalActions 합법성 검증 등) 호출에선 여기까지.
  // 체크메이트 검사는 hasAnyLegalAction → applyAction(silent) 재귀이므로 silent에선 건너뜀.
  // AI는 외부에서 isCheckmate(...)를 별도 호출해 메이트 판정.
  if(silent) return { ok:true };

  // 체크메이트 검사
  if(opponentInCheck && isCheckmate(turn)){
    moveHistory.push(serializeBoard());
    return { ok:true, checkmate: opp(turn) };
  }

  // 무브 못 둘 수 있는 스테일메이트 → 무승부
  if(!opponentInCheck && kingPlaced[turn] && !hasAnyLegalAction(turn)){
    // 손패가 있으면 배치 가능, 그래서 배치 가능성 확인 후 판정
    moveHistory.push(serializeBoard());
    return { ok:true, stalemate:true };
  }

  // 직렬화 후 반복 카운트
  const ser = serializeBoard();
  moveHistory.push(ser);
  // 같은 직렬화 3번 → 무승부
  const rep = moveHistory.filter(x => x === ser).length;
  if(rep >= 3){
    return { ok:true, repetition:true };
  }

  return { ok:true };
}

// 방패 이동 처리 (밀기 포함)
function trySHMove(fr, fc, tr, tc, color){
  // 앞/뒤 1칸
  const dy = (color === 'w') ? -1 : 1;
  const allowedRows = [fr+dy, fr-dy];
  if(!allowedRows.includes(tr)) return { ok:false, err:'방패는 앞/뒤만' };
  if(tc !== fc) return { ok:false, err:'방패는 직진만' };
  const ddy = tr - fr; // +1 or -1
  const target = board[tr][tc];
  if(!target){
    // 단순 이동
    board[tr][tc] = board[fr][fc];
    board[fr][fc] = null;
    lastMove = { fr, fc, tr, tc, type:'move' };
    return { ok:true };
  }
  // 밀기: 다음 칸 검사
  const pr = tr + ddy;
  if(!inBounds(pr, tc)){
    // 판 끝 → 밀린 기물 사망 (손패 회수 X)
    board[tr][tc] = board[fr][fc];
    board[fr][fc] = null;
    lastMove = { fr, fc, tr, tc, type:'push' };
    return { ok:true };
  }
  const beyond = board[pr][tc];
  if(beyond){
    // 다른 기물에 닿음 → 밀린 기물 사망 (손패 회수 X), beyond는 그대로
    board[tr][tc] = board[fr][fc];
    board[fr][fc] = null;
    lastMove = { fr, fc, tr, tc, type:'push' };
    return { ok:true };
  }
  // 밀기 성공: target → beyond, SH → target
  board[pr][tc] = target;
  board[tr][tc] = board[fr][fc];
  board[fr][fc] = null;
  lastMove = { fr, fc, tr, tc, type:'push' };
  return { ok:true };
}

// 모든 합법 액션 수집 (체크 검증 포함)
function allLegalActions(color){
  const list = [];
  const handHasPieces = Object.values(hands[color]).some(v => v > 0);
  // 킹 미배치면 킹 배치만 가능 (단, 자기 킹이 즉시 체크되는 자리는 제외 — 아래 필터에서 걸러짐)
  if(!kingPlaced[color]){
    if(hands[color].K > 0){
      for(let r=2;r<=5;r++) for(let c=2;c<=5;c++){
        if(!board[r][c]) list.push({type:'place', kind:'K', r, c, color});
      }
    }
    // ⚠ 여기서 early return 하지 않음 — 아래 합법성 필터로 흘려보내서
    // 상대 킹 인접 등 자기 킹이 즉시 체크되는 자리를 걸러냄 (AI가 무한 거절 안 당하게)
  } else {
    // 손패 배치
    for(const [kind, n] of Object.entries(hands[color])){
      if(n <= 0) continue;
      if(kind === 'K') continue; // K 추가 배치 불가 (이미 배치됨)
      if(kind === 'SN'){
        [[0,0],[0,7],[7,0],[7,7]].forEach(([r,c]) => {
          if(!board[r][c]) list.push({type:'place', kind, r, c, color});
        });
      } else {
        for(let r=2;r<=5;r++) for(let c=1;c<=6;c++){
          if(!board[r][c]) list.push({type:'place', kind, r, c, color});
        }
      }
    }
  }
  // 보드상 기물 이동
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p = board[r][c];
    if(!p || p.color !== color) continue;
    if(p.kind === 'SN'){
      const { attacks } = pieceMoves(r, c, p);
      for(const [tr,tc] of attacks){
        list.push({type:'move', fr:r, fc:c, tr, tc});
      }
    } else if(p.kind === 'SH'){
      const dy = (color === 'w') ? -1 : 1;
      for(const ddy of [dy, -dy]){
        const nr = r+ddy;
        if(!inBounds(nr,c)) continue;
        list.push({type:'move', fr:r, fc:c, tr:nr, tc:c});
      }
    } else {
      const { moves, attacks } = pieceMoves(r, c, p);
      for(const [tr,tc] of moves) list.push({type:'move', fr:r, fc:c, tr, tc});
      for(const [tr,tc] of attacks) list.push({type:'move', fr:r, fc:c, tr, tc});
    }
  }

  // 자기 킹 체크 노출되는 수 제거 + 5회 체크 한도 검증
  const filtered = list.filter(a => {
    const snap = snapshotState();
    const r = applyAction(a, {silent:true});
    const isLegal = r.ok && !r.suicide;
    restoreState(snap);
    return isLegal;
  });
  return filtered;
}

function hasAnyLegalAction(color){
  // 빠른 검증 (전체 수집은 비싸지만 정확함)
  // 일단 모두 수집
  const list = allLegalActions(color);
  return list.length > 0;
}

function isCheckmate(color){
  if(!kingPlaced[color]) return false;
  if(!isInCheck(color)) return false;
  return !hasAnyLegalAction(color);
}

// ===================================================================
// 9. UI 렌더링
// ===================================================================
const boardEl = document.getElementById('board');

function setBoardSize(){
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  let cellSize;
  if(ww >= 821){
    // 데스크탑: 좌우 패널 240*2 + 패딩
    const avail = Math.min(ww - 540, wh - 100);
    cellSize = Math.max(40, Math.min(72, Math.floor(avail / 8)));
  } else {
    // 모바일/태블릿: 보드 영역의 실제 폭 기준 (이젠 grid가 auto-row라 폭이 결정 인자)
    const wrap = document.querySelector('.board-wrap');
    const availW = wrap ? Math.max(0, wrap.getBoundingClientRect().width - 6) : (ww - 16);
    // 세로 여유도 검사 — 카드+손패+탑바 합쳐 대략 320px 정도 여유 두고 클램프
    const availH = Math.max(180, wh - 320);
    const sq = Math.min(availW || (ww-16), availH);
    cellSize = Math.max(28, Math.min(56, Math.floor(sq / 8)));
  }
  document.documentElement.style.setProperty('--cs', cellSize + 'px');
}
window.addEventListener('resize', setBoardSize);
window.addEventListener('orientationchange', ()=> setTimeout(setBoardSize, 100));
// 화면 폭 변경 시 카드/손패 스왑 조건도 재평가
let _resizeRenderTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(_resizeRenderTimer);
  _resizeRenderTimer = setTimeout(()=> { try { renderAll(); } catch(_){} }, 150);
});

let SEL = null;             // 선택 상태: {kind:'place'|'board', ...}
let HIGHLIGHTS = [];        // 표시할 [r,c, type] 좌표 리스트

function flipped(){ return MY_COLOR === 'b'; }
function displayCoords(r, c){
  // 흑 시점이면 보드 회전
  return flipped() ? [7-r, 7-c] : [r, c];
}
function logicalCoords(dr, dc){
  return flipped() ? [7-dr, 7-dc] : [dr, dc];
}

function renderBoard(){
  boardEl.innerHTML = '';
  for(let dr=0; dr<8; dr++){
    for(let dc=0; dc<8; dc++){
      const [r,c] = logicalCoords(dr, dc);
      const cell = document.createElement('div');
      cell.className = 'cell ' + ((r+c)%2===0 ? 'lt' : 'dk');
      cell.dataset.r = r;
      cell.dataset.c = c;

      // 좌표 라벨 (시점 기준)
      if(dc === 0){
        const lab = document.createElement('span');
        lab.className = 'coord r';
        lab.textContent = rankLabel(r);
        cell.appendChild(lab);
      }
      if(dr === 7){
        const lab = document.createElement('span');
        lab.className = 'coord f';
        lab.textContent = fileLabel(c);
        cell.appendChild(lab);
      }

      // 배치 영역 표시 (선택된 손패에 따라)
      if(SEL && SEL.kind === 'place' && !board[r][c] && canPlaceHere(SEL.color, SEL.piece, r, c)){
        if(SEL.piece === 'K') cell.classList.add('king-zone');
        else if(SEL.piece === 'SN') cell.classList.add('corner-zone');
        else cell.classList.add('place-zone');
      }

      // 기물
      const p = board[r][c];
      if(p){
        const span = document.createElement('span');
        const isSpec = SPECIAL_KINDS.includes(p.kind);
        span.className = 'pc ' + p.color + (isSpec?' spec':'');
        span.textContent = SYMBOLS[p.color][p.kind];
        if(p.kind === 'GK'){ span.style.color = '#9aa0a6'; span.style.textShadow = '0 0 8px #6b7075'; }  // 회색 킹
        cell.appendChild(span);
        // 스나이퍼 공격 카운터 (3회 후퇴)
        if(p.kind === 'SN' && p.attacks > 0){
          const ctr = document.createElement('span');
          ctr.className = 'sn-counter';
          ctr.textContent = `${p.attacks}/3`;
          cell.appendChild(ctr);
        }
      }

      // 폰 배치 미리보기: 손패에서 폰 선택 중이고 이 칸이 배치 가능 영역이면 진행방향 화살표
      if(SEL && SEL.kind === 'place' && SEL.piece === 'P' && !board[r][c] && canPlaceHere(SEL.color, 'P', r, c)){
        const arrow = document.createElement('span');
        // 시각적 방향: 백은 r 감소 방향(논리적 위), 흑은 r 증가(논리적 아래)
        // flipped()=true면 화면이 뒤집혀 시각적으로 반대
        const movesUpVisually = (SEL.color === 'w') !== flipped();
        arrow.className = 'pawn-place-arrow ' + SEL.color + ' ' + (movesUpVisually ? 'up' : 'down');
        arrow.textContent = movesUpVisually ? '↑' : '↓';
        cell.appendChild(arrow);
      }

      // 마지막 수 강조
      if(lastMove){
        if(lastMove.type === 'place'){
          // 배치는 빨간 하이라이트 (단일 칸)
          if(lastMove.tr === r && lastMove.tc === c) cell.classList.add('last-place');
        } else {
          // 이동/저격/밀기는 금색 하이라이트 (출발+도착)
          if((lastMove.fr === r && lastMove.fc === c) || (lastMove.tr === r && lastMove.tc === c)){
            cell.classList.add('last');
          }
        }
      }

      // 선택된 칸
      if(SEL && SEL.kind === 'board' && SEL.r === r && SEL.c === c){
        cell.classList.add('sel');
      }

      // 이동/공격 표시
      for(const h of HIGHLIGHTS){
        if(h.r === r && h.c === c){
          cell.classList.add(h.type);
        }
      }

      // 체크된 킹
      if(p && p.kind === 'K' && isInCheck(p.color)){
        cell.classList.add('check');
      }

      // 폰 진행 방향 점: 이 칸 자체가 어느 폰의 다음 진행 칸이라면 점 표시
      // (HIGHLIGHTS와 겹치지 않도록 SEL이 활성일 땐 생략)
      if(!SEL && !board[r][c]){
        const back = pawnComingFrom(r, c);
        if(back){
          const dot = document.createElement('span');
          // 폰이 시각적으로 어느 방향에서 오는가? = 그 폰의 진행 방향과 같음
          const movesUpVisually = (back.color === 'w') !== flipped();
          dot.className = 'pawn-dir ' + back.color + ' ' + (movesUpVisually ? 'up' : 'down');
          cell.appendChild(dot);
        }
      }

      cell.addEventListener('click', onCellClick);
      boardEl.appendChild(cell);
    }
  }
  if(IS_PEASANT) renderMinsim();
  if(IS_TYCOON) renderTycoon();
}

// 농민 봉기: 민심 게이지 표시 (양 진영, 80% 이상이면 빨강+🔥)
function renderMinsim(){
  let el = document.getElementById('minsimBar');
  if(!el){
    el = document.createElement('div');
    el.id = 'minsimBar';
    // 위치/스타일은 CSS(#minsimBar)가 담당 — 데스크탑은 fixed(상단바 아래), 모바일은 연속체크 위 흐름 배치.
    const anchor = document.getElementById('myCheckStats');
    if(anchor && anchor.parentNode){
      anchor.parentNode.insertBefore(el, anchor);   // 연속 체크 위
    } else {
      (document.getElementById('myCard') || document.body).appendChild(el);
    }
  }
  const T = (s)=> (window.t ? window.t(s) : s);
  const bar = (label, v, color) => {
    const active = v >= 50;   // ≥50% = 봉기 발동 (킹 2칸·퀸 아군폰·폰의 킹 사냥)
    const fill = Math.min(100, Math.max(0, v));
    return `<div style="display:flex;align-items:center;gap:4px">
      <span style="color:${color}">${T(label)}</span>
      <span style="position:relative;display:inline-block;width:54px;height:8px;background:#2a2a2e;border-radius:5px;overflow:hidden">
        <span style="position:absolute;top:0;bottom:0;left:0;width:${fill}%;background:${active?'#ff453a':color};transition:width .3s"></span>
      </span>
      <span style="color:${active?'#ff453a':'#999'};min-width:30px">${Math.round(v)}%${active?' 🔥'+T('봉기'):''}</span>
    </div>`;
  };
  el.innerHTML = `<span style="color:#888;font-size:11px">${T('민심')}</span>` + bar('백', minsim.w||0, '#e8e8e8') + bar('흑', minsim.b||0, '#9aa0a6');
}

// 빈 칸 (r,c)로 폰이 한 칸 전진해 올 수 있다면 그 폰의 색을 반환. 없으면 null.
function pawnComingFrom(r, c){
  // 백 폰은 r 감소 방향으로 이동 → (r+1, c)에 백 폰이 있으면 (r,c)가 진행 칸
  // 흑 폰은 r 증가 방향으로 이동 → (r-1, c)에 흑 폰이 있으면 (r,c)가 진행 칸
  if(inBounds(r+1, c)){
    const p = board[r+1][c];
    if(p && p.kind === 'P' && p.color === 'w') return {color:'w'};
  }
  if(inBounds(r-1, c)){
    const p = board[r-1][c];
    if(p && p.kind === 'P' && p.color === 'b') return {color:'b'};
  }
  return null;
}

function canPlaceHere(color, kind, r, c){
  if(!kingPlaced[color]){ return kind === 'K' && inKingZone(r,c); }
  if(kind === 'K') return false; // 이미 배치됨
  if(kind === 'SN') return inCornerZone(r,c);
  return inGeneralZone(r,c);
}

function renderHands(){
  const myHandEl = document.getElementById('myHand');
  const oppHandEl = document.getElementById('oppHand');
  const oppSheetEl = document.getElementById('oppHandSheet');
  const myTitleEl = document.getElementById('myHandTitle');
  const oppTitleEl = document.getElementById('oppHandTitle');

  const SMALL_SCREEN = window.innerWidth <= 600;
  let bottomColor, topColor, bottomInteractive, topInteractive;
  if(IS_LOCAL && SMALL_SCREEN){
    // 모바일 로컬: 활성 색이 메인(아래) 패널에. 눈동자 안 써도 즉시 조작.
    bottomColor = turn;
    topColor = opp(turn);
    bottomInteractive = !gameOver;
    topInteractive = false;
    if(myTitleEl)  myTitleEl.textContent  = (bottomColor==='w'?'백':'흑') + ' 손패 (활성)';
    if(oppTitleEl) oppTitleEl.textContent = (topColor==='w'?'백':'흑') + ' 손패 (대기)';
  } else if(IS_LOCAL){
    // 큰 화면 로컬: 백=아래, 흑=위 고정. 양쪽 다 클릭 가능 (각자 차례에).
    bottomColor = 'w';
    topColor = 'b';
    bottomInteractive = (turn === 'w') && !gameOver;
    topInteractive    = (turn === 'b') && !gameOver;
    if(myTitleEl)  myTitleEl.textContent  = '백 손패' + (turn==='w' ? ' (차례)' : '');
    if(oppTitleEl) oppTitleEl.textContent = '흑 손패' + (turn==='b' ? ' (차례)' : '');
  } else {
    // 네트워크/AI/관전: 본인 색이 메인, 상대 색이 위
    bottomColor = MY_COLOR;
    topColor = opp(MY_COLOR);
    bottomInteractive = (turn === MY_COLOR) && !gameOver;
    topInteractive = false;
    if(myTitleEl)  myTitleEl.textContent  = '내 손패';
    if(oppTitleEl) oppTitleEl.textContent = '상대 손패';
  }

  myHandEl.innerHTML = renderHandList(bottomColor, bottomInteractive);
  const oppHandHTML = renderHandList(topColor, topInteractive);
  oppHandEl.innerHTML = oppHandHTML;
  oppSheetEl.innerHTML = oppHandHTML;
}
function renderHandList(color, interactive){
  const order = ['K','Q','R','B','N','P','SH','SN','JP'];
  return order.map(k => {
    const n = hands[color][k] || 0;
    const sym = SYMBOLS[color][k];
    const name = PIECE_NAMES[k];
    const dis = !interactive || n <= 0 || isMyTurnLocked() === false || gameOver;
    const isSel = SEL && SEL.kind === 'place' && SEL.piece === k;
    return `<button class="hp ${isSel?'sel':''} ${dis?'dis':''}"
              ${interactive && !dis ? `onclick="selectHand('${k}')"` : ''}>
              <span class="sym hp-${color} ${SPECIAL_KINDS.includes(k)?'spec':''}">${sym}</span>
              <span class="nm">${name}</span>
              <span class="ct">${n}</span>
            </button>`;
  }).join('');
}

function renderStatus(){
  // 체크 표시
  document.getElementById('myCheck').textContent = isInCheck(MY_COLOR) ? '⚠ 체크!' : '';
  document.getElementById('oppCheck').textContent = isInCheck(opp(MY_COLOR)) ? '⚠ 체크!' : '';

  // 체크 통계 (양쪽 카드 모두)
  renderCheckStats('myCheckStats', MY_COLOR);
  renderCheckStats('oppCheckStats', opp(MY_COLOR));

  // 로컬 모드: 작은 화면(모바일)에선 카드/손패가 활성-기준으로 동적 스왑.
  // 큰 화면에선 양쪽이 동시에 잘 보이므로 백=아래/흑=위 고정 유지.
  const SMALL_SCREEN = window.innerWidth <= 600;
  if(IS_LOCAL && SMALL_SCREEN){
    const act = turn, idle = opp(turn);
    // 아래(myCard) = 활성, 위(oppCard) = 대기
    document.getElementById('myAv').textContent = act==='w' ? 'W' : 'B';
    document.getElementById('myAv').className = 'av' + (act==='b'?' b':'');
    document.getElementById('myName').textContent = act==='w' ? '백 (플레이어 1)' : '흑 (플레이어 2)';
    document.getElementById('myMeta').textContent = (act==='w'?'백':'흑') + ' — 차례';

    document.getElementById('oppAv').textContent = idle==='w' ? 'W' : 'B';
    document.getElementById('oppAv').className = 'av' + (idle==='b'?' b':'');
    document.getElementById('oppName').textContent = idle==='w' ? '백 (플레이어 1)' : '흑 (플레이어 2)';
    document.getElementById('oppMeta').textContent = (idle==='w'?'백':'흑') + ' — 대기';

    // 활성 카드는 항상 myCard
    document.getElementById('myCard').classList.toggle('active', !gameOver);
    document.getElementById('oppCard').classList.toggle('active', false);

    // 체크 통계도 활성/대기 매핑
    renderCheckStats('myCheckStats', act);
    renderCheckStats('oppCheckStats', idle);
  } else if(IS_LOCAL){
    // 큰 화면 로컬: 양쪽 카드 고정 (myCard=백, oppCard=흑) — 활성 펄스만 색에 따라
    document.getElementById('myAv').textContent = 'W';
    document.getElementById('myAv').className = 'av';
    document.getElementById('myName').textContent = '백 (플레이어 1)';
    document.getElementById('myMeta').textContent = turn==='w' ? '백 — 차례' : '백 — 대기';

    document.getElementById('oppAv').textContent = 'B';
    document.getElementById('oppAv').className = 'av b';
    document.getElementById('oppName').textContent = '흑 (플레이어 2)';
    document.getElementById('oppMeta').textContent = turn==='b' ? '흑 — 차례' : '흑 — 대기';

    // 활성 펄스: 백 차례면 myCard, 흑 차례면 oppCard
    document.getElementById('myCard').classList.toggle('active', turn==='w' && !gameOver);
    document.getElementById('oppCard').classList.toggle('active', turn==='b' && !gameOver);

    renderCheckStats('myCheckStats', 'w');
    renderCheckStats('oppCheckStats', 'b');
  } else {
    // 활성 표시 (기본)
    document.getElementById('myCard').classList.toggle('active', turn === MY_COLOR && !gameOver);
    document.getElementById('oppCard').classList.toggle('active', turn !== MY_COLOR && !gameOver);
  }

  // 상태 플로팅
  const sf = document.getElementById('statusFloat');
  let msg = '';
  if(gameOver){
    msg = '';
  } else if(IS_SPEC){
    msg = `${turn==='w'?'백':'흑'} 차례`;
  } else if(turn === MY_COLOR || IS_LOCAL){
    const activeCol = IS_LOCAL ? turn : MY_COLOR;
    if(!kingPlaced[activeCol]){
      msg = `⚠ ${turn==='w'?'백':'흑'}: 킹부터 배치하세요 (4×4 영역)`;
    } else if(SEL && SEL.kind === 'place'){
      msg = `${PIECE_NAMES[SEL.piece]} 배치할 곳 선택`;
    } else if(SEL && SEL.kind === 'board'){
      msg = '이동할 칸 선택';
    } else {
      msg = `${turn==='w'?'백':'흑'} 차례 - 손패 또는 기물 선택`;
    }
  } else {
    msg = `${turn==='w'?'백':'흑'} 차례 (대기 중)`;
  }
  if(msg){ sf.textContent = msg; sf.classList.add('show'); }
  else sf.classList.remove('show');
}

// 각 카드에 "가한 연속 체크" / "가한 총 체크" 표시 (자기 공격 통계)
// streak: 이 색이 가한 연속 체크 = 상대가 받고 있는 수 = checkStreak[opp(color)]
//   3 도달 시 가한 쪽이 자멸하는 규칙이라, 내 카드만 봐도 위험도 파악 가능
function renderCheckStats(elId, color){
  const el = document.getElementById(elId); if(!el) return;
  const streakGiven = checkStreak[opp(color)] || 0;  // 이 색이 가한 연속 체크
  const totalGiven  = totalChecks[color] || 0;        // 이 색이 가한 총 체크
  const sCls = streakGiven >= 2 ? 'danger' : streakGiven >= 1 ? 'warn' : '';
  const tCls = totalGiven >= 5 ? 'danger' : totalGiven >= 4 ? 'warn' : '';
  el.innerHTML = `
    <div class="cs streak ${sCls}" title="가한 연속 체크 (3 도달 시 가한 쪽 자멸)">
      <div class="lab">연속 체크</div><div class="val">${streakGiven}/3</div>
    </div>
    <div class="cs total ${tCls}" title="가한 총 체크 (5 초과 시 그 수 무효)">
      <div class="lab">총 체크</div><div class="val">${totalGiven}/5</div>
    </div>`;
}

function isMyTurnLocked(){
  if(IS_SPEC) return false;
  if(IS_LOCAL) return true; // 로컬은 양쪽 다 조작
  return turn === MY_COLOR;
}

function renderAll(){
  setBoardSize();
  renderBoard();
  renderHands();
  renderStatus();
  updateMaterial();
  if(IS_POTION){
    drawBlockedOverlay();
    renderPotionUI();
  }
  // 시트가 열려있으면 데이터 갱신 (수가 진행될 때 시트가 stale 안 되게)
  const sheet = document.getElementById('oppSheet');
  if(sheet && sheet.classList.contains('show')) populateOppSheet();
  if(window._DEBUG_ON) renderDebugOverlay();
}

// 디버그 오버레이 (URL에 ?debug=1 일 때만 활성)
window._DEBUG_ON = (Q.get('debug') === '1');
if(window._DEBUG_ON){
  const dbg = document.createElement('div');
  dbg.id = 'dbgOverlay';
  dbg.style.cssText = 'position:fixed;top:8px;right:8px;background:rgba(0,0,0,.85);color:#0f0;font:11px/1.4 monospace;padding:8px 10px;border-radius:6px;z-index:9999;max-width:280px;border:1px solid #0f0;pointer-events:none';
  document.body.appendChild(dbg);
  // 모든 에러를 화면에 표시
  window.addEventListener('error', e=>{
    const errBox = document.createElement('div');
    errBox.style.cssText = 'position:fixed;bottom:8px;left:8px;right:8px;background:rgba(180,0,0,.95);color:#fff;font:12px/1.4 monospace;padding:10px;border-radius:6px;z-index:10000;white-space:pre-wrap';
    errBox.textContent = '🛑 JS ERROR: ' + e.message + '\n@ ' + (e.filename||'?') + ':' + e.lineno;
    document.body.appendChild(errBox);
    setTimeout(()=>errBox.remove(), 8000);
  });
}
function renderDebugOverlay(){
  const dbg = document.getElementById('dbgOverlay'); if(!dbg) return;
  const handStr = c => Object.entries(hands[c]).filter(([k,v])=>v>0).map(([k,v])=>`${k}${v}`).join(' ')||'(빈)';
  dbg.innerHTML =
    `mode=${MODE} role=${NET_ROLE||'-'}<br>`+
    `turn=<b style="color:${turn==='w'?'#fff':'#888'}">${turn}</b> myCol=${MY_COLOR}<br>`+
    `kingPlaced w=${kingPlaced.w?'✓':'✗'} b=${kingPlaced.b?'✓':'✗'}<br>`+
    `gameOver=${gameOver}<br>`+
    `SEL=${SEL?JSON.stringify(SEL):'null'}<br>`+
    `<span style="color:#ccc">w손패:</span> ${handStr('w')}<br>`+
    `<span style="color:#aaa">b손패:</span> ${handStr('b')}<br>`+
    `chk:w=${checkStreak.w}/${totalChecks.w} b=${checkStreak.b}/${totalChecks.b}`;
}

// ===================================================================
// 10. 클릭 처리
// ===================================================================
function selectHand(kind){
  if(gameOver) return;
  if(!isMyTurnLocked()) return;
  if(IS_LOCAL){
    if(hands[turn][kind] <= 0) return;
    SEL = { kind:'place', piece:kind, color:turn };
  } else {
    if(hands[MY_COLOR][kind] <= 0) return;
    SEL = { kind:'place', piece:kind, color:MY_COLOR };
  }
  HIGHLIGHTS = [];
  renderAll();
}

function onCellClick(e){
  if(gameOver) return;
  if(IS_SPEC) return;
  if(!isMyTurnLocked()) return;

  const r = parseInt(e.currentTarget.dataset.r);
  const c = parseInt(e.currentTarget.dataset.c);
  const myCol = IS_LOCAL ? turn : MY_COLOR;

  // 차단 물약 사용 중이면 가로채기
  if(_pendingBlockPotion && IS_POTION){
    if(tryBlockCellClick(r, c)) return;
  }

  // 타이쿤 폰 승급 모드: 클릭한 폰을 승급
  if(IS_TYCOON && _tycoonPromote){
    _tycoonPromote = false;
    tryTycoonPromote(r, c);
    SEL = null; HIGHLIGHTS = []; renderAll();
    return;
  }

  // 손패 배치 모드
  if(SEL && SEL.kind === 'place'){
    if(canPlaceHere(SEL.color, SEL.piece, r, c) && !board[r][c]){
      submitAction({ type:'place', kind:SEL.piece, r, c, color:SEL.color });
      SEL = null; HIGHLIGHTS = [];
      return;
    }
    // 배치 실패: 다른 칸 클릭으로 취소
    SEL = null; HIGHLIGHTS = []; renderAll();
    return;
  }

  // 보드 기물 선택
  if(!SEL){
    const p = board[r][c];
    if(p && p.color === myCol && kingPlaced.w && kingPlaced.b){
      SEL = { kind:'board', r, c };
      HIGHLIGHTS = computeHighlights(r, c, p);
      renderAll();
    }
    return;
  }

  // 보드 기물 선택됨 → 클릭한 칸이 이동/공격 대상인지
  if(SEL.kind === 'board'){
    if(SEL.r === r && SEL.c === c){
      // 동일 칸 → 선택 해제
      SEL = null; HIGHLIGHTS = []; renderAll();
      return;
    }
    const p = board[SEL.r][SEL.c];
    // 같은 색 기물 클릭 → 다른 기물로 선택 변경
    if(board[r][c] && board[r][c].color === myCol){
      SEL = { kind:'board', r, c };
      HIGHLIGHTS = computeHighlights(r, c, board[r][c]);
      renderAll();
      return;
    }
    const isHL = HIGHLIGHTS.some(h => h.r === r && h.c === c);
    // 클릭 가능한 highlight는 'move' / 'attack'만. 'sniper-range', 'sniper-blocked'는 시각 전용.
    const hl = HIGHLIGHTS.find(h => h.r === r && h.c === c);
    const isClickable = hl && (hl.type === 'move' || hl.type === 'attack');
    if(isClickable){
      // 이동 시도
      // 폰 프로모션 체크
      if(p.kind === 'P' && ((p.color==='w' && r===0)||(p.color==='b' && r===7))){
        promptPromotion(p.color).then(promo => {
          submitAction({ type:'move', fr:SEL.r, fc:SEL.c, tr:r, tc:c, promote: promo });
          SEL = null; HIGHLIGHTS = [];
        });
      } else {
        submitAction({ type:'move', fr:SEL.r, fc:SEL.c, tr:r, tc:c });
        SEL = null; HIGHLIGHTS = [];
      }
    } else if(isHL){
      // 시각 전용 highlight 클릭 (sniper-range/blocked) — 동작 없음, 선택 유지
      return;
    } else {
      // 외곽 클릭 → 선택 해제
      SEL = null; HIGHLIGHTS = []; renderAll();
    }
  }
}

function computeHighlights(r, c, p){
  const out = [];
  if(p.kind === 'SN'){
    // 시각: 8방향 1~4칸 전체 사정거리 표시 (시야 차단 무관)
    //  · 빈 칸 → 'sniper-range' (주황 동그라미)
    //  · 적 기물 → 'attack' or 'sniper-blocked' (실제 공격 가능 여부에 따라)
    //  · 우군 기물 → 표시 없음 (orange 안 그림)
    const dirs = [
      [-1, 0, 4],[ 1, 0, 4],[ 0,-1, 4],[ 0, 1, 4],   // 십자 4칸
      [-1,-1, 3],[-1, 1, 3],[ 1,-1, 3],[ 1, 1, 3]    // 대각 3칸
    ];
    // 실제 공격 가능 셀 집합 (시야 차단 적용된 결과)
    const { attacks } = pieceMoves(r, c, p);
    const attackSet = new Set(attacks.map(([ar,ac]) => ar + ',' + ac));
    for(const [dr, dc, maxDist] of dirs){
      for(let dist = 1; dist <= maxDist; dist++){
        const nr = r + dr*dist, nc = c + dc*dist;
        if(!inBounds(nr, nc)) break;          // 보드 밖이면 멈춤
        const t = board[nr][nc];
        if(!t){
          out.push({r:nr, c:nc, type:'sniper-range'});  // 빈: 주황
        } else if(t.color !== p.color){
          if(attackSet.has(nr + ',' + nc)){
            out.push({r:nr, c:nc, type:'attack'});       // 적+공격가능: 빨강
          } else {
            out.push({r:nr, c:nc, type:'sniper-blocked'});// 적+시야막힘: 흐린 빨강
          }
        }
        // 우군: 표시 안 함, 그러나 그 너머 셀도 보이도록 break하지 않음
      }
    }
    // 자기 킹 노출 검증 (attack/blocked만 필터; sniper-range는 클릭 무동작이라 스킵)
    return out.filter(h => {
      if(h.type !== 'attack') return true;  // 시각 전용은 그대로 통과
      const snap = snapshotState();
      const res = applyAction({type:'move', fr:r, fc:c, tr:h.r, tc:h.c}, {silent:true});
      restoreState(snap);
      return res.ok;
    });
  } else if(p.kind === 'SH'){
    const dy = (p.color === 'w') ? -1 : 1;
    for(const ddy of [dy, -dy]){
      const nr = r+ddy;
      if(!inBounds(nr,c)) continue;
      const t = board[nr][c];
      if(!t) out.push({r:nr, c, type:'move'});
      else out.push({r:nr, c, type:'attack'}); // 밀기
    }
  } else {
    const { moves, attacks } = pieceMoves(r, c, p);
    for(const [tr,tc] of moves) out.push({r:tr, c:tc, type:'move'});
    for(const [tr,tc] of attacks) out.push({r:tr, c:tc, type:'attack'});
  }
  // 자기 킹 노출되는 수 제거 (SN은 위에서 이미 처리)
  return out.filter(h => {
    const snap = snapshotState();
    const a = { type:'move', fr:r, fc:c, tr:h.r, tc:h.c };
    if(p.kind === 'P' && ((p.color==='w' && h.r===0)||(p.color==='b' && h.r===7))){
      a.promote = 'Q';
    }
    const res = applyAction(a, {silent:true});
    restoreState(snap);
    return res.ok;
  });
}

// 프로모션 모달
function promptPromotion(color){
  return new Promise(resolve => {
    const opts = ['Q','R','B','N'];
    document.getElementById('promoOpts').innerHTML = opts.map(k =>
      `<button class="promo-opt ${color}" data-k="${k}">${SYMBOLS[color][k]}</button>`
    ).join('');
    document.getElementById('promoModal').classList.add('show');
    document.getElementById('promoRestore').style.display = 'none';
    document.querySelectorAll('.promo-opt').forEach(b => {
      b.onclick = () => {
        document.getElementById('promoModal').classList.remove('show');
        document.getElementById('promoRestore').style.display = 'none';
        resolve(b.dataset.k);
      };
    });
  });
}
// 프로모션 모달 임시 숨김 — 보드 확인용
window.hidePromoForLook = function(){
  document.getElementById('promoModal').classList.remove('show');
  document.getElementById('promoRestore').style.display = '';
};
window.showPromoModal = function(){
  document.getElementById('promoModal').classList.add('show');
  document.getElementById('promoRestore').style.display = 'none';
};

// ===================================================================
// 11. submitAction (로컬/AI/네트워크 분기)
// ===================================================================

// === 리플레이 기록/저장 ===
function recordReplayAction(action, captured){
  if(IS_REPLAY) return; // 리플레이 모드에선 기록 안 함
  // lastMove에서 추가 메타 추출
  const meta = {
    action: {...action},
    captured: captured || null,
    moveType: lastMove?.type || (action.type === 'place' ? 'place' : 'move'),
    retreat: !!(lastMove && lastMove.retreat),
    ts: Date.now()
  };
  actionHistory.push(meta);
}

function saveReplayToStorage(winner, endTitle, endDesc){
  if(IS_REPLAY) return; // 리플레이 모드에선 저장 안 함
  if(!actionHistory.length) return;
  try {
    const id = 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    // 메타데이터 (목록용 — 작게)
    const meta = {
      id,
      savedAt: Date.now(),
      mode: MODE, // local | ai | aivai | online
      aiDifficulty: IS_AI ? DIFF : (IS_AIVAI ? `${W_DIFF}/${B_DIFF}` : null),
      timeLimit: TIME_LIMIT,
      handStr: Q.get('hand') || '',
      players: {
        w: { 
          nick: IS_AIVAI ? `백 AI(${W_DIFF})` : (IS_NET ? (_gameRatingInfo?.whiteNick || '백') : (MY_COLOR === 'w' ? MY_NICK_P : (IS_AI ? MY_NICK_P : '백'))),
          elo: IS_NET ? (_gameRatingInfo?.whiteElo || 0) : (MY_COLOR === 'w' ? MY_ELO_P : 0)
        },
        b: { 
          nick: IS_AIVAI ? `흑 AI(${B_DIFF})` : (IS_NET ? (_gameRatingInfo?.blackNick || '흑') : (MY_COLOR === 'b' ? MY_NICK_P : (IS_AI ? 'AI' : '흑'))),
          elo: IS_NET ? (_gameRatingInfo?.blackElo || 0) : (MY_COLOR === 'b' ? MY_ELO_P : 0)
        }
      },
      myColor: (IS_LOCAL || IS_AIVAI) ? null : MY_COLOR,
      winner: winner || 'draw',
      endTitle: endTitle || '',
      endDesc: endDesc || '',
      moveCount: actionHistory.length
    };
    // 전체 데이터
    const full = { actions: actionHistory };

    // 인덱스 업데이트
    const indexKey = 'frontier_replay_index';
    let index = [];
    try { index = JSON.parse(localStorage.getItem(indexKey) || '[]'); } catch(e){ index = []; }
    index.unshift(meta);

    // 저장 시도
    try {
      localStorage.setItem(indexKey, JSON.stringify(index));
      localStorage.setItem('frontier_replay_' + id, JSON.stringify(full));
    } catch(e) {
      // 용량 초과 → 가장 오래된 거부터 삭제하면서 재시도
      while(index.length > 1){
        const oldest = index.pop();
        try { localStorage.removeItem('frontier_replay_' + oldest.id); } catch(_){}
        try {
          localStorage.setItem(indexKey, JSON.stringify(index));
          localStorage.setItem('frontier_replay_' + id, JSON.stringify(full));
          console.log('[리플레이] 용량 부족: 오래된 리플레이 삭제 후 저장');
          break;
        } catch(_){}
      }
    }
    console.log('[리플레이] 저장 완료:', id, meta.moveCount + '수');
  } catch(e){
    console.warn('[리플레이] 저장 실패:', e);
  }
}

function submitAction(action){
  // 액션의 color는 항상 현재 차례의 색으로 통일 (이동/배치 모두)
  // (LOCAL: turn 따라 번갈아 / AI: AI는 흑 차례 / ONLINE: 본인 차례에서만 호출됨)
  action.color = turn;
  
  // 리플레이 기록용: 액션 적용 전 상태 캡처 (잡힌 기물 추적)
  let _capturedPiece = null;
  if(action.type === 'move'){
    const tgt = board[action.tr] && board[action.tr][action.tc];
    if(tgt) _capturedPiece = { kind: tgt.kind, color: tgt.color };
  }
  
  const snap = snapshotState();
  const r = applyAction(action);
  if(!r.ok){ 
    // 복원되어있을 것
    showFlash('❌ ' + r.err);
    SEL=null; HIGHLIGHTS=[]; renderAll();
    return;
  }
  
  // 리플레이 기록
  recordReplayAction(action, _capturedPiece);
  // 사운드
  if(action.type === 'place') playSnd('place');
  else if(lastMove && lastMove.type === 'snipe') playSnd('capture');
  else if(action.type === 'move'){
    // 잡힌 기물 있었나?
    // 간단히: 사운드 항상 move
    playSnd('move');
  }

  // 스나이퍼 후퇴 알림
  if(lastMove && lastMove.type === 'snipe' && lastMove.retreat){
    showFlash('🎯 스나이퍼 3회 공격 완료 — 손패로 후퇴', 2200);
  }

  // 액션 성공: 선택/하이라이트 초기화 후 렌더 (잔상 제거)
  SEL = null; HIGHLIGHTS = [];
  renderAll();
  postMoveCheck(r);

  // 네트워크 전송
  if(IS_NET){
    sendToPeer({ t:'MOVE', action });
    if(NET_ROLE === 'host') publishGameState();
    // 게스트도 매 수마다 lastActivity 갱신 (관전 필터 통과용)
    if(NET_ROLE === 'guest' && _fbDb && ROOM_CODE){
      _fbDb.ref('rooms/'+ROOM_CODE+'/lastActivity').set(Date.now()).catch(()=>{});
    }
  }

  // AI 차례
  if(IS_AI && !gameOver && turn === 'b'){
    setTimeout(()=> aiTurn(), 250);
  } else if(IS_AIVAI && !gameOver){
    // AI vs AI: 양쪽 모두 자동 진행. 조금 더 긴 딜레이로 관전 가능
    setTimeout(()=> aiTurn(), 600);
  }
}

function postMoveCheck(r){
  const T = (s,p)=> (window.t ? window.t(s,p) : s);
  if(r.fiveWin){
    endGame('🏆','오목 승리!', T('{c}이 5목을 완성했습니다.', {c:T(r.fiveWin==='w'?'백':'흑')}), r.fiveWin);
    return;
  }
  if(r.checkmate){
    endGame('👑','체크메이트!', T('{c}의 승리.', {c:T(r.checkmate==='w'?'백':'흑')}), r.checkmate);
    return;
  }
  if(r.stalemate){
    endGame('🤝','스테일메이트', '둘 곳이 없어 무승부.', 'draw');
    return;
  }
  if(r.repetition){
    endGame('🔁','3수 동형','동일 형국이 3번 반복되어 무승부.', 'draw');
    return;
  }
  if(r.tycoonWin){
    endGame('💰','타이쿤 승리!', T('{c}이(가) {n}G를 모아 승리했습니다!', {c:T(r.tycoonWin==='w'?'백':'흑'), n:TYCOON_WIN_GOLD}), r.tycoonWin);
    return;
  }
  // 체크 알림 — 강조 표시 + 위험 단계 메시지
  if(isInCheck(turn)){
    const givenStreak = checkStreak[turn];      // = 체크한 쪽이 가한 연속 (turn이 받는 = opp이 가함)
    const givenTotal  = totalChecks[opp(turn)]; // 체크한 쪽이 가한 총
    const checkedColor = T(turn==='w'?'백':'흑');        // 체크 받은 쪽
    const giverColor   = T(turn==='w'?'흑':'백');        // 체크 건 쪽
    let msg = T('⚠ {cc} 체크! {gc}이 가한 연속 {s}/3 · 총 {t}/5', {cc:checkedColor, gc:giverColor, s:givenStreak, t:givenTotal});
    if(givenStreak === 2) msg = T('🚨 {gc} 2연속 체크! 한 번 더 = {gc} 자멸', {gc:giverColor});
    if(givenTotal === 5) msg = T('⛔ {gc} 총 체크 한도 도달 ({t}/5) — 추가 체크 시 무효', {t:givenTotal});
    showFlash(msg, 2800, true);
  }
}

// _flashTimer + showFlash + closeConfirm + showConfirm + escapeHtml + escapeAttr → js/game/utils.js로 이동

// ===================================================================
// 12. 게임 종료 + ELO
// ===================================================================
let _gameRatingInfo = null; // {whiteUid, whiteElo, blackUid, blackElo, whiteNick, blackNick}
let _eloPending = false;
let _waitingForEloResult = false;
let _lastWinnerForGuest = null;
function setEndNavDisabled(disabled){
  const ids = ['rematchBtn','endLobbyBtn'];
  for(const id of ids){
    const el = document.getElementById(id);
    if(!el) continue;
    if(disabled){
      el.disabled = true;
      el.style.opacity = '.5';
      el.style.cursor = 'wait';
      if(!el.dataset.origText) el.dataset.origText = el.textContent;
      if(id === 'endLobbyBtn') el.textContent = '저장 중...';
    } else {
      el.disabled = false;
      el.style.opacity = '';
      el.style.cursor = '';
      if(el.dataset.origText) el.textContent = el.dataset.origText;
    }
  }
}
window.addEventListener('beforeunload', e => {
  if(_eloPending){
    e.preventDefault();
    e.returnValue = 'ELO 업데이트가 아직 진행 중입니다. 잠시 후 나가주세요.';
    return e.returnValue;
  }
});

function endGame(emoji, title, desc, winner /* 'w'|'b'|'draw' */, fromHost){
  if(gameOver) return;
  
  // 게임 종료 — 새로고침 감지 마커 제거 (이후 새로고침해도 안전)
  try { sessionStorage.removeItem('frontier_active_game'); } catch(_){}
  
  // 게스트는 호스트 신호 외에 자체 endGame 차단 (winner 일관성 보장)
  // 단 호스트와 연결 끊긴 경우엔 통과 (fromHost=true로 별도 호출)
  if(IS_NET && NET_ROLE === 'guest' && !fromHost && !_hostDisconnected){
    // 게스트는 자체 종료 조건 감지해도 endGame 호출 X — 호스트가 신호 보낼 때까지 대기
    // 호스트도 같은 board 상태라 같은 결론 내릴 것
    return;
  }
  
  // 호스트는 endGame 진입 즉시 게스트에게 신호 전송
  if(IS_NET && NET_ROLE === 'host'){
    try {
      sendToPeer({ t:'END_SIGNAL', winner, title, desc, emoji });
    } catch(_){}
  }
  
  gameOver = true;
  // 리플레이 저장 (먼저 저장하고 나머지 진행)
  saveReplayToStorage(winner, title, desc);
  document.getElementById('endIcon').textContent = emoji;
  // 직관적 결과 표시: 큰 글씨로 승리!/패배/무승부, 아래 상세(어느 진영·어떻게)
  //   · 온라인/AI: 내(MY_COLOR) 기준 승/패  · 로컬·관전·AIvAI·리플레이: '승리!'(승자는 상세에)
  let _big;
  if(winner === 'draw') _big = '무승부';
  else if((IS_NET && !IS_SPEC) || IS_AI) _big = (winner === MY_COLOR) ? '승리!' : '패배';
  else _big = '승리!';
  const _bigColor = (_big === '패배') ? '#ff453a' : (_big === '무승부' ? '#9aa0a6' : '#f5c842');
  const _tEl = document.getElementById('endTitle');
  _tEl.textContent = (window.t ? window.t(_big) : _big);
  _tEl.style.color = _bigColor;
  _tEl.style.fontSize = '2.4em';
  _tEl.style.fontWeight = '900';
  document.getElementById('endDesc').textContent = (window.t ? window.t(desc) : desc);
  playSnd('end');
  const eloEl = document.getElementById('endElo');
  eloEl.style.display = 'none';

  // 업적 검사 (승리 / AI 격파 / 5목 / 체크메이트 등)
  try { checkAchievements(winner, title, desc); } catch(e){ console.warn('업적 검사 실패:', e); }
  
  // 일일 퀘스트 진행 추적 (localStorage 사용)
  if(!IS_SPEC && !IS_REPLAY){
    try {
      const win = winner === MY_COLOR;
      let winType = null;
      if(title && title.indexOf('오목') >= 0) winType = 'omok';
      else if(title && title.indexOf('체크메이트') >= 0) winType = 'mate';
      const mode = IS_AI ? 'ai' : IS_LOCAL ? 'local' : IS_NET ? 'online' : 'other';
      const data = { mode, win, winType, isPotion: IS_POTION };
      // index.html의 함수에 접근 못 함 — localStorage 직접 갱신
      trackQuestProgressLocal('game_end', data);
    } catch(e){ console.warn('일일 퀘스트 추적 실패:', e); }
  }

  const rematchBtn = document.getElementById('rematchBtn');
  // 관전자/리플레이 외엔 모든 모드에서 표시 (라벨은 모드별로 다름)
  if(IS_SPEC || IS_REPLAY){
    rematchBtn.style.display = 'none';
  } else {
    rematchBtn.style.display = '';
    rematchBtn.textContent = IS_NET ? '🔄 리매치' : '🔄 다시 시작';
  }

  // ELO 적용 (온라인만)
  if(IS_NET && !IS_SPEC){
    if(!_gameRatingInfo){
      eloEl.style.display = '';
      eloEl.className = 'elo-change';
      eloEl.innerHTML = '⚠ ELO 정보 없음 — 게임 시작 데이터 교환 실패';
      console.warn('[ELO] _gameRatingInfo가 null. HELLO 메시지 교환 실패 가능성.');
    } else if(!winner){
      eloEl.style.display = '';
      eloEl.className = 'elo-change';
      eloEl.innerHTML = '⚠ 승자 정보 없음 — ELO 적용 안 됨';
      console.warn('[ELO] winner가 null/undefined.', {winner, _gameRatingInfo});
    } else {
      eloEl.textContent = '레이팅 계산 중...';
      eloEl.style.display = '';
      _eloPending = true;
      setEndNavDisabled(true);
      console.log('[ELO] 시작 — winner:', winner, 'MY_COLOR:', MY_COLOR, 'role:', NET_ROLE);
      
      if(NET_ROLE === 'host'){
        // 호스트: 자기 + 게스트 ELO diff 둘 다 계산, 자기는 직접 저장, 게스트는 메시지로 전송
        applyEloChangeAsHost(winner).then(({myDiff, oppDiff, oppNewElo}) => {
          _eloPending = false;
          setEndNavDisabled(false);
          if(myDiff !== null){
            const newElo = MY_ELO_P + myDiff;
            if(myDiff === 0){
              eloEl.className = 'elo-change';
              eloEl.innerHTML = `<span style="color:var(--muted)">변동 없음</span> · ${MY_ELO_P} ELO`;
            } else {
              const sign = myDiff > 0 ? '+' : '';
              eloEl.className = 'elo-change ' + (myDiff>0?'up':'dn');
              eloEl.innerHTML = `${MY_ELO_P} → <b>${newElo}</b> <span style="opacity:.8">(${sign}${myDiff})</span>`;
            }
            // 리매치를 위해 MY_ELO_P + _gameRatingInfo 갱신
            MY_ELO_P = newElo;
            if(_gameRatingInfo){
              if(MY_COLOR === 'w'){
                _gameRatingInfo.whiteElo = newElo;
                _gameRatingInfo.blackElo = oppNewElo;
              } else {
                _gameRatingInfo.blackElo = newElo;
                _gameRatingInfo.whiteElo = oppNewElo;
              }
              console.log('[ELO] _gameRatingInfo 갱신 (호스트):', _gameRatingInfo);
            }
          } else {
            eloEl.className = 'elo-change';
            eloEl.innerHTML = '⚠ ELO 업데이트 실패';
          }
          // 게스트에게 결과 전송
          try {
            sendToPeer({ t:'ELO_RESULT', diff: oppDiff, newElo: oppNewElo });
            console.log('[ELO] 게스트에게 결과 전송:', {oppDiff, oppNewElo});
          } catch(e){ console.warn('[ELO] 게스트 결과 전송 실패:', e.message); }
        }).catch(e => {
          _eloPending = false;
          setEndNavDisabled(false);
          console.error('applyEloChangeAsHost error:', e);
          eloEl.className = 'elo-change';
          eloEl.innerHTML = '⚠ ELO 오류: ' + (e.message || e);
        });
        // 매치 로그 (호스트만)
        saveMatchLog(winner, title, desc);
      } else {
        // 게스트: 자체 계산 안 함. 호스트 ELO_RESULT 메시지 대기
        _waitingForEloResult = true;
        _lastWinnerForGuest = winner;
        // 만약 8초 안에 ELO_RESULT 안 오면 자체 계산으로 fallback
        // (호스트 연결 끊김 등 — gameOver 상태여도 ELO 계산은 진행되어야 함)
        setTimeout(() => {
          if(!_waitingForEloResult) return; // 이미 처리됨
          _waitingForEloResult = false;
          console.warn('[ELO] 호스트 ELO_RESULT 8초 timeout — 자체 계산 fallback');
          applyEloChange(winner).then(diff => {
            _eloPending = false;
            setEndNavDisabled(false);
            if(diff !== null){
              const newElo = MY_ELO_P + diff;
              if(diff === 0){
                eloEl.className = 'elo-change';
                eloEl.innerHTML = `<span style="color:var(--muted)">변동 없음</span> · ${MY_ELO_P} ELO`;
              } else {
                const sign = diff > 0 ? '+' : '';
                eloEl.className = 'elo-change ' + (diff>0?'up':'dn');
                eloEl.innerHTML = `${MY_ELO_P} → <b>${newElo}</b> <span style="opacity:.8">(${sign}${diff})</span>`;
              }
              // 리매치를 위해 갱신
              MY_ELO_P = newElo;
              if(_gameRatingInfo){
                if(MY_COLOR === 'w') _gameRatingInfo.whiteElo = newElo;
                else _gameRatingInfo.blackElo = newElo;
              }
            } else {
              eloEl.className = 'elo-change';
              eloEl.innerHTML = '⚠ ELO 업데이트 실패';
            }
          }).catch(e => {
            _eloPending = false;
            setEndNavDisabled(false);
            eloEl.innerHTML = '⚠ ELO 오류: ' + (e.message || e);
          });
        }, 8000);
      }
    }
  } else if(IS_AI || IS_LOCAL){
    eloEl.style.display = '';
    eloEl.className = 'elo-change';
    eloEl.innerHTML = `<small style="color:var(--muted)">${IS_AI?'AI 대전':'로컬 모드'}: ELO 변동 없음</small>`;
  }

  document.getElementById('endModal').classList.add('show');

  // 호스트만 방 상태 업데이트
  if(IS_NET){
    if(NET_ROLE === 'host'){
      _fbDb && _fbDb.ref('rooms/'+ROOM_CODE).update({ gameActive:false }).catch(()=>{});
    }
    sendToPeer({ t:'END', winner });
  }
}

// 게임 종료 모달 숨기기/복귀 (보드 확인용)
function hideEndModal(){
  document.getElementById('endModal').classList.remove('show');
  document.getElementById('endRestore').style.display = 'block';
}
function showEndModal(){
  document.getElementById('endModal').classList.add('show');
  document.getElementById('endRestore').style.display = 'none';
}

// 규칙 보기/닫기
function openRules(){ document.getElementById('rulesModal').classList.add('show'); }
function closeRules(){ document.getElementById('rulesModal').classList.remove('show'); }

// ===== 일일 퀘스트 진행 추적 (localStorage 직접) =====
function trackQuestProgressLocal(eventType, payload){
  let data;
  try { data = JSON.parse(localStorage.getItem('frontier_quests') || 'null'); } catch(_){}
  if(!data || !data.quests) return; // 퀘스트 미생성 — 다음 로비 방문 시 생성됨
  let anyChange = false;
  let anyCompleted = 0;
  data.quests.forEach(q => {
    if(q.completed) return;
    let inc = 0;
    if(eventType === 'game_end'){
      const {mode, win, winType, isPotion} = payload || {};
      if(q.type === 'play') inc = 1;
      if(q.type === 'win' && win) inc = 1;
      if(q.type === 'ai' && mode === 'ai') inc = 1;
      if(q.type === 'mate_win' && win && winType === 'mate') inc = 1;
      if(q.type === 'omok_win' && win && winType === 'omok') inc = 1;
      if(q.type === 'potion_play' && isPotion) inc = 1;
      if(q.type === 'local' && mode === 'local') inc = 1;
    }
    if(inc > 0){
      q.progress = Math.min(q.target, q.progress + inc);
      if(q.progress >= q.target && !q.completed){
        q.completed = true;
        anyCompleted++;
      }
      anyChange = true;
    }
  });
  if(anyChange){
    try { localStorage.setItem('frontier_quests', JSON.stringify(data)); } catch(_){}
    // 업적 (FRONTIER.html에선 MY_UID 같이 변수가 다름. Firebase 직접 접근)
    try {
      if(window._fbDb && window.MY_UID){
        const completedCount = data.quests.filter(q => q.completed).length;
        if(completedCount >= 1) window._fbDb.ref(`users/${window.MY_UID}/achievements/quest_first`).set({unlockedAt:Date.now()}).catch(()=>{});
        if(completedCount >= 3) window._fbDb.ref(`users/${window.MY_UID}/achievements/quest_all`).set({unlockedAt:Date.now()}).catch(()=>{});
      }
    } catch(_){}
  }
}

// ===== 업적 검사 =====
// unlockAch, checkPostEloAchievements, unsetInactiveTitleIfNeeded, checkAchievements,
// applyEloChangeAsHost, saveMatchLog, applyEloAsGuest, applyEloChange → js/game/elo.js로 이동

// ===================================================================
// 13. AI
// ===================================================================
// 기물 가치 — 평가 함수의 기본 (호환성 유지용 상수)
const PIECE_VALUES = { K:0, Q:9, R:5, B:3, N:3, P:1, SH:3, SN:5, JP:3 };

// === 진화 가능한 평가 가중치 (Genome) ===
// 진화 알고리즘의 대상. 모든 평가 가중치를 한 객체에 모아놓음.
// 개체별로 약간씩 다른 유전자 → 다른 플레이 스타일
const DEFAULT_GENOME = Object.freeze({
  // 기물 가치 (8)
  Q: 90, R: 50, B: 35, N: 30, P: 10, SH: 25, SN: 60, JP: 35,
  // 라인 위협 (4) — 5목 추구
  threat2: 20,
  threat3: 200,
  threat4: 2000,
  threat5: 100000,
  // 손패 자원 (1)
  handRatio: 0.5,
  // 체크 관련 (2)
  checkGive: 50,
  checkRecv: 80
});
function aiTurn(){
  if(gameOver) return;
  const aiColor = IS_AIVAI ? turn : 'b';
  if(turn !== aiColor) return;
  const list = allLegalActions(aiColor);
  if(!list.length) return;
  const diff = IS_AIVAI ? (aiColor === 'w' ? W_DIFF : B_DIFF) : DIFF;
  const genome = null;

  if(diff === 'hard'){
    showAIThinking(true, IS_AIVAI ? aiColor : null);
    setTimeout(() => {
      if(gameOver){ showAIThinking(false); return; }
      let best;
      try { best = aiHard(list, aiColor, genome); } catch(e){ console.error('AI 오류', e); best = list[0]; }
      showAIThinking(false);
      if(!best) best = list[Math.floor(Math.random()*list.length)];
      if(best.type === 'move'){
        const p = board[best.fr][best.fc];
        if(p && p.kind === 'P'){
          if(aiColor === 'w' && best.tr === 0) best.promote = 'Q';
          else if(aiColor === 'b' && best.tr === 7) best.promote = 'Q';
        }
      }
      submitAction(best);
    }, 30);
    return;
  }
  let best;
  if(diff === 'easy') best = aiEasy(list, aiColor, genome);
  else best = aiNormal(list, aiColor, genome);

  if(!best) best = list[Math.floor(Math.random()*list.length)];
  if(best.type === 'move'){
    const p = board[best.fr][best.fc];
    if(p && p.kind === 'P'){
      if(aiColor === 'w' && best.tr === 0) best.promote = 'Q';
      else if(aiColor === 'b' && best.tr === 7) best.promote = 'Q';
    }
  }
  submitAction(best);
}

function showAIThinking(show, color){
  const el = document.getElementById('aiThinkingIndicator');
  if(!el) return;
  if(show){
    const label = color === 'w' ? '백 AI' : color === 'b' ? '흑 AI' : 'AI';
    el.querySelector('span:last-child').textContent = `${label} 사고 중...`;
  }
  el.style.display = show ? 'flex' : 'none';
}

function aiEasy(list, myColor){
  const oppC = opp(myColor);
  // 1. 즉시 5연속
  for(const a of list){
    const snap = snapshotState();
    const r = applyAction(a, {silent:true});
    if(r.ok && r.fiveWin === myColor){ restoreState(snap); return a; }
    restoreState(snap);
  }
  // 2. 상대 4연속 차단
  const block = findBlock4(list, oppC);
  if(block) return block;
  // 3. 30% 확률 체크
  if(Math.random() < 0.3){
    for(const a of list){
      const snap = snapshotState();
      applyAction(a, {silent:true});
      const giveCheck = isInCheck(oppC);
      restoreState(snap);
      if(giveCheck) return a;
    }
  }
  return list[Math.floor(Math.random()*list.length)];
}

function aiNormal(list, myColor, genome){
  const g = genome || DEFAULT_GENOME;
  const oppC = opp(myColor);
  // 1. 즉시 승
  for(const a of list){
    const snap = snapshotState();
    const r = applyAction(a, {silent:true});
    if(r.ok){
      if(r.fiveWin === myColor){ restoreState(snap); return a; }
      if(isInCheck(oppC) && isCheckmate(oppC)){ restoreState(snap); return a; }
    }
    restoreState(snap);
  }
  // 2. 상대 위협 차단
  const block = findBlock4(list, oppC);
  if(block) return block;
  // 3. 평가 점수 상위 35% 중 랜덤
  const scored = list.map(a => ({a, s: evaluateAction(a, myColor, g)}));
  scored.sort((x,y)=> y.s - x.s);
  const top = scored.slice(0, Math.max(1, Math.ceil(scored.length * 0.35)));
  return top[Math.floor(Math.random()*top.length)].a;
}

// ===== AI 어려움 — 알파베타 미니맥스 (반복 회피 + 깊이 탐색) =====
const AI_HARD_TIME_MS = 2500;     // 최대 사고 시간
const AI_HARD_MAX_DEPTH = 5;       // 최대 탐색 깊이 (반복 = 5수 lookahead)
const AI_HARD_TT_MAX = 100000;     // 트랜스포지션 테이블 최대 엔트리

function aiHard(list, myColor, genome){
  const g = genome || DEFAULT_GENOME;
  const oppC = opp(myColor);
  // 1. 즉시 승리 검사 (5목 또는 체크메이트)
  for(const a of list){
    const snap = snapshotState();
    const r = applyAction(a, {silent:true});
    if(r.ok){
      if(r.fiveWin === myColor){ restoreState(snap); return a; }
      if(isInCheck(oppC) && isCheckmate(oppC)){ restoreState(snap); return a; }
    }
    restoreState(snap);
  }
  // 2. 상대 4연속 위협 차단
  const block = findBlock4(list, oppC);
  if(block) return block;

  // 3. 모든 합법수 1차 평가 + 반복 카운트 (반복 회피 사전 점수 적용)
  const startTime = Date.now();
  const tt = new Map();
  const allScored = [];
  for(const a of list){
    if(Date.now() - startTime > AI_HARD_TIME_MS * 0.15) break;
    const snap = snapshotState();
    const r = applyAction(a, {silent:true});
    if(!r.ok){ restoreState(snap); continue; }
    let baseScore = evaluatePosition(myColor, g);
    if(r.fiveWin === myColor) baseScore = 99000;
    else if(r.fiveWin === oppC) baseScore = -99000;
    else if(isInCheck(oppC) && isCheckmate(oppC)) baseScore = 99000;
    else if(isInCheck(myColor) && isCheckmate(myColor)) baseScore = -99000;
    else if(r.suicide) baseScore = -99000;
    const ser = serializeBoard();
    const repCount = moveHistory.filter(s => s === ser).length;
    restoreState(snap);
    allScored.push({a, baseScore, repCount});
  }
  if(!allScored.length) return list[0];

  allScored.forEach(x => {
    x.adj = x.baseScore;
    if(x.repCount === 1) x.adj -= 1500;
    else if(x.repCount >= 2) x.adj -= 100000;
  });
  allScored.sort((x,y) => y.adj - x.adj);

  const rootCands = allScored.slice(0, Math.min(15, allScored.length));

  let bestMove = rootCands[0].a;
  let bestScore = rootCands[0].adj;
  let bestDepth = 1;

  for(let depth = 2; depth <= AI_HARD_MAX_DEPTH; depth++){
    if(Date.now() - startTime > AI_HARD_TIME_MS * 0.55) break;

    let iterBest = -Infinity;
    let iterMove = null;
    let alpha = -99999;
    const beta = 99999;

    for(const {a, repCount} of rootCands){
      if(Date.now() - startTime > AI_HARD_TIME_MS) break;

      const snap = snapshotState();
      const r = applyAction(a, {silent:true});
      if(!r.ok){ restoreState(snap); continue; }

      let score;
      if(r.fiveWin === myColor){
        score = 50000 - (AI_HARD_MAX_DEPTH - depth);
      } else if(r.fiveWin === oppC){
        score = -50000 + (AI_HARD_MAX_DEPTH - depth);
      } else if(isInCheck(oppC) && isCheckmate(oppC)){
        score = 50000 - (AI_HARD_MAX_DEPTH - depth);
      } else if(isInCheck(myColor) && isCheckmate(myColor)){
        score = -50000 + (AI_HARD_MAX_DEPTH - depth);
      } else if(r.suicide){
        score = -50000;
      } else {
        score = -alphaBetaSearch(depth - 1, -beta, -alpha, oppC, startTime, AI_HARD_TIME_MS, tt, g);
      }

      if(repCount === 1) score -= 1500;
      else if(repCount >= 2) score -= 100000;

      restoreState(snap);

      if(score > iterBest){
        iterBest = score;
        iterMove = a;
      }
      if(score > alpha) alpha = score;
    }

    if(iterMove && (Date.now() - startTime <= AI_HARD_TIME_MS)){
      bestMove = iterMove;
      bestScore = iterBest;
      bestDepth = depth;
    }

    if(Math.abs(bestScore) > 40000) break;
  }

  const freshRoot = rootCands.filter(x => x.repCount === 0);
  if(freshRoot.length > 0){
    const bestEntry = rootCands.find(x => x.a === bestMove);
    if(bestEntry && bestEntry.repCount > 0){
      bestMove = freshRoot[0].a;
    }
  }

  console.log(`[AI Hard ${myColor}] depth=${bestDepth} score=${bestScore} time=${Date.now()-startTime}ms nodes=${_searchNodes||0}`);
  _searchNodes = 0;
  return bestMove;
}

let _searchNodes = 0;
function alphaBetaSearch(depth, alpha, beta, color, startTime, timeLimit, tt, genome){
  const g = genome || DEFAULT_GENOME;
  _searchNodes++;
  if(Date.now() - startTime > timeLimit) return 0;

  if(depth === 0){
    return evaluatePosition(color, g);
  }

  // 트랜스포지션 테이블 조회 (정확값만)
  const ttKey = serializeBoard() + '@' + depth;
  const ttHit = tt.get(ttKey);
  if(ttHit !== undefined) return ttHit;

  const list = allLegalActions(color);
  if(!list.length){
    if(isInCheck(color)) return -50000 + depth; // 메이트 (빠른 메이트 선호)
    return 0; // 스테일메이트
  }

  // 이동 정렬 (가지치기 효과 ↑) — 유전자 기반 가치
  const branchLimit = depth >= 4 ? 8 : (depth >= 3 ? 10 : 14);
  const scored = list.map(a => {
    let s = 0;
    if(a.type === 'move'){
      const tgt = board[a.tr][a.tc];
      if(tgt) s += (g[tgt.kind] || 0) * 10;
    } else if(a.type === 'place'){
      s += (g[a.kind] || 0);
      const dr = Math.min(a.r, 7-a.r);
      const dc = Math.min(a.c, 7-a.c);
      s += (dr + dc); // 중앙성
    }
    return {a, s};
  });
  scored.sort((x,y) => y.s - x.s);
  const cands = scored.slice(0, branchLimit);

  let best = -Infinity;
  for(const {a} of cands){
    if(Date.now() - startTime > timeLimit) break;

    const snap = snapshotState();
    const r = applyAction(a, {silent:true});
    if(!r.ok){ restoreState(snap); continue; }

    let val;
    const oppC = opp(color);
    if(r.fiveWin === color){
      val = 50000 - depth;
    } else if(r.fiveWin === oppC){
      val = -50000 + depth;
    } else if(isInCheck(oppC) && isCheckmate(oppC)){
      val = 50000 - depth; // 상대 메이트
    } else if(isInCheck(color) && isCheckmate(color)){
      val = -50000 + depth; // 내 메이트
    } else if(r.suicide){
      val = -50000;
    } else {
      val = -alphaBetaSearch(depth - 1, -beta, -alpha, oppC, startTime, timeLimit, tt, g);
    }

    restoreState(snap);

    if(val > best) best = val;
    if(val > alpha) alpha = val;
    if(alpha >= beta) break; // 베타 컷오프
  }

  const result = best === -Infinity ? evaluatePosition(color, g) : best;
  // TT 저장 (크기 제한)
  if(tt.size < AI_HARD_TT_MAX) tt.set(ttKey, result);
  return result;
}

// 4연속 위협 차단할 수 찾기
function findBlock4(list, threatColor){
  // 적이 4연속을 만들어두었는지 검사 → 있으면 그 자리에 둘 수 있는 액션 찾기
  // 단순 휴리스틱: 적 색깔로 4연 + 양옆 빈칸 패턴 검사
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  const threats = [];
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      for(const [dr,dc] of dirs){
        // 4 연속 검사
        const cells = [];
        for(let i=0;i<4;i++){
          const nr=r+dr*i, nc=c+dc*i;
          if(!inBounds(nr,nc)) break;
          cells.push([nr,nc]);
        }
        if(cells.length<4) continue;
        const allMy = cells.every(([nr,nc]) => board[nr][nc] && board[nr][nc].color===threatColor);
        if(!allMy) continue;
        // 양 끝 빈칸
        const before = [r-dr, c-dc];
        const after = [r+dr*4, c+dc*4];
        for(const [tr,tc] of [before, after]){
          if(inBounds(tr,tc) && !board[tr][tc]) threats.push([tr,tc]);
        }
      }
    }
  }
  if(!threats.length) return null;
  // 위협 자리에 둘 수 있는 액션
  for(const [tr,tc] of threats){
    for(const a of list){
      if(a.type === 'place' && a.r === tr && a.c === tc) return a;
      if(a.type === 'move' && a.tr === tr && a.tc === tc) return a;
    }
  }
  return null;
}

function evaluateAction(a, color, genome){
  const g = genome || DEFAULT_GENOME;
  const snap = snapshotState();
  const r = applyAction(a, {silent:true});
  let score = 0;
  if(!r.ok){ restoreState(snap); return -99999; }
  score = evaluatePosition(color, g);
  // 즉시 승
  if(r.fiveWin === color) score += 100000;
  if(r.fiveWin === opp(color)) score -= 100000;
  if(r.checkmate === color) score += 100000;
  // 체크 보너스/페널티 (유전자)
  if(isInCheck(opp(color))) score += g.checkGive;
  if(isInCheck(color)) score -= g.checkRecv;
  restoreState(snap);
  return score;
}

function evaluatePosition(color, genome){
  const g = genome || DEFAULT_GENOME;
  let score = 0;
  // 보드 기물
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p = board[r][c];
    if(!p) continue;
    const v = g[p.kind] || 0;
    score += (p.color === color) ? v : -v;
  }
  // 손패
  for(const k of Object.keys(hands.w)){
    const v = (g[k] || 0) * g.handRatio;
    score += hands[color][k] * v - hands[opp(color)][k] * v;
  }
  // 오목 위협
  score += countLineThreats(color, g) - countLineThreats(opp(color), g);
  return score;
}

function countLineThreats(col, genome){
  const g = genome || DEFAULT_GENOME;
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  let total = 0;
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      for(const [dr,dc] of dirs){
        let count=0;
        for(let i=0;i<5;i++){
          const nr=r+dr*i, nc=c+dc*i;
          if(!inBounds(nr,nc)){ count=-99; break; }
          const p = board[nr][nc];
          if(!p){ continue; }
          if(p.color===col) count++;
          else { count=-99; break; }
        }
        if(count<0) continue;
        if(count>=5) total += g.threat5;
        else if(count===4) total += g.threat4;
        else if(count===3) total += g.threat3;
        else if(count===2) total += g.threat2;
      }
    }
  }
  return total;
}

// ===================================================================
// 14. 사운드 (Web Audio)
// ===================================================================
let _audCtx = null;
function audio(){
  if(!_audCtx){ try{ _audCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){return null;} }
  return _audCtx;
}
function playSnd(type){
  const ctx = audio(); if(!ctx) return;
  if(ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  // === 따뜻한 나무 체스 효과음 ===
  // 중간 주파수 + 부드러운 attack + 약한 wood body
  function woodClick(opts){
    const {
      clickFreq = 1200,     // 클릭 중심 주파수 (중간 영역 — 따뜻함)
      clickQ = 1.5,          // 넓은 대역 (더 풍부한 톤)
      clickGain = 0.5,
      bodyFreq = 300,        // 나무 통 따뜻한 울림
      bodyGain = 0.12,       // 적당한 wood body 느낌
      duration = 0.04,
      delay = 0
    } = opts;
    const t0 = now + delay;

    // 1. 클릭 노이즈 — 부드러운 envelope
    const len = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i = 0; i < len; i++){
      // 약간 부드러운 exp decay (pow 6 — 너무 sharp 안 되게)
      const env = Math.pow(1 - i/len, 6);
      d[i] = (Math.random()*2 - 1) * env;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    // 2. Highpass — 200Hz 이하만 컷 (덜 공격적)
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(200, t0);

    // 3. Bandpass — 중간 주파수 통과 (넓은 대역으로 따뜻하게)
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(clickFreq, t0);
    bp.Q.setValueAtTime(clickQ, t0);

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(clickGain, t0);
    noise.connect(hp).connect(bp).connect(ng).connect(ctx.destination);
    noise.start(t0);

    // 4. Wood body 공명 — 따뜻한 중저음
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.connect(og).connect(ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(bodyFreq, t0);
    o.frequency.exponentialRampToValueAtTime(bodyFreq * 0.8, t0 + duration);
    og.gain.setValueAtTime(0, t0);
    og.gain.linearRampToValueAtTime(bodyGain, t0 + 0.003);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + duration + 0.02);
    o.start(t0);
    o.stop(t0 + duration + 0.03);
  }

  if(type === 'move'){
    // 따뜻한 "tok"
    woodClick({
      clickFreq: 1400, clickQ: 1.5,
      clickGain: 0.45,
      bodyFreq: 350, bodyGain: 0.1,
      duration: 0.04
    });
  } else if(type === 'place'){
    // 살짝 더 단단한 "tock"
    woodClick({
      clickFreq: 1100, clickQ: 1.3,
      clickGain: 0.55,
      bodyFreq: 280, bodyGain: 0.14,
      duration: 0.05
    });
  } else if(type === 'capture'){
    // 강한 더블 클릭 "tk-tk"
    woodClick({
      clickFreq: 1300, clickQ: 1.4,
      clickGain: 0.55,
      bodyFreq: 260, bodyGain: 0.13,
      duration: 0.045
    });
    woodClick({
      clickFreq: 1700, clickQ: 1.8,
      clickGain: 0.4,
      bodyFreq: 380, bodyGain: 0.08,
      duration: 0.03,
      delay: 0.04
    });
  } else if(type === 'chat'){
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(880, now);
    o.frequency.exponentialRampToValueAtTime(660, now + 0.1);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.1, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    o.start(now); o.stop(now + 0.22);
  }
  // type === 'end' 는 의도적으로 소리 없음 (정적이 더 자연스러움)
}

// ===================================================================
// 15. 네트워크 (Firebase + PeerJS)
// ===================================================================
// FB_CONFIG, _fbDb, _fbAuth, _authReady, fbInit → js/game/firebase.js로 이동

// _peer, _peerConn, _specWatcher, _connCloseTimer, _hostDisconnected, _lastPongTime, _heartbeatInterval,
// netInit, initHost, initGuest, tryConnect, startHeartbeat, triggerDisconnect, setupConn → js/game/network.js로 이동

function onPeerMessage(data){
  if(!data || !data.t) return;
  // 정상 메시지 받음 → pong 시각 갱신 + grace 취소
  _lastPongTime = Date.now();
  // PING/PONG (연결 상태 확인용)
  if(data.t === 'PING'){
    try { sendToPeer({ t:'PONG', ts: data.ts }); } catch(_){}
    return;
  }
  if(data.t === 'PONG'){
    return; // _lastPongTime은 위에서 갱신됨
  }
  // 호스트가 보낸 종료 신호 (게스트 전용)
  if(data.t === 'END_SIGNAL'){
    if(NET_ROLE === 'guest' && !gameOver){
      endGame(data.emoji || '🏁', data.title || '게임 종료', data.desc || '', data.winner, true);
    }
    return;
  }
  if(data.t === 'CHAT_EMOJI'){
    // 상대가 보낸 이모지 — 채팅에 표시
    if(data.emojiId){
      addChatMsg(data.from || '상대', '', false, false, data.emojiId);
      // 채팅 안 보고 있으면 unread badge
      if(!document.getElementById('chatPanel').classList.contains('show')){
        _chatUnread = (_chatUnread||0) + 1;
        updateChatBadge();
      }
    }
    return;
  }
  if(data.t === 'EMOJI'){
    // 옛 형식 호환 — CHAT_EMOJI로 처리
    if(data.id){
      addChatMsg('상대', '', false, false, data.id);
    }
    return;
  }
  if(data.t === 'ELO_RESULT'){
    // 게스트만 처리 — 호스트가 계산한 결과
    if(NET_ROLE !== 'guest' || !_waitingForEloResult) return;
    _waitingForEloResult = false;
    _eloPending = false;
    setEndNavDisabled(false);
    const diff = data.diff;
    const newElo = data.newElo;
    const eloEl = document.getElementById('endElo');
    if(eloEl && diff !== null && diff !== undefined){
      if(diff === 0){
        eloEl.className = 'elo-change';
        eloEl.innerHTML = `<span style="color:var(--muted)">변동 없음</span> · ${MY_ELO_P} ELO`;
      } else {
        const sign = diff > 0 ? '+' : '';
        eloEl.className = 'elo-change ' + (diff>0?'up':'dn');
        eloEl.innerHTML = `${MY_ELO_P} → <b>${newElo}</b> <span style="opacity:.8">(${sign}${diff})</span>`;
      }
      eloEl.style.display = '';
    }
    // 리매치를 위해 MY_ELO_P + _gameRatingInfo 갱신
    MY_ELO_P = newElo;
    if(_gameRatingInfo){
      if(MY_COLOR === 'w'){
        _gameRatingInfo.whiteElo = newElo;
      } else {
        _gameRatingInfo.blackElo = newElo;
      }
      console.log('[ELO] _gameRatingInfo 갱신 (게스트):', _gameRatingInfo);
    }
    // 자기 데이터에 저장 (자기 인증으로)
    applyEloAsGuest(diff, newElo, _lastWinnerForGuest);
    return;
  }
  if(data.t === 'HELLO'){
    console.log('[net] HELLO 수신:', data);
    // 같은 계정 매칭 방지
    const otherUid = NET_ROLE === 'host' ? data.guestUid : data.hostUid;
    if(otherUid && otherUid === MY_UID){
      sendToPeer({t:'REJECT', reason:'same_account'});
      showFlash('자기 자신과는 매칭할 수 없습니다');
      setTimeout(()=>{
        cleanupRoom();
        goLobby();
      }, 1500);
      return;
    }
    if(NET_ROLE === 'host'){
      _gameRatingInfo = {
        whiteUid: MY_UID, whiteElo: MY_ELO_P, whiteNick: MY_NICK_P, whiteTag: MY_TAG_P,
        blackUid: data.guestUid, blackElo: data.guestElo, blackNick: data.guestNick, blackTag: data.guestTag||''
      };
      console.log('[net] _gameRatingInfo 설정 (host):', _gameRatingInfo);
      _opponentUid = data.guestUid;
      // 프로필 사진 표시 (W → 호스트 사진, B → 게스트 사진)
      setTimerPhoto('w', MY_PHOTO_URL, MY_NICK_P);
      setTimerPhoto('b', data.guestPhoto || '', data.guestNick || '');
      const gTag = data.guestTag ? `<span class="ingame-tag">#${escapeHtml(data.guestTag)}</span>` : '';
      const gTitle = data.guestTitle 
        ? `<span class="nick-title" style="color:${data.guestTitleColor||'#f5c842'};font-weight:800;margin-right:4px;font-size:.85em;text-shadow:0 0 4px currentColor">${escapeHtml(data.guestTitle)}</span>`
        : '';
      document.getElementById('oppName').innerHTML = gTitle + escapeHtml(data.guestNick) + gTag + ` (${data.guestElo})`;
      document.getElementById('oppMeta').textContent = '흑 ELO ' + data.guestElo;
      if(data.guestTitle) setupTitleObserver('oppName', data.guestTitle, data.guestTitleColor||'#f5c842');
      // 호스트가 게스트한테 자기 정보 답장 (게스트가 host 정보 받을 수 있도록 확실히)
      sendToPeer({
        t:'HELLO',
        hostNick: MY_NICK_P, hostElo: MY_ELO_P, hostUid: MY_UID, hostTag: MY_TAG_P,
        hostTitle: MY_TITLE_NAME || '', hostTitleColor: MY_TITLE_COLOR || '',
        hostPhoto: MY_PHOTO_URL || '',
        hand: INIT_HAND
      });
      console.log('[net] HELLO 답장 송신 (host → guest)');
    } else {
      _gameRatingInfo = {
        whiteUid: data.hostUid, whiteElo: data.hostElo, whiteNick: data.hostNick, whiteTag: data.hostTag||'',
        blackUid: MY_UID, blackElo: MY_ELO_P, blackNick: MY_NICK_P, blackTag: MY_TAG_P
      };
      console.log('[net] _gameRatingInfo 설정 (guest):', _gameRatingInfo);
      _opponentUid = data.hostUid;
      // 프로필 사진 표시 (W → 호스트 사진, B → 게스트 사진)
      setTimerPhoto('w', data.hostPhoto || '', data.hostNick || '');
      setTimerPhoto('b', MY_PHOTO_URL, MY_NICK_P);
      const hTag = data.hostTag ? `<span class="ingame-tag">#${escapeHtml(data.hostTag)}</span>` : '';
      const hTitle = data.hostTitle 
        ? `<span class="nick-title" style="color:${data.hostTitleColor||'#f5c842'};font-weight:800;margin-right:4px;font-size:.85em;text-shadow:0 0 4px currentColor">${escapeHtml(data.hostTitle)}</span>`
        : '';
      document.getElementById('oppName').innerHTML = hTitle + escapeHtml(data.hostNick) + hTag + ` (${data.hostElo})`;
      document.getElementById('oppMeta').textContent = '백 ELO ' + data.hostElo;
      if(data.hand){
        hands.w = {...DEFAULT_HAND, ...data.hand};
        hands.b = {...DEFAULT_HAND, ...data.hand};
        renderAll();
      }
      if(data.hostTitle) setupTitleObserver('oppName', data.hostTitle, data.hostTitleColor||'#f5c842');
    }
    // 차단 검사 — 내가 이미 차단한 상대인지 확인
    checkOpponentBlocked();
    // 채팅 차단 버튼 표시
    const bBtn = document.getElementById('chatBlockBtn');
    if(bBtn) bBtn.style.display = '';
    publishGameState();
    startTimerIfNeeded();
    // 연결 상태 모니터링 시작 (PING/PONG 5초마다)
    if(IS_NET) startHeartbeat();
  } else if(data.t === 'MOVE'){
    // 상대가 둔 수 적용
    let _captured = null;
    if(data.action.type === 'move'){
      const tgt = board[data.action.tr] && board[data.action.tr][data.action.tc];
      if(tgt) _captured = { kind: tgt.kind, color: tgt.color };
    }
    const r = applyAction(data.action);
    if(!r.ok){ console.error('상대 액션 실패', r); return; }
    recordReplayAction(data.action, _captured);
    if(data.action.type === 'place') playSnd('place');
    else playSnd('move');
    SEL = null; HIGHLIGHTS = []; // 상대 수 적용 시 내 잔여 선택 정리
    renderAll();
    if(NET_ROLE === 'host') publishGameState();
    postMoveCheck(r);
  } else if(data.t === 'CHAT'){
    // 차단된 상대 채팅 무시
    if(_opponentBlocked){
      console.log('[Chat] 차단된 상대 메시지 무시');
      return;
    }
    addChatMsg(data.from || '상대', data.msg, false);
    playSnd('chat');
    if(!_chatOpen){
      _chatUnread++;
      updateChatBadge();
    }
  } else if(data.t === 'REMATCH_REQ'){
    document.getElementById('rematchAskMsg').textContent = `${data.from || '상대'}가 리매치를 요청했습니다.`;
    document.getElementById('rematchAskModal').classList.add('show');
  } else if(data.t === 'REMATCH_REPLY'){
    if(data.accept) doRematch();
    else { showFlash('상대가 리매치를 거절했습니다'); addChatMsg('시스템','상대가 리매치를 거절했습니다',null,true); }
  } else if(data.t === 'FORFEIT'){
    if(!gameOver){
      const winner = MY_COLOR;
      endGame('🏳','상대 기권', (window.t ? window.t('{n}가 기권했습니다.', {n:data.from || window.t('상대')}) : `${data.from || '상대'}가 기권했습니다.`), winner);
    }
  } else if(data.t === 'END'){
    // 다른 쪽에서 종료 시 동기화 (이미 종료됐을 수 있음)
  } else if(data.t === 'REJECT'){
    // 호스트가 거부 (같은 계정 등)
    let msg = '연결이 거부되었습니다';
    if(data.reason === 'same_account') msg = '자기 자신과는 매칭할 수 없습니다';
    showFlash(msg);
    setTimeout(()=>{
      cleanupRoom();
      goLobby();
    }, 1500);
  }
  // ===== 타이쿤 모드 메시지 (상대의 자유 행동: 구매/강화/승급 동기화) =====
  else if(data.t === 'TYCOON_BUY'){
    const price = (typeof TYCOON_PRICES !== 'undefined' && TYCOON_PRICES[data.kind]) || 0;
    gold[data.color] = (gold[data.color]||0) - price;
    hands[data.color][data.kind] = (hands[data.color][data.kind]||0) + 1;
    if(NET_ROLE === 'host') publishGameState();
    renderAll();
  } else if(data.t === 'TYCOON_UPGRADE'){
    gold[data.color] = (gold[data.color]||0) - TYCOON_SN_UPGRADE_COST;
    snUpgraded[data.color] = true;
    if(NET_ROLE === 'host') publishGameState();
    renderAll();
  } else if(data.t === 'TYCOON_PROMOTE'){
    gold[data.color] = (gold[data.color]||0) - TYCOON_PROMO_COST;
    if(board[data.r] && board[data.r][data.c]) board[data.r][data.c] = { color: data.color, kind: data.promo };
    if(NET_ROLE === 'host') publishGameState();
    renderAll();
  }
  // ===== 물약 모드 메시지 =====
  else if(data.t === 'POTION_USED'){
    // 상대가 물약 1개 사용 — 상대 인벤 카운트 -1
    if(oppInventoryCount > 0) oppInventoryCount--;
    renderPotionUI();
  } else if(data.t === 'POTION_MERGE'){
    // 상대 합체 — 카운트 -1 (2개 → 1개 level 2)
    if(oppInventoryCount > 0) oppInventoryCount--;
    renderPotionUI();
  } else if(data.t === 'POTION_SHOP_BUY'){
    // 상대가 상점에서 구매 — 카운트 +1
    oppInventoryCount = Math.min(oppInventoryCount + 1, MAX_INVENTORY_SIZE);
    renderPotionUI();
  } else if(data.t === 'POTION_SHOP_SELL'){
    // 상대가 상점에서 판매 — 카운트 -1
    if(oppInventoryCount > 0) oppInventoryCount--;
    renderPotionUI();
  } else if(data.t === 'POTION_REVIVE'){
    // 상대가 부활 사용 — 보드에 추가
    board[data.r][data.c] = (data.kind === 'SN') ? { color: data.color, kind: data.kind, attacks: 0 } : { color: data.color, kind: data.kind };
    renderAll();
    playSnd('place');
    showFlash(`상대가 ${getPieceName(data.kind)} 부활`, 1800);
  } else if(data.t === 'POTION_BLOCK'){
    // 상대가 차단 칸 추가
    blockedCells.push({r: data.r, c: data.c, turnsLeft: 3, owner: data.color});
    drawBlockedOverlay();
    showFlash('상대가 칸을 차단', 1500);
  } else if(data.t === 'POTION_JOKER'){
    // 양쪽 다 색 swap + 보드 회전
    for(let r=0;r<8;r++) for(let c=0;c<8;c++){
      if(board[r][c]) board[r][c].color = opp(board[r][c].color);
    }
    const tmpHand = {...hands.w}; hands.w = {...hands.b}; hands.b = tmpHand;
    const tmpKP = kingPlaced.w; kingPlaced.w = kingPlaced.b; kingPlaced.b = tmpKP;
    blockedCells.forEach(b => { b.owner = opp(b.owner); });
    const tmpT = _wTimeLeft; _wTimeLeft = _bTimeLeft; _bTimeLeft = tmpT;
    MY_COLOR = opp(MY_COLOR);
    document.body.classList.toggle('board-flipped');
    if(data.level === 2){
      showFlash('🃏 상대 조커 강화! 한 번 더 둠');
      // 레벨 2: 상대가 한 번 더 둠 — turn 그대로 (상대 차례 유지)
    } else {
      showFlash('🃏 진영 교환됨!');
      // 일반: 한 수로 처리 → turn 넘김 (보내는 쪽도 넘김)
      turn = opp(turn);
      if(IS_POTION) handlePotionTurnStart(turn);
    }
    renderAll();
    playSnd('move');
  } else if(data.t === 'POTION_TIME'){
    // 상대 시간 물약 적용
    if(data.color === 'w'){
      _wTimeLeft += 180 * 1000;
      if(data.level === 2) _bTimeLeft = Math.max(0, _bTimeLeft - 120 * 1000);
    } else {
      _bTimeLeft += 180 * 1000;
      if(data.level === 2) _wTimeLeft = Math.max(0, _wTimeLeft - 120 * 1000);
    }
    showFlash('⏰ 상대 시간 조작', 1500);
  } else if(data.t === 'POTION_PEEK_REQ'){
    // 상대가 내 인벤 보고 싶음 — 응답
    sendToPeer({ t:'POTION_PEEK_RESP', inventory: myInventory.map(p => ({type:p.type, level:p.level})) });
    showFlash('👁 상대가 내 인벤을 봤음', 1500);
  } else if(data.t === 'POTION_PEEK_RESP'){
    // 상대 인벤 받음
    oppInventoryRevealed = data.inventory || [];
    showPeekFloatingCard(oppInventoryRevealed);
    setTimeout(()=>{ oppInventoryRevealed = null; hidePeekFloatingCard(); }, 12000);
  } else if(data.t === 'POTION_STEAL_REQ'){
    // 상대가 내 물약 훔치려 함 — 랜덤 1개 빼서 보내줌
    if(myInventory.length > 0){
      const idx = Math.floor(Math.random() * myInventory.length);
      const stolen = myInventory[idx];
      myInventory.splice(idx, 1);
      sendToPeer({ t:'POTION_STEAL_RESP', potion: {type: stolen.type, level: stolen.level} });
      renderPotionUI();
      showFlash(`👁 상대가 ${POTION_TYPES[stolen.type].name} 훔침!`, 2000);
    } else {
      sendToPeer({ t:'POTION_STEAL_RESP', potion: null });
    }
  } else if(data.t === 'POTION_STEAL_RESP'){
    // 훔치기 성공 결과
    if(data.potion && myInventory.length < MAX_INVENTORY_SIZE){
      myInventory.push({
        id: genPotionId(),
        type: data.potion.type,
        level: data.potion.level,
        color: MY_COLOR
      });
      showFlash(`✨ ${POTION_TYPES[data.potion.type].name} 획득!`);
    } else if(!data.potion){
      showFlash('상대 인벤이 비어있음');
    }
    renderPotionUI();
  }
}

// sendToPeer, publishGameState → js/game/network.js (아래 onPeerMessage는 main 유지)

// 관전자
function initSpectator(){
  document.getElementById('chatFab').style.display = '';
  document.getElementById('forfeitBtn').style.display = 'none';
  document.getElementById('chatInput').disabled = true;
  document.getElementById('chatInput').placeholder = '관전 모드 (읽기 전용)';
  showFlash('👁 관전 모드 — 게임 상태를 불러오는 중...', 4000);
  // chatLog 구독
  _fbDb.ref('rooms/'+ROOM_CODE+'/chatLog').on('value', snap => {
    const log = JSON.parse(snap.val() || '[]');
    document.getElementById('chatMsgs').innerHTML = '';
    log.forEach(m => addChatMsg(m.from, m.msg, false, m.sys));
  });
  let _firstStateLoaded = false;
  _fbDb.ref('rooms/'+ROOM_CODE+'/gameState').on('value', snap => {
    const raw = snap.val();
    if(!raw){
      // 아직 호스트가 publish 안 한 상태일 수 있음.
      // 방 자체가 사라진 경우는 아래 rooms 리스너에서 처리.
      // 여기서는 종료 처리하지 않고 대기.
      return;
    }
    try{
      const s = JSON.parse(raw);
      board = s.board;
      hands = s.hands;
      turn = s.turn;
      kingPlaced = s.kingPlaced;
      lastMove = s.lastMove;
      checkStreak = s.checkStreak || {w:0,b:0};
      totalChecks = s.totalChecks || {w:0,b:0};
      minsim = s.minsim || {w:0,b:0};
      gold = s.gold || {w:0,b:0};
      snUpgraded = s.snUpgraded || {w:false,b:false};
      tycoonTurn = s.tycoonTurn || {w:0,b:0};
      _gameRatingInfo = s.rating;
      if(_gameRatingInfo){
        document.getElementById('myName').textContent = _gameRatingInfo.whiteNick + ` (${_gameRatingInfo.whiteElo})`;
        document.getElementById('myMeta').textContent = '백';
        document.getElementById('oppName').textContent = _gameRatingInfo.blackNick + ` (${_gameRatingInfo.blackElo})`;
        document.getElementById('oppMeta').textContent = '흑';
      }
      renderAll();
      if(!_firstStateLoaded){
        _firstStateLoaded = true;
        showFlash('👁 관전 시작', 1500);
      }
    }catch(e){ console.error('관전 상태 파싱 실패',e); }
  });
  // 방 자체 감시 — 방이 삭제될 때만 종료 처리
  _fbDb.ref('rooms/'+ROOM_CODE).on('value', snap => {
    const r = snap.val();
    if(!r && !gameOver){
      endGame('📛','방 종료','호스트가 방을 닫았거나 게임이 종료되었습니다.', null);
    }
  });
}

// ===================================================================
// 16. 채팅
// ===================================================================
// 채팅/이모지/차단/setTimerPhoto → js/game/chat.js로 이동

// ===================================================================
// 17. 타이머 — 체스식 총 시간 (Fischer 증분)
// ===================================================================
// 각 플레이어는 TIME_LIMIT 만큼의 총 시간을 갖고, 자기 차례에만 차감됨.
// 한 수 완료 시 그 수를 둔 플레이어에게 TIME_INC 만큼 추가.
// _turnStartTime, _timerInterval, _wTimeLeft, _bTimeLeft, _pauseTimerForBlur, _resumeTimerForBlur, startTimerIfNeeded, updateTimer, commitMoveTime → js/game/timer.js로 이동

// 기물 점수 (재질) 계산 + 표시
function updateMaterial(){
  // 보드 위 기물의 합 점수
  let wSum = 0, bSum = 0;
  for(let r=0; r<8; r++) for(let c=0; c<8; c++){
    const p = board[r][c];
    if(!p) continue;
    const v = PIECE_VALUES[p.kind] || 0;
    if(p.color === 'w') wSum += v;
    else bSum += v;
  }
  for(const k of Object.keys(hands.w || {})){
    wSum += (PIECE_VALUES[k] || 0) * (hands.w[k] || 0);
  }
  for(const k of Object.keys(hands.b || {})){
    bSum += (PIECE_VALUES[k] || 0) * (hands.b[k] || 0);
  }
  const total = wSum + bSum;
  const wPct = total > 0 ? (wSum / total * 100) : 50;
  const bPct = total > 0 ? (bSum / total * 100) : 50;
  const diff = wSum - bSum;
  const diffStr = diff > 0 ? `+${diff} 백 우세` : diff < 0 ? `${diff} 흑 우세` : '동등';
  const diffClass = diff > 0 ? 'mbf-diff adv-w' : diff < 0 ? 'mbf-diff adv-b' : 'mbf-diff';

  // 토픽바 컴팩트 바
  const tm = document.getElementById('topbarMaterial');
  if(tm){
    tm.style.display = '';
    const wNum = document.getElementById('mbcWNum');
    const bNum = document.getElementById('mbcBNum');
    const wFill = document.getElementById('mbcWFill');
    const bFill = document.getElementById('mbcBFill');
    if(wNum) wNum.textContent = wSum;
    if(bNum) bNum.textContent = bSum;
    if(wFill) wFill.style.width = wPct + '%';
    if(bFill) bFill.style.width = bPct + '%';
  }

  // 시트 풀 바 (모바일 눈 버튼 시트)
  const mbfWNum = document.getElementById('mbfWNum');
  const mbfBNum = document.getElementById('mbfBNum');
  const mbfWFill = document.getElementById('mbfWFill');
  const mbfBFill = document.getElementById('mbfBFill');
  const mbfDiff = document.getElementById('mbfDiff');
  if(mbfWNum) mbfWNum.textContent = wSum;
  if(mbfBNum) mbfBNum.textContent = bSum;
  if(mbfWFill) mbfWFill.style.width = wPct + '%';
  if(mbfBFill) mbfBFill.style.width = bPct + '%';
  if(mbfDiff){ mbfDiff.textContent = diffStr; mbfDiff.className = diffClass; }
}

// 차례 변경 시 타이머 리셋
const _origApply = applyAction;
// 턴 변경 감지: 한 수 완료된 시점이므로 그 수 둔 사람의 시간 차감 + 증분 적용
let _lastTurn = turn;
function watchTurnForTimer(){
  if(_lastTurn !== turn){
    _lastTurn = turn;
    commitMoveTime();
  }
}
setInterval(watchTurnForTimer, 100);

// ===================================================================
// 18. 리매치 / 기권 / 로비 이동
// ===================================================================
function rematchReply(accept){
  document.getElementById('rematchAskModal').classList.remove('show');
  sendToPeer({ t:'REMATCH_REPLY', accept });
  if(accept) doRematch();
}
function doRematch(){
  // 상태 초기화
  board = makeEmptyBoard();
  hands = IS_TYCOON ? { w:{...TYCOON_HAND}, b:{...TYCOON_HAND} } : { w:{...INIT_HAND}, b:{...INIT_HAND} };
  turn = 'w';
  kingPlaced = { w:false, b:false };
  lastMove = null;
  moveHistory = [];
  actionHistory = [];
  checkStreak = { w:0, b:0 };
  totalChecks = { w:0, b:0 };
  minsim = { w:0, b:0 };   // 농민 봉기: 민심 게이지 초기화
  gold = { w:0, b:0 };     // 타이쿤: 골드 초기화
  snUpgraded = { w:false, b:false };
  tycoonTurn = { w:0, b:0 };
  gameOver = false;
  SEL = null;
  HIGHLIGHTS = [];
  _eloPending = false;
  _lastTurn = 'w';

  // 포션 상태 초기화 (잔류 방지)
  if(IS_POTION){
    blockedCells = [];
    oppInventoryRevealed = null;
    hidePeekFloatingCard && hidePeekFloatingCard();
    drawBlockedOverlay && drawBlockedOverlay();
  }
  // 보드 회전 / MY_COLOR (조커 효과) 잔류 제거
  if(document.body.classList.contains('board-flipped')){
    document.body.classList.remove('board-flipped');
    // MY_COLOR 원복: URL에서 받은 원본 색으로
    if(!IS_LOCAL){
      MY_COLOR = _ORIG_MY_COLOR || (NET_ROLE === 'host' ? 'w' : 'b');
    }
  }

  // 모든 모달 닫기 (혹시 열려있을 경우)
  ['endModal','rematchAskModal','rulesModal','confirmModal','tutorialAskModal','custModal','potionInvModal','potionShopModal','potionActionMenu','reviveModal'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.classList.remove('show');
  });

  // 종료 모달 버튼 상태 복원
  setEndNavDisabled(false);
  const rmBtn = document.getElementById('rematchBtn');
  if(rmBtn){
    rmBtn.disabled = false;
    rmBtn.textContent = IS_NET ? '🔄 리매치' : '🔄 다시 시작';
  }

  // 타이머 리셋
  if(_timerInterval){ clearInterval(_timerInterval); _timerInterval = null; }
  if(TIME_LIMIT > 0){
    _wTimeLeft = TIME_LIMIT;
    _bTimeLeft = TIME_LIMIT;
    _turnStartTime = Date.now();
    startTimerIfNeeded();
  }

  // AI 사고 인디케이터 숨김
  showAIThinking(false);

  // 포션 모드 재초기화 (보드 다시 그리기 + 인벤 다시 분배)
  if(IS_POTION){
    initPotionMode();
  }

  // 호스트만 방 상태 갱신
  if(NET_ROLE === 'host'){
    _fbDb && _fbDb.ref('rooms/'+ROOM_CODE).update({ gameActive:true }).catch(()=>{});
    publishGameState();
  }

  renderAll();

  // AI 모드: 흑 차례 시작 (없겠지만 안전)
  if(IS_AI && turn === 'b'){
    setTimeout(()=> aiTurn(), 500);
  } else if(IS_AIVAI){
    setTimeout(()=> aiTurn(), 800);
  }
}

// 리매치 / 재시작 요청 — 모드별 분기
function requestRematch(){
  if(!IS_NET){
    // 로컬 / AI / AIVAI → 즉시 재시작
    doRematch();
    return;
  }
  // 온라인 — 상대에게 요청
  sendToPeer({ t:'REMATCH_REQ', from: MY_NICK_P });
  const rmBtn = document.getElementById('rematchBtn');
  rmBtn.textContent = '요청 보냄...';
  rmBtn.disabled = true;
}

function confirmForfeit(){
  if(gameOver) return;
  showConfirm('기권', '정말 기권하시겠습니까?', () => {
    sendToPeer({ t:'FORFEIT', from: MY_NICK_P });
    endGame('🏳','기권', '기권했습니다.', opp(MY_COLOR));
  });
}
function confirmLeave(){
  if(gameOver){ goLobby(); return; }
  if(IS_SPEC){ goLobby(); return; }
  showConfirm('로비 이동', '게임을 떠나면 기권 처리됩니다. 계속하시겠습니까?', () => {
    if(IS_NET){
      sendToPeer({ t:'FORFEIT', from: MY_NICK_P });
      // 본인도 endGame 호출 → ELO 차감 + 종료 모달 표시
      // 모달에서 ELO 변동 확인 후 사용자가 "로비로" 누르면 떠남
      endGame('🏳','기권', '기권하고 떠났습니다.', opp(MY_COLOR));
    } else {
      cleanupRoom();
      goLobby();
    }
  });
}
function goLobby(){
  // 정상 퇴장 — 새로고침 감지 마커 제거
  try { sessionStorage.removeItem('frontier_active_game'); } catch(_){}
  cleanupRoom();
  myRoomCode = null;
  location.href = 'index.html';
}
function tryGoLobbyFromEnd(){
  if(_eloPending){
    showConfirm('ELO 업데이트 중', 'ELO가 아직 저장되지 않았습니다. 기다리시겠습니까?\n(취소: 잠시 더 기다리기 / 확인: 그래도 나가기 — 이 경우 ELO가 반영되지 않을 수 있습니다.)', () => {
      goLobby();
    });
    return;
  }
  goLobby();
}
// showConfirm + closeConfirm → js/game/utils.js로 이동

function cleanupRoom(){
  if(!IS_NET) return;
  // 호스트/게스트 모두 방 삭제 가능
  if(_fbDb && ROOM_CODE){
    _fbDb.ref('rooms/'+ROOM_CODE).remove().catch(()=>{});
  }
  if(_peerConn) try{_peerConn.close();}catch(e){}
  if(_peer) try{_peer.destroy();}catch(e){}
}
window.addEventListener('beforeunload', () => {
  if(myRoomCode){
    if(_fbDb) _fbDb.ref('rooms/'+myRoomCode).remove().catch(()=>{});
  }
});
// 모바일 Safari는 beforeunload보다 pagehide가 더 reliable
window.addEventListener('pagehide', () => {
  if(myRoomCode){
    if(_fbDb) _fbDb.ref('rooms/'+myRoomCode).remove().catch(()=>{});
  }
});

// ===================================================================
// 19. 모바일 상대 손패 시트
// ===================================================================
function toggleOppSheet(){
  const sheet = document.getElementById('oppSheet');
  const isOpening = !sheet.classList.contains('show');
  if(isOpening) populateOppSheet();
  sheet.classList.toggle('show');
}

function populateOppSheet(){
  // 헤더: 아바타 / 이름 / 메타 (현재 차례 상태)
  // 모바일 로컬에선 oppAv/oppName이 idle 색을 가리키므로 그대로 복사
  const oppAvEl   = document.getElementById('oppAv');
  const oppNameEl = document.getElementById('oppName');
  const oppMetaEl = document.getElementById('oppMeta');
  const sheetAv   = document.getElementById('oppSheetAv');
  const sheetName = document.getElementById('oppSheetName');
  const sheetMeta = document.getElementById('oppSheetMeta');
  if(sheetAv){
    sheetAv.textContent = oppAvEl ? oppAvEl.textContent : 'B';
    sheetAv.className   = (oppAvEl ? oppAvEl.className : 'av b');
  }
  if(sheetName) sheetName.textContent = oppNameEl ? oppNameEl.textContent : '상대';
  if(sheetMeta) sheetMeta.textContent = oppMetaEl ? oppMetaEl.textContent : '—';

  // 체크 통계 — 현재 시점 oppCheckStats와 동일 데이터를 시트에 렌더
  // (oppCheckStats는 모바일에서 숨긴 상태이지만 데이터는 갱신되고 있음)
  // renderCheckStats는 색을 받아서 그 색의 "가한" 통계를 보여주므로 idle/opp 색을 파악
  let oppColor;
  const SMALL_SCREEN = window.innerWidth <= 600;
  if(IS_LOCAL && SMALL_SCREEN){
    oppColor = opp(turn);  // idle = 상대
  } else if(IS_LOCAL){
    oppColor = 'b';
  } else {
    oppColor = opp(MY_COLOR);
  }
  renderCheckStats('oppSheetStats', oppColor);
}

// ===================================================================
// 20. 초기화
// ===================================================================
// ===================================================================
// 17. 리플레이 모드
// ===================================================================
let _replayData = null;
let _replayMeta = null;
let _replayCurrentTurn = 0;

function initReplay(){
  if(!REPLAY_ID){
    alert('리플레이 ID가 없습니다.');
    location.href = 'replays.html';
    return;
  }
  // 메타데이터 로드
  let metaList = [];
  try { metaList = JSON.parse(localStorage.getItem('frontier_replay_index') || '[]'); } catch(e){}
  _replayMeta = metaList.find(m => m.id === REPLAY_ID);
  if(!_replayMeta){
    alert('리플레이를 찾을 수 없습니다.');
    location.href = 'replays.html';
    return;
  }
  // 액션 데이터 로드
  let full = null;
  try { full = JSON.parse(localStorage.getItem('frontier_replay_' + REPLAY_ID)); } catch(e){}
  if(!full || !full.actions){
    alert('리플레이 데이터가 손상되었습니다.');
    location.href = 'replays.html';
    return;
  }
  _replayData = full;

  // === 시점 설정: 저장된 myColor 기준, 없으면 백 ===
  // MY_COLOR는 let이라 변경 가능. flipped() 함수가 이걸 사용함.
  MY_COLOR = _replayMeta.myColor || 'w';

  // 상태 초기화 (저장된 hand 기준)
  const savedHand = parseHandStr(_replayMeta.handStr || '');
  hands = { w: {...savedHand}, b: {...savedHand} };
  board = makeEmptyBoard();
  turn = 'w';
  kingPlaced = { w:false, b:false };
  lastMove = null;
  moveHistory = [];
  checkStreak = { w:0, b:0 };
  totalChecks = { w:0, b:0 };
  minsim = { w:0, b:0 };   // 농민 봉기: 민심 게이지 초기화
  gold = { w:0, b:0 };     // 타이쿤: 골드 초기화
  snUpgraded = { w:false, b:false };
  tycoonTurn = { w:0, b:0 };
  gameOver = false;

  document.body.classList.add('replay-mode');

  // UI 헤더 — 시점에 따라 내/상대 패널 라벨 결정
  const wp = _replayMeta.players?.w || {};
  const bp = _replayMeta.players?.b || {};
  const myP = MY_COLOR === 'w' ? wp : bp;
  const oppP = MY_COLOR === 'w' ? bp : wp;
  document.getElementById('myName').textContent = myP.nick || (MY_COLOR === 'w' ? '백' : '흑');
  document.getElementById('myAv').textContent = MY_COLOR === 'w' ? 'W' : 'B';
  document.getElementById('myAv').className = 'av' + (MY_COLOR === 'b' ? ' b' : '');
  document.getElementById('myMeta').textContent = myP.elo ? `${MY_COLOR==='w'?'백':'흑'} · ELO ${myP.elo}` : (MY_COLOR==='w'?'백':'흑');
  document.getElementById('oppName').textContent = oppP.nick || (MY_COLOR === 'w' ? '흑' : '백');
  document.getElementById('oppAv').textContent = MY_COLOR === 'w' ? 'B' : 'W';
  document.getElementById('oppAv').className = 'av' + (MY_COLOR === 'w' ? ' b' : '');
  document.getElementById('oppMeta').textContent = oppP.elo ? `${MY_COLOR==='w'?'흑':'백'} · ELO ${oppP.elo}` : (MY_COLOR==='w'?'흑':'백');

  const modeLbl = ({local:'로컬', ai:`AI(${_replayMeta.aiDifficulty||'?'})`, online:'온라인'})[_replayMeta.mode] || _replayMeta.mode;
  document.getElementById('modeLbl').textContent = `📺 리플레이 — ${modeLbl}`;

  // 결과 표시
  const winnerStr = _replayMeta.winner === 'w' ? '백 승' : _replayMeta.winner === 'b' ? '흑 승' : '무승부';
  const resultText = _replayMeta.endTitle ? `${_replayMeta.endTitle} (${winnerStr})` : winnerStr;

  // 리플레이 컨트롤 표시
  const bar = document.getElementById('replayBar');
  bar.style.display = '';
  document.getElementById('replayMetaTitle').textContent = `${wp.nick || '백'} vs ${bp.nick || '흑'}`;
  document.getElementById('replayMetaResult').textContent = resultText;

  const total = _replayData.actions.length;
  document.getElementById('replayTurnTotal').textContent = total;
  document.getElementById('replayProgress').max = total;
  document.getElementById('replayJumpInput').max = total;

  // 슬라이더 입력
  document.getElementById('replayProgress').addEventListener('input', e => {
    replayGoTo(parseInt(e.target.value));
  });

  // 키보드 단축키
  window.addEventListener('keydown', e => {
    if(e.target.tagName === 'INPUT') return;
    if(e.key === 'ArrowLeft'){ e.preventDefault(); replayPrev(); }
    else if(e.key === 'ArrowRight'){ e.preventDefault(); replayNext(); }
    else if(e.key === 'Home'){ e.preventDefault(); replayJumpStart(); }
    else if(e.key === 'End'){ e.preventDefault(); replayJumpEnd(); }
  });

  // 수순 리스트
  buildReplayList();
  // 캡쳐 마커 렌더 (시점 기준 초/빨)
  buildReplayCaptureMarks();

  // 첫 렌더
  renderAll();
  updateReplayUI();
}

// 시점 전환 (로컬 리플레이 등에서 양쪽 시점 둘러보기 용)
window.replayFlip = function(){
  MY_COLOR = MY_COLOR === 'w' ? 'b' : 'w';
  // 패널 라벨 다시 적용
  const wp = _replayMeta.players?.w || {};
  const bp = _replayMeta.players?.b || {};
  const myP = MY_COLOR === 'w' ? wp : bp;
  const oppP = MY_COLOR === 'w' ? bp : wp;
  document.getElementById('myName').textContent = myP.nick || (MY_COLOR === 'w' ? '백' : '흑');
  document.getElementById('myAv').textContent = MY_COLOR === 'w' ? 'W' : 'B';
  document.getElementById('myAv').className = 'av' + (MY_COLOR === 'b' ? ' b' : '');
  document.getElementById('myMeta').textContent = myP.elo ? `${MY_COLOR==='w'?'백':'흑'} · ELO ${myP.elo}` : (MY_COLOR==='w'?'백':'흑');
  document.getElementById('oppName').textContent = oppP.nick || (MY_COLOR === 'w' ? '흑' : '백');
  document.getElementById('oppAv').textContent = MY_COLOR === 'w' ? 'B' : 'W';
  document.getElementById('oppAv').className = 'av' + (MY_COLOR === 'w' ? ' b' : '');
  document.getElementById('oppMeta').textContent = oppP.elo ? `${MY_COLOR==='w'?'흑':'백'} · ELO ${oppP.elo}` : (MY_COLOR==='w'?'흑':'백');
  // 마커 다시 그리기 (시점에 따라 색 바뀜)
  buildReplayCaptureMarks();
  renderAll();
};

function buildReplayCaptureMarks(){
  const marksEl = document.getElementById('replayMarks');
  if(!marksEl || !_replayData) return;
  const total = _replayData.actions.length;
  if(total === 0){ marksEl.innerHTML = ''; return; }

  const myColor = MY_COLOR;
  const FILES = 'abcdefgh';
  const RANKS = '87654321';

  const marks = [];
  _replayData.actions.forEach((meta, i) => {
    const turnIdx = i + 1;
    const action = meta.action;
    const leftPct = (turnIdx / total) * 100;
    const captorColor = action.color || (i % 2 === 0 ? 'w' : 'b');
    const posStr = action.type === 'move'
      ? `${FILES[action.tc]}${RANKS[action.tr]}`
      : `${FILES[action.c]}${RANKS[action.r]}`;

    // 캡쳐 마커 (초록/빨강)
    if(meta.captured){
      const isMyCapture = captorColor === myColor;
      const cls = isMyCapture ? 'capture' : 'captured';
      const capturedSym = SYMBOLS[meta.captured.color]?.[meta.captured.kind] || '?';
      const label = (isMyCapture ? '획득' : '손실') + ` ${capturedSym} ${posStr}`;
      marks.push(`<div class="replay-mark ${cls}" style="left:${leftPct}%" data-turn="${turnIdx}" onclick="replayGoTo(${turnIdx})">
        <span class="replay-mark-tooltip">${turnIdx}수 · ${label}</span>
      </div>`);
    }
    // 프로모션 마커 (파랑)
    if(action.type === 'move' && action.promote){
      const promoSym = SYMBOLS[captorColor]?.[action.promote] || '?';
      marks.push(`<div class="replay-mark promote" style="left:${leftPct}%" data-turn="${turnIdx}" onclick="replayGoTo(${turnIdx})">
        <span class="replay-mark-tooltip">${turnIdx}수 · 프로모션 → ${promoSym} ${posStr}</span>
      </div>`);
    }
    // 배치 마커 (주황)
    if(action.type === 'place'){
      const placeSym = SYMBOLS[captorColor]?.[action.kind] || '?';
      marks.push(`<div class="replay-mark place" style="left:${leftPct}%" data-turn="${turnIdx}" onclick="replayGoTo(${turnIdx})">
        <span class="replay-mark-tooltip">${turnIdx}수 · 배치 ${placeSym} ${posStr}</span>
      </div>`);
    }
  });
  marksEl.innerHTML = marks.join('');
}

function replayResetState(){
  const savedHand = parseHandStr(_replayMeta.handStr || '');
  hands = { w: {...savedHand}, b: {...savedHand} };
  board = makeEmptyBoard();
  turn = 'w';
  kingPlaced = { w:false, b:false };
  lastMove = null;
  moveHistory = [];
  checkStreak = { w:0, b:0 };
  totalChecks = { w:0, b:0 };
  minsim = { w:0, b:0 };   // 농민 봉기: 민심 게이지 초기화
  gold = { w:0, b:0 };     // 타이쿤: 골드 초기화
  snUpgraded = { w:false, b:false };
  tycoonTurn = { w:0, b:0 };
  gameOver = false;
}

function replayApplyTo(toIndex){
  // 0 = 시작 상태 (액션 0개 적용)
  // N = N개 액션 적용
  toIndex = Math.max(0, Math.min(toIndex, _replayData.actions.length));
  replayResetState();
  for(let i=0; i<toIndex; i++){
    const a = _replayData.actions[i].action;
    applyAction(a, {silent: true});
  }
  // 마지막 액션의 하이라이트 복원
  if(toIndex > 0){
    const lastA = _replayData.actions[toIndex-1].action;
    if(lastA.type === 'place'){
      lastMove = { fr:-1, fc:-1, tr:lastA.r, tc:lastA.c, type:'place' };
    } else if(lastA.type === 'move'){
      lastMove = { fr:lastA.fr, fc:lastA.fc, tr:lastA.tr, tc:lastA.tc, type:'move' };
    }
  } else {
    lastMove = null;
  }
  _replayCurrentTurn = toIndex;
}

function replayGoTo(idx){
  replayApplyTo(idx);
  renderAll();
  updateReplayUI();
}

window.replayNext = function(){
  if(_replayCurrentTurn < _replayData.actions.length) replayGoTo(_replayCurrentTurn + 1);
};
window.replayPrev = function(){
  if(_replayCurrentTurn > 0) replayGoTo(_replayCurrentTurn - 1);
};
window.replayJumpStart = function(){ replayGoTo(0); };
window.replayJumpEnd = function(){ replayGoTo(_replayData.actions.length); };
window.replayJumpInput = function(){
  const v = parseInt(document.getElementById('replayJumpInput').value);
  if(isNaN(v)) return;
  replayGoTo(v);
};
window.replayToggleList = function(){
  const list = document.getElementById('replayList');
  list.style.display = list.style.display === 'none' ? '' : 'none';
};

function describeAction(meta, idx){
  // meta: {action, captured, moveType, retreat}
  const a = meta.action;
  // 색 추정: action.color 없으면 인덱스 패리티 (구버전 리플레이 호환)
  const aColor = a.color || (idx % 2 === 0 ? 'w' : 'b');
  const colorName = aColor === 'w' ? '백' : '흑';
  const colorClass = aColor === 'w' ? 'w' : 'b';
  const FILES = 'abcdefgh';
  const RANKS = '87654321';
  function pos(r,c){ return FILES[c] + RANKS[r]; }
  let text = '';
  if(a.type === 'place'){
    const piece = SYMBOLS[aColor][a.kind] || a.kind;
    const pname = PIECE_NAMES[a.kind] || a.kind;
    text = `${piece} ${pname} 배치 ${pos(a.r,a.c)}`;
  } else if(a.type === 'move'){
    const from = pos(a.fr, a.fc);
    const to = pos(a.tr, a.tc);
    if(meta.moveType === 'snipe'){
      text = `⊕ 저격 ${from}→${to}`;
      if(meta.retreat) text += ' (3회 완료, 후퇴)';
    } else if(meta.moveType === 'push'){
      text = `⬢ 밀기 ${from}→${to}`;
    } else {
      text = `이동 ${from}→${to}`;
    }
  }
  return { text, colorName, colorClass, captured: meta.captured };
}

function buildReplayList(){
  const list = document.getElementById('replayList');
  if(!_replayData?.actions?.length){ list.innerHTML = '<div style="padding:8px;color:var(--muted)">기록 없음</div>'; return; }
  list.innerHTML = _replayData.actions.map((meta, i) => {
    const d = describeAction(meta, i);
    const capHtml = d.captured ? `<span class="turn-cap">×${SYMBOLS[d.captured.color]?.[d.captured.kind] || '?'}</span>` : '';
    return `<div class="replay-list-item" data-idx="${i+1}" onclick="replayGoTo(${i+1})">
      <span class="turn-num">${i+1}.</span>
      <span class="turn-color ${d.colorClass}">●</span>
      <span class="turn-text">${d.text}</span>
      ${capHtml}
    </div>`;
  }).join('');
}

function updateReplayUI(){
  document.getElementById('replayTurnNow').textContent = _replayCurrentTurn;
  document.getElementById('replayProgress').value = _replayCurrentTurn;
  document.getElementById('replayJumpInput').value = _replayCurrentTurn;

  // 현재 수 설명
  const curEl = document.getElementById('replayCurrent');
  if(_replayCurrentTurn === 0){
    curEl.textContent = '— 시작 —';
    curEl.classList.remove('has-capture');
    curEl.classList.remove('is-loss');
  } else {
    const meta = _replayData.actions[_replayCurrentTurn - 1];
    const d = describeAction(meta, _replayCurrentTurn - 1);
    let html = `<span class="turn-color ${d.colorClass}" style="display:inline-block">●</span> <b>${d.colorName}</b>: ${d.text}`;
    if(d.captured){
      const capSym = SYMBOLS[d.captured.color]?.[d.captured.kind] || '?';
      // 시점 기준: 캡쳐자가 나면 "획득" 초록, 아니면 "손실" 빨강
      const captorColor = meta.action.color || ((_replayCurrentTurn - 1) % 2 === 0 ? 'w' : 'b');
      const isMyCapture = captorColor === MY_COLOR;
      const label = isMyCapture ? '획득' : '손실';
      const colorVar = isMyCapture ? 'var(--green)' : 'var(--red)';
      html += ` <span class="cap-mark" style="color:${colorVar};font-weight:700;margin-left:6px">${label}: <span class="pc-sym">${capSym}</span></span>`;
      curEl.classList.add('has-capture');
      if(isMyCapture){ curEl.classList.remove('is-loss'); }
      else { curEl.classList.add('is-loss'); }
    } else {
      curEl.classList.remove('has-capture');
      curEl.classList.remove('is-loss');
    }
    curEl.innerHTML = html;
  }

  // 리스트 항목 하이라이트
  document.querySelectorAll('.replay-list-item').forEach(el => {
    if(parseInt(el.dataset.idx) === _replayCurrentTurn) el.classList.add('current');
    else el.classList.remove('current');
  });

  // thumb 근처 마름모는 투명도 낮춰서 thumb이 보이도록
  // 정확히 같은 턴 = 가장 흐림(at-thumb), 1턴 차이 = 살짝 흐림(near-thumb)
  document.querySelectorAll('.replay-mark').forEach(el => {
    const t = parseInt(el.dataset.turn);
    el.classList.remove('at-thumb','near-thumb');
    if(!isFinite(t)) return;
    const diff = Math.abs(t - _replayCurrentTurn);
    if(diff === 0) el.classList.add('at-thumb');
    else if(diff === 1) el.classList.add('near-thumb');
  });
}

// 칭호 prefix가 textContent 갱신으로 사라지지 않도록 감시
function setupTitleObserver(elementId, titleName, titleColor){
  const el = document.getElementById(elementId);
  if(!el) return;
  const ensureTitle = () => {
    if(el.querySelector('.nick-title')) return;
    const span = document.createElement('span');
    span.className = 'nick-title';
    span.style.cssText = `color:${titleColor};font-weight:800;margin-right:4px;font-size:.85em;text-shadow:0 0 4px currentColor`;
    span.textContent = titleName;
    el.insertBefore(span, el.firstChild);
  };
  const observer = new MutationObserver(ensureTitle);
  observer.observe(el, { childList:true, subtree:false });
}

function init(){
  // 리플레이 모드: 별도 init
  if(IS_REPLAY){
    initReplay();
    return;
  }
  // 새로고침 감지 — P2P 게임 도중 새로고침 시 자동으로 로비로
  // (PeerJS conn 끊기고 게임 상태 망가지니 재개 불가능)
  if(IS_NET && !IS_SPEC){
    try {
      const prev = sessionStorage.getItem('frontier_active_game');
      if(prev){
        const info = JSON.parse(prev);
        if(info && info.room === ROOM_CODE){
          // 같은 방 재진입 = 새로고침
          sessionStorage.removeItem('frontier_active_game');
          alert('게임이 새로고침으로 중단되었습니다.\n상대에게는 자동 승리 처리됩니다.\n로비로 돌아갑니다.');
          goLobby();
          return;
        }
        sessionStorage.removeItem('frontier_active_game');
      }
      // 정상 진입 — 마커 등록 (다음 새로고침 감지용)
      sessionStorage.setItem('frontier_active_game', JSON.stringify({room: ROOM_CODE, role: NET_ROLE, ts: Date.now()}));
    } catch(_){}
  }

  // UI 초기 정보
  const myTagHtml = MY_TAG_P ? `<span class="ingame-tag">#${MY_TAG_P}</span>` : '';
  const myEloTxt = IS_NET ? ` (${MY_ELO_P})` : '';
  const myTitleHtml = (MY_TITLE_NAME && !IS_LOCAL) 
    ? `<span class="nick-title" style="color:${MY_TITLE_COLOR};font-weight:800;margin-right:4px;font-size:.85em;text-shadow:0 0 4px currentColor">${escapeHtml(MY_TITLE_NAME)}</span>`
    : '';
  document.getElementById('myName').innerHTML = myTitleHtml + escapeHtml(MY_NICK_P) + myTagHtml + myEloTxt;
  document.getElementById('myAv').textContent = (MY_COLOR === 'w' ? 'W' : 'B');
  document.getElementById('myAv').className = 'av' + (MY_COLOR==='b'?' b':'');
  document.getElementById('myMeta').textContent = MY_COLOR === 'w' ? '백' : '흑';
  
  // 칭호 prefix가 textContent 갱신으로 사라지는 것 방지 (MutationObserver)
  if(MY_TITLE_NAME && !IS_LOCAL){
    setupTitleObserver('myName', MY_TITLE_NAME, MY_TITLE_COLOR);
  }

  if(IS_AI){
    document.getElementById('oppName').textContent = `AI (${DIFF==='easy'?'쉬움':DIFF==='hard'?'어려움':'보통'})`;
    document.getElementById('oppMeta').textContent = '흑';
    document.getElementById('modeLbl').textContent = 'AI 대전';
    // 타이머 사진: 백=본인 사진, 흑=AI 아이콘
    setTimerPhoto('w', MY_PHOTO_URL, MY_NICK_P);
    setTimerPhoto('b', '', 'AI');
  } else if(IS_LOCAL){
    // 로컬 대전: 백/흑 둘 다 본인 사진
    setTimerPhoto('w', MY_PHOTO_URL, '백');
    setTimerPhoto('b', MY_PHOTO_URL, '흑');
  } else if(IS_AIVAI){
    const wLbl = W_DIFF==='easy'?'쉬움':W_DIFF==='hard'?'어려움':'보통';
    const bLbl = B_DIFF==='easy'?'쉬움':B_DIFF==='hard'?'어려움':'보통';
    document.getElementById('myName').textContent = `백 AI (${wLbl})`;
    document.getElementById('myMeta').textContent = '백';
    document.getElementById('oppName').textContent = `흑 AI (${bLbl})`;
    document.getElementById('oppMeta').textContent = '흑';
    document.getElementById('modeLbl').textContent = '🤖 AI vs AI';
    document.getElementById('forfeitBtn').style.display = 'none';
  } else if(IS_LOCAL){
    document.getElementById('oppName').textContent = '플레이어 2';
    document.getElementById('oppMeta').textContent = '흑';
    document.getElementById('modeLbl').textContent = '로컬 2인';
  } else if(NET_ROLE === 'host'){
    document.getElementById('oppName').textContent = '게스트 대기 중...';
    document.getElementById('oppMeta').textContent = '흑';
    document.getElementById('modeLbl').textContent = `방 ${ROOM_CODE} (호스트)`;
  } else if(NET_ROLE === 'guest'){
    document.getElementById('oppName').textContent = '호스트 연결 중...';
    document.getElementById('oppMeta').textContent = '백';
    document.getElementById('modeLbl').textContent = `방 ${ROOM_CODE} (게스트)`;
  } else if(IS_SPEC){
    document.getElementById('myName').textContent = '백';
    document.getElementById('oppName').textContent = '흑';
    document.getElementById('modeLbl').textContent = `방 ${ROOM_CODE} (관전)`;
    document.getElementById('forfeitBtn').style.display = 'none';
  }

  if(IS_LOCAL || IS_AI || IS_AIVAI){
    if(TIME_LIMIT > 0) startTimerIfNeeded();
  }

  // 물약 모드 초기화 + 진단
  console.log('[POTION] IS_POTION:', IS_POTION, 'URL params:', location.search);
  if(IS_POTION){
    initPotionMode();
    setTimeout(() => showFlash('🧪 물약 모드 ON', 2000), 600);
  }
  if(IS_TYCOON){
    initTycoonMode();
    setTimeout(() => showFlash('💰 타이쿤 모드 ON — 매 턴 +5G, 50G 선점 시 승리', 2600), 600);
  }

  netInit();
  renderAll();

  // AI vs AI: 백부터 자동 시작
  if(IS_AIVAI && !gameOver){
    setTimeout(()=> aiTurn(), 800);
  }
}
init();

