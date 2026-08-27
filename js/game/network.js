// ===================================================================
// network.js — PeerJS 연결, HELLO 송수신, heartbeat, 끊김 grace, 메시지 publish
// 의존: utils (showFlash), firebase (_fbDb, fbInit),
//      게임 상수 (IS_NET, IS_SPEC, NET_ROLE, ROOM_CODE, MY_COLOR, gameOver, INIT_HAND,
//                MY_UID, MY_NICK_P, MY_ELO_P, MY_TAG_P, MY_TITLE_NAME, MY_TITLE_COLOR,
//                MY_PHOTO_URL, hands, board, turn, kingPlaced, blockedCells,
//                _checkCounters, totalCheckCount, myInventory, oppInventoryCount,
//                _gameRatingInfo, _opponentUid (chat.js))
//      외부: onPeerMessage (main FRONTIER.html에 정의, setupConn에서 호출),
//           endGame, cleanupRoom, goLobby, getElementById...
// 노출: _peer, _peerConn, _specWatcher, _heartbeatInterval, _lastPongTime,
//      _connCloseTimer, _hostDisconnected,
//      window.netInit, initHost, initGuest, tryConnect, setupConn, sendToPeer,
//      publishGameState, startHeartbeat, triggerDisconnect
// ===================================================================

let _peer = null;
let _peerConn = null;
let _specWatcher = null;

window.netInit = function netInit(){
  if(!IS_NET && !IS_SPEC) return;
  fbInit();

  if(IS_SPEC){
    initSpectator();
    return;
  }

  myRoomCode = ROOM_CODE; // 이탈 시 방 정리

  if(NET_ROLE === 'host'){
    initHost();
  } else if(NET_ROLE === 'guest'){
    initGuest();
  }
}

window.initHost = function initHost(){
  document.getElementById('connectModal').classList.add('show');
  document.getElementById('connectMsg').textContent = '게스트 입장을 기다립니다...';
  // 유령방 방지: 호스트 연결이 끊기면 Firebase가 자동으로 방 제거
  if(_fbDb && ROOM_CODE){
    try {
      _fbDb.ref('rooms/'+ROOM_CODE).onDisconnect().remove();
    } catch(e){ console.warn('onDisconnect 등록 실패', e); }
  }
  // PeerID = ROOM_CODE
  _peer = new Peer(ROOM_CODE, {
    host: 'frontier-peerjs.onrender.com',
    port: 443,
    path: '/peerjs',
    secure: true,
    config:{ 'iceServers':[ {urls:'stun:stun.l.google.com:19302'}, {urls:'stun:stun1.l.google.com:19302'} ]}
  });
  _peer.on('open', id => {
    console.log('Host PeerID:', id);
  });
  _peer.on('connection', conn => {
    _peerConn = conn;
    setupConn(conn);
  });
  _peer.on('error', e => {
    console.error('Peer error', e);
    showFlash('연결 오류: ' + e.type);
  });
}

window.initGuest = function initGuest(){
  document.getElementById('connectModal').classList.add('show');
  document.getElementById('connectMsg').textContent = '호스트와 연결을 시도합니다...';
  _peer = new Peer({
    host: 'frontier-peerjs.onrender.com',
    port: 443,
    path: '/peerjs',
    secure: true,
    config:{ 'iceServers':[ {urls:'stun:stun.l.google.com:19302'}, {urls:'stun:stun1.l.google.com:19302'} ]}
  });
  _peer.on('open', id => {
    tryConnect(0);
  });
  _peer.on('error', e => console.error('Peer error', e));
}

// 시그널링 서버(Render 무료 티어)가 유휴 상태면 깨는 데 30초 이상 걸린다.
// 예전엔 1.5초 x 6회 = 9초 만에 포기해서 콜드스타트를 못 넘겼다.
const CONNECT_ATTEMPTS = 14;
window.tryConnect = function tryConnect(attempt){
  if(attempt >= CONNECT_ATTEMPTS){
    document.getElementById('connectMsg').textContent =
      '연결 실패. 호스트가 없거나 방이 닫혔습니다. (새로고침해서 다시 시도해 보세요)';
    return;
  }
  const msgEl = document.getElementById('connectMsg');
  if(msgEl && attempt > 2){
    msgEl.textContent = `서버를 깨우는 중… (${attempt}/${CONNECT_ATTEMPTS})`;
  }
  const conn = _peer.connect(ROOM_CODE, { reliable:true });
  let opened = false;
  conn.on('open', () => {
    opened = true;
    _peerConn = conn;
    setupConn(conn);
  });
  // 초반은 촘촘히, 뒤로 갈수록 간격을 늘려 총 45초 정도 버틴다
  const wait = attempt < 4 ? 1500 : 4000;
  setTimeout(() => {
    if(!opened) tryConnect(attempt+1);
  }, wait);
}

let _connCloseTimer = null;
let _hostDisconnected = false;
let _lastPongTime = 0;
let _heartbeatInterval = null;

window.startHeartbeat = function startHeartbeat(){
  if(_heartbeatInterval) clearInterval(_heartbeatInterval);
  _lastPongTime = Date.now();
  _heartbeatInterval = setInterval(() => {
    if(gameOver){ clearInterval(_heartbeatInterval); return; }
    // ping 보냄
    try { sendToPeer({ t:'PING', ts: Date.now() }); } catch(_){}
    // 무응답 판정. 12초는 모바일에서 오탐이 잦아 20초로 늘렸다
    // (양쪽이 동시에 상대가 끊겼다고 판단하면 둘 다 자기 승리로 처리해 버린다)
    const elapsed = Date.now() - _lastPongTime;
    if(elapsed > 20000 && !_connCloseTimer && !_hostDisconnected){
      console.warn('[heartbeat] 20초간 응답 없음 — 연결 끊김 처리');
      triggerDisconnect();
    }
  }, 3000); // 3초마다 ping (이전 5초)
}

window.triggerDisconnect = function triggerDisconnect(){
  if(gameOver || IS_SPEC) return;
  _hostDisconnected = true;
  showFlash('상대 연결 끊김 — 자동 승리 처리');
  setTimeout(() => {
    if(!gameOver){
      endGame('🔌','상대 연결 끊김', '상대 응답 없음 — 자동 승리합니다.', MY_COLOR, NET_ROLE === 'guest');
    }
  }, 300);
}
window.setupConn = function setupConn(conn){
  console.log('[net] setupConn 호출 — role:', NET_ROLE);
  conn.on('data', data => {
    // 정상 메시지 받음 → 끊김 grace 취소 + pong 시간 갱신
    _lastPongTime = Date.now();
    if(_connCloseTimer){ clearTimeout(_connCloseTimer); _connCloseTimer = null; }
    onPeerMessage(data);
  });
  conn.on('close', () => {
    if(_connCloseTimer || _hostDisconnected) return; // 이미 처리 중
    if(!gameOver && !IS_SPEC){
      showFlash('연결 끊김 — 10초 대기 중');
      _hostDisconnected = true;
      _connCloseTimer = setTimeout(() => {
        if(!gameOver){
          endGame('🔌','상대 연결 끊김', '상대 연결이 끊겨 자동 승리합니다.', MY_COLOR, NET_ROLE === 'guest');
        }
      }, 10000);
    } else if(!gameOver && IS_SPEC){
      showFlash('호스트 연결이 끊겼습니다');
    }
  });
  conn.on('error', e => {
    console.error('[net] Conn error',e);
    if(gameOver || IS_SPEC) return;
    if(!_connCloseTimer && !_hostDisconnected){
      _hostDisconnected = true;
      showFlash('연결 오류 — 자동 승리 처리');
      setTimeout(() => {
        if(!gameOver){
          endGame('🔌','상대 연결 오류', '연결 오류로 자동 승리합니다.', MY_COLOR, NET_ROLE === 'guest');
        }
      }, 300);
    }
  });

  // 연결 완료 → 인사
  document.getElementById('connectModal').classList.remove('show');
  document.getElementById('chatFab').style.display = '';
  document.getElementById('forfeitBtn').style.display = '';

  // 인사 교환 — conn이 완전히 open된 후 보내야 (PeerJS race condition 방지)
  const sendHello = () => {
    if(NET_ROLE === 'host'){
      const payload = {
        t:'HELLO',
        hostNick: MY_NICK_P, hostElo: MY_ELO_P, hostUid: MY_UID, hostTag: MY_TAG_P,
        hostTitle: MY_TITLE_NAME || '', hostTitleColor: MY_TITLE_COLOR || '',
        hostPhoto: MY_PHOTO_URL || '',
        hand: INIT_HAND,
        rulesVersion: RULES_VERSION
      };
      console.log('[net] HELLO 송신 (host):', payload);
      sendToPeer(payload);
    } else {
      const payload = {
        t:'HELLO',
        guestNick: MY_NICK_P, guestElo: MY_ELO_P, guestUid: MY_UID, guestTag: MY_TAG_P,
        guestTitle: MY_TITLE_NAME || '', guestTitleColor: MY_TITLE_COLOR || '',
        guestPhoto: MY_PHOTO_URL || '',
        rulesVersion: RULES_VERSION
      };
      console.log('[net] HELLO 송신 (guest):', payload);
      sendToPeer(payload);
    }
  };
  
  // conn.open 상태 확인. 이미 open이면 즉시, 아니면 'open' 이벤트 대기
  if(conn.open){
    sendHello();
  } else {
    conn.on('open', sendHello);
    // 안전망: 1초 후에도 안 보내졌으면 강제 송신
    setTimeout(() => {
      if(conn.open) sendHello();
    }, 1000);
  }

  // gameActive 마크 (호스트만)
  if(NET_ROLE === 'host'){
    _fbDb.ref('rooms/'+ROOM_CODE).update({ gameActive:true }).catch(()=>{});
  }
}

window.sendToPeer = function sendToPeer(obj){
  if(_peerConn && _peerConn.open){
    try{ _peerConn.send(obj); }catch(e){console.error(e);}
  }
}

window.publishGameState = function publishGameState(){
  if(NET_ROLE !== 'host' || !_fbDb) return;
  // 재동기화와 같은 스냅샷을 쓴다 — 관전자도 moveHistory/xlEscapeUsed를 받아야
  // 백 체크 금지·흑 캡처 금지·비상탈출 상태가 맞게 보인다.
  const state = netStateSnapshot();
  _fbDb.ref('rooms/'+ROOM_CODE+'/gameState').set(JSON.stringify(state)).catch(()=>{});
  // 활동 시각 갱신 (유령방 차단용)
  _fbDb.ref('rooms/'+ROOM_CODE+'/lastActivity').set(Date.now()).catch(()=>{});
}
