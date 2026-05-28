/** 交易时段标签（全市场仅正盘） */

export function extendedSessionLabel(_session) {
  return '';
}

export function hasRealtimeProfit(f) {
  return f.realTimeProfit != null && Number.isFinite(f.realTimeProfit);
}

export function hasExtendedRealtimeLayout(_f) {
  return false;
}

export function shouldShowExtendedMetric(_f) {
  return false;
}

export function holdingStatusLabel(h) {
  const session = h?.quoteSession;
  if (session === 'regular' && h?.quoteMode === 'live') return '盘中';
  if (session === 'regular' && h?.quoteMode === 'missing') return '待行情';
  if (session === 'midday') return '午间休市';
  if (
    session === 'closed' ||
    session === 'overnight' ||
    h?.quoteMode === 'close'
  ) {
    return '已收盘';
  }
  return '—';
}

export function holdingStatusClass(h) {
  const session = h?.quoteSession;
  if (session === 'regular' && h?.quoteMode === 'live') return 'is-live';
  if (session === 'midday') return 'is-midday';
  if (
    session === 'closed' ||
    session === 'overnight' ||
    h?.quoteMode === 'close'
  ) {
    return 'is-close';
  }
  return 'is-flat';
}

export function holdingShowsDualChange(_h) {
  return false;
}
