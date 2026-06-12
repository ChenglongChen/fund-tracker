#!/usr/bin/env node
/**
 * 用指定北京时间重新 seed eodSnap（默认 16:37，亚太收盘后）。
 * FUND_TRACKER_DATA_DIR 指向 Mac App data 目录。
 */
import './bootstrap-store.js';
import { loadDayDisplayState, clearScopeSnap, setCurrentPhase, getScopeSnap } from '../server/day-display-state.js';
import { bootstrapServer } from '../server/bootstrap.js';
import { waitForLiveCacheReady, getLiveCache, requestLiveRefresh } from '../server/live.js';

const iso = process.env.FUND_TRACKER_RESEED_AT ?? '2026-06-12T08:37:00.000Z';
const accrualDay = process.env.FUND_TRACKER_RESEED_DAY ?? '2026-06-12';
const now = new Date(iso);

await loadDayDisplayState();
clearScopeSnap(accrualDay, 'eodSnap', 'portfolio');
setCurrentPhase('eod_freeze', now);
await bootstrapServer();
requestLiveRefresh();
const ok = await waitForLiveCacheReady(120_000);
const cache = getLiveCache();
const snap = getScopeSnap(accrualDay, 'eodSnap', 'portfolio');
console.log(
  JSON.stringify(
    {
      ready: ok,
      at: iso,
      rt1: cache.totals?.realtimeProfit,
      est: cache.totals?.realtimeAssets,
      settled: cache.totals?.settledAssets,
      snapRt1: snap?.rt1,
      snapAt: snap?.at,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
