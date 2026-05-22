// FRONTIER — 매일 자정 디스코드 랭킹 전송
// 환경 변수:
//   FIREBASE_DB_URL — https://<project>.firebasedatabase.app
//   DISCORD_WEBHOOK_URL — https://discord.com/api/webhooks/1505849752535826443/7wWpHgov0CNvLZOBbXLQYwnIAS7kiczfkNI-vvtiEggff63RGzMP7VZNSHqxdaLk4xq0

// ⚠ 변수 이름은 secret 이름과 다르게 (GitHub Actions debug mode 마스킹 회피)
const FB_URL = process.env.FIREBASE_DB_URL;
const WH_URL = process.env.DISCORD_WEBHOOK_URL;

if (!FB_URL || !WH_URL) {
  console.error('환경변수 누락');
  process.exit(1);
}

function todayKST() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function rankLabel(i) {
  return '**' + (i + 1) + '위.**';
}

async function fetchLeaderboard() {
  const url = FB_URL.replace(/\/$/, '') + '/leaderboard.json';
  console.log('[1/3] Firebase fetch');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Firebase ' + res.status);
  const data = await res.json();
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).map(function(e) {
    return Object.assign({uid: e[0]}, e[1]);
  });
}

function buildEmbed(arr) {
  const normalArr = arr
    .filter(function(u) { return (u.w||0) + (u.l||0) + (u.d||0) > 0; })
    .sort(function(a, b) { return (b.elo||1200) - (a.elo||1200); })
    .slice(0, 10);

  const potionArr = arr
    .filter(function(u) { return (u.potionW||0) + (u.potionL||0) + (u.potionD||0) > 0; })
    .sort(function(a, b) { return (b.potionElo||1200) - (a.potionElo||1200); })
    .slice(0, 10);

  const today = todayKST();
  const embeds = [];

  if (normalArr.length > 0) {
    const lines = normalArr.map(function(u, i) {
      const name = (u.nick || '익명') + (u.tag ? ' `#' + u.tag + '`' : '');
      const w = u.w || 0, l = u.l || 0, d = u.d || 0;
      return rankLabel(i) + ' ' + name + '\n- `' + (u.elo || 1200) + ' ELO` (' + w + '승 ' + l + '패' + (d ? ' ' + d + '무' : '') + ')';
    });
    embeds.push({
      title: 'FRONTIER 일일 랭킹 — 일반 모드',
      description: lines.join('\n\n'),
      color: 0xf5c842,
      footer: { text: today + ' KST 자정 기준' },
      timestamp: new Date().toISOString()
    });
  }

  if (potionArr.length > 0) {
    const lines = potionArr.map(function(u, i) {
      const name = (u.nick || '익명') + (u.tag ? ' `#' + u.tag + '`' : '');
      const w = u.potionW || 0, l = u.potionL || 0, d = u.potionD || 0;
      return rankLabel(i) + ' ' + name + '\n* `' + (u.potionElo || 1200) + ' ELO` (' + w + '승 ' + l + '패' + (d ? ' ' + d + '무' : '') + ')';
    });
    embeds.push({
      title: 'FRONTIER 일일 랭킹 — 물약 모드',
      description: lines.join('\n\n'),
      color: 0xbf5af2,
      footer: { text: today + ' KST 자정 기준' },
      timestamp: new Date().toISOString()
    });
  }

  if (embeds.length === 0) {
    embeds.push({
      title: 'FRONTIER 일일 랭킹',
      description: '오늘은 랭킹전 게임이 없었습니다.',
      color: 0x808080,
      footer: { text: today + ' KST 자정 기준' },
      timestamp: new Date().toISOString()
    });
  }

  return embeds;
}

async function sendToDiscord(embeds) {
  console.log('[3/3] Discord 전송');
  const payload = {
    username: 'FRONTIER 랭킹봇',
    embeds: embeds
  };
  const res = await fetch(WH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('Discord ' + res.status + ': ' + txt);
  }
  console.log('전송 성공');
}

(async function() {
  try {
    const arr = await fetchLeaderboard();
    console.log('[2/3] 사용자 ' + arr.length + '명 로드');
    const embeds = buildEmbed(arr);
    await sendToDiscord(embeds);
  } catch (e) {
    console.error('실패:', e.message);
    try {
      await fetch(WH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'FRONTIER 랭킹봇',
          content: '⚠ 랭킹 전송 실패: ' + e.message
        })
      });
    } catch (_) {}
    process.exit(1);
  }
})();
