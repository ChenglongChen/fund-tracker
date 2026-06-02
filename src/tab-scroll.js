
/** 各主 Tab 滚动容器 — paint 前 capture、渲染后 restore */

export const TAB_SCROLL_IDS = {
  list: 'holding-list-scroll',
  profit: 'profit-page-scroll',
  watchlist: 'watchlist-scroll',
  market: 'market-scroll',
  profile: 'profile-scroll',
};

/** @type {Record<string, number>} */
const scrollTopByView = {};

/** 在 DOM 替换前保存当前页面上所有 Tab 滚动位置 */
export function captureAllTabScrolls() {
  for (const [view, id] of Object.entries(TAB_SCROLL_IDS)) {
    const el = document.getElementById(id);
    if (el) scrollTopByView[view] = el.scrollTop;
  }
}

/** @param {string} view */
export function restoreTabScroll(view) {
  const id = TAB_SCROLL_IDS[view];
  if (!id) return;
  const top = scrollTopByView[view] ?? 0;
  const apply = () => {
    const el = document.getElementById(id);
    if (el) el.scrollTop = top;
  };
  apply();
  requestAnimationFrame(apply);
}

/** @param {string} view */
export function resetTabScroll(view) {
  scrollTopByView[view] = 0;
  const id = TAB_SCROLL_IDS[view];
  const el = id && document.getElementById(id);
  if (el) el.scrollTop = 0;
}
