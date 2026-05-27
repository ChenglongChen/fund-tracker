import { escapeHtml, fmtIndexChange, fmtIndexPrice, fmtPct, pctClass } from '../format.js';
import { app } from '../app/context.js';
import { setTextClass } from '../dom.js';
import { extendedSessionLabel } from './session.js';

const INDEX_DOCK_CAROUSEL_MS = 4000;
/** @type {ReturnType<typeof setInterval> | null} */
let indexDockCarouselTimer = null;

const INDEX_DRAWER_TABS = [
  { id: 'cn', label: '沪深', markets: ['cn'] },
  { id: 'hk', label: '港股', markets: ['hk'] },
  { id: 'asia', label: '亚太', markets: ['jp', 'kr'] },
  { id: 'us', label: '美股', markets: ['us'] },
  { id: 'fx', label: '外汇', markets: ['fx'] },
];

const INDEX_DOCK_CAROUSEL = [
  { market: 'cn', label: '上证' },
  { market: 'cn', label: '沪深300' },
  { market: 'cn', label: '创业板' },
  { market: 'hk', label: '恒生' },
  { market: 'us', label: '纳斯达克100' },
];

export function showIndexTicker() {
  return app().state.view === 'list' && app().state.indices.length > 0;
}

function dockCarouselIndices() {
  return INDEX_DOCK_CAROUSEL.map(({ market, label }) => {
    const exact = app().state.indices.find((it) => it.label === label);
    if (exact) return exact;
    return app().state.indices.find((it) => it.market === market) || null;
  }).filter(Boolean);
}

function dockIndexShortLabel(label) {
  if (label === '纳斯达克100') return '纳指100';
  if (label === '纳斯达克') return '纳指';
  if (label === '沪深300') return '沪深300';
  return label;
}

function indicesForDrawerTab(tabId) {
  const tab = INDEX_DRAWER_TABS.find((t) => t.id === tabId);
  if (!tab) return [];
  return app().state.indices.filter((it) => tab.markets.includes(it.market));
}

function renderIndexTickerItem(it) {
  return `
    <span class="index-ticker-item">
      <span class="index-ticker-name">${escapeHtml(it.label)}</span>
      <span class="index-ticker-val ${pctClass(it.changePct)}">${fmtPct(it.changePct)}</span>
    </span>`;
}

function renderIndexTickerItems(indices = app().state.indices) {
  return indices.map((it) => renderIndexTickerItem(it)).join('');
}

function resolveIndexQuote(it) {
  const price = it?.price != null && Number.isFinite(Number(it.price)) ? Number(it.price) : null;
  let change = it?.change != null && Number.isFinite(Number(it.change)) ? Number(it.change) : null;
  const changePct =
    it?.changePct != null && Number.isFinite(Number(it.changePct)) ? Number(it.changePct) : null;
  if (change == null && price != null && changePct != null) {
    change = price - price / (1 + changePct / 100);
  }
  return { price, change, changePct };
}

function indexShowsDual(it) {
  return (
    it?.market === 'us' &&
    (it?.quoteSession === 'premarket' ||
      it?.quoteSession === 'afterhours' ||
      it?.quoteSession === 'overnight') &&
    it?.changePctRegular != null &&
    Number.isFinite(Number(it.changePctRegular))
  );
}

function renderIndexDockSlide(it) {
  const { price, change, changePct } = resolveIndexQuote(it);
  const cls = pctClass(changePct);
  const extLabel = extendedSessionLabel(it?.quoteSession);
  const quoteInner = indexShowsDual(it)
    ? `
        <span class="index-dock-price ${pctClass(it.changePctRegular)}">${fmtIndexPrice(price)}</span>
        <span class="index-dock-pct ${pctClass(it.changePctRegular)}">${fmtPct(it.changePctRegular)}</span>
        <span class="index-dock-ext">
          <span class="index-dock-ext-pct ${cls}">${fmtPct(changePct)}</span>
          <span class="metric-dual-line__tag">${extLabel}</span>
        </span>`
    : `
        <span class="index-dock-price ${cls}">${fmtIndexPrice(price)}</span>
        <span class="index-dock-change ${cls}">${fmtIndexChange(change)}</span>
        <span class="index-dock-pct ${cls}">${fmtPct(changePct)}</span>`;
  return `
    <div class="index-dock-slide ${cls}" data-dock-label="${escapeHtml(it.label)}">
      <span class="index-dock-name">${escapeHtml(dockIndexShortLabel(it.label))}</span>
      <span class="index-dock-quote">${quoteInner}</span>
    </div>`;
}

function renderIndexDockBar() {
  const slides = dockCarouselIndices();
  if (!slides.length) return '';
  const slideIdx = app().state.indexDockSlide % slides.length;
  const active = slides[slideIdx] ?? slides[0];
  const tone = pctClass(active?.changePct);
  return `
    <div class="index-dock" id="index-dock">
      <button type="button" class="index-dock-bar ${tone}" id="btn-index-dock" aria-expanded="${app().state.indexDrawerOpen}" aria-controls="index-drawer">
        <span class="index-dock-carousel" aria-live="polite" aria-atomic="true">
          ${renderIndexDockSlide(active)}
        </span>
        <span class="index-dock-chevron" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </span>
      </button>
    </div>`;
}

function renderIndexDrawerPanel() {
  const open = app().state.indexDrawerOpen;
  const tabId = app().state.indexDrawerTab;
  const tabIndices = indicesForDrawerTab(tabId);
  const tabs = INDEX_DRAWER_TABS.map(
    (tab) => `
    <button type="button" role="tab" class="index-drawer-tab${tab.id === tabId ? ' is-active' : ''}" data-index-tab="${tab.id}" id="index-tab-${tab.id}" aria-selected="${tab.id === tabId ? 'true' : 'false'}" aria-controls="index-drawer-panel">
      ${escapeHtml(tab.label)}
    </button>`,
  ).join('');
  return `
    <div class="index-drawer${open ? ' is-open' : ''}" id="index-drawer" role="dialog" aria-modal="true" aria-label="大盘指数" aria-hidden="${open ? 'false' : 'true'}">
      <div class="index-drawer-handle" aria-hidden="true"></div>
      <div class="index-drawer-tabs-row">
        <div class="index-drawer-tabs" role="tablist">${tabs}</div>
        <button type="button" class="index-drawer-close" id="btn-index-drawer-close" aria-label="收起">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <div class="index-drawer-grid" id="index-drawer-panel" role="tabpanel" aria-labelledby="index-tab-${tabId}">${renderIndexTickerItems(tabIndices)}</div>
    </div>`;
}

export function renderIndexSheetMask() {
  if (!showIndexTicker()) return '';
  const open = app().state.indexDrawerOpen;
  return `<button type="button" class="index-sheet-mask${open ? ' is-open' : ''}" id="index-sheet-mask" aria-label="关闭大盘指数"${open ? '' : ' hidden'} tabindex="-1"></button>`;
}

function renderIndexBottom() {
  if (!showIndexTicker()) return '';
  return `
    <div class="index-bottom${app().state.indexDrawerOpen ? ' index-bottom--drawer-open' : ''}" id="index-bottom">
      ${renderIndexDrawerPanel()}
      ${renderIndexDockBar()}
    </div>`;
}

export function renderBottomChrome() {
  if (!showIndexTicker()) return '';
  return `<div class="bottom-chrome" id="bottom-chrome">${renderIndexBottom()}</div>`;
}

export function openIndexDrawer() {
  app().state.indexDrawerReturnFocus = document.activeElement;
  app().state.indexDrawerOpen = true;
  stopIndexDockCarousel();
  syncIndexDrawerUi();
  requestAnimationFrame(() => {
    document.getElementById('btn-index-drawer-close')?.focus({ preventScroll: true });
  });
}

export function closeIndexDrawer() {
  app().state.indexDrawerOpen = false;
  syncIndexDrawerUi();
  const returnEl = app().state.indexDrawerReturnFocus;
  app().state.indexDrawerReturnFocus = null;
  if (returnEl instanceof HTMLElement) returnEl.focus({ preventScroll: true });
}

export function syncIndexDrawerUi() {
  const open = app().state.indexDrawerOpen && showIndexTicker();
  const drawer = document.getElementById('index-drawer');
  const bottom = document.getElementById('index-bottom');
  const mask = document.getElementById('index-sheet-mask');
  const scrollEl = document.getElementById('holding-list-scroll');
  const scrollTop = scrollEl?.scrollTop ?? 0;

  document.querySelector('.portfolio-page')?.classList.toggle('index-sheet-open', open);
  bottom?.classList.toggle('index-bottom--drawer-open', open);

  if (drawer) {
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  if (mask) {
    mask.classList.toggle('is-open', open);
    mask.toggleAttribute('hidden', !open);
    mask.tabIndex = open ? 0 : -1;
  }
  document.getElementById('btn-index-dock')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) stopIndexDockCarousel();
  else startIndexDockCarousel();

  if (scrollEl) {
    scrollEl.scrollTop = scrollTop;
    requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollTop;
    });
  }
}

function patchIndexDockSlideEl(slideEl, it) {
  if (!slideEl || !it) return;
  const { price, change, changePct } = resolveIndexQuote(it);
  const cls = pctClass(changePct);
  slideEl.classList.remove('is-up', 'is-down', 'is-flat');
  slideEl.classList.add(cls);
  slideEl.setAttribute('data-dock-label', it.label);
  const nameEl = slideEl.querySelector('.index-dock-name');
  const priceEl = slideEl.querySelector('.index-dock-price');
  const changeEl = slideEl.querySelector('.index-dock-change');
  const pctEl = slideEl.querySelector('.index-dock-pct');
  if (nameEl) nameEl.textContent = dockIndexShortLabel(it.label);
  if (priceEl) {
    priceEl.textContent = fmtIndexPrice(price);
    setTextClass(priceEl, cls);
  }
  if (changeEl) {
    changeEl.textContent = fmtIndexChange(change);
    setTextClass(changeEl, cls);
  }
  if (pctEl) {
    pctEl.textContent = fmtPct(changePct);
    setTextClass(pctEl, cls);
  }
}

function patchIndexDockCarousel(animate = true) {
  const slides = dockCarouselIndices();
  if (!slides.length) return false;
  if (app().state.indexDockSlide >= slides.length) app().state.indexDockSlide = 0;
  const carousel = document.querySelector('.index-dock-carousel');
  if (!carousel) return false;
  const it = slides[app().state.indexDockSlide];
  const apply = () => {
    const slideEl = carousel.querySelector('.index-dock-slide');
    if (slideEl) patchIndexDockSlideEl(slideEl, it);
    else carousel.innerHTML = renderIndexDockSlide(it);
    const bar = document.getElementById('btn-index-dock');
    if (bar && it) {
      const tone = pctClass(it.changePct);
      bar.classList.remove('is-up', 'is-down', 'is-flat');
      bar.classList.add(tone);
    }
  };
  if (animate && carousel.querySelector('.index-dock-slide')) {
    carousel.classList.add('is-fading');
    window.setTimeout(() => {
      apply();
      carousel.classList.remove('is-fading');
    }, 160);
  } else {
    apply();
  }
  return true;
}

export function startIndexDockCarousel() {
  stopIndexDockCarousel();
  if (!showIndexTicker() || app().state.indexDrawerOpen) return;
  const slides = dockCarouselIndices();
  if (slides.length <= 1) return;
  indexDockCarouselTimer = setInterval(() => {
    app().state.indexDockSlide = (app().state.indexDockSlide + 1) % slides.length;
    patchIndexDockCarousel(true);
  }, INDEX_DOCK_CAROUSEL_MS);
}

export function stopIndexDockCarousel() {
  if (indexDockCarouselTimer) clearInterval(indexDockCarouselTimer);
  indexDockCarouselTimer = null;
}

export function patchIndexDrawerTab() {
  const tabId = app().state.indexDrawerTab;
  document.querySelectorAll('.index-drawer-tab').forEach((btn) => {
    const active = btn.getAttribute('data-index-tab') === tabId;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const panel = document.getElementById('index-drawer-panel');
  if (panel) panel.setAttribute('aria-labelledby', `index-tab-${tabId}`);
  const grid = document.querySelector('.index-drawer-grid');
  if (!grid) return false;
  const tabIndices = indicesForDrawerTab(tabId);
  grid.innerHTML = renderIndexTickerItems(tabIndices);
  return true;
}

export function patchIndexTicker() {
  if (!showIndexTicker()) return true;
  if (!patchIndexDockCarousel(false)) return false;
  const drawerItems = document.querySelectorAll('.index-drawer-grid .index-ticker-item');
  const tabIndices = indicesForDrawerTab(app().state.indexDrawerTab);
  if (drawerItems.length !== tabIndices.length) return patchIndexDrawerTab();
  tabIndices.forEach((it, i) => {
    const item = drawerItems[i];
    if (!item) return;
    const nameEl = item.querySelector('.index-ticker-name');
    const valEl = item.querySelector('.index-ticker-val');
    if (nameEl) nameEl.textContent = it.label;
    if (valEl) {
      valEl.textContent = fmtPct(it.changePct);
      setTextClass(valEl, pctClass(it.changePct));
    }
  });
  return true;
}

export function initIndexDrawerGlobalListeners() {
  if (window.__indexDrawerGlobalListeners) return;
  window.__indexDrawerGlobalListeners = true;
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (app().state.indexDrawerOpen) closeIndexDrawer();
      return;
    }
    if (ev.key !== 'Tab' || !app().state.indexDrawerOpen) return;
    const drawer = document.getElementById('index-drawer');
    if (!drawer?.classList.contains('is-open')) return;
    const focusables = [
      ...drawer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  });
  document.addEventListener(
    'wheel',
    (ev) => {
      if (!app().state.indexDrawerOpen || !showIndexTicker()) return;
      if (ev.target instanceof Element && ev.target.closest('#index-drawer')) return;
      const page = document.querySelector('.portfolio-page.index-sheet-open');
      if (page?.contains(ev.target)) ev.preventDefault();
    },
    { passive: false, capture: true },
  );
  document.addEventListener(
    'touchmove',
    (ev) => {
      if (!app().state.indexDrawerOpen || !showIndexTicker()) return;
      if (ev.target instanceof Element && ev.target.closest('#index-drawer')) return;
      const page = document.querySelector('.portfolio-page.index-sheet-open');
      if (page?.contains(ev.target)) ev.preventDefault();
    },
    { passive: false, capture: true },
  );
}
