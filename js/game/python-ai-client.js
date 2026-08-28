/* FRONTIER Python AI bridge. Load this after FRONTIER's main game script. */
(() => {
  const q = new URLSearchParams(location.search);
  const enabled = q.get('pyai') === '1';
  const apiBase = (q.get('aiapi') || window.FRONTIER_AI_API || '').replace(/\/$/, '');
  const simulations = Math.max(1, Math.min(250, Number(q.get('aisims') || 32)));
  // 요청 타임아웃(ms).
  // 실측(Render 무료 티어, 워밍업 후): 시뮬레이션 1회에도 기저 10초, 32회면 26초.
  // 20초로 잡았더니 '어려움'은 항상 타임아웃 → 사실상 Python AI가 한 번도
  // 못 두고 내장 AI로만 돌았다. 서버 쪽 병목(tactical_action)을 줄였지만
  // 무료 티어 CPU라 여유를 둔다.
  const DEFAULT_TIMEOUT_MS = 40000;
  const requestedTimeoutMs = Number(q.get('aitimeout') || DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(3000, requestedTimeoutMs)
    : DEFAULT_TIMEOUT_MS;
  if (!enabled || !apiBase || typeof aiTurn !== 'function') return;
  const fallbackAiTurn = aiTurn;
  // Render 무료 티어는 유휴 시 잠듦 → 게임 로드 즉시 서버를 깨워, 기물 배치하는 동안 워밍업 →
  // 첫 AI 수부터 강한 Python AI가 준비됨 (폴백은 깨어나는 동안만 일시적).
  try { fetch(`${apiBase}/api/health`, { method:'GET', cache:'no-store' }).catch(()=>{}); } catch(_){}
  const jsonifyBoard = () => board.map(row => row.map(p => p ? { color:p.color, kind:p.kind, ...(p.kind === 'SN' ? {attacks:p.attacks || 0} : {}) } : null));
  const statePayload = () => ({
    board: jsonifyBoard(), hands: {w:{...hands.w}, b:{...hands.b}}, turn,
    kingPlaced:{...kingPlaced}, checkStreak:{...checkStreak}, totalChecks:{...totalChecks},
    history: Array.isArray(moveHistory) ? [...moveHistory] : [], potion: !!IS_POTION
  });
  async function requestMove() {
    // 타임아웃: 응답이 없으면 abort → catch에서 내장 AI로 폴백 (무한 대기 방지)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetch(`${apiBase}/api/move`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({state: statePayload(), simulations}),
        signal: ctrl.signal
      });
      if (!response.ok) throw new Error(`AI API ${response.status}: ${await response.text()}`);
      const body = await response.json();
      if (!body.ok || !body.action) throw new Error(body.reason || 'AI returned no action');
      return body.action;
    } finally {
      clearTimeout(timer);
    }
  }
  aiTurn = async function remotePythonAiTurn() {
    if (gameOver) return;
    const aiColor = IS_AIVAI ? turn : 'b';
    if (turn !== aiColor) return;
    // Python 엔진은 8x8 고정이고 물약 상태를 모른다 — 두 경우 모두 내장 AI로
    if (IS_POTION) { console.warn('Python AI v1 excludes potion mode; falling back to browser AI.'); return fallbackAiTurn(); }
    if (typeof IS_XL !== 'undefined' && IS_XL) { console.warn('Python AI is 8x8-only; XL falls back to browser AI.'); return fallbackAiTurn(); }
    // 공성추는 frontier_ai/game.py에 아직 없다. 손패나 판에 하나라도 있으면
    // 서버가 판을 잘못 읽고 불법 수를 돌려주므로 아예 보내지 않는다.
    const hasRam = (hands.w.RM > 0 || hands.b.RM > 0) ||
      board.some(row => row.some(p => p && p.kind === 'RM'));
    if (hasRam) { console.warn('Python AI does not know the ram (RM); falling back to browser AI.'); return fallbackAiTurn(); }
    showAIThinking(true, IS_AIVAI ? aiColor : null);
    try {
      const action = await requestMove();
      if (gameOver || turn !== aiColor) return;
      action.color = aiColor;
      // 서버가 준 수가 이쪽 규칙으로 불법이면 submitAction이 조용히 거절하고 끝나
      // AI 턴이 그대로 소진된다 → 게임이 영영 멈춘다.
      // 배포된 Python 엔진과 JS 룰 버전이 어긋나면 실제로 일어난다.
      // 넘기기 전에 여기서 먼저 검증하고, 불법이면 내장 AI로 넘긴다.
      const snap = snapshotState();
      const probe = applyAction(action, { silent: true });
      restoreState(snap);
      if (!probe.ok) {
        console.warn('Python AI가 불법 수를 반환 — 내장 AI로 전환:', probe.err, action);
        if (typeof showFlash === 'function') showFlash('AI 응답이 규칙과 불일치 — 내장 AI로 진행', 2600);
        return fallbackAiTurn();
      }
      submitAction(action);
    } catch (err) {
      console.error('Python AI 연결 실패, 내장 AI로 전환:', err);
      const msg = (err && err.name === 'AbortError')
        ? 'AI 서버 응답 지연 — 내장 AI로 진행'
        : 'AI 서버 연결 실패 — 내장 AI로 진행';
      if (typeof showFlash === 'function') showFlash(msg, 2600);
      fallbackAiTurn();
    } finally { showAIThinking(false); }
  };
  console.info(`FRONTIER Python AI enabled: ${apiBase} simulations=${simulations}`);
})();
