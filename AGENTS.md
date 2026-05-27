# AGENTS.md — fund-tracker

多账户基金持仓看板（Node API + Vite SPA）。核心难点在 **实时收益 RT1 / 预估资产 EST / 盘前盘后 snap** 的时段口径一致性。

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
npm run verify:alipay-realtime   # 需 API 运行
```

## Canonical 公式（不可随意改口径）

```
账户资产     = Σ amount
RT1 (row1)   = Σ estimateProfit          # 不含盘前/盘后 row2
EST (header) = baseline + RT1 ≈ 账户资产 + RT1（scope 内）
```

- **穿透层永远 live 算**；**展示层**按 phase 读 snap 或 live
- **settle 入账**只更新 `portfolio.json`（AMT/DAY/持有）；**禁止** clear snap
- 单基金 EST fallback：`amount - settled + ep`；**header 禁止**逐基金累加该式（无 RT1 的基金会多减 settled）

## 北京时间轴（QDII 主视角）

| 时段 (BJ) | phase | RT1 / row1 | row2 extended |
|-----------|-------|------------|---------------|
| 08:00–16:00 | `overnight_freeze` | **snap** | 夜盘 live |
| 16:00–21:30 | `premarket_freeze` | **snap** | 盘前 live |
| 21:30–04:00 | `us_regular_live` | live（regular+extended 并入 RT1） | — |
| 04:00–08:00 | `afterhours_freeze` | **snap** | 盘后 live |
| A 股 21:30–09:30 | — | **`—`**（含 snap 阶段） | — |
| 周末 A 股/黄金 | — | **`—`** | — |

A 股 **15:00–21:30 同日** 仍可展示最后一次收盘 snapshot；**21:30 起**进入 suppress 窗口。

## refreshLive 流水线（顺序不可打乱）

唯一入口：`live-pipeline.runLiveDisplayPipeline()`（`live.js` 调用）

1. **`fund-display.buildDisplayFundRow`** — 唯一计算 `estimateProfit` / `estimateAssets` / row2
2. **`reconcileDisplayState`** — seed / discard snap、写 baseline
3. **`tryBackfillSnapFromTicks`** — 仅补 provisional；premarket 须 ≥16:00
4. **`applyDisplaySnapAndTotals`** — snap 读/写 + **`computePortfolioTotals`（仅 Σ ep）** + header snap

## Ground truth（禁止多处计算）

| 数据 | 唯一 writer | 其他人只能 |
|------|------------|-----------|
| per-fund `estimateProfit` | `fund-display.js` | snap 复制；suppress 清空 |
| header `realtimeProfit` | `Σ estimateProfit` via `aggregate.js` | snap 阶段不再读 `snap.rt1` 覆盖 |
| header `realtimeAssets` | `baseline + realtimeProfit` | — |
| raw 穿透 pct | `market.js` | 输入 fund-display，不直出 UI |
| **会话/phase/snapKey** | **`display-session.resolveDisplaySession()`** | 只读 session |

## 会话状态（唯一接口）

`resolveDisplaySession(now, { persistedPhase: getCurrentPhase() })` — 每 tick 解析一次，传入 pipeline。

返回 `usPhase`、`clockPhase`、`snapKey`、`rt1Source`、`row2Source`、`phaseToPersist`、`canBackfill*` 等。**禁止**在其他模块重复 `getUsSessionPhase` + 分钟窗口分支。

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
| 前端 Pages | `src/main.js` |
| 前端 ViewModel | `src/live-view-model.js`, `src/summary.js` |
| 前端 Components | `src/components/metrics.js`, `src/components/session.js` |
| 账户 scope | `src/accounts.js` |

## 产品规则（易错）

1. **盘前 16:00–21:30**：RT1/EST/row1 **snap**；row2 extended **live**
2. **盘后 04:00–08:00**：与盘前对称；RT1 以正盘收市 snap 为准
3. **21:30 正盘**：discard premarket snap，RT1 live（regular+extended）
4. **A 股/黄金联接 21:30–09:30 + 周末**：row1 为 `—`（`shouldSuppressDomesticRealtimeDisplay`）；**snap 不能写回数值**
5. **黄金联接**（如 000216）归类为 `cn`，顶栏 **不** 显示「黄金」市场
6. **estimateProfit** 必须来自 **display impact**，不能直接用 raw 穿透 `r`

## 代码风格

- ES modules（`"type": "module"`）
- 最小 diff；匹配现有命名与 JSDoc
- 改口径必补/改 `server/*.test.js` 或 verify 脚本
- 不提交 `data/portfolio.json`、`data/app-state.json`、`data/day-display-state.json`
- 不编辑 Cursor plan 文件；规格以 `docs/` 为准

## 完成前检查

- [ ] `npm run test:fund-estimate && npm run test:realtime-profit`
- [ ] 若动 snap/suppress：`npm run test:display-session && npm run test:display-state && npm run test:live-pipeline`
- [ ] 若动前端 ViewModel/组件：`npm run build`
- [ ] 若动 RT1/EST/snap：考虑 `verify:alipay-realtime` / `verify:tab-reconcile`
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
├── scripts/           ← 校准、验收
└── .cursor/rules/     ← Cursor 规则
```
