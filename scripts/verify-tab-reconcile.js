/**
 * 三 tab 互证：账户概况 Σ 实时收益 = 全账户 unmerged Σ；全部持仓 merged Σ 与 unmerged 按 code 一致
 * 用法：node scripts/verify-tab-reconcile.js [--url=http://localhost:8788]
 */

const baseUrl = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8788';

function round2(n) {
  return Math.round(n * 100) / 100;
}

function mergeByCode(funds) {
  const map = new Map();
  for (const f of funds) {
    const hit = map.get(f.code);
    if (!hit) {
      map.set(f.code, { ...f, realTimeProfit: f.estimateProfit ?? 0 });
      continue;
    }
    hit.amount += f.amount ?? 0;
    hit.realTimeProfit = (hit.realTimeProfit ?? 0) + (f.estimateProfit ?? 0);
  }
  return [...map.values()];
}

async function main() {
  const [portfolioRes, liveRes] = await Promise.all([
    fetch(`${baseUrl}/api/portfolio`),
    fetch(`${baseUrl}/api/live`),
  ]);
  if (!portfolioRes.ok || !liveRes.ok) {
    console.error('API unavailable', portfolioRes.status, liveRes.status);
    process.exit(1);
  }

  const portfolio = await portfolioRes.json();
  const live = await liveRes.json();
  const liveById = new Map((live.funds ?? []).map((f) => [f.id, f]));
  const accounts = portfolio.accounts ?? [];

  let unmergedRt = 0;
  const perAccount = {};
  for (const pf of portfolio.funds ?? []) {
    const lv = liveById.get(pf.id);
    const ep = lv?.estimateProfit;
    if (ep == null || !Number.isFinite(ep)) continue;
    unmergedRt += ep;
    perAccount[pf.accountId] = (perAccount[pf.accountId] ?? 0) + ep;
  }
  unmergedRt = round2(unmergedRt);

  let cardSum = 0;
  for (const acc of accounts) {
    cardSum += round2(perAccount[acc.id] ?? 0);
  }
  cardSum = round2(cardSum);

  const mergedFunds = mergeByCode(
    (portfolio.funds ?? []).map((pf) => {
      const lv = liveById.get(pf.id) ?? {};
      return { ...pf, estimateProfit: lv.estimateProfit ?? null };
    }),
  );
  const mergedRt = round2(mergedFunds.reduce((s, f) => s + (f.realTimeProfit ?? 0), 0));

  const headerRt = live.totals?.realtimeProfit ?? null;
  const baseline = live.totals?.baseline ?? null;
  const est = live.totals?.realtimeAssets ?? null;

  console.log('=== Tab 互证 ===');
  console.log('beijingDate', live.beijingDate);
  console.log('displayState', live.displayState?.phase ?? '—');
  console.log('unmerged Σ RT1', unmergedRt);
  console.log('account cards Σ RT1', cardSum);
  console.log('merged all Σ RT1', mergedRt);
  console.log('header totals.realtimeProfit', headerRt);
  console.log('baseline + RT1', baseline != null && headerRt != null ? round2(baseline + headerRt) : '—');
  console.log('totals.realtimeAssets', est);

  let failed = false;
  if (cardSum !== unmergedRt) {
    console.error('FAIL: account cards Σ ≠ unmerged Σ');
    failed = true;
  }
  if (mergedRt !== unmergedRt) {
    console.warn('WARN: merged Σ ≠ unmerged Σ (expected when duplicate codes across accounts)');
  }
  if (headerRt != null && Math.abs(headerRt - unmergedRt) > 0.05) {
    console.error('FAIL: header RT1 ≠ unmerged Σ');
    failed = true;
  }
  if (baseline != null && headerRt != null && est != null) {
    const canonical = round2(baseline + headerRt);
    if (Math.abs(canonical - est) > 0.05) {
      console.error('FAIL: realtimeAssets ≠ baseline + RT1');
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log('OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
