/**
 * 验收：支付宝账户 scope 下总实时收益 = 各基金 estimateProfit 之和
 * 用法：node scripts/verify-alipay-realtime.js [--url=http://localhost:8788]
 */

const baseUrl = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8788';

function roundProfit(amount, pct) {
  if (pct == null || amount == null) return null;
  return Math.round(((amount * pct) / 100) * 100) / 100;
}

function round2(n) {
  return Math.round(n * 100) / 100;
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

  const alipayFunds = (portfolio.funds ?? []).filter((f) => f.accountId === 'alipay');
  let sumEstimate = 0;
  let sumExtended = 0;
  let sumFrozenRegular = 0;
  let sumRow1Premarket = 0;
  let mismatch = 0;
  /** @type {{ code: string, drift: number, ep: number, gz: number|null }[]} */
  const audit = [];

  for (const pf of alipayFunds) {
    const lv = liveById.get(pf.id);
    if (!lv) continue;

    const ep = lv.estimateProfit;
    if (ep != null && Number.isFinite(ep)) sumEstimate += ep;

    const ext = lv.realTimeProfitExtended;
    if (ext != null && Number.isFinite(ext)) sumExtended += ext;

    const frozenPct = lv.impactPctRegular ?? lv.impactPct;
    const frozenProfit = roundProfit(pf.amount, frozenPct);
    if (frozenProfit != null) sumFrozenRegular += frozenProfit;

    const livePct = lv.impactPctRegularLive ?? lv.impactPctRegular ?? lv.impactPct;
    let row1 = roundProfit(pf.amount, livePct);
    if (lv.impactSession === 'premarket' && ep != null) row1 = ep;
    if (lv.impactSession === 'afterhours' && ep != null) row1 = ep;
    if (row1 != null) sumRow1Premarket += row1;

    const gzPct = lv.rawImpactPct ?? lv.impactPct;
    const gzProfit = roundProfit(pf.amount, gzPct);
    if (ep != null && gzProfit != null) {
      audit.push({ code: pf.code, drift: Math.abs(ep - gzProfit), ep, gz: gzProfit });
    }

    if (ep != null && row1 != null && Math.abs(ep - row1) > 0.02) {
      mismatch += 1;
      console.log(
        `  mismatch ${pf.code} ep=${ep} row1=${row1} session=${lv.impactSession ?? '?'}`,
      );
    }
  }

  sumEstimate = round2(sumEstimate);
  sumExtended = round2(sumExtended);
  sumFrozenRegular = round2(sumFrozenRegular);
  sumRow1Premarket = round2(sumRow1Premarket);
  audit.sort((a, b) => b.drift - a.drift);

  const alipayAssets = alipayFunds.reduce((s, f) => s + (f.amount ?? 0), 0);
  const baseline = live.totals?.baseline ?? null;

  console.log('=== 支付宝账户实时收益验收 ===');
  console.log('beijingDate', live.beijingDate);
  console.log('rt1AccrualDay', live.displayState?.accrualDay ?? '—');
  console.log('displayPhase', live.displayState?.phase ?? '—');
  console.log('marketChip', live.displayContext?.marketChip ?? '—');
  console.log('alipay funds', alipayFunds.length);
  console.log('alipay settledAssets', round2(alipayAssets));
  console.log('sum estimateProfit (header口径)', sumEstimate);
  console.log('sum row1 snap-aligned', sumRow1Premarket);
  console.log('sum extended row2', sumExtended);
  console.log('sum frozen display regular', sumFrozenRegular);
  console.log('live vs frozen drift', round2(sumEstimate - sumFrozenRegular));
  if (baseline != null) {
    console.log('portfolio baseline', baseline);
    console.log('canonical EST (baseline+RT1 portfolio)', round2(baseline + (live.totals?.realtimeProfit ?? 0)));
  }
  console.log('row1 vs header match', sumEstimate === sumRow1Premarket ? 'OK' : 'MISMATCH');
  console.log('per-fund row1 mismatches', mismatch);
  if (audit.length) {
    console.log('top fundgz vs estimate drift:');
    for (const row of audit.slice(0, 5)) {
      console.log(`  ${row.code} ep=${row.ep} gz=${row.gz} drift=${round2(row.drift)}`);
    }
  }

  if (sumEstimate !== sumRow1Premarket || mismatch > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
