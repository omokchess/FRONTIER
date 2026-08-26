/* 낮/밤 테마 전환. head에서 동기 실행 — 첫 페인트 전에 data-theme을 박아 깜빡임을 막는다.
   저장값이 없으면 OS 설정(prefers-color-scheme)을 따른다. */
(() => {
  const KEY = 'frontier_theme';
  const html = document.documentElement;
  const saved = (() => { try { return localStorage.getItem(KEY); } catch (_) { return null; } })();
  const system = () => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  const apply = t => { html.dataset.theme = t; html.style.colorScheme = t; };
  apply(saved === 'light' || saved === 'dark' ? saved : system());

  // 저장한 적이 없으면 OS 설정 변경을 따라간다.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    try { if (!localStorage.getItem(KEY)) apply(system()); } catch (_) {}
  });

  // 토글 버튼은 주입 — 6개 페이지 HTML을 각각 고치지 않기 위해.
  addEventListener('DOMContentLoaded', () => {
    const btn = document.createElement('button');
    btn.className = 'theme-toggle';
    btn.type = 'button';
    const label = () => {
      const dark = html.dataset.theme === 'dark';
      btn.textContent = dark ? '☀' : '☾';
      btn.title = btn.ariaLabel = dark ? '낮 모드로 전환' : '밤 모드로 전환';
    };
    btn.onclick = () => {
      const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (_) {}
      label();
    };
    label();
    document.body.appendChild(btn);
  });
})();
