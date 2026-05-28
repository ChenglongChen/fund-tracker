# 后端架构

Node API（`:8788`）。原则：**每层单一 writer**，可复用组件只做组装，编排只在 `live-pipeline.js`。

## 分层

```
┌─────────────────────────────────────────────────────────┐
│  Entry — live.js / index.js                              │
│  cache · 调度 · HTTP                                     │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  Pipeline — live-pipeline.js                             │
│  唯一展示编排（顺序不可打乱）                             │
└───────────────────────────┬─────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  fund-display.js    snap-seed/apply      aggregate.js
  per-fund ep        状态机组件            Σ ep + context
        │                   │
        ▼                   ▼
  market-session.js   display-session.js
  display impact      phase / snapKey
        │
        ▼
  components/         fund-estimate.js
  可复用 building blocks   公式库
```

## 流水线（固定顺序）

```
resolveDisplaySession (一次/tick)
→ buildDisplayFundRows          fund-display.js
→ reconcileDisplayState         components/snap-seed.js
→ tryBackfillSnapFromTicks
→ applyDisplaySnapAndTotals     snap-apply + suppress 收口
```

## Single writer

| 数据 | 唯一 writer |
|------|------------|
| `estimateProfit` | `fund-display.buildDisplayFundRow` |
| header `realtimeProfit` | `aggregate.computePortfolioTotals`（仅 Σ ep） |
| phase / snapKey | `display-session.resolveDisplaySession` |
| raw 穿透 pct | `market.js` |
| QDII 穿透 T+1 掩码 | `holdings-pipeline.maskHoldingsForLiveRt1Display` |
| 详情 holdings 刷新 | `market.refreshFundHoldingsDisplay`（须与 pack 同掩码） |
| suppress 收口 | `components/suppress.finalizeLiveFundDisplayRow` |

## 可复用组件（`server/components/`）

| 模块 | 职责 |
|------|------|
| `suppress.js` | A 股 suppress 判定 + row1 强制清空 |
| `market-hours.js` | 交易时段、顶栏 chip、fmtMd |
| `extended-row.js` | row2 extended 金额（pct × amount） |
| `table-head.js` | 列表表头日期汇总 |
| `snap-ready.js` | snap 是否含 per-fund 明细 |
| `snap-entry.js` | 单基金 snap 条目（复制 ep） |
| `snap-seed.js` | reconcile / seed / tick 回填 |
| `snap-apply.js` | 读 snap、portfolio totals、row2 合计 |

## 目录

```
server/
├── index.js              HTTP 路由
├── live.js               /api/live cache + 调度
├── live-pipeline.js      展示唯一编排
├── display-session.js    会话/phase 唯一接口
├── fund-display.js       per-fund ep / EST / row2
├── market-session.js     display impact 解析（穿透→展示 pct）
├── fund-estimate.js      公式库（仅 fund-display 调用）
├── aggregate.js          组合求和 + displayContext
├── day-display-state.js  baseline / snap 持久化
├── market.js             穿透 impact + 详情 refreshFundHoldingsDisplay
├── holdings-pipeline.js  加权估值、liveRt1Only、maskHoldingsForLiveRt1Display
├── fund-regular-eligibility.js  正盘门控 fundShouldRefreshLiveRt1
├── components/           可复用组件（上表）
└── *.test.js             单元测试
```

## QDII 穿透 T+1（易错）

US 正盘且存在 `quoteSession==='regular'` 持仓时：

1. **RT1 加权**：`estimateFromHoldings(..., { liveRt1Only: true })` — 仅 regular 持仓
2. **展示掩码**：`maskHoldingsForLiveRt1Display` — 非 regular 的 `changePct→null`，`liveRt1Excluded→true`
3. **两处调用**：`computeFundImpactFromPack`（live refresh）与 **`refreshFundHoldingsDisplay`**（GET `/api/fund/:code/detail`）

漏掉 (3) 会导致详情页仍显示腾讯等收盘涨跌幅，而列表 RT1 已排除 — **典型回归**。

## 改动检查清单

- [ ] ep 是否只在 `fund-display.js` 计算
- [ ] EST 是否为 `amount+ep` / `Σ estimateAssets`（非 `amount−settled+ep`）
- [ ] header RT1 是否仅 `Σ estimateProfit`
- [ ] snap seed 是否只复制 `liveRow.estimateProfit`
- [ ] suppress 是否经 `finalizeLiveFundDisplayRow` 收口
- [ ] 详情 API 是否 `applySessionQuotes` 后调 `maskHoldingsForLiveRt1Display`
- [ ] 编排是否只改 `live-pipeline.js`，不散落 phase 判断
- [ ] `npm run test:display-session && npm run test:display-state && npm run test:live-pipeline`
- [ ] `node server/live-rt1-holdings.test.js && node server/scope-totals.test.js`
