// ===================================================================
// chat.js — 채팅 + 이모지 + 상대 차단
// 의존: utils (escapeHtml, escapeAttr), firebase (_fbDb), 게임 상수
//      (NET_ROLE, ROOM_CODE, MY_UID, MY_NICK_P, MY_COLOR, IS_NET, IS_SPEC, sendToPeer, _gameRatingInfo)
// 노출: toggleChat, addChatMsg, sendChat, updateChatBadge
//      window.toggleChatEmojiDrawer, sendChatEmoji, toggleBlockOpponent
//      setTimerPhoto (프로필 사진 — 타이머에서 사용)
//      _chatOpen, _chatUnread, _opponentBlocked, _opponentUid, _chatLog 전역
// ===================================================================

var _chatOpen = false;
var _chatUnread = 0;
var _opponentBlocked = false;  // 이 게임의 상대가 차단됐는지 (채팅 무시)
var _opponentUid = null;       // 상대 UID (차단/친구추가 시 사용)
var _myBlockedSet = new Set(); // 내 차단 목록 UID 집합
var _chatLog = [];

// ===== 이모지 목록 =====
const EMOJI_LIST = [
  { id:'checkmate', name:'체크메이트', url:'./assets/emojis/checkmate.jpg' },
  { id:'hi', name:'안녕', url:'./assets/emojis/hi.jpg' },
  { id:'silly', name:'헤헤', url:'./assets/emojis/silly.jpg' }
];

// ===== 타이머 프로필 사진 (타이머 우측 ♔/♚ 자리에 사진) =====
window.setTimerPhoto = function setTimerPhoto(color, photoUrl, nick){
  const el = document.getElementById(color === 'w' ? 'ttwIcon' : 'ttbIcon');
  if(!el) return;
  if(photoUrl){
    el.className = 'ti tt-photo';
    el.style.backgroundImage = `url("${photoUrl}")`;
    el.textContent = '';
    const tester = new Image();
    tester.onerror = () => {
      el.classList.add('fallback');
      el.style.backgroundImage = '';
      el.textContent = (nick || '?').charAt(0).toUpperCase();
    };
    tester.src = photoUrl;
  } else {
    el.className = 'ti tt-photo fallback';
    el.style.backgroundImage = '';
    el.textContent = (nick || (color === 'w' ? '♔' : '♚')).charAt(0).toUpperCase();
  }
};

window.toggleChat = function toggleChat(){
  _chatOpen = !_chatOpen;
  document.getElementById('chatPanel').classList.toggle('show', _chatOpen);
  if(_chatOpen){ _chatUnread = 0; updateChatBadge(); }
};

window.updateChatBadge = function updateChatBadge(){
  const b = document.getElementById('chatBadge');
  if(!b) return;
  if(_chatUnread > 0){ b.textContent = _chatUnread; b.style.display=''; }
  else b.style.display = 'none';
};

window.addChatMsg = function addChatMsg(from, msg, mine, sys, emojiId){
  const el = document.createElement('div');
  el.className = 'cm ' + (sys?'sys':(mine?'me':'them'));
  if(sys){ el.textContent = msg; }
  else if(emojiId){
    const e = EMOJI_LIST.find(x => x.id === emojiId);
    if(e){
      el.innerHTML = `<span class="who">${escapeHtml(from)}</span><img class="chat-msg-img" src="${e.url}" alt="${escapeAttr(e.name)}">`;
    } else {
      el.innerHTML = `<span class="who">${escapeHtml(from)}</span><span style="opacity:.6">[이모지: ${escapeHtml(emojiId)}]</span>`;
    }
  }
  else el.innerHTML = `<span class="who">${escapeHtml(from)}</span><span>${escapeHtml(msg)}</span>`;
  document.getElementById('chatMsgs').appendChild(el);
  document.getElementById('chatMsgs').scrollTop = 1e9;
  _chatLog.push({from, msg, sys, emojiId});
  if(NET_ROLE === 'host'){
    _fbDb && _fbDb.ref('rooms/'+ROOM_CODE+'/chatLog').set(JSON.stringify(_chatLog)).catch(()=>{});
  }
};

// ===== 이모지 drawer =====
var _lastEmojiSent = 0;

window.toggleChatEmojiDrawer = function(){
  console.log('[emoji] 버튼 클릭');
  const dr = document.getElementById('chatEmojiDrawer');
  if(!dr){ console.warn('[emoji] drawer element 없음!'); return; }
  const open = dr.classList.toggle('show');
  console.log('[emoji] drawer 열림:', open);
  if(open){
    const grid = document.getElementById('cedGrid');
    if(!grid){ console.warn('[emoji] grid element 없음!'); return; }
    console.log('[emoji] EMOJI_LIST 길이:', EMOJI_LIST.length);
    grid.innerHTML = EMOJI_LIST.map(e =>
      `<button class="ced-cell" onclick="sendChatEmoji('${e.id}')" title="${escapeAttr(e.name)}">
        <img src="${e.url}" alt="${escapeAttr(e.name)}" loading="lazy" onerror="console.warn('[emoji] 이미지 로드 실패:','${e.url}'); this.parentNode.innerHTML='${escapeAttr(e.name)}'; this.parentNode.style.fontSize='10px'; this.parentNode.style.color='#888'">
      </button>`
    ).join('');
    console.log('[emoji] grid 렌더 완료');
  }
};

window.sendChatEmoji = function(emojiId){
  if(IS_SPEC) return;
  const now = Date.now();
  if(now - _lastEmojiSent < 2000) return; // 쿨다운
  _lastEmojiSent = now;
  addChatMsg(MY_NICK_P, '', true, false, emojiId);
  if(IS_NET){
    sendToPeer({ t:'CHAT_EMOJI', from:MY_NICK_P, emojiId });
  }
  document.getElementById('chatEmojiDrawer').classList.remove('show');
};

window.sendChat = function sendChat(){
  if(IS_SPEC) return;
  const inp = document.getElementById('chatInput');
  const msg = inp.value.trim();
  if(!msg) return;
  addChatMsg(MY_NICK_P, msg, true);
  sendToPeer({ t:'CHAT', from:MY_NICK_P, msg });
  inp.value = '';
};

// 채팅 Enter 키 — DOMContentLoaded 후 안전하게 binding
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('chatInput');
  if(inp){
    inp.addEventListener('keydown', e => { if(e.key === 'Enter') sendChat(); });
  }
});

// ===== 채팅 차단 =====
window.checkOpponentBlocked = async function checkOpponentBlocked(){
  _opponentBlocked = false;
  if(!_opponentUid || !_fbDb || !MY_UID || IS_SPEC) return;
  try {
    const snap = await _fbDb.ref(`users/${MY_UID}/blocked/${_opponentUid}`).once('value');
    if(snap.exists()){
      _opponentBlocked = true;
      addChatMsg('시스템', '차단한 사용자입니다. 메시지가 자동으로 무시됩니다.', null, true);
      updateBlockButtonUI();
    }
  } catch(e){
    console.warn('[Block] 차단 확인 실패:', e.message);
  }
};

window.updateBlockButtonUI = function updateBlockButtonUI(){
  const btn = document.getElementById('chatBlockBtn');
  if(!btn) return;
  if(_opponentBlocked){
    btn.innerHTML = '✓ 차단됨';
    btn.style.color = 'var(--green)';
    btn.style.borderColor = 'var(--green)';
  } else {
    btn.innerHTML = '🚫 차단';
    btn.style.color = 'var(--red)';
    btn.style.borderColor = 'var(--red)';
  }
};

window.toggleBlockOpponent = async function(){
  if(!_opponentUid){
    alert('상대 정보가 아직 없습니다.');
    return;
  }
  if(!_fbDb || !MY_UID){
    alert('네트워크 정보 없음');
    return;
  }
  if(_opponentBlocked){
    if(!confirm('이 사용자의 차단을 해제하시겠습니까?')) return;
    try {
      await _fbDb.ref(`users/${MY_UID}/blocked/${_opponentUid}`).remove();
      _opponentBlocked = false;
      addChatMsg('시스템', '차단 해제됨', null, true);
      updateBlockButtonUI();
    } catch(e){
      alert('차단 해제 실패: ' + e.message);
    }
  } else {
    if(!confirm('이 사용자를 차단하시겠습니까?\n앞으로 이 사용자의 채팅이 보이지 않습니다.')) return;
    try {
      const oppNick = _gameRatingInfo
        ? (MY_COLOR === 'w' ? _gameRatingInfo.blackNick : _gameRatingInfo.whiteNick)
        : '상대';
      const oppTag = _gameRatingInfo
        ? (MY_COLOR === 'w' ? _gameRatingInfo.blackTag : _gameRatingInfo.whiteTag)
        : '';
      await _fbDb.ref(`users/${MY_UID}/blocked/${_opponentUid}`).set({
        nick: oppNick, tag: oppTag, blockedAt: Date.now()
      });
      try { await _fbDb.ref(`users/${MY_UID}/friends/${_opponentUid}`).remove(); } catch(_){}
      _opponentBlocked = true;
      addChatMsg('시스템', `${oppNick} 차단됨. 메시지가 더 이상 표시되지 않습니다.`, null, true);
      updateBlockButtonUI();
    } catch(e){
      alert('차단 실패: ' + e.message);
    }
  }
};
