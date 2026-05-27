/** 交易时段标签与 extended 布局规则（与 server display-session.extendedSession 对齐） */

export function extendedSessionLabel(session) {
  if (session === 'premarket') return '盘前';
  if (session === 'afterhours') return '盘后';
  if (session === 'overnight') return '夜盘';
  return '';
}

export function hasRealtimeProfit(f) {
  return f.realTimeProfit != null && Number.isFinite(f.realTimeProfit);
}

export function hasExtendedRealtimeLayout(f) {
  if (f.market === 'cn' || f.market === 'gold_cn') return false;
  if (!hasRealtimeProfit(f)) return false;
  if (
    f.impactSession !== 'premarket' &&
    f.impactSession !== 'afterhours' &&
    f.impactSession !== 'overnight'
  ) {
    return false;
  }
  if (f.impactPctExtended == null || !Number.isFinite(f.impactPctExtended)) return false;
  if (f.impactSession === 'premarket' || f.impactSession === 'overnight') return true;
  return f.realtimeActive;
}

export function shouldShowExtendedMetric(f) {
  return hasExtendedRealtimeLayout(f);
}

export function holdingStatusLabel(h) {
  const session = h?.quoteSession;
  if (session === 'premarket') return '盘前';
  if (session === 'afterhours') return '盘后';
  if (session === 'overnight') return '夜盘';
  if (session === 'regular' && h?.quoteMode === 'live') return '盘中';
  if (session === 'closed' || h?.quoteMode === 'close') return '已收盘';
  if (h?.quoteMode === 'live') return '盘中';
  return '—';
}

export function holdingStatusClass(h) {
  const session = h?.quoteSession;
  if (session === 'premarket') return 'is-premarket';
  if (session === 'afterhours') return 'is-afterhours';
  if (session === 'overnight') return 'is-overnight';
  if (session === 'regular' && h?.quoteMode === 'live') return 'is-live';
  if (session === 'closed' || h?.quoteMode === 'close') return 'is-close';
  if (h?.quoteMode === 'live') return 'is-live';
  return 'is-flat';
}

export function holdingShowsDualChange(h) {
  return (
    (h?.quoteSession === 'premarket' ||
      h?.quoteSession === 'afterhours' ||
      h?.quoteSession === 'overnight') &&
    h.changePctRegular != null &&
    Number.isFinite(Number(h.changePctRegular)) &&
    h.changePct != null &&
    Number.isFinite(Number(h.changePct))
  );
}
