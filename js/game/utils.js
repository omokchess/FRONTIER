// ===================================================================
// utils.js — 공통 헬퍼 (HTML escape, 토스트, 확인 모달)
// 의존: 다른 JS 없음 (DOM만 사용)
// 노출: window.escapeHtml, escapeAttr, showFlash, showConfirm, closeConfirm
// ===================================================================

window.escapeHtml = function(s){
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
};

window.escapeAttr = function(s){
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
};

let _flashTimer = null;

window.showFlash = function(msg, ms = 2000, isCheckFlash = false){
  const el = document.getElementById('statusFloat');
  if(!el) return;
  el.textContent = (window.t ? window.t(msg) : msg);
  el.classList.add('show');
  el.classList.toggle('check-flash', !!isCheckFlash);
  clearTimeout(_flashTimer);
  _flashTimer = setTimeout(() => {
    el.classList.remove('check-flash');
    if(typeof renderStatus === 'function') renderStatus();
  }, ms);
};

window.showConfirm = function(title, msg, onYes){
  document.getElementById('confirmTitle').textContent = (window.t ? window.t(title) : title);
  document.getElementById('confirmMsg').textContent = (window.t ? window.t(msg) : msg);
  document.getElementById('confirmModal').classList.add('show');
  document.getElementById('confirmYes').onclick = () => {
    closeConfirm();
    onYes();
  };
};

window.closeConfirm = function(){
  document.getElementById('confirmModal').classList.remove('show');
};
