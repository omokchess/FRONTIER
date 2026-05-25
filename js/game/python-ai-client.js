/* FRONTIER Python AI bridge. Load this after FRONTIER's main game script. */
(() => {
  const q = new URLSearchParams(location.search);
  const enabled = q.get('pyai') === '1';
  const apiBase = (q.get('aiapi') || window.FRONTIER_AI_API || '').replace(/\/$/, '');
  const simulations = Math.max(1, Math.min(250, Number(q.get('aisims') || 32)));
  // 요청 타임아웃(ms). Render 무료 티어 콜드스타트(~14s) 고려 기본 15s. 초과 시 내장 AI로 폴백.
  const timeoutMs = Math.max(3000, Number(q.get('aitimeout') || 15000));
  if (!enabled || !apiBase || typeof aiTurn !== 'function') return;
  const fallbackAiTurn = aiTurn;
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
    if (IS_POTION) { console.warn('Python AI v1 excludes potion mode; falling back to browser AI.'); return fallbackAiTurn(); }
    showAIThinking(true, IS_AIVAI ? aiColor : null);
    try {
      const action = await requestMove();
      if (gameOver || turn !== aiColor) return;
      action.color = aiColor;
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
