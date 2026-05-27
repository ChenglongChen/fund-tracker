# 开发指南

## 1. 环境

```bash
npm install
npm run dev          # 前端 :5178 + API :8788
npm run dev:api      # 仅 API
npm run dev:web      # 仅 Vite
```

生产：

```bash
npm run build
PORT=8788 npm start  # 静态 + API 同端口
```

## 2. 测试

| 命令 | 说明 |
|------|------|
| `npm run test:fund-estimate` | RT1/EST 公式、盘前 snap |
| `npm run test:realtime-profit` | 组合 RT1 与 baseline 一致 |
| `node server/market-session.test.js` | 时段、suppress、盘前 display |

## 3. 验收脚本

需 API 运行中（默认 `http://localhost:8788`）：

```bash
npm run verify:alipay-realtime   # 支付宝 scope：Σ estimateProfit = row1
npm run verify:tab-reconcile     # 三 tab RT1 互证、baseline+RT1=EST
```

可选参数：`node scripts/verify-alipay-realtime.js --url=http://host:port`

## 4. 改代码时的检查清单

### 动到实时展示

- [ ] `resolveLiveDisplayImpact` 与 `fundEstimateImpactPct` 盘前/盘后口径一致
- [ ] `buildLiveFundRow` 的 `estimateProfit` 来自 **display impact**，非 raw `r`
- [ ] `buildSummary` 使用 `settledAssets + totalRealTime`
- [ ] snap 阶段 `applyPortfolioTotalsSnap` 覆盖 totals

### 动到入账

- [ ] `settle.js` **不要** clear snap / premarket state
- [ ] 入账后 RT1/EST 在 snap phase 不变

### 动到日切

- [ ] `getRt1AccrualDay`：00:00–04:00 归属前一日
- [ ] `ensureDayBaseline` 在 0:00 滚 baseline

## 5. 估值校准

```bash
npm run calibrate:valuation   # → data/valuation-profiles.json
npm run backtest:valuation
npm run audit:impact-xyz
```

## 6. 关键调试 API

```bash
curl -s http://localhost:8788/api/live | jq '{date:.beijingDate, chip:.displayContext.marketChip, totals:.totals, phase:.displayState}'
curl -s http://localhost:8788/api/live | jq '.funds[] | select(.code=="022364") | {code, estimateProfit, impactPct, market}'
```

## 7. 目录约定

- 运行时数据写 `data/`，勿提交 Git（除 `valuation-profiles.json`）
- 规格变更先更新 `docs/realtime-spec.md`，再改代码

## 8. 已知后续项

| 项 | 说明 |
|----|------|
| per-scope baseline | 当前 portfolio 级；alipay 等 scope 独立 baseline 待扩展 |
| EOD snap 完整性 | 08:00 写入已有；休市后 drift 防护可加强 |
| 21:00 验收 | 盘前 60s header 0 变化需线上时段人工确认 |
