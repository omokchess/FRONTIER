// ===================================================================
// elo.js — ELO 계산 + 저장, 매치 로그, 업적, 칭호 자동 해제
// 의존: utils (showFlash), firebase (_fbDb, _fbAuth, _authReady),
//      게임 상수 (MY_UID, MY_COLOR, MY_NICK_P, MY_TAG_P, MY_ELO_P, IS_POTION,
//                IS_SPEC, IS_REPLAY, IS_AI, IS_LOCAL, _gameRatingInfo)
// 노출: window.unlockAch, checkPostEloAchievements, unsetInactiveTitleIfNeeded
//      checkAchievements, applyEloChangeAsHost, saveMatchLog, applyEloAsGuest,
//      applyEloChange
// ===================================================================

window.unlockAch = async function unlockAch(id){
  if(!_fbDb) return;
  // 인증된 실제 uid 사용 (MY_UID는 URL 파라미터라 신뢰 X)
  if(_authReady){ try { await _authReady; } catch(_){} }
  const actualUid = (_fbAuth && _fbAuth.currentUser && !_fbAuth.currentUser.isAnonymous) 
    ? _fbAuth.currentUser.uid : null;
  if(!actualUid){ console.warn('[Ach] 인증 없음 — 업적 저장 skip:', id); return; }
  try {
    const snap = await _fbDb.ref(`users/${actualUid}/achievements/${id}`).once('value');
    if(snap.exists()) return; // 이미 달성
    await _fbDb.ref(`users/${actualUid}/achievements/${id}`).set({ unlockedAt: Date.now() });
    console.log('[Ach] 해제:', id);
    showFlash(`🏆 업적 해제: ${id}`);
  } catch(e){
    console.warn('[Ach] unlock 실패:', e.message, '— id:', id);
  }
}

window.checkPostEloAchievements = async function checkPostEloAchievements(newElo, newW){
  if(!_fbDb) return;
  console.log('[Ach] checkPostElo — newElo:', newElo, 'newW:', newW);
  if(newW === 1) await unlockAch('first_win');
  if(newW >= 5) await unlockAch('five_wins');
  if(newW >= 10) await unlockAch('ten_wins');
  if(newW >= 50) await unlockAch('fifty_wins');
  if(newW >= 100) await unlockAch('hundred_wins');
  if(newElo >= 1200) await unlockAch('silver_tier');
  if(newElo >= 1400) await unlockAch('gold_tier');
  if(newElo >= 1600) await unlockAch('platinum_tier');
  if(newElo >= 1800) await unlockAch('diamond_tier');
}

// 새 ELO 기준으로 현재 활성 칭호가 부적합하면 자동 해제
window.unsetInactiveTitleIfNeeded = async function unsetInactiveTitleIfNeeded(uid, newElo){
  if(!_fbDb || !uid) return;
  try {
    const snap = await _fbDb.ref(`users/${uid}/activeTitle`).once('value');
    const active = snap.val();
    if(!active) return;
    
    let shouldUnset = false;
    let reason = '';
    
    // 티어 칭호 — 최소 ELO 미만이면 해제
    const TIER_MIN = { tier_diamond:1800, tier_platinum:1600, tier_gold:1400, tier_silver:1200 };
    if(TIER_MIN[active] !== undefined){
      if(newElo < TIER_MIN[active]){
        shouldUnset = true;
        reason = `티어 부족 (${newElo}<${TIER_MIN[active]})`;
      }
    }
    
    // 순위 칭호 — 본인 현재 랭킹이 부합하지 않으면 해제
    if(active === 'rank_1' || active === 'rank_2' || active === 'rank_3'){
      try {
        // 어드민/태그없음 제외하고 랭킹 계산
        const [lb, ad] = await Promise.all([
          _fbDb.ref('leaderboard').once('value'),
          _fbDb.ref('admins').once('value')
        ]);
        const obj = lb.val() || {};
        const admins = ad.val() || {};
        const arr = Object.entries(obj)
          .filter(([u, info]) => !admins[u] && info.tag)
          .map(([u, info]) => ({uid:u, elo: info.elo||1200}))
          .sort((a,b)=> b.elo - a.elo);
        const idx = arr.findIndex(x => x.uid === uid);
        const myRank = idx === 0 ? 1 : idx === 1 ? 2 : idx === 2 ? 3 : null;
        const required = active === 'rank_1' ? 1 : active === 'rank_2' ? 2 : 3;
        if(myRank !== required){
          shouldUnset = true;
          reason = `순위 (${myRank}≠${required})`;
        }
      } catch(_){}
    }
    
    if(shouldUnset){
      await Promise.all([
        _fbDb.ref(`users/${uid}/activeTitle`).remove(),
        _fbDb.ref(`users/${uid}/activeTitleName`).remove(),
        _fbDb.ref(`users/${uid}/activeTitleColor`).remove(),
        _fbDb.ref(`leaderboard/${uid}/activeTitle`).remove(),
        _fbDb.ref(`leaderboard/${uid}/activeTitleName`).remove(),
        _fbDb.ref(`leaderboard/${uid}/activeTitleColor`).remove()
      ]);
      console.log('[title] 자동 해제:', active, '—', reason);
    }
  } catch(e){
    console.warn('[title] 자동 해제 검사 실패:', e.message);
  }
}

window.checkAchievements = async function checkAchievements(winner, title, desc){
  if(IS_SPEC || IS_REPLAY) return;
  if(!MY_COLOR && !IS_AI && !IS_LOCAL) return;
  
  const iWon = winner === MY_COLOR;
  const iLost = winner !== MY_COLOR && winner !== 'draw';
  
  // 승리 기반 업적
  if(iWon){
    await unlockAch('first_win');
    if(title && title.indexOf('오목') >= 0) await unlockAch('first_omok');
    if(title && title.indexOf('체크메이트') >= 0) await unlockAch('first_mate');
    
    if(IS_AI){
      const diff = window._aiDifficulty || 'normal';
      if(diff === 'easy') await unlockAch('ai_easy');
      else if(diff === 'normal') await unlockAch('ai_normal');
      else if(diff === 'hard') await unlockAch('ai_hard');
    }
    
    // 연승 카운터 ↑
    try {
      const cur = parseInt(localStorage.getItem('frontier_win_streak') || '0');
      const newStreak = cur + 1;
      localStorage.setItem('frontier_win_streak', String(newStreak));
      if(newStreak >= 5) await unlockAch('win_streak_5');
      if(newStreak >= 10) await unlockAch('win_streak_10');
    } catch(_){}
  } else if(iLost){
    await unlockAch('first_loss');
    // 연승 카운터 리셋
    try { localStorage.setItem('frontier_win_streak', '0'); } catch(_){}
  } else {
    // 무승부 — 연승은 유지 X (리셋)
    try { localStorage.setItem('frontier_win_streak', '0'); } catch(_){}
  }
}

// 호스트 전용: 양쪽 ELO diff 계산 + 자기 저장 + 게스트 diff 반환
window.applyEloChangeAsHost = async function applyEloChangeAsHost(winner){
  if(!_gameRatingInfo){ console.warn('[ELO host] _gameRatingInfo 없음'); return {myDiff:null, oppDiff:null, oppNewElo:null}; }
  if(!_fbDb){ console.warn('[ELO host] _fbDb 없음'); return {myDiff:null, oppDiff:null, oppNewElo:null}; }
  
  const ELO_FIELD = IS_POTION ? 'potionElo' : 'elo';
  const W_FIELD = IS_POTION ? 'potionW' : 'w';
  const L_FIELD = IS_POTION ? 'potionL' : 'l';
  const D_FIELD = IS_POTION ? 'potionD' : 'd';
  
  const myCol = MY_COLOR;
  const myInfo = myCol === 'w'
    ? {uid: _gameRatingInfo.whiteUid, elo: _gameRatingInfo.whiteElo}
    : {uid: _gameRatingInfo.blackUid, elo: _gameRatingInfo.blackElo};
  const oppInfo = myCol === 'w'
    ? {uid: _gameRatingInfo.blackUid, elo: _gameRatingInfo.blackElo}
    : {uid: _gameRatingInfo.whiteUid, elo: _gameRatingInfo.whiteElo};
  
  const myScore = winner === 'draw' ? 0.5 : (winner === myCol ? 1 : 0);
  const oppScore = winner === 'draw' ? 0.5 : (winner !== myCol ? 1 : 0);
  
  const K = 32;
  const myExpected = 1 / (1 + Math.pow(10, (oppInfo.elo - myInfo.elo)/400));
  
  const myDiff = Math.round(K * (myScore - myExpected));
  const oppDiff = Math.round(K * (oppScore - (1 - myExpected)));
  
  const myNewElo = myInfo.elo + myDiff;
  const oppNewElo = oppInfo.elo + oppDiff;
  
  console.log(`[ELO host] my(${myCol}) ${myInfo.elo}→${myNewElo} (${myDiff>=0?'+':''}${myDiff}) / opp ${oppInfo.elo}→${oppNewElo} (${oppDiff>=0?'+':''}${oppDiff})`);
  
  // 호스트 자기 ELO 저장 (자기 인증으로만)
  try {
    if(_authReady){ try { await _authReady; } catch(_){} }
    if(_fbAuth.currentUser && !_fbAuth.currentUser.isAnonymous){
      const myUidActual = _fbAuth.currentUser.uid;
      const ref = _fbDb.ref('users/'+myUidActual);
      const snap = await ref.once('value');
      const cur = snap.val() || {};
      const upd = {};
      upd[ELO_FIELD] = myNewElo;
      upd[W_FIELD] = (cur[W_FIELD]||0) + (myScore===1?1:0);
      upd[L_FIELD] = (cur[L_FIELD]||0) + (myScore===0?1:0);
      upd[D_FIELD] = (cur[D_FIELD]||0) + (myScore===0.5?1:0);
      await ref.update(upd);
      const lbUpd = { nick: cur.nick || MY_NICK_P };
      if(cur.tag || MY_TAG_P) lbUpd.tag = cur.tag || MY_TAG_P;
      lbUpd[ELO_FIELD] = myNewElo;
      lbUpd[W_FIELD] = upd[W_FIELD];
      lbUpd[L_FIELD] = upd[L_FIELD];
      lbUpd[D_FIELD] = upd[D_FIELD];
      await _fbDb.ref('leaderboard/'+myUidActual).update(lbUpd);
      if(!IS_POTION){
        try { await checkPostEloAchievements(myNewElo, upd[W_FIELD]); } catch(_){}
      }
      // 칭호 자동 해제 검사 (티어 떨어졌거나 순위 밀려나면)
      try { await unsetInactiveTitleIfNeeded(myUidActual, myNewElo); } catch(_){}
      console.log('[ELO host] 자기 저장 완료');
    } else {
      console.warn('[ELO host] 자기 인증 없음 — 저장 skip');
    }
  } catch(e){
    console.error('[ELO host] 자기 저장 실패:', e);
  }
  
  return {myDiff, oppDiff, oppNewElo};
}

// 게스트 전용: 호스트 메시지로 받은 ELO 결과를 자기 데이터에 적용
window.applyEloAsGuest = async function applyEloAsGuest(diff, newElo, winner){
  if(!_fbDb) return;
  if(diff === null || diff === undefined) return;
  
  const ELO_FIELD = IS_POTION ? 'potionElo' : 'elo';
  const W_FIELD = IS_POTION ? 'potionW' : 'w';
  const L_FIELD = IS_POTION ? 'potionL' : 'l';
  const D_FIELD = IS_POTION ? 'potionD' : 'd';
  
  const myScore = winner === 'draw' ? 0.5 : (winner === MY_COLOR ? 1 : 0);
  
  try {
    if(_authReady){ try { await _authReady; } catch(_){} }
    if(!_fbAuth.currentUser || _fbAuth.currentUser.isAnonymous){
      console.warn('[ELO guest] 인증 없음 — 비레이팅 (표시만)');
      return;
    }
    const myUidActual = _fbAuth.currentUser.uid;
    const ref = _fbDb.ref('users/'+myUidActual);
    const snap = await ref.once('value');
    const cur = snap.val() || {};
    const upd = {};
    upd[ELO_FIELD] = newElo;
    upd[W_FIELD] = (cur[W_FIELD]||0) + (myScore===1?1:0);
    upd[L_FIELD] = (cur[L_FIELD]||0) + (myScore===0?1:0);
    upd[D_FIELD] = (cur[D_FIELD]||0) + (myScore===0.5?1:0);
    await ref.update(upd);
    const lbUpd = { nick: cur.nick || MY_NICK_P };
    if(cur.tag || MY_TAG_P) lbUpd.tag = cur.tag || MY_TAG_P;
    lbUpd[ELO_FIELD] = newElo;
    lbUpd[W_FIELD] = upd[W_FIELD];
    lbUpd[L_FIELD] = upd[L_FIELD];
    lbUpd[D_FIELD] = upd[D_FIELD];
    await _fbDb.ref('leaderboard/'+myUidActual).update(lbUpd);
    if(!IS_POTION){
      try { await checkPostEloAchievements(newElo, upd[W_FIELD]); } catch(_){}
    }
    // 칭호 자동 해제 검사
    try { await unsetInactiveTitleIfNeeded(myUidActual, newElo); } catch(_){}
    console.log('[ELO guest] 자기 저장 완료:', newElo);
  } catch(e){
    console.error('[ELO guest] 저장 실패:', e);
  }
}

// 매치 로그 자동 기록 (호스트만 호출)
window.saveMatchLog = async function saveMatchLog(winner, title, desc){
  if(!_gameRatingInfo || !_fbDb) return;
  try {
    if(_authReady){ try { await _authReady; } catch(_){} }
    if(!_fbAuth.currentUser || _fbAuth.currentUser.isAnonymous) return;
    const log = {
      ts: Date.now(),
      isPotion: !!IS_POTION,
      whiteUid: _gameRatingInfo.whiteUid || null,
      whiteNick: _gameRatingInfo.whiteNick || null,
      whiteTag: _gameRatingInfo.whiteTag || null,
      whiteElo: _gameRatingInfo.whiteElo || 1200,
      blackUid: _gameRatingInfo.blackUid || null,
      blackNick: _gameRatingInfo.blackNick || null,
      blackTag: _gameRatingInfo.blackTag || null,
      blackElo: _gameRatingInfo.blackElo || 1200,
      winner: winner || null,
      reason: title || null,
      detail: desc || null
    };
    await _fbDb.ref('matchLogs').push(log);
    console.log('[matchLog] 저장 완료');
  } catch(e){
    console.warn('[matchLog] 저장 실패:', e.message);
  }
}

window.applyEloChange = async function applyEloChange(winner){
  if(!_fbDb){ console.warn('[ELO] _fbDb 없음 — 적용 안 함'); return null; }
  
  // _gameRatingInfo 없으면 자기 데이터로 fallback (HELLO 메시지 누락 시)
  if(!_gameRatingInfo){
    console.warn('[ELO] _gameRatingInfo 없음 — 자기 데이터로 fallback');
    _gameRatingInfo = {
      whiteUid: MY_COLOR==='w' ? MY_UID : '__unknown_w__',
      whiteElo: MY_COLOR==='w' ? MY_ELO_P : 1200,
      whiteNick: MY_COLOR==='w' ? MY_NICK_P : '백',
      whiteTag: MY_COLOR==='w' ? MY_TAG_P : '',
      blackUid: MY_COLOR==='b' ? MY_UID : '__unknown_b__',
      blackElo: MY_COLOR==='b' ? MY_ELO_P : 1200,
      blackNick: MY_COLOR==='b' ? MY_NICK_P : '흑',
      blackTag: MY_COLOR==='b' ? MY_TAG_P : ''
    };
  }
  
  // 모드별 ELO 필드
  const ELO_FIELD = IS_POTION ? 'potionElo' : 'elo';
  const W_FIELD = IS_POTION ? 'potionW' : 'w';
  const L_FIELD = IS_POTION ? 'potionL' : 'l';
  const D_FIELD = IS_POTION ? 'potionD' : 'd';
  const myCol = MY_COLOR;
  const myInfo = myCol === 'w'
    ? {uid:_gameRatingInfo.whiteUid, elo:_gameRatingInfo.whiteElo}
    : {uid:_gameRatingInfo.blackUid, elo:_gameRatingInfo.blackElo};
  const oppInfo = myCol === 'w'
    ? {uid:_gameRatingInfo.blackUid, elo:_gameRatingInfo.blackElo}
    : {uid:_gameRatingInfo.whiteUid, elo:_gameRatingInfo.whiteElo};
  if(!myInfo.uid || myInfo.uid.startsWith('__unknown')){
    console.warn('[ELO] 내 uid 누락 — 적용 안 함');
    return null;
  }

  // 리매치 + 이전 판 ELO 반영 — Firebase에서 현재 ELO 다시 가져오기
  let actualMyElo = myInfo.elo;
  let actualOppElo = oppInfo.elo;
  try {
    const mySnap = await _fbDb.ref('leaderboard/' + myInfo.uid).once('value');
    const myLB = mySnap.val();
    if(myLB){
      actualMyElo = myLB[ELO_FIELD] || myInfo.elo;
    }
  } catch(_){}
  if(oppInfo.uid && !oppInfo.uid.startsWith('__unknown')){
    try {
      const oppSnap = await _fbDb.ref('leaderboard/' + oppInfo.uid).once('value');
      const oppLB = oppSnap.val();
      if(oppLB){
        actualOppElo = oppLB[ELO_FIELD] || oppInfo.elo;
      }
    } catch(_){}
  }

  const score = winner === 'draw' ? 0.5 : (winner === myCol ? 1 : 0);
  const K = 32;
  const expected = 1 / (1 + Math.pow(10, (actualOppElo - actualMyElo)/400));
  const diff = Math.round(K * (score - expected));
  const newElo = actualMyElo + diff;
  console.log(`[ELO ${ELO_FIELD}] ${myCol} score=${score} expected=${expected.toFixed(3)} diff=${diff} ${actualMyElo}→${newElo} (vs ${actualOppElo})`);

  try{
    if(_authReady){
      try { await _authReady; } catch(_) {}
    }
    if(!_fbAuth.currentUser || _fbAuth.currentUser.isAnonymous){
      console.warn('[ELO] Google 세션 없음 — ELO 업데이트 불가');
      return null;
    }
    if(_fbAuth.currentUser.uid !== myInfo.uid){
      console.warn(`[ELO] auth.uid(${_fbAuth.currentUser.uid}) !== myInfo.uid(${myInfo.uid}) — 본인 UID로 처리`);
      myInfo.uid = _fbAuth.currentUser.uid;
    }
    const ref = _fbDb.ref('users/'+myInfo.uid);
    const snap = await ref.once('value');
    const cur = snap.val() || {};
    const upd = {};
    upd[ELO_FIELD] = newElo;
    upd[W_FIELD] = (cur[W_FIELD]||0) + (score===1?1:0);
    upd[L_FIELD] = (cur[L_FIELD]||0) + (score===0?1:0);
    upd[D_FIELD] = (cur[D_FIELD]||0) + (score===0.5?1:0);
    await ref.update(upd);
    const lbUpd = {
      nick: cur.nick || MY_NICK_P
    };
    lbUpd[ELO_FIELD] = newElo;
    lbUpd[W_FIELD] = upd[W_FIELD];
    lbUpd[L_FIELD] = upd[L_FIELD];
    lbUpd[D_FIELD] = upd[D_FIELD];
    await _fbDb.ref('leaderboard/'+myInfo.uid).update(lbUpd);
    console.log(`[ELO ${ELO_FIELD}] 업데이트 성공`, upd);
    if(!IS_POTION){
      try { await checkPostEloAchievements(newElo, upd[W_FIELD]); } catch(_){}
    }
  }catch(e){
    console.error('[ELO] 업데이트 실패',e);
    throw e;
  }
  return diff;
}
