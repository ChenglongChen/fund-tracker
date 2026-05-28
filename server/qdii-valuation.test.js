import assert from 'node:assert/strict';
import {
  blendEnsembleImpact,
  ensembleAlpha,
  isFundgzFresh,
  valuationConfidenceLabel,
} from './qdii-valuation.js';
import { computeHoldingsImpactBreakdown } from './holdings-pipeline.js';

const mixed = [
  { code: 'NVDA', weight: 10, changePct: 1, quoteSession: 'regular', holdingMarket: 'us' },
  { code: '00700', weight: 8, changePct: -2, quoteSession: 'regular', holdingMarket: 'hk' },
];

const bd = computeHoldingsImpactBreakdown(mixed, { usd: 0.2, hkd: 0.1 });
assert.equal(bd?.holdingsPct, -0.06);
assert.ok(Math.abs(bd.fxUsdContribution - 0.02) < 0.0001);
assert.ok(Math.abs(bd.fxHkdContribution - 0.008) < 0.0001);
assert.ok(Math.abs(bd.totalPct - (-0.032)) < 0.0001);

assert.equal(blendEnsembleImpact(1, 3, 1), 1);
assert.equal(blendEnsembleImpact(1, 3, 0), 3);
assert.equal(blendEnsembleImpact(1, 3, 0.5), 2);

assert.ok(ensembleAlpha({ quoteCoverage: 80, reportAgeDays: 30, fundgzFresh: true }) > 0.7);
assert.equal(ensembleAlpha({ quoteCoverage: 80, fundgzFresh: false }), 1);

const now = new Date('2026-05-28T12:00:00.000Z');
assert.equal(isFundgzFresh({ gztime: '2026-05-28 19:30' }, now), true);
assert.equal(isFundgzFresh({ gztime: '2026-05-27 10:00' }, now), false);

assert.equal(valuationConfidenceLabel({ quoteCoverage: 75, reportAgeDays: 60, impactSource: 'holdings' }), '高·穿透');
assert.equal(valuationConfidenceLabel({ quoteCoverage: 50, reportAgeDays: 60, impactSource: 'ensemble' }), '中高·融合');

console.log('qdii-valuation.test.js OK');
