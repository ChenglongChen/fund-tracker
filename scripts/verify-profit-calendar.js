#!/usr/bin/env node
/**
 * 验收：收益日历 vs 本地基准 fixture。
 *
 * 默认读取 scripts/fixtures/alipay-may-2026.local.json（私有，不提交 Git）。
 * 若无 local 文件则回退 example，仅做结构检查并提示跳过严格对比。
 *
 * 用法：
 *   cp scripts/fixtures/alipay-may-2026.example.json scripts/fixtures/alipay-may-2026.local.json
 *   # 编辑 local 填入你的基准后：
 *   node scripts/verify-profit-calendar.js
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPortfolio } from '../server/store.js';
import { buildProfitCalendar } from '../server/profit-calendar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');
const LOCAL = path.join(FIXTURES, 'alipay-may-2026.local.json');
const EXAMPLE = path.join(FIXTURES, 'alipay-may-2026.example.json');

/** @param {string} p */
async function readJsonIfExists(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

const localFixture = await readJsonIfExists(LOCAL);
const fixture = localFixture ?? (await readJsonIfExists(EXAMPLE));
if (!fixture) {
  console.error('Missing fixture. Add alipay-may-2026.local.json or .example.json');
  process.exit(1);
}
if (!localFixture) {
  console.warn('⚠ No alipay-may-2026.local.json — using example fixture; strict day diff checks skipped.\n');
}

const portfolio = await readPortfolio();
const cal = await buildProfitCalendar({
  scope: fixture.accountId,
  month: fixture.month,
  accounts: portfolio.accounts ?? [],
  now: new Date('2026-05-29T12:00:00+08:00'),
});

/** @type {string[]} */
const fails = [];
let twoWeekRef = 0;
let twoWeekEst = 0;

const strictDays = localFixture ? new Set(fixture.twoWeekKeys) : new Set();

for (const day of Object.keys(fixture.days)) {
  const ref = fixture.days[day];
  const row = cal.days.find((d) => d.date === day);
  const est = row?.profit ?? 0;
  const diff = Math.abs(est - ref);
  const tol = strictDays.has(day) ? fixture.tolerancePerDay : fixture.tolerancePerDay * 40;
  const ok = !localFixture || diff <= tol;
  const mark = !localFixture ? '~' : strictDays.has(day) ? (ok ? '✓' : '✗') : ok ? '~' : '·';
  console.log(
    `${mark} ${day}  ref=${ref.toFixed(2)}  est=${est.toFixed(2)}  Δ=${(est - ref).toFixed(2)}`,
  );
  if (strictDays.has(day) && !ok) fails.push(day);
}

for (const k of fixture.twoWeekKeys) {
  twoWeekRef += fixture.days[k];
  const row = cal.days.find((d) => d.date === k);
  twoWeekEst += row?.profit ?? 0;
}
const twoWeekDiffPct = twoWeekRef !== 0 ? Math.abs(twoWeekEst - twoWeekRef) / Math.abs(twoWeekRef) : 0;
console.log(`\n近两周  ref=${twoWeekRef.toFixed(2)}  est=${twoWeekEst.toFixed(2)}  Δ%=${(twoWeekDiffPct * 100).toFixed(2)}%`);
if (localFixture && twoWeekDiffPct > fixture.toleranceTwoWeekPct) {
  fails.push('two-week-total');
}

const alipayFunds = portfolio.funds.filter((f) => f.accountId === 'alipay');
const ypSum = alipayFunds.reduce((s, f) => s + (f.yesterdayProfit ?? 0), 0);
const d29 = cal.days.find((d) => d.date === '2026-05-29');
if (localFixture && d29 && Math.abs(d29.profit - ypSum) > 5) {
  console.log(`✗ 5/29 vs yesterdayProfit sum: cal=${d29.profit} portfolio=${ypSum}`);
  fails.push('5/29-yesterdayProfit');
} else if (localFixture) {
  console.log(`✓ 5/29 vs yesterdayProfit (Δ≤5)`);
}

if (!localFixture) {
  console.log('\nverify:profit-calendar SKIPPED strict checks (no .local.json fixture)');
  process.exit(0);
}

if (fails.length) {
  console.error(`\nFAILED: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nverify:profit-calendar PASSED');
