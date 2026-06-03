/** Mac App：列表横向滚动与表头同步、窗口 resize 后重算 inset */

import { refreshBottomChromeInset } from './bottom-chrome-inset.js';

let scrollSyncBound = false;
/** @type {(() => void) | null} */
let onStickyScroll = null;
/** @type {(() => void) | null} */
let onListScroll = null;

function isDesktopApp() {
  return document.documentElement.classList.contains('is-desktop-app');
}

function syncScrollLeft(from, to) {
  if (!from || !to || from._scrollSyncLock) return;
  to._scrollSyncLock = true;
  to.scrollLeft = from.scrollLeft;
  to._scrollSyncLock = false;
}

function unbindListScrollSync() {
  const sticky = document.querySelector('.portfolio-sticky');
  const list = document.getElementById('holding-list-scroll');
  if (sticky && onStickyScroll) sticky.removeEventListener('scroll', onStickyScroll);
  if (list && onListScroll) list.removeEventListener('scroll', onListScroll);
  onStickyScroll = null;
  onListScroll = null;
  scrollSyncBound = false;
}

export function bindDesktopListScrollSync() {
  unbindListScrollSync();
  if (!isDesktopApp()) return;
  const sticky = document.querySelector('.portfolio-sticky');
  const list = document.getElementById('holding-list-scroll');
  if (!sticky || !list) return;

  onStickyScroll = () => syncScrollLeft(sticky, list);
  onListScroll = () => syncScrollLeft(list, sticky);
  sticky.addEventListener('scroll', onStickyScroll, { passive: true });
  list.addEventListener('scroll', onListScroll, { passive: true });
  scrollSyncBound = true;
}

export function refreshDesktopLayout() {
  if (!isDesktopApp()) return;
  refreshBottomChromeInset();
  bindDesktopListScrollSync();
}

export function initDesktopLayout() {
  if (!isDesktopApp()) return;
  window.addEventListener(
    'resize',
    () => {
      requestAnimationFrame(refreshDesktopLayout);
    },
    { passive: true },
  );
}
