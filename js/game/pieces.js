/* ===================================================================
   기물 SVG — 유니코드 글리프(♔♕♖…, ⬢⊕✦) 대체.
   특수 기물 3종이 ⬢/⊕/✦ 라 생김새만 보고는 뭔지 알 수 없었다.
   특히 XL 모드는 모든 기물이 강화돼서 구분이 더 중요해졌다.

   설계
   - 모든 기물 viewBox 0 0 45 45 (체스 SVG 관례) → 어느 크기에도 같은 비율
   - 색은 두 값만: 채움(--pc-fill) / 윤곽(--pc-line). 백=밝은 채움+어두운 선,
     흑=어두운 채움+밝은 선. 밝은 칸/어두운 칸, 낮/밤 어디서도 읽힌다.
   - 특수 기물도 나머지와 같은 받침대를 공유해 '기물'로 읽히게 하고,
     머리 모양으로만 구분한다: 방패=방패 몸통, 스나이퍼=조준경 얹은 탑,
     어쌔신=후드 쓴 형체. (기호처럼 그렸더니 판 위에서 혼자 이질적이었다)
   노출: window.pieceSvg(kind, color, size)
   =================================================================== */
(() => {
  // 공통 받침대 (킹/퀸/룩/비숍/폰이 공유)
  const BASE = '<path d="M9 36h27v4H9z"/><path d="M11 32h23v4H11z"/>';

  const SHAPES = {
    // 킹 — 십자 + 왕관 몸통
    K: `<path d="M22.5 5v7M19 8h7"/>
        <path d="M22.5 13c-4 0-7 3-7 7 0 4 3 6 3 12h8c0-6 3-8 3-12 0-4-3-7-7-7z"/>
        <path d="M13 22c-2-3-6-2-6 2s4 5 8 5M32 22c2-3 6-2 6 2s-4 5-8 5"/>
        ${BASE}`,
    // 퀸 — 다섯 꼭짓점 왕관 + 구슬
    Q: `<circle cx="8" cy="12" r="2.6"/><circle cx="15.5" cy="8.5" r="2.6"/>
        <circle cx="22.5" cy="7" r="2.8"/><circle cx="29.5" cy="8.5" r="2.6"/>
        <circle cx="37" cy="12" r="2.6"/>
        <path d="M9 14l3.5 18h20L36 14l-5.5 7-3-11-5 11-5-11-3 11z"/>
        ${BASE}`,
    // 룩 — 성탑 + 총안
    R: `<path d="M11 8h5v4h4V8h5v4h4V8h5v8l-3 3v13l3 3v4H11v-4l3-3V19l-3-3z"/>`,
    // 비숍 — 주교관 + 세로 틈
    B: `<circle cx="22.5" cy="8" r="2.8"/>
        <path d="M22.5 11c-5 0-9 6-9 11 0 4 2 6 4 8h10c2-2 4-4 4-8 0-5-4-11-9-11z"/>
        <path d="M22.5 15v9M18.5 19.5h8"/>
        ${BASE}`,
    // 나이트 — 왼쪽을 향한 말 머리 옆모습 (주둥이·귀·목선)
    N: `<path d="M10 21c0-5 4-9 9-10.5L17.5 4l8 4.5c6.5 2 9 8.5 9 16.5V32H13.5c0-5 3.5-7.5 7-9.5
                c-4 0-8 0-10.5-1.5z"/>
        <circle cx="21.5" cy="13.5" r="1.5" class="pc-dot"/>
        <circle cx="12.8" cy="19.6" r="1" class="pc-dot"/>
        <path d="M24 9.5c3 2 5 5 5.5 9" class="pc-mark"/>
        ${BASE}`,
    // 폰 — 구슬 + 목 + 받침
    P: `<circle cx="22.5" cy="12" r="5.2"/>
        <path d="M17 20h11l3 12H14z"/>
        ${BASE}`,

    // ===== 특수 기물 — 행마법이 드러나게 =====
    // 방패: 방패 몸통 + 위아래 꺾쇠 (앞뒤 직진). 받침대를 공유해 기물로 읽힌다.
    SH: `<path d="M22.5 6L32 9.5V18c0 7-4.5 11.5-9.5 14-5-2.5-9.5-7-9.5-14V9.5z"/>
         <path d="M17.5 19l5-5 5 5M17.5 22l5 5 5-5" class="pc-mark"/>
         ${BASE}`,
    // 스나이퍼: 조준경 머리를 얹은 탑 (제자리 원거리). 좌우·위 눈금이 사거리를 뜻한다.
    SN: `<path d="M17.5 17h10l2.5 15H15z"/>
         <circle cx="22.5" cy="11" r="6.5"/>
         <circle cx="22.5" cy="11" r="2.4" class="pc-mark"/>
         <path d="M13 11h3M29 11h3M22.5 2.5v3" class="pc-mark"/>
         ${BASE}`,
    // 어쌔신: 후드 쓴 형체 + 얼굴 틈 (2칸 도약)
    JP: `<path d="M22.5 4c5.5 2 9 7 8.5 13-.5 7-4 12-8.5 15-4.5-3-8-8-8.5-15C13.5 11 17 6 22.5 4z"/>
         <path d="M18 17h9" class="pc-mark"/>
         ${BASE}`,
  };

  // 백/흑 팔레트. 채움과 윤곽을 뒤집기만 하면 두 진영이 나온다.
  const PALETTE = {
    w: { fill: '#F7F5EF', line: '#16181A' },
    b: { fill: '#1D2226', line: '#F2F0EA' }
  };

  window.pieceSvg = function pieceSvg(kind, color, size){
    const shape = SHAPES[kind];
    if(!shape) return '';
    const p = PALETTE[color] || PALETTE.w;
    const px = size ? `width="${size}" height="${size}"` : 'width="100%" height="100%"';
    // stroke-width는 viewBox 기준 고정 → 크기가 변해도 선 굵기 비율이 유지된다
    return `<svg class="pc-svg pc-${color}" viewBox="0 0 45 45" ${px}
      fill="${p.fill}" stroke="${p.line}" stroke-width="2.2"
      stroke-linejoin="round" stroke-linecap="round"
      style="display:block;overflow:visible">
      <g>${shape.replace(/class="pc-mark"/g, `fill="none" stroke="${p.line}" stroke-width="2"`)
                 .replace(/class="pc-dot"/g, `fill="${p.line}" stroke="none"`)}</g>
    </svg>`;
  };

  // 텍스트 흐름 안에 끼워 넣을 때 (기보/리플레이 로그 등)
  window.pieceSvgInline = function pieceSvgInline(kind, color, size){
    return `<span class="pc-inline" style="width:${size}px;height:${size}px">${
      window.pieceSvg(kind, color, size)}</span>`;
  };
})();
