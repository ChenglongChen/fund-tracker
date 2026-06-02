
/** 实测 fixed 底栏高度，避免大盘指数 / Tab 挡住列表最后一项（Mac App / PWA 通用） */

let resizeObserver = null;

export function syncBottomChromeInset() {
  const chrome = document.getElementById('bottom-chrome');
  const root = document.documentElement;
  if (!chrome) {
    root.style.removeProperty('--bottom-chrome-measured-h');
    return;
  }
  const h = Math.ceil(chrome.getBoundingClientRect().height);
  root.style.setProperty('--bottom-chrome-measured-h', `${h}px`);
}

function observeBottomChrome() {
  const chrome = document.getElementById('bottom-chrome');
  if (!chrome) return;
  if (typeof ResizeObserver === 'undefined') {
    syncBottomChromeInset();
    return;
  }
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => syncBottomChromeInset());
  }
  resizeObserver.disconnect();
  resizeObserver.observe(chrome);
  syncBottomChromeInset();
}

export function initBottomChromeInset() {
  observeBottomChrome();
  window.addEventListener('resize', syncBottomChromeInset, { passive: true });
  window.visualViewport?.addEventListener('resize', syncBottomChromeInset, { passive: true });
}

/** paint / drawer 切换后调用 */
export function refreshBottomChromeInset() {
  requestAnimationFrame(() => {
    observeBottomChrome();
    requestAnimationFrame(syncBottomChromeInset);
  });
}
