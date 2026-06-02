import { ensurePortfolio } from './store.js';
import { loadImpactSnapshots, getFundSnapshotRecords } from './impact-snapshots.js';
import { loadDayDisplayState } from './day-display-state.js';
import { seedSessionQuoteSnapshots } from './session-quotes.js';
import { seedFundRegularSnapshots } from './market-session.js';
import { setStooqQuotesUpdatedHandler } from './asia-quotes.js';
import { mergeSharedHoldingQuotes } from './market.js';
import { startSchedulers, settleIfNeeded, requestLiveRefresh } from './live.js';

let booted = false;

export async function bootstrapServer() {
  if (booted) return;
  await ensurePortfolio();
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
