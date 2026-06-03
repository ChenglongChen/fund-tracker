/** iPhone Safari / 主屏幕 PWA：启用与 Mac 手机壳一致的布局 class */

function shouldUsePhoneShell() {
  if (typeof window === 'undefined') return false;
  if (window.fundTrackerDesktop?.isDesktop) return false;
  const ua = navigator.userAgent || '';
  const isIphone = /iPhone|iPod/.test(ua);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.navigator.standalone === true;
  return isIphone || standalone;
}

export function initPhoneShell() {
  if (!shouldUsePhoneShell()) return;
  document.documentElement.classList.add('is-phone-shell');
}
