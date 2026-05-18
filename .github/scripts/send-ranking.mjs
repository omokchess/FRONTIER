// FRONTIER — 매일 자정 디스코드 랭킹 전송
// secrets:
//   FIREBASE_DB_URL — https://<project>.firebaseio.com 또는 *.firebasedatabase.app
//   DISCORD_WEBHOOK_URL — Discord 채널 웹훅 URL

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

if (!FIREBASE_DB_URL || !DISCORD_WEBHOOK_URL) {
  console.error('환경변수 누락: FIREBASE_DB_URL 또는 DISCORD_WEBHOOK_URL');
  process.exit(1);
}

// ─────────────────────────────────────────────
// 헬퍼: KST 오늘 날짜
function todayKST() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// 티어 분류 (FRONTIER 시스템과 동일)
function tierOf(elo) {
  if (elo >= 1800) return { name: '다이아', color: '#5ac8fa', emoji: '💎' };
  if (elo >= 1600) return { name: '플래티넘', color: '#a259ff', emoji: '💠' };
  if (elo >= 1400) return { name: '골드',     color: '#f5c842', emoji: '📀' };
  if (elo >= 1200) return { name: '실버',     color: '#c0c0c0', emoji: '💿' };
  return { name: '브론즈', color: '#cd7f32', emoji: '⚱️' };
}

function rankIcon(i) {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `**${i + 1}.**`;
}

// ─────────────────────────────────────────────
// 1. Firebase에서 leaderboard 가져오기
async function fetchLeaderboard() {
  const url = `${FIREBASE_DB_URL.replace(/\/$/, '')}/leaderboard.json`;
  console.log('[1/3] Firebase fetch:', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Firebase ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data || typeof data !== 'object') {
    console.warn('leaderboard 비어있음');
    return [];
  }
  const arr = Object.entries(data).map(([uid, u]) => ({ uid, ...u }));
  return arr;
}

// ─────────────────────────────────────────────
// 2. 메시지 빌드
function buildEmbed(arr) {
  // 일반 ELO 정렬 (전적 1게임 이상만)
  const normalArr = arr
    .filter(u => (u.w || 0) + (u.l || 0) + (u.d || 0) > 0)
    .sort((a, b) => (b.elo || 1200) - (a.elo || 1200))
    .slice(0, 10);

  // 물약 모드 ELO 정렬 (전적 1게임 이상만)
  const potionArr = arr
    .filter(u => (u.potionW || 0) + (u.potionL || 0) + (u.potionD || 0) > 0)
    .sort((a, b) => (b.potionElo || 1200) - (a.potionElo || 1200))
    .slice(0, 10);

  const today = todayKST();
  const embeds = [];

  // 일반 모드 랭킹
  if (normalArr.length > 0) {
    const lines = normalArr.map((u, i) => {
      const t = tierOf(u.elo || 1200);
      const name = (u.nick || '익명') + (u.tag ? ` \`#${u.tag}\`` : '');
      const w = u.w || 0, l = u.l || 0, d = u.d || 0;
      return `${rankIcon(i)} ${t.emoji} **${name}** — \`${u.elo || 1200}\` ELO (${w}승 ${l}패${d ? ` ${d}무` : ''})`;
    });
    embeds.push({
      title: '🏆 FRONTIER 일일 랭킹 — 일반 모드',
      description: lines.join('\n') || '_데이터 없음_',
      color: 0xf5c842, // 골드
      footer: { text: `${today} KST 자정 기준` },
      timestamp: new Date().toISOString(),
    });
  }

  // 물약 모드 랭킹 (있을 때만)
  if (potionArr.length > 0) {
    const lines = potionArr.map((u, i) => {
      const t = tierOf(u.potionElo || 1200);
      const name = (u.nick || '익명') + (u.tag ? ` \`#${u.tag}\`` : '');
      const w = u.potionW || 0, l = u.potionL || 0, d = u.potionD || 0;
      return `${rankIcon(i)} ${t.emoji} **${name}** — \`${u.potionElo || 1200}\` ELO (${w}승 ${l}패${d ? ` ${d}무` : ''})`;
    });
    embeds.push({
      title: '🧪 FRONTIER 일일 랭킹 — 물약 모드',
      description: lines.join('\n') || '_데이터 없음_',
      color: 0xbf5af2, // 보라
      footer: { text: `${today} KST 자정 기준` },
      timestamp: new Date().toISOString(),
    });
  }

  // 데이터가 아예 없으면
  if (embeds.length === 0) {
    embeds.push({
      title: '🏆 FRONTIER 일일 랭킹',
      description: '오늘은 랭킹전 게임이 없었습니다.',
      color: 0x808080,
      footer: { text: `${today} KST 자정 기준` },
      timestamp: new Date().toISOString(),
    });
  }

  return embeds;
}

// ─────────────────────────────────────────────
// 3. Discord 웹훅 전송
async function sendToDiscord(embeds) {
  console.log(`[3/3] Discord 전송 (${embeds.length} embeds)`);
  const payload = {
    username: 'FRONTIER 랭킹봇',
    avatar_url: 'https://frontier-5h9.pages.dev/icon-192.png',
    embeds,
  };
  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Discord ${res.status}: ${txt}`);
  }
  console.log('전송 성공');
}

// ─────────────────────────────────────────────
(async () => {
  try {
    const arr = await fetchLeaderboard();
    console.log(`[2/3] 사용자 ${arr.length}명 로드`);
    const embeds = buildEmbed(arr);
    await sendToDiscord(embeds);
  } catch (e) {
    console.error('실패:', e.message);
    // 실패해도 Discord에 알림 (선택)
    try {
      await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'FRONTIER 랭킹봇',
          content: `⚠ 랭킹 전송 실패: ${e.message}`,
        }),
      });
    } catch (_) {}
    process.exit(1);
  }
})();
