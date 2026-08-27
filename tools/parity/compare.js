(async()=>{
const cases = await (await fetch('/_parity.json',{cache:'no-store'})).json();
const out=[];
for(const cs of cases){
  const st = cs.state;
  // Python 상태를 JS 전역에 그대로 싣는다
  board = st.board.map(row => row.map(c => c ? {...c} : null));
  hands = { w:{...st.hands.w}, b:{...st.hands.b} };
  turn = st.turn;
  kingPlaced = {...st.kingPlaced};
  checkStreak = {...st.checkStreak};
  totalChecks = {...st.totalChecks};
  moveHistory = [...st.history];
  gameOver = false; SEL=null; HIGHLIGHTS=[];
  if(typeof xlEscapeUsed !== 'undefined') xlEscapeUsed={w:false,b:false};

  const js = new Set(allLegalActions(turn).map(a =>
    a.type === 'place' ? `P|${a.kind}|${a.r}|${a.c}` : `M|${a.fr}|${a.fc}|${a.tr}|${a.tc}`));
  const py = new Set(cs.legal);
  const onlyJs = [...js].filter(k => !py.has(k)).sort();
  const onlyPy = [...py].filter(k => !js.has(k)).sort();
  out.push({ 국면: cs.name, JS: js.size, Python: py.size,
             일치: onlyJs.length===0 && onlyPy.length===0,
             JS만: onlyJs.slice(0,8), Python만: onlyPy.slice(0,8) });
}
window.__r = JSON.stringify({
  전체일치: out.every(o=>o.일치),
  불일치: out.filter(o=>!o.일치),
  요약: out.map(o=>`${o.국면}: JS ${o.JS} / Py ${o.Python} ${o.일치?'✓':'✗'}`)
}, null, 1);
})()
