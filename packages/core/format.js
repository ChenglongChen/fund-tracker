import { beijingTimeHms } from './time.js';

/** 纯格式化工具（无隐私、无业务状态） */

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function pctClass(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'is-flat';
  const n = Number(v);
  if (n > 0) return 'is-up';
  if (n < 0) return 'is-down';
  return 'is-flat';
}

export function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function fmtMoneyRaw(v, signed = false) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!signed) return abs;
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

export function fmtIndexPrice(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtIndexChange(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

/** @param {Date} [date] 北京时间 HH:mm:ss */
export function fmtTime(date = new Date()) {
  return beijingTimeHms(date);
}

export function fmtTableDate(dateStr) {
  if (!dateStr) return '—';
  const s = String(dateStr);
  if (s.length >= 10) return s.slice(5).replace('-', '/');
  return s;
}

/** 表头日期标签：仅保留 MM-DD（去掉 HH:mm:ss） */
export function fmtHeadDateLabel(label) {
  if (!label) return '';
  const s = String(label).trim();
  const md = s.match(/^(\d{2}-\d{2})\b/);
  if (md) return md[1];
  return s;
}
