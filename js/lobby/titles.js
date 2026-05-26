'use strict';

(function(){
  const SHOP_TITLES = [
    { name:'루키', price:5, color:'#30d158' },
    { name:'노력가', price:7, color:'#5ac8fa' },
    { name:'구매 칭호 mk1', price:10, color:'#bbbbbb' },
    { name:'고수!', price:17, color:'#f5c842' },
    { name:'괴물', price:36, color:'#ff453a' }
  ];

  function fallbackEscape(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }

  function getMyTierTitle(elo){
    if(elo >= 1800) return { id:'tier_diamond', name:'💠 다이아몬드', color:'#5ac8fa' };
    if(elo >= 1600) return { id:'tier_platinum', name:'🔷 플래티넘', color:'#af52de' };
    if(elo >= 1400) return { id:'tier_gold', name:'🥇 골드', color:'#f5c842' };
    if(elo >= 1200) return { id:'tier_silver', name:'🥈 실버', color:'#bbb' };
    return { id:'tier_bronze', name:'🥉 브론즈', color:'#cd7f32' };
  }

  window.FRONTIER_LOBBY_TITLES = {
    install(ctx){
      const getDb = ctx.getDb || (() => null);
      const getUid = ctx.getUid || (() => null);
      const getTag = ctx.getTag || (() => '');
      const getElo = ctx.getElo || (() => 1200);
      const getAchievements = ctx.getAchievements || (() => ({}));
      const getAchColor = ctx.getAchColor;
      const achievements = ctx.achievements || [];
      const loadAchievements = ctx.loadAchievements || (async () => ({}));
      const escapeHtml = ctx.escapeHtml || fallbackEscape;
      const renderProfile = ctx.renderProfile || (async () => {});
      const setTitleState = ctx.setTitleState || (() => {});

      let myRanking = null;
      let adminStatusLoaded = false;
      let adminUid = null;

      async function ensureAdminStatus(){
        const uid = getUid();
        if(adminStatusLoaded && adminUid === uid) return !!window.IS_ADMIN;
        window.IS_ADMIN = false;
        if(!uid || !getDb()) return false;
        try {
          const adminSnap = await getDb().ref('admins/'+uid).once('value');
          window.IS_ADMIN = adminSnap.val() === true;
        } catch(e){
          console.warn('[admin] 상태 조회 실패:', e.message);
          window.IS_ADMIN = false;
        }
        adminStatusLoaded = true;
        adminUid = uid;
        return !!window.IS_ADMIN;
      }

      async function loadMyRanking(){
        const uid = getUid();
        const db = getDb();
        if(!uid || !db) return null;
        try {
          if(await ensureAdminStatus()) return null;
          if(!getTag()) return null;

          const [lbSnap, adSnap] = await Promise.all([
            db.ref('leaderboard').once('value'),
            db.ref('admins').once('value')
          ]);
          const obj = lbSnap.val() || {};
          const admins = adSnap.val() || {};

          const arr = Object.entries(obj)
            .filter(([entryUid, info]) => {
              if(admins[entryUid] === true) return false;
              if(!info.tag) return false;
              return true;
            })
            .map(([entryUid, info]) => ({uid:entryUid, elo: info.elo||1200}))
            .sort((a,b) => b.elo - a.elo);
          const idx = arr.findIndex(x => x.uid === uid);
          if(idx === 0) return 1;
          if(idx === 1) return 2;
          if(idx === 2) return 3;
          return null;
        } catch(_){
          return null;
        }
      }

      window.openTitlesModal = async function(){
        const db = getDb();
        const uid = getUid();
        document.getElementById('titlesModal').classList.add('show');
        const list = document.getElementById('titlesList');
        list.innerHTML = '<div class="empty-small">로딩 중...</div>';
        if(!db || !uid){
          list.innerHTML = '<div class="empty-small">로그인이 필요합니다.</div>';
          return;
        }

        const tier = getMyTierTitle(getElo());
        myRanking = await loadMyRanking();

        let activeTitle = null;
        try {
          const snap = await db.ref('users/'+uid+'/activeTitle').once('value');
          activeTitle = snap.val();
        } catch(_){}

        if(Object.keys(getAchievements()).length === 0){
          try { await loadAchievements(); } catch(_){}
        }

        let ownedSpecial = {};
        try {
          const snap = await db.ref(`users/${uid}/ownedTitles`).once('value');
          ownedSpecial = snap.val() || {};
        } catch(_){}
        let myCoins = 0;
        try { myCoins = (await db.ref(`users/${uid}/coins`).once('value')).val() || 0; } catch(_){}

        const isAdmin = await ensureAdminStatus();
        const titles = [];

        const TIERS = [
          { id:'tier_bronze',   name:'🥉 브론즈',    color:'#cd7f32', minElo:0 },
          { id:'tier_silver',   name:'🥈 실버',      color:'#bbb',    minElo:1200 },
          { id:'tier_gold',     name:'🥇 골드',      color:'#f5c842', minElo:1400 },
          { id:'tier_platinum', name:'🔷 플래티넘',  color:'#af52de', minElo:1600 },
          { id:'tier_diamond',  name:'💠 다이아몬드',color:'#5ac8fa', minElo:1800 }
        ];
        TIERS.forEach(T => {
          const earned = isAdmin || (getElo() >= T.minElo);
          titles.push({ id:T.id, name:T.name, color:T.color, desc:`ELO ${T.minElo}+`, earned, group:'티어' });
        });

        [
          { id:'rank_1', name:'👑 1위', color:'#ffd700', need:1 },
          { id:'rank_2', name:'🥈 2위', color:'#c0c0c0', need:2 },
          { id:'rank_3', name:'🥉 3위', color:'#cd7f32', need:3 }
        ].forEach(R => {
          const earned = isAdmin || (myRanking === R.need);
          titles.push({ id:R.id, name:R.name, color:R.color, desc:`전체 랭킹 ${R.need}위`, earned, group:'순위' });
        });

        achievements.forEach(a => {
          const earned = isAdmin || !!getAchievements()[a.id];
          const c = getAchColor(a);
          titles.push({
            id: 'ach_' + a.id,
            name: a.name,
            color: c.type === 'gradient' ? null : c.value,
            gradient: c.type === 'gradient' ? c.value : null,
            desc: a.desc,
            earned,
            group: '업적'
          });
        });

        Object.entries(ownedSpecial).forEach(([name, info]) => {
          if(info && info.source === 'shop') return;
          titles.push({
            id: 'sp_' + name,
            name: name,
            color: (info && info.color) || '#f5c842',
            desc: (info && info.source === 'admin') ? '어드민 지급' : '데일리 상자 보상',
            earned: true,
            group: '특수'
          });
        });

        const groups = ['티어','순위','업적','특수'];
        let html = '';
        groups.forEach(g => {
          const inGroup = titles.filter(t => t.group === g);
          if(inGroup.length === 0) return;
          html += `<div class="title-group-header">${g}</div>`;
          html += inGroup.map(t => {
            const isActive = (activeTitle === t.id);
            const colorStyle = t.gradient
              ? `background:${t.gradient};-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800`
              : (t.earned ? `color:${t.color}` : '');
            const equipPayload = encodeURIComponent(JSON.stringify({id:t.id, name:t.name, color: t.color || '#f5c842', gradient: t.gradient || ''}));
            return `
              <div class="title-item ${t.earned?'earned':'locked'} ${isActive?'active':''}" style="${isActive ? `border-color:${t.color||'#f5c842'}` : ''}">
                <div class="title-info-row">
                  <div class="title-name" style="${colorStyle}">${escapeHtml(t.name)}</div>
                  <div class="title-desc">${escapeHtml(t.desc)}</div>
                </div>
                ${t.earned
                  ? `<button class="title-equip-btn ${isActive?'unequip':''}" onclick="${isActive?'unequipTitle()':`equipTitleEnc('${equipPayload}')`}">${isActive?'해제':'끼우기'}</button>`
                  : '<div class="title-locked-badge">🔒</div>'}
              </div>
            `;
          }).join('');
        });

        let shopHtml = `<div class="title-group-header">🛒 상점 · 보유 ${myCoins} C</div>`;
        shopHtml += SHOP_TITLES.map(s => {
          const owned = !!ownedSpecial[s.name];
          const isActive = (activeTitle === ('sp_' + s.name));
          const equipPayload = encodeURIComponent(JSON.stringify({id:'sp_'+s.name, name:s.name, color:s.color, gradient:''}));
          const canBuy = myCoins >= s.price;
          let right;
          if(owned){
            right = `<button class="title-equip-btn ${isActive?'unequip':''}" onclick="${isActive?'unequipTitle()':`equipTitleEnc('${equipPayload}')`}">${isActive?'해제':'끼우기'}</button>`;
          } else {
            right = `<button class="title-equip-btn" ${canBuy?'':'disabled'} style="${canBuy?'':'opacity:.4;cursor:not-allowed'}" onclick="${canBuy?`buyTitle('${encodeURIComponent(s.name)}',${s.price},'${s.color}')`:''}">구매 ${s.price} C</button>`;
          }
          return `
            <div class="title-item ${owned?'earned':'locked'} ${isActive?'active':''}" style="${isActive ? `border-color:${s.color}` : ''}">
              <div class="title-info-row">
                <div class="title-name" style="color:${s.color}">${escapeHtml(s.name)}</div>
                <div class="title-desc">${owned?'보유 중':(s.price+' C로 구매')}</div>
              </div>
              ${right}
            </div>`;
        }).join('');
        html += shopHtml;
        list.innerHTML = html;
      };

      window.equipTitleEnc = function(encoded){
        try {
          const obj = JSON.parse(decodeURIComponent(encoded));
          window.equipTitle(obj.id, obj.name, obj.color, obj.gradient || '');
        } catch(e){
          alert('파싱 실패: ' + e.message);
        }
      };

      window.equipTitle = async function(id, name, color, gradient){
        const db = getDb();
        const uid = getUid();
        if(!uid || !db) return;
        try {
          const updates = {
            activeTitle: id,
            activeTitleName: name,
            activeTitleColor: color || '#f5c842'
          };
          if(gradient) updates.activeTitleGradient = gradient;
          else updates.activeTitleGradient = null;

          await db.ref('users/'+uid).update(updates);
          await db.ref('leaderboard/'+uid).update(updates);
          setTitleState({id, name, color: color || '#f5c842', gradient: gradient || ''});
          await renderProfile();
          await window.openTitlesModal();
        } catch(e){
          alert('칭호 끼우기 실패: ' + e.message);
        }
      };

      async function clearActiveTitleInLobby(uid=getUid()){
        const db = getDb();
        if(!uid || !db) return;
        const fields = ['activeTitle', 'activeTitleName', 'activeTitleColor', 'activeTitleGradient'];
        const refs = [];
        fields.forEach(field => {
          refs.push(db.ref(`users/${uid}/${field}`).remove());
          refs.push(db.ref(`leaderboard/${uid}/${field}`).remove());
        });
        await Promise.all(refs);
        setTitleState({id:null, name:null, color:null, gradient:''});
      }

      window.unequipTitle = async function(){
        const uid = getUid();
        if(!uid || !getDb()) return;
        try {
          await clearActiveTitleInLobby(uid);
          await renderProfile();
          await window.openTitlesModal();
        } catch(e){
          alert('칭호 해제 실패: ' + e.message);
        }
      };

      window.buyTitle = async function(encName, price, color){
        const db = getDb();
        const uid = getUid();
        if(!uid || !db){ alert('로그인이 필요합니다.'); return; }
        const name = decodeURIComponent(encName);
        try {
          const cur = (await db.ref(`users/${uid}/coins`).once('value')).val() || 0;
          if(cur < price){ alert('코인(C)이 부족합니다.'); return; }
          const own = (await db.ref(`users/${uid}/ownedTitles/${name}`).once('value')).val();
          if(own){ alert('이미 보유한 칭호입니다.'); return; }
          await db.ref(`users/${uid}/coins`).set(cur - price);
          await db.ref(`users/${uid}/ownedTitles/${name}`).set({ color, unlockedAt: Date.now(), source: 'shop' });
          await window.openTitlesModal();
        } catch(e){
          alert('구매 실패: ' + e.message);
        }
      };

      window.closeTitlesModal = function(){
        document.getElementById('titlesModal').classList.remove('show');
      };

      async function unsetInactiveTitleInLobby(){
        const db = getDb();
        const uid = getUid();
        if(!uid || !db) return;
        try {
          const snap = await db.ref(`users/${uid}/activeTitle`).once('value');
          const active = snap.val();
          if(!active) return;
          if(await ensureAdminStatus()) return;

          let shouldUnset = false;
          let reason = '';
          const TIER_MIN = { tier_diamond:1800, tier_platinum:1600, tier_gold:1400, tier_silver:1200, tier_bronze:0 };
          if(TIER_MIN[active] !== undefined && getElo() < TIER_MIN[active]){
            shouldUnset = true;
            reason = `tier ${getElo()}<${TIER_MIN[active]}`;
          }
          if(active === 'rank_1' || active === 'rank_2' || active === 'rank_3'){
            const r = await loadMyRanking();
            const req = active === 'rank_1' ? 1 : active === 'rank_2' ? 2 : 3;
            if(r !== req){
              shouldUnset = true;
              reason = `rank ${r || '-'}!=${req}`;
            }
          }
          if(active.startsWith('ach_')){
            const achId = active.slice(4);
            if(Object.keys(getAchievements()).length === 0){
              await loadAchievements();
            }
            if(!getAchievements()[achId]){
              shouldUnset = true;
              reason = `achievement ${achId} missing`;
            }
          }
          if(active.startsWith('sp_')){
            const titleName = active.slice(3);
            const ownSnap = await db.ref(`users/${uid}/ownedTitles/${titleName}`).once('value');
            if(!ownSnap.exists()){
              shouldUnset = true;
              reason = `owned title ${titleName} missing`;
            }
          }
          if(shouldUnset){
            await clearActiveTitleInLobby(uid);
            console.log('[title] 로비에서 자동 해제:', active, reason);
          }
        } catch(e){
          console.warn('[title] 자동 해제 실패:', e.message);
        }
      }

      return {
        clearActiveTitleInLobby,
        ensureAdminStatus,
        getMyTierTitle,
        loadMyRanking,
        unsetInactiveTitleInLobby
      };
    }
  };
})();
