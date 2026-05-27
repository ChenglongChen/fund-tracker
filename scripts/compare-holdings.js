/**
 * 对比本地持仓与参考列表（如 345569 导出的 JSON）。
 * 运行: node scripts/compare-holdings.js 270023 [ref.json]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchFundHoldings, holdingMergeKey, holdingMatchName } from '../server/market.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REF = join(__dirname, '../data/ref-270023-345569.json');

const code = process.argv[2] || '270023';
const refPath = process.argv[3] || (code === '270023' ? DEFAULT_REF : undefined);

function matchRef(ours, ref) {
  if (ours.code && ref.code && holdingMergeKey(ours) === holdingMergeKey(ref)) return true;
  return holdingMatchName(ours.name) === holdingMatchName(ref.name);
}

async function main() {
  const pack = await fetchFundHoldings(code);
  const ours = pack.holdings;

  console.log(`\n=== ${code} 本地持仓 ===`);
  console.log(
    `报告: Q ${pack.recentReportDate} + 年报 ${pack.annualReportDate} | 共 ${ours.length} 支`,
  );
  console.log('Top 10:', ours.slice(0, 10).map((h) => `${h.name} ${h.weight}%`).join(' | '));

  if (!refPath) {
    console.log('\n提示: 传入参考 JSON 可 diff，格式 [{ "name":"智谱", "weight":5.1 }]');
    console.log(JSON.stringify(ours.map((h) => ({ name: h.name, code: h.code, weight: h.weight })), null, 2));
    return;
  }

  const ref = JSON.parse(readFileSync(refPath, 'utf8'));
  const onlyRef = ref.filter((r) => !ours.some((o) => matchRef(o, r)));
  const onlyOurs = ours.filter((o) => !ref.some((r) => matchRef(o, r)));
  const weightDiff = [];

  for (const r of ref) {
    const o = ours.find((x) => matchRef(x, r));
    if (!o) continue;
    const delta = o.weight - r.weight;
    if (Math.abs(delta) > 0.011) weightDiff.push({ name: r.name, ref: r.weight, ours: o.weight, delta });
  }

  console.log(`\n=== 与参考对比 (${ref.length} 支) ===`);
  console.log(`完全一致: ${ref.length - onlyRef.length - weightDiff.length} 支`);
  console.log(`仅参考有: ${onlyRef.length}`, onlyRef.map((x) => x.name).join(', ') || '—');
  console.log(`仅本地有: ${onlyOurs.length}`, onlyOurs.map((x) => x.name).join(', ') || '—');
  if (weightDiff.length) {
    console.log('权重差异:');
    for (const d of weightDiff.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 15)) {
      console.log(`  ${d.name}: 参考 ${d.ref}% vs 本地 ${d.ours}% (${d.delta > 0 ? '+' : ''}${d.delta.toFixed(2)})`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
