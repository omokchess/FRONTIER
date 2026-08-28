/* 낮/밤 테마 전환. head에서 동기 실행 — 첫 페인트 전에 data-theme을 박아 깜빡임을 막는다.
   저장값이 없으면 OS 설정(prefers-color-scheme)을 따른다. */
(() => {
  const KEY = 'frontier_theme';
  const html = document.documentElement;
  const saved = (() => { try { return localStorage.getItem(KEY); } catch (_) { return null; } })();
  const system = () => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  // 전환 중에는 트랜지션을 끈다 (theme.css의 .theme-switching 참고).
  // 끈 상태를 두 프레임 유지해야 새 색이 확정된 뒤에 트랜지션이 되살아난다.
  const apply = (t, animate) => {
    if (animate) html.classList.add('theme-switching');
    html.dataset.theme = t;
    html.style.colorScheme = t;
    if (animate) {
      // rAF는 탭이 숨겨져 있으면 아예 발화하지 않는다 → 클래스가 영영 안 지워져
      // 트랜지션이 통째로 죽는다. 타이머로 반드시 해제되게 이중으로 건다.
      const clear = () => html.classList.remove('theme-switching');
      requestAnimationFrame(() => requestAnimationFrame(clear));
      setTimeout(clear, 120);
    }
  };
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
      apply(next, true);
      try { localStorage.setItem(KEY, next); } catch (_) {}
      label();
    };
    label();
    // 로비 헤더가 있으면 그 안에 넣는다 (플로팅 버튼 하나 줄이기).
    // 언어 선택기는 i18n이 나중에 그리므로 DOM 순서 대신 flex order로 자리를 잡는다.
    // 헤더가 없는 페이지(게임/랭킹 등)에서는 기존대로 우하단 고정.
    // 모바일에서는 .head가 display:none이라, 안에 넣으면 토글이 사라진다.
    const head = document.querySelector('.head');
    if (head && head.getBoundingClientRect().height > 0) {
      btn.classList.add('theme-toggle-inline');
      head.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }
  });
})();
