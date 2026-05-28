import { escapeHtml, fmtTime } from '../format.js';
import { app } from '../app/context.js';

export function formatClockLabel(timeStr) {
  const { state } = app();
  const date = state.displayContext?.beijingDate ?? state.lastLive?.beijingDate ?? '';
  if (date && timeStr) return `${date.slice(5)} ${timeStr}`;
  return timeStr || fmtTime();
}

export function detailHoldingsMetaHtml(holdingsCount) {
  return `${holdingsCount} 只`;
}
