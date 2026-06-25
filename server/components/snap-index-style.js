/**
 * 美指 style 基金（index / proxy / fundgz）：正盘 live index，休市后读 4:00 收盘 snapshot。
 */
import { resolveDisplaySession } from '../display-session.js';
import { getIndexSessionRegular } from '../session-quotes.js';
import { indexStripLabelForProxyFund } from '../valuation-profile.js';

/** @param {object} liveRow */
export function isUsIndexStyleFund(liveRow) {
  if (liveRow?.market !== 'us') return false;
  if (liveRow?.shouldRefreshLiveRt1 === true || liveRow?.hasRegularHolding === true) return false;
  const src = String(liveRow?.impactSource ?? liveRow?.estimateSource ?? '');
  if (src === 'holdings' || src === 'ensemble') return false;
  return src === 'index' || src.startsWith('proxy:') || src === 'fundgz';
}

/** 21:30–04:00 美股正盘：沿用 style index live */
export function shouldUseLiveUsIndexStyle(liveRow, now = new Date()) {
  if (!isUsIndexStyleFund(liveRow)) return false;
  return resolveDisplaySession(now).usPhase === 'regular';
}

/** 04:00 收盘后至下次正盘：读 eodSnap / 指数条收盘 snapshot */
export function shouldFreezeUsIndexCloseSnapshot(liveRow, now = new Date()) {
  return isUsIndexStyleFund(liveRow) && !shouldUseLiveUsIndexStyle(liveRow, now);
}

/**
 * 美指联接休市后 row1 pct：优先指数条 4:00 收盘（如纳指100/标普500），再 fallback per-fund。
 * @param {object} liveRow
 * @param {(id: number) => number|null|undefined} [fundRegularPct]
 */
export function resolveUsIndexCloseImpactPct(liveRow, fundRegularPct = () => null) {
  // fund row 已经按人民币净值口径叠加 FX；优先使用它，避免休市 snap 回退到纯指数条（无 FX）。
  if (liveRow?.impactPctRegular != null && Number.isFinite(liveRow.impactPctRegular)) {
    return liveRow.impactPctRegular;
  }
  const label = indexStripLabelForProxyFund(liveRow?.name ?? '');
  if (label) {
    const idx = getIndexSessionRegular(label);
    if (idx != null && Number.isFinite(idx)) return idx;
  }
  const fundId = liveRow?.id;
  const pct = fundId != null ? fundRegularPct(fundId) : null;
  return pct != null && Number.isFinite(pct) ? pct : null;
}
