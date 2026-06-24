/** 持仓状态标签（全市场仅正盘；无盘前/盘后） */

export function hasRealtimeProfit(f) {
  return f.realTimeProfit != null && Number.isFinite(f.realTimeProfit);
}

export function holdingStatusLabel(h) {
  if (h?.quoteMode === 'preopen') return '待行情';
  if (h?.liveRt1Excluded) return '—';
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
  if (h?.quoteMode === 'preopen') return 'is-flat';
  if (h?.liveRt1Excluded) return 'is-flat';
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

