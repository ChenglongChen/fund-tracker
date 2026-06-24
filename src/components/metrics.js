/**
 * 可复用指标 UI 组件（Hero / 列表 / 账户卡 / 详情共用）— iOS 风格模式 A 竖排。
 */
import { fmtPct, pctClass } from '../format.js';
import { fmtMoney } from '../display-format.js';

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

