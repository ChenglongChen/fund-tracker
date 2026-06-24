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

### 回归（推荐）

```bash
npm run test:regression   # 大改 RT1/EST/snap/穿透 后必跑，14 组串联
npm run build             # 动 src/ 时加跑
```

### 单测

| 命令 | 说明 |
|------|------|
| `npm run test:regression` | **全量回归**（见 package.json 串联列表） |
| `npm run test:fund-estimate` | RT1/EST 公式、snap |
| `npm run test:realtime-profit` | 组合 RT1 与 baseline 一致 |
| `npm run test:api-contract` | API 鉴权 + 响应结构契约 |
| `npm run test:qdii-valuation` | QDII 穿透/融合/FX/覆盖率 |
| `npm run test:display-session` | phase / snapKey 会话 |
| `npm run test:display-state` | snap 状态（`snap-state.test.js`） |
| `npm run test:live-pipeline` | 展示流水线 |
| `npm run test:timeline-audit` | 全时段 × 多市场核算审计（spec §7） |
| `npm run test:fund-holding-fields` | 持仓 quote 字段 + 基金 row + snap/入账互证（spec §10） |
| `npm run test:fund-regular-eligibility` | 正盘门控 / 行情刷新 |
| `npm run test:holdings-rt1` | liveRt1Only、T+1 掩码 |
| `npm run test:scope-totals` | 多账户 scope 合计 |
| `npm run test:phase-transition` | 时段边界切换 |
| `npm run test:realtime-display-pipeline` | suppress + snap + header=Σrow1 |
| `npm run test:profit-calendar` | 收益日历 / pending / attribution |
| `npm run test:holding-market` | 各市场开收市窗口 |
| `npm run test:market-session` | 时段、suppress、当日收益 pending |

## 3. 验收脚本

需 API 运行中（默认 `http://localhost:8788`）：

```bash
npm run verify:alipay-realtime   # 支付宝 scope：Σ estimateProfit = row1
npm run verify:tab-reconcile     # 三 tab RT1 互证、baseline+RT1=EST
npm run verify:profit-calendar   # 收益日历 vs fixture（需 local 或 example）
npm run backfill:profit-ledger   # 历史 ledger 回填
```

可选参数：`node scripts/verify-alipay-realtime.js --url=http://host:port`

## 4. 改代码时的检查清单

### 动到实时展示

- [ ] `resolveLiveDisplayImpact` 与 `fundEstimateImpactPct` 正盘口径一致
- [ ] `buildDisplayFundRow` 的 `estimateProfit` 来自 **display impact**，非 raw `r`
- [ ] `fundEstimatedAssets` / `estimatedAssetsForRow` 为 **`amount+ep`**（非 `amount−settled+ep`）
- [ ] `buildSummary` 读 API `live.totals` / `totalsByAccount`；无 totals 时用 `Σ estimateAssets` / `Σ estimateProfit`
- [ ] `refreshFundHoldingsDisplay` 在 `applySessionQuotes` 后调用 `maskHoldingsForLiveRt1Display`
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
```

## 6. 关键调试 API

```bash
curl -s http://localhost:8788/api/live | jq '{date:.beijingDate, chip:.displayContext.marketChip, totals:.totals, phase:.displayState}'
curl -s http://localhost:8788/api/live | jq '.funds[] | select(.code=="022364") | {code, estimateProfit, impactPct, market}'
# QDII 详情穿透（示例 code 见 scripts/fixtures/screenshot/fund-detail-packs.json）
curl -s http://localhost:8788/api/fund/270023/detail | jq '.holdings[0:3]'
```

## 7. 目录约定

- 运行时数据写 `data/`，勿提交 Git（除 `valuation-profiles.example.json` 等示例）
- 规格变更先更新 `docs/realtime-spec.md`，再改代码
- README 截图：`npm run screenshot:readme`（数据包 `scripts/fixtures/screenshot/`）

## 8. 维护备忘（非阻塞）

| 项 | 说明 |
|----|------|
| per-scope baseline | 当前 portfolio 级；账户 scope 独立 baseline 待扩展 |
| EOD snap | 休市后 drift 防护可加强 |
| 时段验收 | 部分规则需特定北京时间人工 spot check |
