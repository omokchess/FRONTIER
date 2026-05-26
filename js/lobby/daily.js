'use strict';

(function(){
  const QUEST_POOL = [
    { id:'play_1',      name:'한 판은 하고 가자',   desc:'게임 1판 플레이',          target:1, type:'play' },
    { id:'play_3',      name:'세 판 더',           desc:'게임 3판 플레이',          target:3, type:'play' },
    { id:'win_1',       name:'오늘의 승리',         desc:'게임 1판 승리',            target:1, type:'win' },
    { id:'ai_1',        name:'기계와 한 판',        desc:'AI와 1판 플레이',          target:1, type:'ai' },
    { id:'mate_1',      name:'체크메이트 한 번',    desc:'체크메이트로 1번 승리',    target:1, type:'mate_win' },
    { id:'omok_1',      name:'5목 한 번',          desc:'5목으로 1번 승리',         target:1, type:'omok_win' },
    { id:'potion_1',    name:'물약 한 모금',        desc:'물약 모드 1판 플레이',     target:1, type:'potion_play' },
    { id:'local_1',     name:'옆 사람과 한 판',     desc:'로컬 2인 1판 플레이',      target:1, type:'local' },
    { id:'replay_1',    name:'추억 회상',           desc:'리플레이 1개 보기',        target:1, type:'replay' },
    { id:'spec_1',      name:'옆에서 구경',         desc:'온라인 방 1번 관전',       target:1, type:'spectate' },
  ];

  const REWARD_TITLES = [
    { name:'🍀 행운아', color:'#30d158' },
    { name:'🎁 데일리 마스터', color:'#bf5af2' },
    { name:'✨ 빛나는 자', color:'#f5c842' },
    { name:'🌟 별빛', color:'#5ac8fa' },
    { name:'🎀 데일리 챔피언', color:'#ff453a' },
    { name:'🔥 불꽃의 인도자', color:'#ff9500' },
    { name:'⚡ 천둥', color:'#ffd60a' },
    { name:'🌈 무지개 수집가', color:'#af52de' },
    { name:'🦋 나비효과', color:'#64d2ff' },
    { name:'👑 운명의 총아', color:'#ffd700' }
  ];

  function fallbackEscape(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }

  function getTodayDateStr(){
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }

  function getYesterdayDateStr(){
    const d = new Date(Date.now() + 9 * 3600 * 1000 - 86400000);
    return d.toISOString().slice(0, 10);
  }

  function normalizeStreak(raw){
    return {
      current: Math.max(0, parseInt(raw && raw.current, 10) || 0),
      last: (raw && typeof raw.last === 'string') ? raw.last : null,
      longest: Math.max(0, parseInt(raw && raw.longest, 10) || 0)
    };
  }

  function pickNewestStreak(a, b){
    const x = normalizeStreak(a);
    const y = normalizeStreak(b);
    if(!x.last) return y;
    if(!y.last) return x;
    if(y.last > x.last) return y;
    if(x.last > y.last) return x;
    return y.current > x.current ? y : x;
  }

  window.FRONTIER_LOBBY_DAILY = {
    install(ctx){
      const getDb = ctx.getDb || (() => null);
      const getAuth = ctx.getAuth || (() => null);
      const getUid = ctx.getUid || (() => null);
      const escapeHtml = ctx.escapeHtml || fallbackEscape;
      const escapeAttr = ctx.escapeAttr || escapeHtml;
      const unlockAchievement = ctx.unlockAchievement || (async () => false);

      function currentAuthUid(){
        const auth = getAuth();
        const user = auth && auth.currentUser;
        return user && !user.isAnonymous ? user.uid : getUid();
      }

      async function saveDailyStreak(uid, data){
        try { localStorage.setItem('frontier_streak', JSON.stringify(data)); } catch(_){}
        const db = getDb();
        if(!uid || !db) return;
        try {
          await db.ref(`users/${uid}/dailyStreak`).set({...data, updatedAt: Date.now()});
        } catch(e){
          console.warn('[Daily] streak 서버 저장 실패:', e.message);
        }
      }

      async function unlockDailyStreakAchievements(current){
        const pairs = [
          [3, 'streak_3'],
          [7, 'streak_7'],
          [30, 'streak_30'],
          [100, 'streak_100'],
          [365, 'streak_365']
        ];
        for(const [need, id] of pairs){
          if(current >= need) await unlockAchievement(id, 'daily_streak');
        }
      }

      async function updateDailyStreak(){
        let localData;
        try { localData = JSON.parse(localStorage.getItem('frontier_streak') || 'null'); } catch(_){}
        const uid = currentAuthUid();
        const db = getDb();
        let remoteData = null;
        if(uid && db){
          try {
            const snap = await db.ref(`users/${uid}/dailyStreak`).once('value');
            remoteData = snap.val();
          } catch(e){
            console.warn('[Daily] streak 서버 조회 실패:', e.message);
          }
        }
        const data = pickNewestStreak(localData, remoteData);
        const today = getTodayDateStr();
        const yesterday = getYesterdayDateStr();
        if(data.last === today){
          // Already counted today.
        } else if(data.last === yesterday){
          data.current = (data.current || 0) + 1;
          data.last = today;
        } else {
          data.current = 1;
          data.last = today;
        }
        if(data.current > (data.longest || 0)) data.longest = data.current;
        await saveDailyStreak(uid, data);
        await unlockDailyStreakAchievements(data.current || 0);
        return data;
      }

      function getDailyQuests(){
        let data;
        try { data = JSON.parse(localStorage.getItem('frontier_quests') || 'null'); } catch(_){}
        const today = getTodayDateStr();
        if(!data || data.date !== today){
          const shuffled = [...QUEST_POOL].sort(() => Math.random() - 0.5);
          const picks = shuffled.slice(0, 3).map(q => ({...q, progress:0, completed:false}));
          data = { date: today, quests: picks };
          try { localStorage.setItem('frontier_quests', JSON.stringify(data)); } catch(_){}
        }
        return data;
      }

      async function giveDailyBoxReward(){
        const uid = getUid();
        const db = getDb();
        if(!uid || !db) return;
        const coins = 5 + Math.floor(Math.random() * 6);
        const titleRoll = Math.random() < 0.10;
        let newTitle = null;

        try {
          const cSnap = await db.ref(`users/${uid}/coins`).once('value');
          const curC = cSnap.val() || 0;
          await db.ref(`users/${uid}/coins`).set(curC + coins);

          if(titleRoll){
            const ownedSnap = await db.ref(`users/${uid}/ownedTitles`).once('value');
            const owned = ownedSnap.val() || {};
            const available = REWARD_TITLES.filter(t => !owned[t.name]);
            if(available.length > 0){
              newTitle = available[Math.floor(Math.random() * available.length)];
              await db.ref(`users/${uid}/ownedTitles/${newTitle.name}`).set({
                color: newTitle.color,
                unlockedAt: Date.now(),
                source: 'daily_box'
              });
            }
          }
        } catch(e){
          console.warn('[Box] 보상 저장 실패:', e.message);
        }

        showDailyBoxRewardModal(coins, newTitle);
      }

      function showDailyBoxRewardModal(coins, title){
        const existing = document.getElementById('boxRewardModal');
        if(existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'boxRewardModal';
        modal.className = 'modal show';
        modal.innerHTML = `
          <div class="modal-card" style="max-width:380px;width:90%;text-align:center;padding:28px">
            <div style="margin-bottom:14px">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#f5c842" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 12px rgba(245,200,66,.6));animation:boxBounce .8s ease-out">
                <polyline points="20 12 20 22 4 22 4 12"/>
                <rect x="2" y="7" width="20" height="5"/>
                <line x1="12" y1="22" x2="12" y2="7"/>
                <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
                <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
              </svg>
            </div>
            <h2 style="color:#f5c842;margin-bottom:6px">데일리 상자 획득!</h2>
            <p style="color:var(--muted);font-size:13px;margin-bottom:18px">오늘의 퀘스트 3개를 모두 완료했습니다</p>

            <div style="background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px">
              <div style="display:flex;align-items:center;justify-content:center;gap:8px;font-size:22px;font-weight:800;color:#f5c842">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" font-size="13" font-weight="900" fill="#1c1c1e">C</text></svg>
                +${coins} C
              </div>
              <div style="font-size:11px;color:var(--muted);margin-top:4px">코인</div>
            </div>

            ${title ? `
              <div style="background:linear-gradient(135deg,rgba(245,200,66,.15),rgba(255,149,0,.08));border:1px solid ${title.color};border-radius:10px;padding:14px;margin-bottom:14px">
                <div style="font-size:11px;color:var(--muted);margin-bottom:6px">🎉 보너스 — 새 칭호!</div>
                <div style="color:${title.color};font-size:17px;font-weight:800;text-shadow:0 0 8px ${title.color}">${escapeHtml(title.name)}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:6px">내 페이지 > 칭호에서 장착 가능</div>
              </div>
            ` : ''}

            <button class="btn btn-gold" onclick="document.getElementById('boxRewardModal').remove()" style="width:100%;padding:12px;font-weight:800">확인</button>
          </div>
        `;
        document.body.appendChild(modal);
      }

      function trackQuestStreak(){
        let s;
        try { s = JSON.parse(localStorage.getItem('frontier_quest_streak') || 'null'); } catch(_){}
        if(!s) s = { current:0, last:null };
        const today = getTodayDateStr();
        const yesterday = getYesterdayDateStr();
        if(s.last === today) return;
        if(s.last === yesterday) s.current = (s.current || 0) + 1;
        else s.current = 1;
        s.last = today;
        try { localStorage.setItem('frontier_quest_streak', JSON.stringify(s)); } catch(_){}
        if(getUid() && getDb()){
          if(s.current >= 7)   unlockAchievement('quest_streak_7', 'quest_streak');
          if(s.current >= 30)  unlockAchievement('quest_streak_30', 'quest_streak');
          if(s.current >= 100) unlockAchievement('quest_streak_100', 'quest_streak');
          if(s.current >= 365) unlockAchievement('quest_streak_365', 'quest_streak');
        }
      }

      window.trackQuestProgress = function(eventType, payload){
        const data = getDailyQuests();
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
          } else if(eventType === 'replay_view'){
            if(q.type === 'replay') inc = 1;
          } else if(eventType === 'spectate'){
            if(q.type === 'spectate') inc = 1;
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
          if(getUid() && getDb()){
            const completedCount = data.quests.filter(q => q.completed).length;
            if(completedCount >= 1) unlockAchievement('quest_first', 'quest');
            if(completedCount >= 3) unlockAchievement('quest_all', 'quest');

            if(completedCount >= 3 && !data.rewardClaimed){
              data.rewardClaimed = true;
              try { localStorage.setItem('frontier_quests', JSON.stringify(data)); } catch(_){}
              giveDailyBoxReward();
            }
          }
          if(anyCompleted > 0) trackQuestStreak();
        }
        return data;
      };

      window.openDailyQuestModal = function(){
        document.getElementById('dailyQuestModal').classList.add('show');
        renderDailyQuestModal();
      };

      window.closeDailyQuestModal = function(){
        document.getElementById('dailyQuestModal').classList.remove('show');
      };

      function getStreak(){
        try { return JSON.parse(localStorage.getItem('frontier_streak') || 'null') || {current:0,longest:0}; }
        catch(_){ return {current:0,longest:0}; }
      }

      function renderDailyQuestModal(){
        const quests = getDailyQuests().quests;
        const streak = getStreak();
        const list = document.getElementById('questList');
        if(!list) return;
        list.innerHTML = quests.map(q => `
          <div class="quest-item ${q.completed?'completed':''}">
            <div class="quest-name">${q.completed ? '✅' : '⬜'} ${escapeAttr(q.name)}</div>
            <div class="quest-desc">${escapeAttr(q.desc)}</div>
            <div class="quest-progress">
              <div class="quest-bar"><div class="quest-fill" style="width:${(q.progress/q.target)*100}%"></div></div>
              <span class="quest-pct">${q.progress}/${q.target}</span>
            </div>
          </div>
        `).join('');
        const streakEl = document.getElementById('streakDisplay');
        if(streakEl){
          streakEl.innerHTML = `
            <div class="streak-current">🔥 <b>${streak.current||0}</b>일 연속</div>
            <div class="streak-longest" style="font-size:11px;color:var(--muted);margin-top:2px">최장: ${streak.longest||0}일</div>
          `;
        }
      }

      function renderQuestCardBadge(){
        const data = getDailyQuests();
        const incomplete = data.quests.filter(q => !q.completed).length;
        const badge = document.getElementById('questBadge');
        if(badge){
          if(incomplete > 0){
            badge.textContent = incomplete;
            badge.style.display = '';
          } else {
            badge.style.display = 'none';
          }
        }
        const streak = getStreak();
        const sc = document.getElementById('streakCount');
        if(sc) sc.textContent = streak.current || 0;
      }

      return {
        getDailyQuests,
        getStreak,
        renderQuestCardBadge,
        updateDailyStreak
      };
    }
  };
})();
