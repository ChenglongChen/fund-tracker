import { themeToggleLabel } from '../theme.js';

export function themeToggleIconMarkup() {
  const dark = document.documentElement.dataset.theme === 'dark';
  if (dark) {
    return `<svg class="theme-toggle-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="3.75" stroke="currentColor" stroke-width="1.5"/>
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg class="theme-toggle-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M13.6 3.3a6.5 6.5 0 1 0 7.2 10.2A7.8 7.8 0 0 1 13.6 3.3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

export function renderThemeToggle() {
  const label = themeToggleLabel();
  return `
    <button type="button" class="theme-toggle" id="btn-theme" aria-label="切换${label}模式" title="切换${label}模式">
      ${themeToggleIconMarkup()}
    </button>`;
}

export function renderPhoneChrome() {
  return `<div class="phone-chrome">${renderThemeToggle()}</div>`;
}

export function patchThemeToggle() {
  const label = themeToggleLabel();
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.setAttribute('title', `切换${label}模式`);
    btn.setAttribute('aria-label', `切换${label}模式`);
    btn.querySelector('.theme-toggle-label')?.remove();
    const iconEl = btn.querySelector('.theme-toggle-icon');
    if (iconEl) {
      const wrap = document.createElement('span');
      wrap.innerHTML = themeToggleIconMarkup();
      const next = wrap.firstElementChild;
      if (next) iconEl.replaceWith(next);
    }
  });
}
