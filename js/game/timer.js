// ===================================================================
// timer.js — Fischer 증분 타이머 + Alt+Tab/모바일 백그라운드 보호
// 의존: game core (gameOver, turn, MY_COLOR, TIME_LIMIT, TIME_INC, IS_LOCAL, opp(), endGame())
// 노출: _wTimeLeft, _bTimeLeft, _turnStartTime, _timerInterval
//      window.startTimerIfNeeded, updateTimer, commitMoveTime
//      window._pauseTimerForBlur, _resumeTimerForBlur
// ===================================================================
// 각 플레이어는 TIME_LIMIT 만큼의 총 시간을 갖고, 자기 차례에만 차감됨.
// 한 수 완료 시 그 수를 둔 플레이어에게 TIME_INC 만큼 추가.

var _turnStartTime = 0;     // 현재 턴 시작 시각
var _timerInterval = null;
var _wTimeLeft = 0;         // 백의 남은 총 시간 (초)
var _bTimeLeft = 0;         // 흑의 남은 총 시간 (초)

// 모바일/데스크탑: 백그라운드 진입 시 타이머 정지 + 사용시간 정확히 차감
window._pauseTimerForBlur = function _pauseTimerForBlur(){
  if(typeof TIME_LIMIT === 'undefined' || TIME_LIMIT <= 0) return;
  if(typeof gameOver !== 'undefined' && gameOver) return;
  if(_timerInterval){
    clearInterval(_timerInterval);
    _timerInterval = null;
    // pause 직전까지의 elapsed를 _wTimeLeft/_bTimeLeft에 반영
    // (이게 없으면 복귀 시 _turnStartTime이 reset되어 사용한 시간이 사라짐)
    const elapsedNow = (Date.now() - _turnStartTime) / 1000;
    if(turn === 'w') _wTimeLeft = Math.max(0, _wTimeLeft - elapsedNow);
    else _bTimeLeft = Math.max(0, _bTimeLeft - elapsedNow);
    _turnStartTime = Date.now(); // pause 동안 0부터 시작
  }
};

window._resumeTimerForBlur = function _resumeTimerForBlur(){
  if(typeof TIME_LIMIT === 'undefined' || TIME_LIMIT <= 0) return;
  if(typeof gameOver !== 'undefined' && gameOver) return;
  if(!_timerInterval){
    _turnStartTime = Date.now();
    _timerInterval = setInterval(updateTimer, 100);
  }
};

document.addEventListener('visibilitychange', () => {
  if(document.hidden) _pauseTimerForBlur();
  else _resumeTimerForBlur();
});
window.addEventListener('blur', _pauseTimerForBlur);
window.addEventListener('focus', _resumeTimerForBlur);

window.startTimerIfNeeded = function startTimerIfNeeded(){
  if(TIME_LIMIT <= 0) return;
  document.getElementById('myTimer').style.display = '';
  document.getElementById('oppTimer').style.display = '';
  document.getElementById('topbarTimer').style.display = '';
  _wTimeLeft = TIME_LIMIT;
  _bTimeLeft = TIME_LIMIT;
  _turnStartTime = Date.now();
  if(_timerInterval) clearInterval(_timerInterval);
  _timerInterval = setInterval(updateTimer, 100);
  updateTimer();
};

window.updateTimer = function updateTimer(){
  if(gameOver){ clearInterval(_timerInterval); return; }
  if(TIME_LIMIT <= 0) return;
  // 현재 차례인 플레이어의 누적 경과 (이번 턴)
  const elapsedNow = (Date.now() - _turnStartTime) / 1000;
  const wDisp = turn === 'w' ? Math.max(0, _wTimeLeft - elapsedNow) : _wTimeLeft;
  const bDisp = turn === 'b' ? Math.max(0, _bTimeLeft - elapsedNow) : _bTimeLeft;

  const fmt = s => {
    if(s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return (m<10?'0':'') + m + ':' + (sec<10?'0':'') + sec.toFixed(1);
  };

  // 토픽바 듀얼 타이머
  const ttw = document.getElementById('ttwTime'), ttb = document.getElementById('ttbTime');
  const ttWBox = document.getElementById('ttWhite'), ttBBox = document.getElementById('ttBlack');
  if(ttw) ttw.textContent = fmt(wDisp);
  if(ttb) ttb.textContent = fmt(bDisp);
  if(ttWBox){
    ttWBox.classList.toggle('active', turn === 'w');
    ttWBox.classList.toggle('warn', turn === 'w' && wDisp < 10);
  }
  if(ttBBox){
    ttBBox.classList.toggle('active', turn === 'b');
    ttBBox.classList.toggle('warn', turn === 'b' && bDisp < 10);
  }

  // 사이드 패널 타이머
  if(IS_LOCAL){
    const t = document.getElementById( turn==='w'?'myTimer':'oppTimer' );
    const o = document.getElementById( turn==='w'?'oppTimer':'myTimer' );
    if(t){ t.textContent = fmt(turn==='w'?wDisp:bDisp); t.classList.toggle('warn',(turn==='w'?wDisp:bDisp)<10); }
    if(o){ o.textContent = fmt(turn==='w'?bDisp:wDisp); o.classList.remove('warn'); }
  } else {
    const myDisp = MY_COLOR === 'w' ? wDisp : bDisp;
    const opDisp = MY_COLOR === 'w' ? bDisp : wDisp;
    const myT = document.getElementById('myTimer');
    const opT = document.getElementById('oppTimer');
    if(myT){ myT.textContent = fmt(myDisp); myT.classList.toggle('warn', turn===MY_COLOR && myDisp < 10); }
    if(opT){ opT.textContent = fmt(opDisp); opT.classList.toggle('warn', turn!==MY_COLOR && opDisp < 10); }
  }

  // 시간 초과 검사
  const activeDisp = turn === 'w' ? wDisp : bDisp;
  if(activeDisp <= 0){
    clearInterval(_timerInterval);
    const loser = turn;
    endGame('⏱','시간 초과', `${loser==='w'?'백':'흑'}의 시간이 초과되었습니다.`, opp(loser));
  }
};

// 한 수 완료 시 호출 — 그 수를 둔 플레이어의 경과 시간 차감 + 증분 추가
window.commitMoveTime = function commitMoveTime(){
  if(TIME_LIMIT <= 0) return;
  // 누가 방금 수를 뒀는가? (turn은 이미 바뀐 상태) → opp(turn)
  const moved = opp(turn);
  const elapsed = (Date.now() - _turnStartTime) / 1000;
  if(moved === 'w'){
    _wTimeLeft = Math.max(0, _wTimeLeft - elapsed + TIME_INC);
  } else {
    _bTimeLeft = Math.max(0, _bTimeLeft - elapsed + TIME_INC);
  }
  _turnStartTime = Date.now();
};
