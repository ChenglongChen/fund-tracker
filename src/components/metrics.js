/**
 * 可复用指标 UI 组件（Hero / 列表 / 账户卡 / 详情共用）
 * iOS 风格：模式 A 竖排；模式 B metric-split-row + 盘前/盘后 tag
 */
import { escapeHtml, fmtPct, pctClass } from '../format.js';
import { fmtMoney } from '../display-format.js';
import { extendedSessionLabel, hasExtendedRealtimeLayout } from './session.js';

export function renderPctSub(v, { tag = 'p', extraClass = 'holding-sub', attrs = '' } = {}) {
  const cls = pctClass(v);
  const text = v != null && Number.isFinite(Number(v)) ? fmtPct(v) : '—';
  const classes = [extraClass, cls].filter(Boolean).join(' ');
  const attrStr = attrs ? ` ${attrs}` : '';
  return `<${tag} class="${classes}"${attrStr}>${text}</${tag}>`;
}

/** 列表行竖排指标：金额 + 收益率（与当日收益列同结构） */
export function renderHoldingStackedMetricCol({ colClass, dataCol, amount, pct, amountCls = '', attrs = '' }) {
  const attrStr = attrs ? ` ${attrs}` : '';
  return `
    <div class="holding-col ${colClass}" data-col="${dataCol}"${attrStr}>
      <p class="holding-val ${amountCls}">${fmtMoney(amount, true)}</p>
      ${renderPctSub(pct, { extraClass: 'holding-sub' })}
    </div>`;
}

export function setPctSubEl(el, v) {
  if (!el) return;
  const layout = [...el.classList].filter((c) => !['is-up', 'is-down', 'is-flat'].includes(c));
  el.className = [...layout, pctClass(v)].filter(Boolean).join(' ');
  el.textContent = v != null && Number.isFinite(Number(v)) ? fmtPct(v) : '—';
}

export function renderRealtimeSplitRow(val, pct, { valSigned = true, tag = '' } = {}) {
  const cls = pctClass(valSigned ? val : pct);
  const tagHtml = tag ? `<span class="metric-dual-line__tag">${escapeHtml(tag)}</span>` : '';
  return `
    <p class="metric-split-row${tag ? ' metric-split-row--ext' : ''}">
      <span class="holding-val ${cls}">${fmtMoney(val, valSigned)}</span>
      <span class="holding-sub ${cls}">${fmtPct(pct)}</span>
      ${tagHtml}
    </p>`;
}

export function combinedImpactTooltip(row) {
  if (!hasExtendedRealtimeLayout(row)) return '';
  const total = row.realTimePct ?? row.estimateImpactPct ?? row.impactPct;
  const regular = row.realTimePctRegular ?? row.impactPctRegularLive ?? row.impactPctRegular;
  const ext = row.impactPctExtendedLive ?? row.impactPctExtended;
  const label = extendedSessionLabel(row.impactSession);
  if (total == null || ext == null) return '';
  if (row.impactSession === 'premarket') {
    return `实时 ${fmtPct(total)}（不含${label} ${fmtPct(ext)}）`;
  }
  if (regular == null) return '';
  return `合计 ${fmtPct(total)} = 正盘 ${fmtPct(regular)} + ${label} ${fmtPct(ext)}`;
}

export function renderMetricDualLine({
  mainVal,
  mainPct,
  extVal,
  extPct,
  extLabel,
  tooltip = '',
  valSigned = false,
  mainCls,
  compact = false,
  listMode = false,
}) {
  const cls = mainCls ?? pctClass(valSigned ? mainVal : mainPct);
  const extCls = pctClass(valSigned ? extVal : extPct);
  const tip = tooltip ? ` title="${escapeHtml(tooltip)}"` : '';
  const compactCls = compact ? ' metric-dual-line--compact' : '';
  const listCls = listMode ? ' metric-dual-line--list' : '';
  const showExtVal = extVal != null && Number.isFinite(Number(extVal)) && Math.abs(Number(extVal)) >= 0.01;

  if (listMode) {
    return `
    <div class="metric-dual-line${listCls}"${tip} aria-label="${escapeHtml(tooltip || `${extLabel} ${fmtPct(extPct)}`)}">
      <p class="holding-val ${cls}">${fmtMoney(mainVal, valSigned)}</p>
      ${renderPctSub(mainPct, { extraClass: 'holding-sub' })}
      <div class="metric-dual-line__ext metric-dual-line__ext--inline">
        ${showExtVal ? `<span class="metric-dual-line__ext-val ${extCls}">${fmtMoney(extVal, valSigned)}</span>` : ''}
        ${extPct != null ? `<span class="metric-dual-line__ext-pct ${extCls}">${fmtPct(extPct)}</span>` : ''}
        ${extLabel ? `<span class="metric-dual-line__tag">${escapeHtml(extLabel)}</span>` : ''}
      </div>
    </div>`;
  }

  return `
    <div class="metric-dual-line${compactCls}${listCls}"${tip}>
      <div class="metric-dual-line__main">
        ${mainVal != null ? `<p class="holding-val ${cls}">${fmtMoney(mainVal, valSigned)}</p>` : ''}
        ${mainPct != null ? renderPctSub(mainPct, { extraClass: 'holding-sub' }) : ''}
        ${mainVal == null && mainPct != null ? `<p class="detail-hero-pct ${cls}">${fmtPct(mainPct)}</p>` : ''}
      </div>
      <div class="metric-dual-line__ext">
        ${showExtVal ? `<span class="metric-dual-line__ext-val ${extCls}">${fmtMoney(extVal, valSigned)}</span>` : ''}
        ${extPct != null ? `<span class="metric-dual-line__ext-pct ${extCls}">${fmtPct(extPct)}</span>` : ''}
        ${extLabel ? `<span class="metric-dual-line__tag">${escapeHtml(extLabel)}</span>` : ''}
      </div>
    </div>`;
}
