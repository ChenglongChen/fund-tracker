import { escapeHtml, fmtTime } from '../format.js';
import { app } from '../app/context.js';

export function formatClockLabel(timeStr) {
  const { state } = app();
  const date = state.displayContext?.beijingDate ?? state.lastLive?.beijingDate ?? '';
  if (date && timeStr) return `${date.slice(5)} ${timeStr}`;
  return timeStr || fmtTime();
}

export function detailHoldingsMetaHtml(holdingsCount, meta = {}) {
  const parts = [`${holdingsCount} 只`];
  if (meta.quoteCoverage != null && Number.isFinite(meta.quoteCoverage)) {
    parts.push(`覆盖 ${meta.quoteCoverage.toFixed(0)}%`);
  }
  if (meta.valuationConfidence) parts.push(meta.valuationConfidence);
  return parts.join(' · ');
}
