import {
  BJ_PREMARKET_START_MIN,
  inferDisplayPhaseFromClock,
  resolveDisplaySession,
  resolvePhaseToPersist,
  resolveSnapKey,
} from './display-session.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

const premarket = new Date('2026-05-28T08:30:00.000Z'); // BJ 16:30
const usRegular = new Date('2026-05-28T13:45:00.000Z'); // BJ 21:45
const afterhours = new Date('2026-05-27T21:40:00.000Z'); // BJ 05:40
const asiaLive = new Date('2026-05-28T02:00:00.000Z'); // BJ 10:00 weekday
const weekendAsia = new Date('2026-05-30T02:00:00.000Z'); // BJ 10:00 Sat
const accrualTail = new Date('2026-05-27T18:30:00.000Z'); // BJ 02:30 regular tail

assert('premarket usPhase', resolveDisplaySession(premarket).usPhase === 'premarket');
assert(
  'premarket clockPhase',
  resolveDisplaySession(premarket).clockPhase === 'premarket_freeze',
);
assert('premarket snapKey', resolveDisplaySession(premarket).snapKey === 'premarketSnap');
assert('premarket rt1 snap', resolveDisplaySession(premarket).rt1Source === 'snap');
assert('premarket row2 live', resolveDisplaySession(premarket).row2Source === 'live');

assert('regular usPhase', resolveDisplaySession(usRegular).usPhase === 'regular');
assert(
  'regular clockPhase',
  resolveDisplaySession(usRegular).clockPhase === 'us_regular_live',
);
assert('regular snapKey null', resolveDisplaySession(usRegular).snapKey == null);
assert('regular rt1 live', resolveDisplaySession(usRegular).rt1Source === 'live');
assert('regular discard premarket', resolveDisplaySession(usRegular).shouldDiscardPremarketSnap);

assert('afterhours snap', resolveDisplaySession(afterhours).snapKey === 'afterhoursSnap');
assert('afterhours extended', resolveDisplaySession(afterhours).extendedSession === 'afterhours');

assert('overnight usPhase', resolveDisplaySession(asiaLive).usPhase === 'overnight');
assert(
  'overnight clockPhase',
  resolveDisplaySession(asiaLive).clockPhase === 'overnight_freeze',
);
assert('overnight snapKey', resolveDisplaySession(asiaLive).snapKey === 'overnightSnap');
assert('overnight rt1 snap', resolveDisplaySession(asiaLive).rt1Source === 'snap');
assert('overnight row2 live', resolveDisplaySession(asiaLive).row2Source === 'live');
assert('overnight extended', resolveDisplaySession(asiaLive).extendedSession === 'overnight');
assert('weekend asia live phase', resolveDisplaySession(weekendAsia).clockPhase === 'asia_live');

assert(
  'accrual day tail',
  resolveDisplaySession(accrualTail).accrualDay === '2026-05-27',
);

assert(
  'persisted phase overrides snap read',
  resolveDisplaySession(premarket, { persistedPhase: 'day_open' }).snapKey === 'premarketSnap',
);
assert(
  'afterhours usPhase beats stale persisted premarket',
  resolveDisplaySession(afterhours, { persistedPhase: 'premarket_freeze' }).snapKey ===
    'afterhoursSnap',
);

assert(
  'phaseToPersist premarket',
  resolvePhaseToPersist('premarket', 'premarketSnap', 'premarket_freeze') === 'premarket_freeze',
);
assert(
  'resolveSnapKey eod',
  resolveSnapKey('closed', 'eod_freeze') === 'eodSnap',
);
assert(
  'infer weekend asia',
  inferDisplayPhaseFromClock('closed', 10 * 60) === 'asia_live',
);
assert(
  'infer weekday overnight',
  inferDisplayPhaseFromClock('overnight', 10 * 60) === 'overnight_freeze',
);
assert(
  'backfill premarket needs 16:00',
  !resolveDisplaySession(new Date('2026-05-28T07:30:00.000Z')).canBackfillPremarketSnap,
);
assert(
  'clear premarket before 16:00',
  resolveDisplaySession(new Date('2026-05-28T07:30:00.000Z')).shouldClearPremarketSnap,
);

console.log(`display-session tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
