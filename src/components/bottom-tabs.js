/** 底部功能 Tab（持仓 / 自选 / 行情 / 我的） */
import { app } from '../app/context.js';

export const MAIN_TABS = [
  { id: 'holdings', label: '持仓', hash: '#holdings', icon: 'layers' },
  { id: 'watchlist', label: '自选', hash: '#watchlist', icon: 'star' },
  { id: 'market', label: '行情', hash: '#market', icon: 'chart' },
  { id: 'profile', label: '我的', hash: '#profile', icon: 'user' },
];

export function currentMainTab() {
  return app().state.mainTab ?? 'holdings';
}

function tabIcon(name) {
  if (name === 'layers') {
    return `<svg class="bottom-tab-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>`;
  }
  if (name === 'star') {
    return `<svg class="bottom-tab-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" stroke-width="1.75"/><path d="M12 7.5 13.4 10.8l3.6.3-2.7 2.3.8 3.5L12 15.2l-2.1 1.7.8-3.5-2.7-2.3 3.6-.3L12 7.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }
  if (name === 'chart') {
    return `<svg class="bottom-tab-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" stroke-width="1.75"/><path d="M7 15V11M12 15V8M17 15v-5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
  }
  return `<svg class="bottom-tab-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="9" r="3.25" stroke="currentColor" stroke-width="1.75"/><path d="M6 19c0-3.3 2.7-5 6-5s6 1.7 6 5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
}

export function renderBottomTabs() {
  const active = currentMainTab();
  const tabs = MAIN_TABS.map(
    (t) => `
    <button type="button" role="tab" class="bottom-tab${active === t.id ? ' is-active' : ''}" data-main-tab="${t.id}" aria-selected="${active === t.id ? 'true' : 'false'}">
      ${tabIcon(t.icon)}
      <span class="bottom-tab-label">${t.label}</span>
    </button>`,
  ).join('');
  return `<nav class="bottom-tabs" role="tablist" aria-label="功能导航">${tabs}</nav>`;
}

export function patchBottomTabs() {
  const active = currentMainTab();
  document.querySelectorAll('.bottom-tab[data-main-tab]').forEach((btn) => {
    const id = btn.getAttribute('data-main-tab');
    const on = id === active;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

export function showAppBottomChrome() {
  const v = app().state.view;
  return v === 'list' || v === 'watchlist' || v === 'market' || v === 'profile';
}
