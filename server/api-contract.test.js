
/**
 * API contract + auth middleware smoke tests.
 */
import assert from 'node:assert/strict';
import { handleCorsAndAuth } from './auth.js';

function assertLiveShape(live) {
  assert.ok(live && typeof live === 'object');
  assert.ok(Array.isArray(live.funds));
  assert.ok(live.totals && typeof live.totals === 'object');
  assert.ok('realtimeProfit' in live.totals);
  assert.ok('realtimeAssets' in live.totals);
}

function assertProfitCalendarShape(cal) {
  assert.ok(cal && typeof cal === 'object');
  assert.ok(Array.isArray(cal.days));
}

assertLiveShape({
  funds: [],
  totals: { realtimeProfit: 0, realtimeAssets: 0, settledAssets: 0 },
});
assertProfitCalendarShape({ days: [] });

function mockRes() {
  /** @type {Record<string, string|number>} */
  const headers = {};
  let status = 0;
  /** @type {string} */
  let body = '';
  return {
    headers,
    setHeader(k, v) {
      headers[k] = v;
    },
    writeHead(code, hdrs) {
      status = code;
      Object.assign(headers, hdrs ?? {});
    },
    end(chunk) {
      body = chunk ?? '';
    },
    get status() {
      return status;
    },
    get body() {
      return body;
    },
  };
}

const prevToken = process.env.FUND_TRACKER_API_TOKEN;
process.env.FUND_TRACKER_API_TOKEN = 'test-secret';

const req401 = { method: 'GET', headers: {} };
const res401 = mockRes();
assert.equal(handleCorsAndAuth(req401, res401, '/api/portfolio'), true);
assert.equal(res401.status, 401);

const reqOk = { method: 'GET', headers: { authorization: 'Bearer test-secret' } };
const resOk = mockRes();
assert.equal(handleCorsAndAuth(reqOk, resOk, '/api/portfolio'), false);

const reqHealth = { method: 'GET', headers: {} };
const resHealth = mockRes();
assert.equal(handleCorsAndAuth(reqHealth, resHealth, '/api/health'), false);

process.env.FUND_TRACKER_API_TOKEN = prevToken ?? '';

console.log('api-contract.test.js ok');
