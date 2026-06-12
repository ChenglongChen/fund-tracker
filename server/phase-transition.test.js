/**
 * spec §7 时段切换不变量（会话门控 + snap seed 策略）。
 */
import { resolveDisplaySession } from './display-session.js';
import { getUsSessionPhase } from './holding-market.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

/** @type {Array<[string, string, object]>} */
const PHASE_MATRIX = [
  ['00:30 US正盘', '2026-05-28T16:30:00.000Z', { phase: 'us_regular_live', snap: false, rt1: 'live' }],
  ['03:59 US正盘尾', '2026-05-28T19:59:00.000Z', { phase: 'us_regular_live', snap: false, rt1: 'live' }],
  ['04:00 day_open', '2026-05-28T20:00:00.000Z', { phase: 'day_open', snap: true, rt1: 'snap' }],
  ['07:59 day_open', '2026-05-28T23:59:00.000Z', { phase: 'day_open', snap: true, rt1: 'snap' }],
  ['08:00 asia_live', '2026-05-29T00:00:00.000Z', { phase: 'asia_live', snap: false, rt1: 'live' }],
  ['15:59 asia_live', '2026-05-29T07:59:00.000Z', { phase: 'asia_live', snap: false, rt1: 'live' }],
  ['16:00 eod_freeze', '2026-05-29T08:00:00.000Z', { phase: 'eod_freeze', snap: true, rt1: 'snap' }],
  ['21:29 eod_freeze', '2026-05-29T13:29:00.000Z', { phase: 'eod_freeze', snap: true, rt1: 'snap' }],
  ['21:30 US正盘', '2026-05-29T13:30:00.000Z', { phase: 'us_regular_live', snap: false, rt1: 'live' }],
];

for (const [label, iso, exp] of PHASE_MATRIX) {
  const s = resolveDisplaySession(new Date(iso));
  assert(`${label} phase`, s.clockPhase === exp.phase);
  assert(`${label} rt1Source`, s.rt1Source === exp.rt1);
  assert(`${label} isRt1SnapPhase`, s.isRt1SnapPhase === exp.snap);
}

assert(
  'day_open marked snap phase',
  resolveDisplaySession(new Date('2026-05-28T20:00:00.000Z')).isRt1SnapPhase === true,
);
assert(
  'eod_freeze marked snap phase',
  resolveDisplaySession(new Date('2026-05-29T08:00:00.000Z')).isRt1SnapPhase === true,
);

/** 亚太正盘：全穿透含美股昨收（与 live-rt1-holdings.test.js 一致） */
function blendAsiaMorning(holdings) {
  let sumWC = 0;
  let used = 0;
  for (const h of holdings) {
    if (h.changePct == null || !Number.isFinite(h.changePct)) continue;
    sumWC += h.weight * h.changePct;
    used += h.weight;
  }
  return used > 0 ? sumWC / 100 : null;
}

function blendLiveRt1Only(holdings) {
  let sumWC = 0;
  let used = 0;
  for (const h of holdings) {
    if (h.quoteSession !== 'regular') continue;
    if (h.changePct == null || !Number.isFinite(h.changePct)) continue;
    sumWC += h.weight * h.changePct;
    used += h.weight;
  }
  return used > 0 ? sumWC / 100 : null;
}

const usCloseKrLive = [
  { code: 'NVDA', weight: 40, changePct: 3.29, quoteSession: 'closed', quoteMode: 'close', holdingMarket: 'us' },
  { code: '000660', weight: 5, changePct: 8.2, quoteSession: 'regular', quoteMode: 'live', holdingMarket: 'kr' },
];
const asiaMorning = blendAsiaMorning(usCloseKrLive);
const usRegularOnly = blendLiveRt1Only(usCloseKrLive);
assert('asia keeps us close in blend', asiaMorning > 1.5);
assert('us regular liveRt1Only excludes us close', usRegularOnly < 0.5);
assert('asia not below us-only close weight', asiaMorning >= 40 * 3.29 / 100 - 0.01);

assert(
  '04:00 accrual rolls to new day',
  resolveDisplaySession(new Date('2026-05-28T20:00:00.000Z')).accrualDay === '2026-05-29',
);
assert(
  '03:59 accrual still prior day',
  resolveDisplaySession(new Date('2026-05-28T19:59:00.000Z')).accrualDay === '2026-05-28',
);

const usRegular = new Date('2026-05-28T16:30:00.000Z');
assert('liveRt1Only only when US regular', getUsSessionPhase(usRegular) === 'regular');
assert('asia closed us', getUsSessionPhase(new Date('2026-05-29T00:00:00.000Z')) === 'closed');

console.log(`phase-transition tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
