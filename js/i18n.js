// ===================================================================
// FRONTIER 다국어(i18n) 시스템 — 한국어 원본 키 기반
//   · 모든 페이지가 이 파일 하나를 공유 (index / FRONTIER / create-room ...)
//   · 한국어가 원본. 영/일/중 사전(I18N_DICT)에 '한국어':'번역' 매핑.
//   · 정적 HTML + 동적 렌더 모두 처리: DOM 텍스트 노드를 훑어 한국어→현재 언어로 치환.
//   · MutationObserver로 동적으로 추가되는 한국어도 자동 번역.
//   · 언어 전환을 위해 각 노드의 "원본 한국어"를 WeakMap에 보관.
// ===================================================================
(function(){
  const LS_KEY = 'frontier_lang';
  const SUPPORTED = ['ko','en','ja','zh'];
  const LANG_LABELS = { ko:'🇰🇷 한국어', en:'🇬🇧 English', ja:'🇯🇵 日本語', zh:'🇨🇳 中文' };

  let LANG = 'ko';
  try { const s = localStorage.getItem(LS_KEY); if(s && SUPPORTED.includes(s)) LANG = s; } catch(_){}

  // 사전은 js/i18n-dict.js 에서 window.I18N_DICT 로 주입 (없으면 빈 사전)
  function dict(){ return (window.I18N_DICT && window.I18N_DICT[LANG]) || null; }

  const _orig = new WeakMap();   // textNode -> 원본 한국어 문자열
  let _observer = null;
  let _scheduled = false;

  const hasKo = s => /[가-힣]/.test(s||'');

  // 한국어 원본을 현재 언어로 치환 (trim 키로 매칭, 앞뒤 공백 보존)
  function translate(ko){
    if(LANG === 'ko') return ko;
    const d = dict();
    if(!d) return ko;
    const key = ko.trim();
    if(!key || d[key] == null) return ko;
    return ko.replace(key, d[key]);
  }

  // 파라미터 치환형 번역 (동적 문자열용): t('{n}초', {n:5})
  function t(ko, params){
    let s = ko;
    if(LANG !== 'ko'){
      const d = dict();
      if(d && d[ko.trim()] != null) s = ko.replace(ko.trim(), d[ko.trim()]);
    }
    if(params) for(const k in params) s = s.split('{'+k+'}').join(params[k]);
    return s;
  }

  function _translateTextNodes(root){
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n; while(n = walker.nextNode()) nodes.push(n);
    nodes.forEach(node => {
      // <script>/<style> 내부 텍스트는 건너뜀
      const pt = node.parentNode && node.parentNode.nodeName;
      if(pt === 'SCRIPT' || pt === 'STYLE' || pt === 'TEXTAREA') return;
      let ko = _orig.get(node);
      if(ko === undefined){
        if(!hasKo(node.nodeValue)) return;     // 한글 없으면 등록 안 함
        ko = node.nodeValue; _orig.set(node, ko);
      }
      const tr = translate(ko);
      if(node.nodeValue !== tr) node.nodeValue = tr;
    });
  }

  function _translateAttrs(root){
    const els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title]') : [];
    els.forEach(el => {
      ['placeholder','title'].forEach(attr => {
        if(!el.hasAttribute(attr)) return;
        const dk = 'i18nKo_'+attr;
        let ko = el.dataset[dk];
        if(ko === undefined){
          const cur = el.getAttribute(attr);
          if(!hasKo(cur)) return;
          ko = cur; el.dataset[dk] = ko;
        }
        const tr = translate(ko);
        if(el.getAttribute(attr) !== tr) el.setAttribute(attr, tr);
      });
    });
  }

  function applyI18n(root){
    root = root || document.body;
    if(!root) return;
    if(_observer) _observer.disconnect();     // 내 변경이 옵저버를 다시 트리거하지 않도록
    try {
      _translateTextNodes(root);
      _translateAttrs(root);
    } catch(e){ console.warn('[i18n] apply 실패:', e); }
    if(_observer && LANG !== 'ko' && document.body){
      _observer.observe(document.body, { childList:true, subtree:true, characterData:true });
    }
  }

  function _schedule(){
    if(_scheduled) return; _scheduled = true;
    requestAnimationFrame(() => { _scheduled = false; applyI18n(); });
  }

  function _ensureObserver(){
    if(_observer || !document.body) return;
    _observer = new MutationObserver(() => _schedule());
  }

  function setLang(lang){
    if(!SUPPORTED.includes(lang)) return;
    LANG = lang;
    try { localStorage.setItem(LS_KEY, lang); } catch(_){}
    document.documentElement.setAttribute('lang', lang);
    _ensureObserver();
    applyI18n();    // ko면 원본 복원, 그 외엔 번역 (내부에서 옵저버 재연결)
    if(_observer && lang === 'ko') _observer.disconnect();
    // 선택기 UI 동기화
    document.querySelectorAll('.lang-select').forEach(s => { if(s.value !== lang) s.value = lang; });
    document.querySelectorAll('[data-lang-opt]').forEach(b => b.classList.toggle('on', b.getAttribute('data-lang-opt') === lang));
  }

  // 헤더/설정용 <select> 생성
  function buildLangSelect(extraClass){
    const sel = document.createElement('select');
    sel.className = 'lang-select' + (extraClass ? ' ' + extraClass : '');
    sel.innerHTML = SUPPORTED.map(l => `<option value="${l}">${LANG_LABELS[l]}</option>`).join('');
    sel.value = LANG;
    sel.addEventListener('change', () => setLang(sel.value));
    return sel;
  }

  // 버튼 그룹형 선택기 (설정 모달용) HTML 반환
  function langButtonsHTML(){
    return SUPPORTED.map(l =>
      `<button type="button" data-lang-opt="${l}" class="${l===LANG?'on':''}" onclick="setLang('${l}')">${LANG_LABELS[l]}</button>`
    ).join('');
  }

  window.FRONTIER_I18N = {
    get lang(){ return LANG; },
    SUPPORTED, LANG_LABELS,
    t, applyI18n, setLang, buildLangSelect, langButtonsHTML
  };
  window.t = t;
  window.applyI18n = applyI18n;
  window.setLang = setLang;

  // [data-lang-switch] 컨테이너에 선택기 자동 주입
  function mountSwitchers(){
    document.querySelectorAll('[data-lang-switch]').forEach(el => {
      if(el.querySelector('.lang-select')) return;
      el.appendChild(buildLangSelect());
    });
  }

  // 초기 적용
  function init(){
    document.documentElement.setAttribute('lang', LANG);
    _ensureObserver();
    mountSwitchers();
    if(LANG !== 'ko') applyI18n();
  }
  window.FRONTIER_I18N.mountSwitchers = mountSwitchers;
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
