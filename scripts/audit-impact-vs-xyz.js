/**
 * 估值对比：本地穿透 impact vs 345569.xyz 快照
 * 运行: node scripts/audit-impact-vs-xyz.js [xyz-snapshot.json]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeFundImpact } from '../server/market.js';
import { holdingMatchName } from '../server/holdings-pipeline.js';
import { parseXyzDetailText, XYZ_FUNDS } from './audit-vs-345569.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function findXyzHolding(xyzHoldings, localName) {
  const key = holdingMatchName(localName);
  return xyzHoldings.find((x) => holdingMatchName(x.name) === key);
}

function replayXyzImpact(holdings, xyzHoldings, fxPct = 0) {
  let sum = 0;
  let used = 0;
  let matched = 0;
  for (const h of holdings) {
    const x = findXyzHolding(xyzHoldings, h.name);
    if (!x || x.changePct == null) continue;
    sum += h.weight * x.changePct;
    used += h.weight;
    matched += 1;
  }
  if (used <= 0) return { impact: null, matched, used };
  const base = sum / 100;
  return { impact: base, matched, used };
}

async function main() {
  const snapPath = process.argv[2] || join(ROOT, 'scripts/fixtures/xyz-close-snapshot.json');
  const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
  const portfolio = JSON.parse(readFileSync(join(ROOT, 'data/portfolio.json'), 'utf8'));
  const fxPct = snap.indices?.fx ?? 0;

  const codes = ['270023', '005698', '012922', '022184', '017730', '006075'];
  console.log('\n# 估值对比：本地 vs xyz（xyz 快照为收盘穿透）\n');
  console.log(`xyz 快照: ${snapPath} @ ${snap.updatedAt}\n`);
  console.log('| 代码 | 本地 impact | xyz impact | 差值 | 来源 | xyz复算* | 复算差 |');
  console.log('|------|-------------|------------|------|------|----------|--------|');

  for (const code of codes) {
    const fund = portfolio.funds.find((f) => f.code === code);
    const r = await computeFundImpact(code, fxPct, fund?.name ?? '');
    const xyzRaw = snap[code]?.detailText;
    const xyz = xyzRaw ? parseXyzDetailText(xyzRaw) : null;
    const xyzImpact = snap[code]?.impactPct ?? xyz?.impactPct ?? null;
    const replay = xyz?.holdings?.length
      ? replayXyzImpact(r.holdings, xyz.holdings, fxPct)
      : { impact: null, matched: 0 };

    const local = r.impactPct;
    const delta = local != null && xyzImpact != null ? local - xyzImpact : null;
    const replayDelta =
      local != null && replay.impact != null ? local - replay.impact : null;

    console.log(
      `| ${code} | ${local?.toFixed(2) ?? '—'}% | ${xyzImpact?.toFixed?.(2) ?? '—'}% | ${delta != null ? (delta >= 0 ? '+' : '') + delta.toFixed(2) : '—'}% | ${r.impactSource ?? '—'} | ${replay.impact?.toFixed?.(2) ?? '—'}% | ${replayDelta != null ? (replayDelta >= 0 ? '+' : '') + replayDelta.toFixed(2) : '—'}% |`,
    );

    const bad = r.holdings.filter(
      (h) => h.changePct != null && (h.changePct <= -99 || h.changePct <= -50),
    );
    if (bad.length) {
      console.log(`  ⚠ 异常涨跌 (${bad.length}): ${bad.slice(0, 5).map((h) => `${h.name?.slice(0, 8)} ${h.changePct?.toFixed(1)}%`).join(', ')}`);
    }
  }
  console.log('\n* xyz复算：用 xyz 各持仓涨跌幅 × 本地权重，检验权重/持仓差异\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
