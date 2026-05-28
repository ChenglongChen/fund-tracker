import {
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

const formerPremarket = new Date('2026-05-28T08:30:00.000Z'); // BJ 16:30
const usRegular = new Date('2026-05-28T13:45:00.000Z'); // BJ 21:45
const formerAfterhours = new Date('2026-05-27T21:40:00.000Z'); // BJ 05:40
const asiaLive = new Date('2026-05-28T02:00:00.000Z'); // BJ 10:00 weekday
const weekendAsia = new Date('2026-05-30T02:00:00.000Z'); // BJ 10:00 Sat
const accrualTail = new Date('2026-05-27T18:30:00.000Z'); // BJ 02:30 regular tail

assert('former premarket us closed', resolveDisplaySession(formerPremarket).usPhase === 'closed');
assert(
  'former premarket eod freeze',
  resolveDisplaySession(formerPremarket).clockPhase === 'eod_freeze',
);
assert('former premarket no snap', resolveDisplaySession(formerPremarket).snapKey === 'eodSnap');
assert('former premarket rt1 snap', resolveDisplaySession(formerPremarket).rt1Source === 'snap');

assert('regular usPhase', resolveDisplaySession(usRegular).usPhase === 'regular');
assert(
  'regular clockPhase',
  resolveDisplaySession(usRegular).clockPhase === 'us_regular_live',
);
assert('regular snapKey null', resolveDisplaySession(usRegular).snapKey == null);
assert('regular rt1 live', resolveDisplaySession(usRegular).rt1Source === 'live');

assert('former afterhours closed', resolveDisplaySession(formerAfterhours).usPhase === 'closed');
assert('former afterhours day_open', resolveDisplaySession(formerAfterhours).clockPhase === 'day_open');

assert('asia live us closed', resolveDisplaySession(asiaLive).usPhase === 'closed');
assert(
  'asia live clockPhase',
  resolveDisplaySession(asiaLive).clockPhase === 'asia_live',
);
assert('asia live snapKey null', resolveDisplaySession(asiaLive).snapKey == null);
assert('asia live rt1 live', resolveDisplaySession(asiaLive).rt1Source === 'live');
assert('weekend asia live phase', resolveDisplaySession(weekendAsia).clockPhase === 'asia_live');

assert(
  'accrual day tail',
  resolveDisplaySession(accrualTail).accrualDay === '2026-05-27',
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
  'phaseToPersist regular',
  resolvePhaseToPersist('regular', null, 'us_regular_live') === 'us_regular_live',
);

console.log(`display-session tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
