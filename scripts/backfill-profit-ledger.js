#!/usr/bin/env node
/**
 * 回填 profitLedger（东财 lsjz + 支付宝 creditDay 规则）。
 *
 *   node scripts/backfill-profit-ledger.js
 *   node scripts/backfill-profit-ledger.js --from=2026-05-01 --to=2026-05-29 --account=alipay
 */
import { readPortfolio } from '../server/store.js';
import { backfillProfitLedger } from '../server/profit-backfill.js';
import { beijingDateString } from '../server/time.js';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

const from = arg('from', '2026-05-01');
const to = arg('to', beijingDateString());
const accountId = arg('account', null);
const pages = Number(arg('pages', '12')) || 12;

const portfolio = await readPortfolio();
console.log(`Backfill ${from} → ${to}${accountId ? ` (${accountId})` : ''} …`);
const result = await backfillProfitLedger(portfolio, { from, to, accountId, pages });
console.log(JSON.stringify(result, null, 2));
