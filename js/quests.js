'use strict';
/* 일일 퀘스트 진행 — localStorage에 쌓는 부분만.
 *
 * 예전엔 이 로직이 두 벌이었다: 로비는 js/lobby/daily.js, 게임 페이지는
 * engine.js의 trackQuestProgressLocal. 둘이 갈라지면서 게임 쪽 사본에
 * replay_view / spectate 분기가 빠졌고, '리플레이 1개 보기'와 '온라인 방
 * 1번 관전' 퀘스트가 영영 완료되지 않았다. 그래서 한 곳으로 모은다.
 *
 * 보상·업적처럼 Firebase가 필요한 뒷일은 호출한 쪽에서 한다 —
 * 페이지마다 db/uid를 꺼내는 방법이 다르기 때문이다.
 */
(function(){
  const KEY = 'frontier_quests';

  // 퀘스트 하루 경계는 KST 기준 (daily.js의 getTodayDateStr와 같아야 한다)
  function todayStr(){
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function load(){
    let data;
    try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(_){}
    if(!data || !Array.isArray(data.quests) || data.date !== todayStr()) return null;
    return data;
  }

  // 이 이벤트가 이 퀘스트를 얼마나 진행시키는가
  function increment(quest, eventType, payload){
    if(eventType === 'game_end'){
      const { mode, win, winType, isPotion } = payload || {};
      switch(quest.type){
        case 'play':      return 1;
        case 'win':       return win ? 1 : 0;
        case 'ai':        return mode === 'ai' ? 1 : 0;
        case 'local':     return mode === 'local' ? 1 : 0;
        case 'mate_win':  return (win && winType === 'mate') ? 1 : 0;
        case 'omok_win':  return (win && winType === 'omok') ? 1 : 0;
        case 'potion_play': return isPotion ? 1 : 0;
        default: return 0;
      }
    }
    if(eventType === 'replay_view') return quest.type === 'replay'  ? 1 : 0;
    if(eventType === 'spectate')    return quest.type === 'spectate' ? 1 : 0;
    return 0;
  }

  // 같은 리플레이를 다시 열거나 새로고침해도 하루에 한 번만 센다.
  // 안 그러면 F5 몇 번으로 퀘스트가 끝난다.
  function alreadyCountedToday(eventType){
    if(eventType !== 'replay_view' && eventType !== 'spectate') return false;
    const mark = 'frontier_quest_once_' + eventType;
    try {
      if(localStorage.getItem(mark) === todayStr()) return true;
      localStorage.setItem(mark, todayStr());
    } catch(_){}
    return false;
  }

  window.FRONTIER_QUESTS = {
    todayStr,
    /* 반환: { data, changed, completed } — 퀘스트가 아직 없으면 data:null */
    track(eventType, payload){
      if(alreadyCountedToday(eventType)) return { data: load(), changed: false, completed: 0 };
      const data = load();
      if(!data) return { data: null, changed: false, completed: 0 };
      let changed = false, completed = 0;
      for(const q of data.quests){
        if(q.completed) continue;
        const inc = increment(q, eventType, payload);
        if(inc <= 0) continue;
        q.progress = Math.min(q.target, (q.progress || 0) + inc);
        changed = true;
        if(q.progress >= q.target){ q.completed = true; completed++; }
      }
      if(changed){
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch(_){}
      }
      return { data, changed, completed };
    }
  };
})();
