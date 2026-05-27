const HIDE_ASSETS_KEY = 'fund-tracker-hide-assets';

export const HIDDEN_AMOUNT_TEXT = '******';

/** @returns {boolean} */
export function loadHideAssets() {
  try {
    return localStorage.getItem(HIDE_ASSETS_KEY) === '1';
  } catch {
    return false;
  }
}

/** @param {boolean} hidden */
export function saveHideAssets(hidden) {
  try {
    localStorage.setItem(HIDE_ASSETS_KEY, hidden ? '1' : '0');
  } catch {
    /* ignore */
  }
  return hidden;
}
