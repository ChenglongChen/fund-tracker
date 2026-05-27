import { escapeHtml, fmtTime } from '../format.js';
import { app } from '../app/context.js';

export function formatClockLabel(timeStr) {
  const { state } = app();
  const date = state.displayContext?.beijingDate ?? state.lastLive?.beijingDate ?? '';
  if (date && timeStr) return `${date.slice(5)} ${timeStr}`;
  return timeStr || fmtTime();
}

export function marketStatusHint() {
  const { state } = app();
  return state.displayContext?.marketChip ?? '休市';
}

export function statusTimesHtml() {
  const { state } = app();
  const refresh = formatClockLabel(state.updatedAt);
  const quote = formatClockLabel(state.quoteUpdatedAt || state.updatedAt);
  return `<span class="status-strip-times"><span>刷新 ${escapeHtml(refresh)}</span><span class="status-strip-time-sep" aria-hidden="true">·</span><span>行情 ${escapeHtml(quote)}</span></span>`;
}

export function detailHoldingsMetaHtml(holdingsCount) {
  const { state } = app();
  const refresh = formatClockLabel(state.updatedAt);
  const holdings = state.detailHoldingsAt ? formatClockLabel(state.detailHoldingsAt) : '—';
  return `${holdingsCount} 只 · 刷新 ${escapeHtml(refresh)} · 持仓 ${escapeHtml(holdings)}`;
}

export function patchStatusStripTimes() {
  const statusChip = document.querySelector('.status-strip-chip');
  const statusTime = document.querySelector('.status-strip-time');
  if (statusChip) statusChip.textContent = marketStatusHint();
  if (statusTime) statusTime.innerHTML = statusTimesHtml();
  return Boolean(statusTime);
}

export function renderStatusStrip() {
  return `
    <div class="status-strip">
      <div class="status-strip-meta">
        <span class="status-strip-chip">${escapeHtml(marketStatusHint())}</span>
        <span class="status-strip-time">${statusTimesHtml()}</span>
      </div>
    </div>`;
}
