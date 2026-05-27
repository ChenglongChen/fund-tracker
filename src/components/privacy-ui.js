import { saveHideAssets } from '../privacy.js';
import { app } from '../app/context.js';

export function renderPrivacyToggle() {
  const { state } = app();
  const hidden = state.hideAssets;
  return `
    <button
      type="button"
      class="privacy-toggle"
      id="btn-privacy-toggle"
      aria-pressed="${hidden ? 'true' : 'false'}"
      aria-label="${hidden ? '显示资产' : '隐藏资产'}"
      title="${hidden ? '显示资产' : '隐藏资产'}"
    >
      <svg class="privacy-icon privacy-icon--show" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
      </svg>
      <svg class="privacy-icon privacy-icon--hide" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 2.76 2.24 5 5 5 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-2.76-2.24-5-5-5l-.17.01z"/>
      </svg>
    </button>`;
}

export function patchPrivacyToggle() {
  const { state } = app();
  const btn = document.getElementById('btn-privacy-toggle');
  if (!btn) return;
  const hidden = state.hideAssets;
  btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
  btn.setAttribute('aria-label', hidden ? '显示资产' : '隐藏资产');
  btn.title = hidden ? '显示资产' : '隐藏资产';
}

export function toggleHideAssets() {
  const { state, canPatchDetailDom, patchDetailDom, canPatchListDom, patchListDom, paint } = app();
  state.hideAssets = saveHideAssets(!state.hideAssets);
  patchPrivacyToggle();
  if (state.view === 'detail' && canPatchDetailDom() && patchDetailDom()) return;
  if (state.view === 'list' && canPatchListDom() && patchListDom()) return;
  paint();
}

let privacyClickBound = false;

export function setupPrivacyClick() {
  if (privacyClickBound) return;
  privacyClickBound = true;
  document.getElementById('app')?.addEventListener('click', (ev) => {
    if (!ev.target.closest('.privacy-toggle')) return;
    ev.stopPropagation();
    ev.preventDefault();
    toggleHideAssets();
  });
}
