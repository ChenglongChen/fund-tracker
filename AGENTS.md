# AGENTS.md — fund-tracker

多账户基金持仓看板（Node API + Vite SPA）。核心难点在 **实时收益 RT1 / 预估资产 EST / EOD snap** 的时段口径一致性。

## 先读文档

| 优先级 | 路径 | 何时读 |
|--------|------|--------|
| 1 | `docs/realtime-spec.md` | 改实时收益、预估、snap、Hero/列表 |
| 2 | `docs/data-flow.md` | 改数据流、持久化、API 字段 |
| 3 | `docs/architecture.md` | 全栈分层、模块地图 |
| 4 | `docs/backend-architecture.md` | 后端组件、snap、single writer |
| 5 | `docs/frontend-architecture.md` | 前端 ViewModel / 组件 / single source |
| 6 | `docs/development.md` | 测试、验收、调试命令 |

索引：`docs/README.md`

## 运行

```bash
npm install
npm run dev          # web :5178, api :8788
npm run dev:api      # 仅 API
npm run test:fund-estimate && npm run test:realtime-profit
npm run test:display-session && npm run test:display-state && npm run test:live-pipeline
npm run test:regression                 # 大改后必跑（见下方）
npm run verify:alipay-realtime   # 需 API 运行
```

## 回归测试（大改后必跑）

**凡动 RT1/EST/snap/suppress/穿透/持仓展示/aggregate/display-session，合并或交付前必须：**

```bash
npm run test:regression
npm run build   # 若动 src/
```

`test:regression` 串联 28 组（见 `package.json`）：核心 RT1/EST/snap/穿透（fund-estimate、realtime-profit、display-session、display-state、live-pipeline、realtime-display-pipeline、**timeline-audit**、**fund-holding-fields**、fund-regular-eligibility、holdings-rt1、scope-totals、holding-market、market-session）+ 展示/估值/日历（nav-display、table-head、day-display-baseline、fund-metrics-live、impact-snapshots、weight-model、market-indices、gb-quote-parse、live-view-model、profit-calendar、qdii-valuation、api-contract）。

| 改动范围 | 额外必跑 |
|----------|----------|
| snap / suppress / pipeline | 上表已含；仍建议 `test:qdii-valuation` |
| 前端 ViewModel / session UI | `npm run build` |
| 口径变更 / 发版前 | `verify:alipay-realtime`、`verify:tab-reconcile`（需 API） |

改口径须同步补/改 `server/*.test.js`；**禁止**在未跑 regression 的情况下声称完成。

## Canonical 公式（不可随意改口径）

```
账户资产       = Σ amount（Hero 主值，随净值入账更新）
RT1 (row1)     = Σ estimateProfit（snap 阶段读 eodSnap 冻结值）
```

| 阶段 | EST (header 预估) |
|------|-------------------|
| **live**（asia / us_regular） | `Σ amount + Σ estimateProfit` = `Σ estimateAssets` |
| **snap**（day_open / eod_freeze） | **`B[D] + RT1`**（baseline 同日不变；入账后 EST 不变） |

**禁止** `amount − settled + ep`（RT1 为 T+1 增量时会少加 settled）。  
**禁止** snap 阶段用 **`Σ 当前 amount + ep`**（净值入账后会 double-count）。

- **穿透层永远 live 算**；**展示层**按 phase 读 snap 或 live
- **settle 入账**只更新 `portfolio.json`（AMT/DAY/持有）；**禁止** clear snap

## 北京时间轴（QDII 主视角）

| 时段 (BJ) | phase | RT1 / row1 | EST (header) |
|-----------|-------|------------|--------------|
| 08:00–16:00 | `asia_live` | per-fund live / snap | **live** Σ estimateAssets |
| 16:00–21:30 | `eod_freeze` | **EOD snap** | **snap** B[D]+RT1 |
| 21:30–04:00 | `us_regular_live` | live（仅正盘） | **live** Σ estimateAssets |
| 04:00–08:00 | `day_open` | snap | **snap** B[D]+RT1 |
| A 股 21:30–09:30 | — | **`—`**（含 snap 阶段） |
| 周末 A 股/黄金 | — | **`—`** |

A 股 **15:00–21:30 同日** 仍可展示最后一次收盘 snapshot；**21:30 起**进入 suppress 窗口。

## refreshLive 流水线（顺序不可打乱）

唯一入口：`live-pipeline.runLiveDisplayPipeline()`（`live.js` 调用）

1. **`fund-display.buildDisplayFundRow`** — 唯一计算 `estimateProfit` / `estimateAssets`
2. **`reconcileDisplayState`** — seed EOD snap、写 baseline
3. **`applyDisplaySnapAndTotals`** — snap 读/写 + **`computePortfolioTotals`（仅 Σ ep）** + header snap

## Ground truth（禁止多处计算）

| 数据 | 唯一 writer | 其他人只能 |
|------|------------|-----------|
| per-fund `estimateProfit` | `fund-display.js` | snap 复制；suppress 清空 |
| header `realtimeProfit` | `Σ estimateProfit` via `aggregate.js` | snap 阶段不再读 `snap.rt1` 覆盖 |
| header `realtimeAssets` | live：`Σ estimateAssets`；snap：`B[D]+RT1` via `applyPortfolioTotalsSnap` | 禁止 snap 阶段用 `Σ 当前 amount+ep` |
| 穿透 / 持仓 RT1 门控 | `market.js`, `holdings-pipeline.js`, `fund-regular-eligibility.js` | 详情须 `maskHoldingsForLiveRt1Display` |
| raw 穿透 pct | `market.js` | 输入 fund-display，不直出 UI |
| **会话/phase/snapKey** | **`display-session.resolveDisplaySession()`** | 只读 session |

## 会话状态（唯一接口）

`resolveDisplaySession(now, { persistedPhase: getCurrentPhase() })` — 每 tick 解析一次，传入 pipeline。

返回 `usPhase`、`clockPhase`、`effectivePhase`、`snapKey`、`rt1Source`、`phaseToPersist`、`accrualDay`、`isRt1SnapPhase`。**禁止**在其他模块重复 `getUsSessionPhase` + 分钟窗口分支推导 display phase。

## 前端分层（ViewModel → Components）

| 层 | 文件 | 职责 |
|----|------|------|
| Pages | `src/main.js` | 路由、state、paint/patch |
| ViewModel | `live-view-model.js`, `summary.js` | API→行；scope 合计（读 totals） |
| Components | `components/metrics.js`, `components/session.js` | 模式 A/B 指标 UI（Hero/列表/账户卡共用） |
| Format | `format.js`, `display-format.js` | 数字/金额/隐私 |

前端 **禁止** 用 `impactPct×amount` 作 row1；全账户 Hero 用 `live.totals`。详见 `docs/frontend-architecture.md`。

## 展示层不变量（改 snap / suppress 必查）

1. **Suppress 三处一致**：`buildFundSnapEntry`（seed 不写 rt1）、`applyFundRt1Snap`（读 snap 前短路）、**`finalizeLiveFundDisplayRow`（最终收口，snap 不得覆盖）**
2. Snap 阶段：**`header RT1 === Σ estimateProfit`**（scope 内）
3. **`isScopeSnapReady`**：snap 须有 per-fund 明细且非 `provisional`；空 funds 不得冻结 UI
4. **`sessionSnapNeedsReseed`**：旧 snap 含 suppress 窗口内 A 股 rt1 → 自动 reseed
5. **`estimateProfit`** 来自 **display impact**（`resolveLiveDisplayImpact`），禁止 raw 穿透 `r`

## 模块速查

| 模块 | 文件 |
|------|------|
| Live cache | `server/live.js` |
| **展示流水线** | **`server/live-pipeline.js`** |
| **per-fund 展示** | **`server/fund-display.js`** |
| 组合求和 | `server/aggregate.js` |
| 时段 / display impact | `server/market-session.js` |
| suppress / 收口 | `server/components/suppress.js` |
| 交易时段 / chip | `server/components/market-hours.js` |
| Snap 组件 | `server/components/snap-*.js` |
| RT1/EST 公式 | `server/fund-estimate.js` |
| **会话状态** | **`server/display-session.js`** |
| Baseline 持久化 | `server/day-display-state.js` |
| 入账 | `server/settle.js` |
| **穿透持仓 / T+1 掩码** | **`server/holdings-pipeline.js`**（`maskHoldingsForLiveRt1Display`） |
| **正盘门控** | **`server/fund-regular-eligibility.js`** |
| 详情 API 展示刷新 | `server/market.js`（`refreshFundHoldingsDisplay`） |
| 前端 Pages | `src/main.js` |
| 前端 ViewModel | `src/live-view-model.js`, `src/summary.js` |
| 前端 Components | `src/components/metrics.js`, `src/components/session.js` |
| 账户 scope | `src/accounts.js` |

## 产品规则（易错）

1. **EOD 冻结 16:00–21:30**：RT1/EST/row1 **snap**（读 eodSnap，无盘前/盘后 row2）
2. **day_open 04:00–08:00**：与 EOD 对称冻结；RT1 以美股正盘收市 snap 为准
3. **21:30 正盘**：丢弃上一轮，RT1 live（仅 regular）
4. **A 股/黄金联接 21:30–09:30 + 周末**：row1 为 `—`（`shouldSuppressDomesticRealtimeDisplay`）；**snap 不能写回数值**
5. **黄金联接**（如 000216）归类为 `cn`，顶栏 **不** 显示「黄金」市场
6. **estimateProfit** 必须来自 **display impact**，不能直接用 raw 穿透 `r`
7. **EST 禁止** `amount − settled + ep`；live 用 **`amount + ep`**，header 用 **`Σ estimateAssets`**
8. **QDII 21:30 US 正盘**：穿透 RT1 仅 `quoteSession==='regular'`；HK/JP 等已收盘 → 详情涨跌幅 **`—`**（`liveRt1Excluded`）
9. **多 Tab**：Hero/账户卡只读 API `live.totals` / `totalsByAccount`；禁止前端重算 EST
10. **`refreshFundHoldingsDisplay`** 必须在 `applySessionQuotes` 后调用 **`maskHoldingsForLiveRt1Display`**（与 `computeFundImpactFromPack` 一致）

## 代码风格

- ES modules（`"type": "module"`）
- 最小 diff；匹配现有命名与 JSDoc
- 改口径必补/改 `server/*.test.js` 或 verify 脚本
- 不提交 `data/portfolio.json`、`data/app-state.json`、`data/day-display-state.json`
- **临时脚本 / scratch** 放 `.tmp/`（见 `.tmp/README.md`），勿新增到 `scripts/` 除非要长期保留
- 不编辑 Cursor plan 文件；规格以 `docs/` 为准

## 完成前检查

- [ ] **`npm run test:regression`**（动 RT1/EST/snap/穿透/持仓/aggregate 时 **必跑**）
- [ ] 若仅小改公式单元：`npm run test:fund-estimate && npm run test:realtime-profit`
- [ ] 若动前端 ViewModel/组件：`npm run build`
- [ ] 发版 / 口径变更：考虑 `verify:alipay-realtime` / `verify:tab-reconcile`
- [ ] 文档与代码不一致时，优先更新 `docs/realtime-spec.md` 或 `docs/data-flow.md`

## 目录结构

```
fund-tracker/
├── AGENTS.md          ← 本文件
├── docs/              ← 规格与架构（source of truth）
│   ├── architecture.md
│   ├── backend-architecture.md
│   ├── frontend-architecture.md
│   └── ...
├── server/            ← API、估值、components/
├── src/               ← 前端 SPA
│   ├── main.js
│   ├── live-view-model.js
│   ├── summary.js
│   └── components/
├── data/              ← 运行时 JSON（见 data/README.md）
├── scripts/           ← 校准、验收（长期保留）
├── .tmp/              ← 临时脚本 / scratch（不提交，见 .tmp/README.md）
└── .cursor/rules/     ← Cursor 规则
```
