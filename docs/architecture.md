# 技术方案

## 1. 总体架构

```
┌─────────────┐     1s poll      ┌──────────────────────────────────────┐
│  Vite 前端   │ ◄────────────── │  Node API (server/index.js :8788)    │
│  src/main.js │   /api/live     │                                      │
└─────────────┘                 │  live.js ──► aggregate.js            │
                                │     │              │                 │
                                │     ▼              ▼                 │
                                │  market.js    fund-estimate.js       │
                                │  market-session.js                   │
                                │  display-state-machine.js            │
                                │  day-display-state.js                │
                                └──────────────┬───────────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
            data/portfolio.json      data/day-display-state.json   东财/新浪行情
            data/app-state.json      data/impact-snapshots.json
            data/valuation-profiles.json
```

- **前端**：纯静态 SPA，每秒拉取 `/api/live`，DOM patch 优先于全量重绘。
- **后端**：单进程 HTTP；`live.js` 定时 refresh；`settle.js` 定时检测净值入账。
- **数据**：持仓与状态本地 JSON；无数据库。

## 2. 分层设计

### 2.1 穿透层（永远 live 计算）

| 模块 | 输入 | 输出 |
|------|------|------|
| `market.js` | 基金代码、重仓、指数 strip | `impactPct`、`impactPctRegular`、`impactPctExtended` |
| `holdings-pipeline.js` | 年报重仓 + 实时 quote | 加权穿透涨跌幅 |
| `valuation-profile.js` | `valuation-profiles.json` | holdings / proxy 策略选择 |

穿透结果 **不因展示 snap 而停止计算**，供审计、snap seed、row2 使用。

### 2.2 会话层（按市场裁剪展示）

`market-session.js`：

- `classifyFundMarket(fund)` — 基金归属 `cn` / `us`（QDII 等）
- **黄金联接**（如华安黄金）按 **A 股时段** 归类为 `cn`，顶栏不单独展示「黄金」市场
- `resolveLiveDisplayImpact()` — 组装列表/详情用的 `impactPct`（盘前/盘后仅 regular 进 row1）
- `resolveFundImpactPct()` — 收市 snapshot；**美股正盘期间 A 股/黄金联接已收市则返回 null**（UI 显示 `—`）
- `shouldSuppressDomesticRealtimeDuringUsRegular()` — 上述 suppress 规则

### 2.3 估算层

`fund-estimate.js`：

- **RT1 涨跌幅**：美股盘前/盘后仅 `regular`；正盘 `regular + extended`
- **单基金预估**：`amount - settled + ep`（per-fund fallback）
- **组合预估**：`baseline + Σ RT1`（`aggregate.js` / `applyPortfolioTotalsSnap`）

### 2.4 展示状态机

`display-state-machine.js` + `day-display-state.js`：

| 阶段 | RT1 / header | row2 extended | EST |
|------|--------------|---------------|-----|
| 亚太盘中 | live | — | baseline + RT1 |
| 04:00 盘后 | snap（正盘定稿） | live | snap |
| 16:00 盘前 | snap | live | snap |
| 21:30 正盘 | live（清除盘前 snap） | 并入 RT1 | baseline + RT1 |
| EOD（目标） | eodSnap | snap | eodSnap |

持久化字段见 [data-flow.md](./data-flow.md)。

### 2.5 入账层

`settle.js`：

- 检测东财 / fundgz 净值日期推进 → 更新 `amount`、`yesterdayProfit`、份额
- **禁止** 在入账时 `clearFundImpactSnapshots` 或清除 premarket snap
- 入账后 `ensureDayBaseline()` 仅维护 baseline 元数据，**不改变** 当日 snap 中的 RT1/EST

## 3. 前端结构

| 区域 | 文件 | 说明 |
|------|------|------|
| Hero 顶栏 | `renderPortfolioHeader` | 账户资产、预估、实时/当日/持有 |
| 状态条 | `renderStatusStrip` | `displayContext.marketChip` |
| 持仓列表 | `fundMetricCells` | 实时双行（row1 + 盘前/盘后 row2） |
| 账户概况 | `renderAccountSummaryCard` | 与 Hero 同构的实时双行模式 A/B |
| Summary | `buildSummary` | scope 内 `EST = settledAssets + totalRealTime` |

**模式 A**：竖排 金额 + 收益率（无 extended）  
**模式 B**：两行 `.metric-split-row`（RT1 行 + 盘前/盘后 tag 行）

## 4. 模块地图

```
server/
├── index.js              HTTP 路由
├── live.js               live cache、buildLiveFundRow
├── aggregate.js          computePortfolioTotals、displayContext
├── settle.js             NAV 入账
├── market.js             穿透 + fundgz
├── market-session.js     时段 + display impact
├── fund-estimate.js      RT1/EST 公式
├── display-state-machine.js  snap reconcile
├── day-display-state.js  持久化 baseline/snap
├── impact-snapshots.js   穿透 regular 快照（磁盘）
├── holding-market.js     各交易所日历
├── nav.js                净值 enrich
└── app-state.js          日内 tick、dailyRecords

src/
├── main.js               主 UI
├── accounts.js           账户概况、merge by code
├── portfolio.js          本地 portfolio 副本
└── style.css
```

## 5. 设计原则

1. **Canonical 公式**：`EST = B[D] + RT1`；header 不用 `amount + ep` 作主定义。
2. **穿透 live、展示 snap**：tick 始终算穿透；冻结只影响展示层读 snap。
3. **入账与 snap 解耦**：NAV 只动 AMT/DAY/持有，不动当日 RT1 snap。
4. **Scope 互证**：支付宝 unmerged Σ = 账户卡 Σ；见 `verify:tab-reconcile`。
