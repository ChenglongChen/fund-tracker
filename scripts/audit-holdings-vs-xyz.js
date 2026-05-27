/**
 * 持仓对比：本地（东财股票 + 季报 §5.9 基金投资）vs 345569.xyz 快照
 * 运行: node scripts/audit-holdings-vs-xyz.js [xyz-snapshot.json]
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  fetchFundHoldings,
  holdingMatchName,
} from '../server/market.js';
import { XYZ_FUNDS, parseXyzDetailText } from './audit-vs-345569.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const XYZ_NAME_ALIASES = [
  ['南方两倍做多三星', '南方两倍做多三星'],
  ['南方两倍做多海力士', '南方两倍做多海力士'],
  ['三倍做多半导体etf-direxion', '三倍做多半导体etf-direxion'],
  ['direxiondailysemiconductorbull3x', '三倍做多半导体etf-direxion'],
];

function normName(name) {
  let n = holdingMatchName(name);
  for (const [from, to] of XYZ_NAME_ALIASES) {
    if (n.includes(from.replace(/\s/g, ''))) n = to;
  }
  return n;
}

function matchHoldings(a, b) {
  return normName(a.name) === normName(b.name);
}

function diffHoldings(local, xyz) {
  const onlyXyz = xyz.filter((x) => !local.some((l) => matchHoldings(l, x)));
  const onlyLocal = local.filter((l) => !xyz.some((x) => matchHoldings(l, x)));
  const weightDiff = [];
  let exact = 0;
  for (const x of xyz) {
    const l = local.find((o) => matchHoldings(o, x));
    if (!l) continue;
    const d = l.weight - x.weight;
    if (Math.abs(d) > 0.05) weightDiff.push({ name: x.name, xyz: x.weight, local: l.weight, delta: d });
    else exact += 1;
  }
  return { onlyXyz, onlyLocal, weightDiff, exact };
}

async function main() {
  const snapPath = process.argv[2] || join(ROOT, 'data/xyz-close-snapshot.json');
  const portfolio = JSON.parse(readFileSync(join(ROOT, 'data/portfolio.json'), 'utf8'));
  const unique = [...new Map(portfolio.funds.map((f) => [f.code, f])).values()];
  const xyzByCode = XYZ_FUNDS.filter((x) => x.code);
  const common = xyzByCode.filter((x) => unique.some((f) => f.code === x.code));

  const snap = existsSync(snapPath) ? JSON.parse(readFileSync(snapPath, 'utf8')) : {};

  console.log('\n# 持仓对比：本地（jjcc + 季报 §5.9）vs 345569.xyz\n');
  console.log(`数据源: 东财 F10 股票 + 基金季报 PDF §5.9 基金投资`);
  console.log(`对比基金: ${common.map((x) => x.code).join(', ')}`);
  console.log(`xyz 快照: ${snapPath}\n`);

  const summary = [];

  for (const x of common) {
    const fundRow = unique.find((f) => f.code === x.code);
    const pack = await fetchFundHoldings(x.code, fundRow?.name || x.name);
    const xyzRaw = snap[x.code]?.detailText;
    const xyzParsed = xyzRaw
      ? parseXyzDetailText(xyzRaw)
      : snap[x.code]?.holdings
        ? snap[x.code]
        : null;

    console.log(`## ${x.code} ${x.name}\n`);
    console.log(
      `- 季报 PDF: ${pack.reportMeta?.pdfUrl ?? '—'} (${pack.reportFundCount ?? 0} 支 §5.9 基金)`,
    );
    console.log(
      `- 本地合并持仓: ${pack.holdings.length} 支 | 345569: ${xyzParsed?.count ?? '?'} 支`,
    );

    if (!xyzParsed?.holdings?.length) {
      console.log('- ⚠ 无 xyz 快照 detailText，跳过明细对比\n');
      summary.push({ code: x.code, status: 'no-snapshot' });
      continue;
    }

    const reportFunds = pack.holdings.filter((h) => h.source === 'report-fund');
    const d = diffHoldings(pack.holdings, xyzParsed.holdings);

    console.log(`- 名称+权重(±0.05%)一致: ${d.exact} / ${xyzParsed.holdings.length}`);
    if (reportFunds.length) {
      console.log(
        `- §5.9 基金持仓: ${reportFunds.map((h) => `${h.name} ${h.weight}%`).join(', ')}`,
      );
    }
    if (d.onlyXyz.length) {
      console.log(`- 仅 xyz 有 (${d.onlyXyz.length}): ${d.onlyXyz.slice(0, 12).map((h) => h.name).join(', ')}${d.onlyXyz.length > 12 ? '…' : ''}`);
    }
    if (d.onlyLocal.length) {
      console.log(
        `- 仅本地有 (${d.onlyLocal.length}): ${d.onlyLocal.slice(0, 12).map((h) => h.name).join(', ')}${d.onlyLocal.length > 12 ? '…' : ''}`,
      );
    }
    if (d.weightDiff.length) {
      console.log('- 权重差异 >0.05% (前 8):');
      for (const w of d.weightDiff.slice(0, 8)) {
        console.log(
          `  · ${w.name}: xyz ${w.xyz.toFixed(2)}% vs 本地 ${w.local.toFixed(2)}% (${w.delta > 0 ? '+' : ''}${w.delta.toFixed(2)})`,
        );
      }
    }

    // Top15 side-by-side
    const topN = 15;
    console.log(`\n| # | 345569 | w% | 本地 | w% | 备注 |`);
    console.log(`|---|--------|-----|------|-----|------|`);
    for (let i = 0; i < topN; i++) {
      const a = xyzParsed.holdings[i];
      const b = pack.holdings[i];
      let note = '';
      if (a && b) {
        if (!matchHoldings(a, b)) note = '名称不同';
        else if (Math.abs(a.weight - b.weight) > 0.05) note = '权重差';
      } else if (a && !b) note = '本地缺失';
      else if (!a && b) note = 'xyz未展示';
      console.log(
        `| ${i + 1} | ${a?.name ?? '—'} | ${a?.weight?.toFixed?.(2) ?? '—'} | ${b?.name ?? '—'} | ${b?.weight?.toFixed?.(2) ?? '—'} | ${note} |`,
      );
    }
    console.log('');

    summary.push({
      code: x.code,
      status: 'ok',
      exact: d.exact,
      xyzCount: xyzParsed.holdings.length,
      localCount: pack.holdings.length,
      onlyXyz: d.onlyXyz.length,
      onlyLocal: d.onlyLocal.length,
      weightDiff: d.weightDiff.length,
      reportFunds: reportFunds.length,
    });
  }

  console.log('## 汇总\n');
  console.log('| 代码 | xyz支数 | 本地支数 | 一致 | 仅xyz | 仅本地 | 权重差 | §5.9基金 |');
  console.log('|------|---------|----------|------|-------|--------|--------|----------|');
  for (const s of summary) {
    if (s.status === 'no-snapshot') {
      console.log(`| ${s.code} | — | — | — | — | — | — | — |`);
      continue;
    }
    console.log(
      `| ${s.code} | ${s.xyzCount} | ${s.localCount} | ${s.exact} | ${s.onlyXyz} | ${s.onlyLocal} | ${s.weightDiff} | ${s.reportFunds} |`,
    );
  }
  console.log('\n说明: xyz 对非 Q1 前十大持仓有权重估算；本地对 §5.9 基金用季报披露权重，股票段仍走 Q1+年报模型。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
