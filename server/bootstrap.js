import { ensurePortfolio, readPortfolio } from './store.js';
import { loadImpactSnapshots, getFundSnapshotRecords } from './impact-snapshots.js';
import { loadDayDisplayState } from './day-display-state.js';
import { seedSessionQuoteSnapshots } from './session-quotes.js';
import { seedFundRegularSnapshots } from './market-session.js';
import { setStooqQuotesUpdatedHandler } from './asia-quotes.js';
import { mergeSharedHoldingQuotes } from './market.js';
import { startSchedulers, requestLiveRefresh } from './live.js';
import { settleIfNeeded } from './settle.js';
import { isScreenshotMode } from './screenshot-bundle.js';
import { readAppState } from './app-state.js';
import { migratePortfolioFromDailyRecords, readProfitLedger } from './profit-ledger.js';
import { backfillProfitLedger } from './profit-backfill.js';
import { beijingDateString, beijingIsoAddDays } from './time.js';

let booted = false;

export async function bootstrapServer() {
  if (booted) return;
  await ensurePortfolio();
  const appStateBoot = await readAppState();
  await migratePortfolioFromDailyRecords(appStateBoot.dailyRecords);
  const ledgerBoot = await readProfitLedger();
  if (!isScreenshotMode() && Object.keys(ledgerBoot.days ?? {}).length === 0) {
    console.log('[profit] profitLedger empty — backfilling recent history…');
    try {
      const portfolio = await readPortfolio();
      const to = beijingDateString();
      const from = beijingIsoAddDays(to, -90);
      await backfillProfitLedger(portfolio, { from, to });
      console.log('[profit] backfill done');
    } catch (e) {
      console.warn('[profit] backfill failed:', e instanceof Error ? e.message : e);
    }
  }
  await loadImpactSnapshots();
  await loadDayDisplayState();
  seedSessionQuoteSnapshots();
  seedFundRegularSnapshots(getFundSnapshotRecords());
  setStooqQuotesUpdatedHandler((partial) => {
    mergeSharedHoldingQuotes(partial);
    requestLiveRefresh();
  });
  startSchedulers(settleIfNeeded);
  booted = true;
}
