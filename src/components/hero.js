import { escapeHtml, fmtHeadDateLabel, fmtPct, pctClass } from '../format.js';
import { fmtEstimatedAssets, fmtMoney } from '../display-format.js';
import { buildAccountSummaries } from '../accounts.js';
import { visibleMetricColumns } from '../column-layout.js';
import { app } from '../app/context.js';
import { setTextClass } from '../dom.js';
import {
  renderPctSub,
  setPctSubEl,
} from './metrics.js';
import { renderPrivacyToggle, patchPrivacyToggle } from './privacy-ui.js';

function orderedMetrics() {
  return visibleMetricColumns(app().state.metricColumnOrder, app().state.metricColumnVisible);
}

export function summaryHeroTone(summary) {
  if (!summary) return 'is-flat';
  return pctClass(summary.totalRealTime);
}

export function summaryMetricByKey(s, key) {
  if (!s) return null;
  switch (key) {
    case 'realtime':
      return { val: s.totalRealTime, pct: s.totalRealTimePct, signed: true };
    case 'daily':
      return { val: s.totalSettled, pct: s.totalSettledPct, signed: true };
    case 'holding':
      return { val: s.totalHolding, pct: s.totalHoldingPct, signed: true };
    default:
      return null;
  }
}

export function renderAccountSummaryCard(acc) {
  const dailyCls = pctClass(acc.totalSettled);
  return `
    <button type="button" class="account-summary-card" data-account-scope="${acc.id}" data-account-id="${acc.id}">
      <div class="account-summary-head">
        <span class="account-summary-name">${escapeHtml(acc.name)}</span>
      </div>
      <div class="account-summary-body">
        <div class="account-summary-col">
          <div class="account-summary-label-row">
            <span class="account-summary-label">账户资产</span>
          </div>
          <p class="account-summary-val">${fmtMoney(acc.totalAssets)}</p>
          <p class="account-summary-sub account-summary-sub--combo">${fmtMoney(acc.totalHolding, true)} · ${renderPctSub(acc.totalHoldingPct, { tag: 'span', extraClass: '' })}</p>
        </div>
        <div class="account-summary-col account-summary-col--center">
          <div class="account-summary-label-row account-summary-label-row--center">
            <span class="account-summary-label">实时收益</span>
          </div>
          ${renderAccountRealtimeBody(acc)}
        </div>
        <div class="account-summary-col account-summary-col--right">
          <div class="account-summary-label-row account-summary-label-row--end">
            <span class="account-summary-label">当日收益</span>
          </div>
          <p class="account-summary-val ${dailyCls}">${fmtMoney(acc.totalSettled, true)}</p>
          <p class="account-summary-sub account-summary-sub--combo">${renderPctSub(acc.totalSettledPct, { tag: 'span', extraClass: '' })}</p>
        </div>
      </div>
    </button>`;
}

function summaryHeadDate(col) {
  const head = app().state.displayContext?.tableHead?.[col];
  const label = fmtHeadDateLabel(head?.label ?? head?.line1 ?? '');
  return label ? `<span class="yj-summary-date">${escapeHtml(label)}</span>` : '';
}

export function renderSummaryRealtimeBody(s) {
  const rtCls = pctClass(s.totalRealTime);
  return `
      <p class="yj-summary-val ${rtCls}">${fmtMoney(s.totalRealTime, true)}</p>
      ${renderPctSub(s.totalRealTimePct, { extraClass: 'yj-summary-sub' })}`;
}

export function renderSummaryMetricCol(title, colKey, val, pct, { signed = false, amount = false, summary = null } = {}) {
  const dateHtml = colKey ? summaryHeadDate(colKey) : '';
  const valCls = pctClass(signed ? val : pct);
  if (colKey === 'realtime' && summary) {
    return `
    <div class="yj-summary-col" data-summary-col="${colKey}">
      <p class="yj-summary-label">${escapeHtml(title)}${dateHtml}</p>
      ${renderSummaryRealtimeBody(summary)}
    </div>`;
  }
  return `
    <div class="yj-summary-col ${amount ? 'yj-summary-col--amount' : ''}" data-summary-col="${colKey || 'assets'}">
      <p class="yj-summary-label">${escapeHtml(title)}${dateHtml}</p>
      <p class="yj-summary-val ${valCls}">${fmtMoney(val, signed)}</p>
      ${pct != null || !amount ? renderPctSub(pct, { extraClass: 'yj-summary-sub' }) : ''}
    </div>`;
}

export function renderAccountRealtimeBody(acc) {
  const rtCls = pctClass(acc.hasRealtime ? acc.totalRealTime : null);
  return `
          <p class="account-summary-val ${rtCls}" data-account-rt-val>${acc.hasRealtime ? fmtMoney(acc.totalRealTime, true) : '—'}</p>
          <p class="account-summary-sub account-summary-sub--combo" data-account-rt-pct>${renderPctSub(acc.hasRealtime ? acc.totalRealTimePct : null, { tag: 'span', extraClass: '' })}</p>`;
}

export function renderPortfolioHeader() {
  const s = app().state.summary;
  if (!s) return '';
  const heroTone = summaryHeroTone(s);
  return `
    <header class="yj-summary yj-summary--hero ${heroTone}">
      <div class="yj-summary-grid">
        <div class="yj-summary-col yj-summary-col--amount" data-summary-col="assets">
          <p class="yj-summary-label">
            <span class="yj-summary-label-text">${summaryAssetsLabel()}</span>
            ${renderPrivacyToggle()}
          </p>
          <p class="yj-summary-val">${fmtMoney(s.settledAssets)}</p>
          <p class="yj-summary-sub yj-summary-sub--muted">${fmtEstimatedAssets(s.realtimeAssets)}</p>
        </div>
        ${orderedMetrics()
          .map((col) => {
            const m = summaryMetricByKey(s, col.key);
            return renderSummaryMetricCol(col.title, col.key, m.val, m.pct, {
              signed: m.signed,
              summary: col.key === 'realtime' ? s : null,
            });
          })
          .join('')}
      </div>
    </header>`;
}

export function summaryAssetsLabel() {
  return '账户资产';
}

export function patchSummaryRealtimeCol(colEl, s) {
  if (!colEl || !s) return;
  colEl.classList.remove('yj-summary-col--rt-split');
  const valEl = colEl.querySelector('.yj-summary-val');
  const subEl = colEl.querySelector('.yj-summary-sub');
  const rtCls = pctClass(s.totalRealTime);
  if (valEl) {
    valEl.textContent = fmtMoney(s.totalRealTime, true);
    setTextClass(valEl, rtCls);
  }
  if (subEl) setPctSubEl(subEl, s.totalRealTimePct);
}

export function patchSummaryCol(col, { val, pct, signed = false, subText, subMuted = false, dateCol = null, summary = null }) {
  const colEl = document.querySelector(`[data-summary-col="${col}"]`);
  if (!colEl) return;

  const titles = {
    assets: summaryAssetsLabel(),
    realtime: '实时收益',
    daily: '当日收益',
    holding: '持有收益',
  };
  const labelEl = colEl.querySelector('.yj-summary-label');
  if (labelEl) {
    if (col === 'assets') {
      const textEl = labelEl.querySelector('.yj-summary-label-text');
      if (textEl) textEl.textContent = titles.assets;
      else if (!labelEl.querySelector('.privacy-toggle')) {
        labelEl.innerHTML = `<span class="yj-summary-label-text">${escapeHtml(titles.assets)}</span>${renderPrivacyToggle()}`;
      }
      patchPrivacyToggle();
    } else if (dateCol) {
      const dateLabel = fmtHeadDateLabel(
        app().state.displayContext?.tableHead?.[dateCol]?.label ??
          app().state.displayContext?.tableHead?.[dateCol]?.line1 ??
          '',
      );
      labelEl.innerHTML = `${escapeHtml(titles[col] || '')}${dateLabel ? `<span class="yj-summary-date">${escapeHtml(dateLabel)}</span>` : ''}`;
    }
  }

  const valEl = colEl.querySelector('.yj-summary-val');
  const subEl = colEl.querySelector('.yj-summary-sub');

  if (col === 'realtime' && summary) {
    patchSummaryRealtimeCol(colEl, summary);
    return;
  }

  const valCls = pctClass(signed ? val : pct);

  if (valEl) {
    valEl.textContent = fmtMoney(val, signed);
    setTextClass(valEl, valCls);
  }
  if (!subEl) return;

  if (subText != null) {
    subEl.textContent = subText;
    subEl.classList.toggle('yj-summary-sub--muted', subMuted);
    if (!subMuted) setTextClass(subEl, valCls);
    else subEl.classList.remove('is-up', 'is-down', 'is-flat');
  } else {
    setPctSubEl(subEl, pct);
    subEl.classList.remove('yj-summary-sub--muted');
  }
}

export function patchAccountSummaryCards() {
  const cards = buildAccountSummaries(app().state.fundRows, app().getAccounts());
  for (const acc of cards) {
    const card = document.querySelector(`.account-summary-card[data-account-id="${acc.id}"]`);
    if (!card) return false;

    const cols = card.querySelectorAll('.account-summary-col');
    const assetsCol = cols[0];
    const rtCol = cols[1];
    const dailyCol = cols[2];

    const dailyCls = pctClass(acc.totalSettled);
    const rtCls = pctClass(acc.hasRealtime ? acc.totalRealTime : null);

    if (assetsCol) {
      const val = assetsCol.querySelector('.account-summary-val');
      const sub = assetsCol.querySelector('.account-summary-sub');
      if (val) val.textContent = fmtMoney(acc.totalAssets);
      if (sub) {
        sub.className = 'account-summary-sub account-summary-sub--combo';
        sub.innerHTML = `${fmtMoney(acc.totalHolding, true)} · ${renderPctSub(acc.totalHoldingPct, { tag: 'span', extraClass: '' })}`;
      }
    }

    if (rtCol) {
      const rtVal = rtCol.querySelector('.account-summary-val');
      const rtSub = rtCol.querySelector('[data-account-rt-pct], .account-summary-sub--combo');
      if (rtVal) {
        rtVal.textContent = acc.hasRealtime ? fmtMoney(acc.totalRealTime, true) : '—';
        setTextClass(rtVal, rtCls);
      }
      if (rtSub) {
        rtSub.className = 'account-summary-sub account-summary-sub--combo';
        rtSub.innerHTML = renderPctSub(acc.hasRealtime ? acc.totalRealTimePct : null, { tag: 'span', extraClass: '' });
      }
    }

    if (dailyCol) {
      const val = dailyCol.querySelector('.account-summary-val');
      const sub = dailyCol.querySelector('.account-summary-sub');
      if (val) {
        val.textContent = fmtMoney(acc.totalSettled, true);
        setTextClass(val, dailyCls);
      }
      if (sub) {
        sub.className = 'account-summary-sub account-summary-sub--combo';
        sub.innerHTML = renderPctSub(acc.totalSettledPct, { tag: 'span', extraClass: '' });
      }
    }
  }
  return true;
}
