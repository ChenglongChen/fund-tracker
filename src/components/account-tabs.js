import { SCOPE_ALL, SCOPE_SUMMARY } from '../accounts.js';
import { escapeHtml } from '../format.js';
import { app } from '../app/context.js';
import { renderThemeToggle } from './theme-chrome.js';
import { showIndexTicker, closeIndexDrawer } from './index-dock.js';

/** @type {ResizeObserver | null} */
let accountTabsResizeObserver = null;

export function renderAccountTabButton(t) {
  const selected = app().state.activeScope === t.scope;
  return `
    <button type="button" role="tab" class="account-tab${selected ? ' is-active' : ''}" data-account-scope="${t.scope}" id="account-tab-${t.scope}" aria-selected="${selected ? 'true' : 'false'}" aria-controls="holding-list-scroll">
      ${escapeHtml(t.label)}
    </button>`;
}

function accountTabsPinned() {
  return [
    { scope: SCOPE_SUMMARY, label: '账户概况' },
    { scope: SCOPE_ALL, label: '全部持仓' },
  ];
}

function accountTabsScrollable() {
  return app().getAccounts().map((a) => ({ scope: a.id, label: a.name }));
}

function accountTabsAll() {
  return [...accountTabsPinned(), ...accountTabsScrollable()];
}

export function layoutAccountTabs() {
  const scroll = document.getElementById('account-tabs-track');
  if (!scroll) return;
  const active = scroll.querySelector('.account-tab.is-active');
  if (!active) return;
  const pad = 8;
  const left = active.offsetLeft;
  const right = left + active.offsetWidth;
  const viewLeft = scroll.scrollLeft;
  const viewRight = viewLeft + scroll.clientWidth;
  if (left < viewLeft + pad) {
    scroll.scrollLeft = Math.max(0, left - pad);
  } else if (right > viewRight - pad) {
    scroll.scrollLeft = right - scroll.clientWidth + pad;
  }
}

export function setupAccountTabsLayout() {
  const scroll = document.getElementById('account-tabs-track');
  if (!scroll) return;
  requestAnimationFrame(() => layoutAccountTabs());
  accountTabsResizeObserver?.disconnect();
  accountTabsResizeObserver = new ResizeObserver(() => layoutAccountTabs());
  accountTabsResizeObserver.observe(scroll);
}

export function activateAccountScope(scope) {
  const { setActiveScope, navigateTo, paint, scheduleRefresh } = app();
  app().state.indexDrawerOpen = false;
  setActiveScope(scope);
  navigateTo({ type: 'list', scope });
  app().state.view = 'list';
  paint();
  scheduleRefresh();
}

export function onAccountTabsBarClick(ev) {
  const tab = ev.target.closest('[data-account-scope]');
  if (!tab || !tab.closest('.account-tabs-bar')) return;
  const scope = tab.getAttribute('data-account-scope');
  if (!scope) return;
  activateAccountScope(scope);
}

export function renderAccountTabs() {
  return `
    <div class="account-tabs-bar">
      <div class="account-tabs" role="tablist" id="account-tabs-track">
        ${accountTabsAll().map((t) => renderAccountTabButton(t)).join('')}
      </div>
      ${renderThemeToggle()}
    </div>`;
}
