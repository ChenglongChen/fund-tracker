/**
 * 行情页 — 横向市场 Tab + 三列指数卡片（仅正盘口径）。
 */
import { escapeHtml, fmtPct, pctClass, fmtIndexPrice, fmtIndexChange } from '../format.js';
import { app } from '../app/context.js';
import { renderShell } from '../components/shell.js';
import { renderBottomChrome, showIndexTicker } from '../components/index-dock.js';
import { setTextClass } from '../dom.js';

const MARKET_TABS = [
  { id: 'overview', label: '概况', markets: null },
  { id: 'us', label: '美股', markets: ['us'] },
  { id: 'hk', label: '港股', markets: ['hk'] },
  { id: 'cn', label: '沪深', markets: ['cn'] },
  { id: 'asia', label: '亚太', markets: ['jp', 'kr'] },
  { id: 'fx', label: '外汇', markets: ['fx'] },
];

const OVERVIEW_ORDER = ['cn', 'hk', 'jp', 'kr', 'us', 'fx'];

const EXTENDED_SESSIONS = new Set(['premarket', 'afterhours', 'overnight']);

function sparklineSvg(changePct) {
  const up = changePct == null || Number(changePct) >= 0;
  const stroke = up ? 'var(--up)' : 'var(--down)';
  const fill = up ? 'rgba(230, 67, 64, 0.14)' : 'rgba(9, 187, 7, 0.14)';
  const line = up
    ? 'M0,22 C6,20 10,16 16,14 22,11 28,13 34,10 38,8 44,6 48,4'
    : 'M0,8 C6,10 10,14 16,16 22,19 28,17 34,20 38,22 44,24 48,26';
  const area = `${line} L48,32 L0,32 Z`;
  return `<svg class="market-card-spark" viewBox="0 0 48 32" preserveAspectRatio="none" aria-hidden="true"><path d="${area}" fill="${fill}"/><path d="${line}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** 行情页统一正盘口径：涨跌幅优先 changePctRegular */
function resolveRegularQuote(it) {
  const changePct =
    it?.changePctRegular != null && Number.isFinite(Number(it.changePctRegular))
      ? Number(it.changePctRegular)
      : it?.changePct != null && Number.isFinite(Number(it.changePct))
        ? Number(it.changePct)
        : null;

  const price = it?.price != null && Number.isFinite(Number(it.price)) ? Number(it.price) : null;
  let change = it?.change != null && Number.isFinite(Number(it.change)) ? Number(it.change) : null;

  if (EXTENDED_SESSIONS.has(it?.quoteSession) && changePct != null && price != null) {
    change = price - price / (1 + changePct / 100);
  } else if (change == null && price != null && changePct != null) {
    change = price - price / (1 + changePct / 100);
  }

  return { price, change, changePct };
}

function indicesForTab(tabId) {
  const tab = MARKET_TABS.find((t) => t.id === tabId);
  const all = app().state.indices ?? [];
  if (!tab || tabId === 'overview') {
    return [...all].sort((a, b) => {
      const ia = OVERVIEW_ORDER.indexOf(a.market);
      const ib = OVERVIEW_ORDER.indexOf(b.market);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }
  return all.filter((it) => tab.markets.includes(it.market));
}

function renderMarketCard(it) {
  const { price, change, changePct } = resolveRegularQuote(it);
  const pctCls = pctClass(changePct);
  return `
    <article class="market-index-card ${pctCls}" data-market-index="${escapeHtml(it.label)}">
      <h3 class="market-index-card-name">${escapeHtml(it.label)}</h3>
      <p class="market-index-card-price ${pctCls}">${fmtIndexPrice(price)}</p>
      <p class="market-index-card-change-line ${pctCls}">
        <span class="market-index-card-change">${fmtIndexChange(change)}</span>
        <span class="market-index-card-pct">${fmtPct(changePct)}</span>
      </p>
      ${sparklineSvg(changePct)}
    </article>`;
}

function renderMarketTabs() {
  const active = app().state.marketTab || 'us';
  return `
    <nav class="market-tabs" role="tablist" aria-label="市场行情分类">
      ${MARKET_TABS.map(
        (tab) => `
        <button type="button" class="market-tab${active === tab.id ? ' is-active' : ''}" role="tab" aria-selected="${active === tab.id}" data-market-tab="${tab.id}">
          ${escapeHtml(tab.label)}
        </button>`,
      ).join('')}
    </nav>`;
}

function renderMarketGrid() {
  const indices = indicesForTab(app().state.marketTab || 'us');
  if (!indices.length) {
    return `<div class="market-empty"><p>暂无指数行情</p><p class="market-empty-hint">请稍候刷新</p></div>`;
  }
  return `<div class="market-index-grid">${indices.map((it) => renderMarketCard(it)).join('')}</div>`;
}

export function renderMarketPage() {
  const dockClass = showIndexTicker() ? ' has-index-dock' : '';
  return renderShell(
    `
    <section class="market-page has-bottom-nav${dockClass}">
      <div class="market-page-sticky">
        ${renderMarketTabs()}
      </div>
      <div class="holding-list-scroll page-scroll market-page-scroll" id="market-scroll">
        ${renderMarketGrid()}
      </div>
      ${renderBottomChrome()}
    </section>`,
  );
}

function patchMarketCard(cardEl, it) {
  const { price, change, changePct } = resolveRegularQuote(it);
  const pctCls = pctClass(changePct);
  const priceEl = cardEl.querySelector('.market-index-card-price');
  const changeEl = cardEl.querySelector('.market-index-card-change');
  const pctEl = cardEl.querySelector('.market-index-card-pct');
  if (priceEl) {
    priceEl.textContent = fmtIndexPrice(price);
    setTextClass(priceEl, pctCls);
  }
  if (changeEl) changeEl.textContent = fmtIndexChange(change);
  if (pctEl) pctEl.textContent = fmtPct(changePct);
  const lineEl = cardEl.querySelector('.market-index-card-change-line');
  if (lineEl) setTextClass(lineEl, pctCls);
  setTextClass(cardEl, pctCls);
}

export function patchMarketDom() {
  if (app().state.view !== 'market') return false;
  const indices = indicesForTab(app().state.marketTab || 'us');
  for (const it of indices) {
    const card = document.querySelector(`.market-index-card[data-market-index="${CSS.escape(it.label)}"]`);
    if (card) patchMarketCard(card, it);
  }
  return document.querySelector('.market-tabs') != null;
}
