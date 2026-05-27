/** @param {Element|null} el @param {string} cls */
export function setTextClass(el, cls) {
  if (!el) return;
  el.classList.remove('is-up', 'is-down', 'is-flat');
  if (cls) el.classList.add(cls);
}
