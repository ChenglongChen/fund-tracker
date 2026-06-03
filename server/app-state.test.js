import assert from 'node:assert/strict';
import {
  isDailyRecordCalendarReady,
  pruneProvisionalDailyRecords,
} from './app-state.js';

const today = '2026-06-03';

assert.equal(
  isDailyRecordCalendarReady({ beijingDate: '2026-06-02', settledProfit: 100 }, today),
  true,
  'past day is calendar-ready',
);

assert.equal(
  isDailyRecordCalendarReady({ beijingDate: today, settledProfit: 100 }, today),
  false,
  'today without settle is not calendar-ready',
);

assert.equal(
  isDailyRecordCalendarReady({ beijingDate: today, settled: true, settledProfit: 100 }, today),
  true,
  'today after settle is calendar-ready',
);

assert.equal(
  isDailyRecordCalendarReady({ beijingDate: '2026-06-04', settledProfit: 100 }, today),
  false,
  'future day is not calendar-ready',
);

const pruned = pruneProvisionalDailyRecords(
  {
    dailyRecords: {
      '2026-06-03': { beijingDate: '2026-06-03', settledProfit: 100 },
      '2026-06-02': { beijingDate: '2026-06-02', settled: true, settledProfit: 200 },
    },
  },
  today,
);
assert.equal(pruned.changed, true);
assert.equal(Object.keys(pruned.dailyRecords).length, 1);
assert.equal(pruned.dailyRecords['2026-06-02'].settledProfit, 200);

console.log('app-state tests: ok');
