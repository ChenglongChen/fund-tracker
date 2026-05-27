import { fmtMoneyRaw } from './format.js';
import { HIDDEN_AMOUNT_TEXT } from './privacy.js';

/** @type {() => boolean} */
let hideAssets = () => false;

/** @param {() => boolean} getter */
export function bindHideAssets(getter) {
  hideAssets = getter;
}

export function fmtMoney(v, signed = false) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  if (hideAssets()) return HIDDEN_AMOUNT_TEXT;
  return fmtMoneyRaw(v, signed);
}

export function fmtHoldAmount(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  if (hideAssets()) return HIDDEN_AMOUNT_TEXT;
  return `¥ ${fmtMoneyRaw(v)}`;
}

export function fmtEstimatedAssets(v) {
  if (hideAssets()) return HIDDEN_AMOUNT_TEXT;
  return `预估 ${fmtMoneyRaw(v)}`;
}
