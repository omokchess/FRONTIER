/* ===================================================================
   기물 SVG — 유니코드 글리프(♔♕♖…, ⬢⊕✦) 대체.
   특수 기물 3종이 ⬢/⊕/✦ 라 생김새만 보고는 뭔지 알 수 없었다.
   특히 XL 모드는 모든 기물이 강화돼서 구분이 더 중요해졌다.

   설계
   - 모든 기물 viewBox 0 0 45 45 (체스 SVG 관례) → 어느 크기에도 같은 비율
   - 색은 두 값만: 채움(--pc-fill) / 윤곽(--pc-line). 백=밝은 채움+어두운 선,
     흑=어두운 채움+밝은 선. 밝은 칸/어두운 칸, 낮/밤 어디서도 읽힌다.
   - 특수 기물도 나머지와 같은 받침대를 공유해 '기물'로 읽히게 하고,
     머리 모양으로만 구분한다: 방패=방패 몸통, 발리스타=조준경 얹은 탑,
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
    R: `<path d="M11 8h5v4h4V8h5v4h4V8h5v8l-3 3v11l3 3H12l3-3V19l-3-3z"/>
        ${BASE}`,
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
    // 방패: 방패 몸통 + 향한 축의 꺾쇠. 받침대를 공유해 기물로 읽힌다.
    // 축('v' 세로 / 'h' 가로)이 상대에게도 보여야 하므로 꺾쇠를 90도 돌린다.
    SH: axis => `<path d="M10 7h25v13c0 7-5.5 11-12.5 14C15.5 31 10 27 10 20z"/>
         <path d="M10 12h25" class="pc-mark"/>
         <g${axis === 'h' ? ' transform="rotate(90 22.5 21)"' : ''}>
           <path d="M17 19l5.5-5 5.5 5M17 24l5.5 5 5.5-5" class="pc-mark"/>
         </g>
         ${BASE}`,
    // 발리스타: 받침대 위에 얹힌 거치식 쇠뇌. 제자리에서 쏘는 기물이라
    // 다리(가대)를 벌려 '움직이지 않는다'를 형태로 보이게 했다.
    // 활대 + 당겨진 시위 + 재어진 화살 = 원거리 공격이 한눈에 읽힌다.
    SN: `<path d="M14 22l4.5 10h8L31 22z"/>
         <path d="M11 14c3.5 3 4.5 6 4.5 9M34 14c-3.5 3-4.5 6-4.5 9" class="pc-mark"/>
         <path d="M11 14l11 5 12-5" class="pc-mark"/>
         <path d="M22.5 6v14M19 9l3.5-3.5L26 9" class="pc-mark"/>
         ${BASE}`,
    // 공성추: 바퀴 달린 수레 + 매달린 통나무. 앞으로 튀어나온 머리가
    // '지정한 칸으로 돌진한다'를 읽히게 한다. 받침대는 바퀴가 대신한다.
    RM: `<path d="M9 20h27v5H9z"/>
         <path d="M13 20V13M32 20V13M11 13h23" class="pc-mark"/>
         <path d="M6 27h33l-2.5 5H8.5z"/>
         <circle cx="14" cy="36" r="4"/><circle cx="31" cy="36" r="4"/>
         <path d="M18 16.5h14v4H18z"/>
         <path d="M32 18.5h6" class="pc-mark"/>`,
    // 어쌔신: 교차한 단검 두 자루. 후드 형체는 다른 기물의 '몸통' 실루엣과
    // 뭉쳐 보여서, 겹친 X자 쪽이 멀리서도 구분된다.
    JP: `<path d="M13 8l3-2 12 17 1.5 5-4.5-2.5z"/>
         <path d="M32 8l-3-2-12 17-1.5 5 4.5-2.5z"/>
         <path d="M18.5 17.5h8" class="pc-mark"/>
         ${BASE}`,
  };

  // ===================================================================
  // XL 전용 강화 기물
  // 기본 실루엣을 유지하되 '덧붙은 행마법'이 형태로 드러나게 한다.
  //   Q·R·B는 나이트 행마를 얻으므로 축소 말머리를 얹는다 (체스 변종의 관례:
  //   아마존/챈슬러/아크비숍은 원래 해당 기물 + 나이트 머리로 그린다)
  //   N은 킹 행마를 얻으므로 십자를, 나머지는 늘어난 방향을 눈금으로.
  // ===================================================================

  // 축소 말머리 — 강화 표식. transform으로 위치·크기를 잡는다.
  // (scale이 stroke도 같이 줄여서 작은 표식이 가늘어지는 게 오히려 자연스럽다)
  const miniKnight = (cx, cy, k) =>
    `<path transform="translate(${cx} ${cy}) scale(${k}) translate(-6 -7)"
       d="M0 13c0-3.4 2-6 4.8-7.2L3.4 0l5 2.8C11.4 4.2 13 7 13 10.6V14H1z"/>`;

  const XL_SHAPES = {
    // 아마존 — 퀸 왕관 가운데 구슬을 말머리로
    Q: `<circle cx="8" cy="12.5" r="2.5"/><circle cx="15" cy="10" r="2.3"/>
        <circle cx="30" cy="10" r="2.3"/><circle cx="37" cy="12.5" r="2.5"/>
        <path d="M9 15l3.5 17h20L36 15l-5 6-3-8-5.5 8-5.5-8-3 8z"/>
        ${miniKnight(22.5, 8, 0.62)}
        ${BASE}`,
    // 챈슬러 — 성탑 위로 말머리
    R: `<path d="M11 14h5v3h4v-3h5v3h4v-3h5v5l-3 3v8l3 3H12l3-3V22l-3-3z"/>
        ${miniKnight(22.5, 7, 0.58)}
        ${BASE}`,
    // 아크비숍 — 주교관 꼭대기 구슬 대신 말머리
    B: `<path d="M22.5 14c-5 0-9 6-9 11 0 3.5 2 5.5 4 7h10c2-1.5 4-3.5 4-7 0-5-4-11-9-11z"/>
        <path d="M22.5 18v8M18.5 22h8"/>
        ${miniKnight(22.5, 8.5, 0.58)}
        ${BASE}`,
    // 켄타우로스 — 말머리 + 킹의 십자 (킹 행마 획득)
    N: `<path d="M10 23c0-5 4-9 9-10.5L17.5 7l8 4.5c6.5 2 9 8.5 9 16.5V32H13.5c0-5 3.5-7.5 7-9.5
                c-4 0-8 0-10.5-1.5z"/>
        <circle cx="21.5" cy="15.5" r="1.4" class="pc-dot"/>
        <circle cx="12.8" cy="21.6" r="1" class="pc-dot"/>
        <path d="M30 2v7M26.5 5.5h7" class="pc-mark"/>
        ${BASE}`,
    // 강화 폰 — 좌우 화살표 (옆 한 칸 이동)
    P: `<circle cx="22.5" cy="12" r="5.2"/>
        <path d="M17 20h11l3 12H14z"/>
        <path d="M12.5 25.5h-4M8.5 25.5l2.2-2.2M8.5 25.5l2.2 2.2
                 M32.5 25.5h4M36.5 25.5l-2.2-2.2M36.5 25.5l-2.2 2.2" class="pc-mark"/>
        ${BASE}`,
    // 강화 방패 — 꺾쇠 두 겹 (한 번에 두 칸), 축에 따라 회전
    SH: axis => `<path d="M8 6h29v14c0 7.5-6.5 12-14.5 15C14.5 32 8 27.5 8 20z"/>
         <path d="M8 11.5h29" class="pc-mark"/>
         <g${axis === 'h' ? ' transform="rotate(90 22.5 22)"' : ''}>
           <path d="M16.5 17l6-4.5 6 4.5M16.5 21.5l6-4.5 6 4.5
                    M16.5 24.5l6 4.5 6-4.5M16.5 29l6 4.5 6-4.5" class="pc-mark"/>
         </g>
         ${BASE}`,
    // 강화 발리스타 — 활대가 더 크게 휘고 화살이 둘. 아래 끊긴 눈금은
    // '기물 하나를 관통해 그 너머까지' 를 뜻한다.
    SN: `<path d="M14 22l4.5 10h8L31 22z"/>
         <path d="M8 12c4.5 3.5 6 7 6 11M37 12c-4.5 3.5-6 7-6 11" class="pc-mark"/>
         <path d="M8 12l14.5 6L37 12" class="pc-mark"/>
         <path d="M19.5 5v13M17 8l2.5-3 2.5 3M25.5 5v13M23 8l2.5-3 2.5 3" class="pc-mark"/>
         <path d="M6 27h4M12 27h4M29 27h4M35 27h4" class="pc-mark"/>
         ${BASE}`,
    // 강화 공성추 — 머리에 쇠촉이 붙고 바퀴가 셋. 앞으로 뻗은 눈금은
    // 사거리가 아니라 '더 멀리, 더 세게 민다'는 표식이다.
    RM: `<path d="M8 19h29v5H8z"/>
         <path d="M12 19V11M33 19V11M10 11h25" class="pc-mark"/>
         <path d="M4 26h37l-2.5 5H6.5z"/>
         <circle cx="11" cy="35" r="3.6"/><circle cx="22.5" cy="35" r="3.6"/><circle cx="34" cy="35" r="3.6"/>
         <path d="M15 15h17v4.5H15z"/>
         <path d="M32 13.5l5 3.5-5 3.5z"/>
         <path d="M39 17.5h3" class="pc-mark"/>`,
    // 알리바바 — 교차 단검 + 네 모서리 대각 눈금 (대각 2칸 도약 추가)
    JP: `<path d="M13 8l3-2 12 17 1.5 5-4.5-2.5z"/>
         <path d="M32 8l-3-2-12 17-1.5 5 4.5-2.5z"/>
         <path d="M18.5 17.5h8" class="pc-mark"/>
         <path d="M6 6l4 4M39 6l-4 4M6 28l4-4M39 28l-4-4" class="pc-mark"/>
         ${BASE}`
  };

  // 백/흑 팔레트. 채움과 윤곽을 뒤집기만 하면 두 진영이 나온다.
  const PALETTE = {
    w: { fill: '#F7F5EF', line: '#16181A' },
    b: { fill: '#1D2226', line: '#F2F0EA' }
  };

  // XL 모드에서는 강화 도형을 쓴다. engine.js의 IS_XL은 pieces.js보다 나중에
  // 정의되므로 호출 시점에 typeof로 확인한다 (로비에는 IS_XL 자체가 없다).
  const useXl = () => typeof IS_XL !== 'undefined' && IS_XL;

  window.pieceSvg = function pieceSvg(kind, color, size, forceXl, axis){
    const xl = forceXl === undefined ? useXl() : forceXl;
    const raw = (xl && XL_SHAPES[kind]) || SHAPES[kind];
    // 방패처럼 상태(축)에 따라 달라지는 기물은 도형이 함수로 정의돼 있다
    const shape = typeof raw === 'function' ? raw(axis || 'v') : raw;
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
  window.pieceSvgInline = function pieceSvgInline(kind, color, size, forceXl, axis){
    return `<span class="pc-inline" style="width:${size}px;height:${size}px">${
      window.pieceSvg(kind, color, size, forceXl, axis)}</span>`;
  };
})();
