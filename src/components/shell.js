import { escapeHtml } from '../format.js';
import { app } from '../app/context.js';
import { formatClockLabel } from './status.js';

export function renderShell(inner) {
  return `<div class="app-shell"><main class="phone-page">${inner}</main><div class="sr-live" id="live-region" aria-live="polite" aria-atomic="true"></div></div>`;
}

export function renderLoading() {
  return renderShell(`
    <section class="state-card">
      <p class="state-title">加载中...</p>
      <p class="state-text">正在连接服务端并拉取估值</p>
    </section>`);
}

export function renderError(msg) {
  return renderShell(`
    <section class="state-card">
      <p class="state-title">加载失败</p>
      <p class="state-text" id="error-message">${escapeHtml(msg)}</p>
      <p class="state-text state-text--hint">请确认已运行 <code>npm run dev</code> 或 <code>npm start</code>（需先 build）</p>
      <button type="button" class="retry-button" id="btn-retry" aria-describedby="error-message">重试</button>
    </section>`);
}

export function renderEmptyState({ title, hint, actionId, actionLabel } = {}) {
  return `
    <div class="empty-state">
      <p class="empty-state-title">${escapeHtml(title || '暂无数据')}</p>
      ${hint ? `<p class="empty-state-hint">${escapeHtml(hint)}</p>` : ''}
      ${actionId && actionLabel ? `<button type="button" class="empty-state-action" id="${actionId}">${escapeHtml(actionLabel)}</button>` : ''}
    </div>`;
}

export function renderSubpageNav(title, { backId = 'btn-back', rightHtml = '' } = {}) {
  return `
    <nav class="subpage-nav">
      <div class="subpage-nav-side subpage-nav-side--start">
        <button type="button" class="subpage-nav-back" id="${backId}" aria-label="返回">
          <span class="subpage-nav-back-icon" aria-hidden="true">‹</span>
        </button>
      </div>
      <h1 class="subpage-nav-title">${escapeHtml(title)}</h1>
      <div class="subpage-nav-side subpage-nav-side--end">
        ${rightHtml}
      </div>
    </nav>`;
}

export function renderLiveBanner() {
  const { state } = app();
  const hidden = !state.liveBanner || state.liveBannerDismissed;
  return `
    <div class="live-banner${hidden ? ' is-hidden' : ''}" id="live-banner" role="alert"${hidden ? ' hidden' : ''}>
      <span class="live-banner-text">${escapeHtml(state.liveBanner || '')}</span>
      <button type="button" class="live-banner-action" id="btn-live-retry">重试</button>
      <button type="button" class="live-banner-dismiss" id="btn-live-dismiss" aria-label="关闭">×</button>
    </div>`;
}

export function patchLiveBanner() {
  const { state } = app();
  const el = document.getElementById('live-banner');
  if (!el) return false;
  const hidden = !state.liveBanner || state.liveBannerDismissed;
  el.classList.toggle('is-hidden', hidden);
  el.hidden = hidden;
  const textEl = el.querySelector('.live-banner-text');
  if (textEl) textEl.textContent = state.liveBanner || '';
  return true;
}

export function announceLiveUpdate() {
  const { state } = app();
  const el = document.getElementById('live-region');
  if (!el || state.view === 'loading' || state.view === 'error') return;
  const refresh = formatClockLabel(state.updatedAt);
  const quote = formatClockLabel(state.quoteUpdatedAt || state.updatedAt);
  el.textContent = `已刷新 ${refresh} · 行情 ${quote}`;
}
