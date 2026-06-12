# 实时收益功能规格

> 基准场景：**仓库示例组合**（[`scripts/fixtures/screenshot/`](../scripts/fixtures/screenshot/)，5 只基金、合计 ¥310,000；截图冻结时刻 `2026-05-29T17:00+08:00` · `eod_freeze`）

## 1. 基准数字（示例数据）

| 项目 | 数值 |
|------|------|
| 入账总资产（Σ amount） | ¥310,000 |
| 实时收益 RT1（header） | ¥2,014 |
| 预估资产 EST（EOD snap） | ¥312,014 |
| 支付宝 scope（3 只） | 资产 ¥170,000 · RT1 ¥710 · EST ¥170,710 |

自托管实盘数字因持仓而异；验收以 `npm run test:*` 与 `docs/development.md` 中的脚本为准。

## 2. Canonical 公式

### 2.1 时序口径（T / T+1，**禁止混用**）

```
预估_{T+1} = 账户资产_T + 实时收益_{T+1}
           = amount（T 日已入账）+ estimateProfit（当前会话 RT1）
```

| 符号 | 含义 |
|------|------|
| 账户资产_T | T 日 NAV 入账后的 `amount`（已含 T 日官方收益） |
| 实时收益_{T+1} | **下一交易会话**的 live 增量（如 21:30 后仅 US `regular` 持仓） |
| 入账资产\_{t−1} | 日 t 开始前 `Σ amount`（baseline `B[D]`）；snap 阶段 EST 仍用 `B[D]+RT1_t` |

**禁止**使用 `amount − settledProfit + ep`：该式等价于把 `amount` 退回到入账前再加 RT1，在 RT1 已是 T+1 会话增量时会 **少加一整段 settled**。

同一 Beijing 日 t 内 **baseline 不变**（snap 防跳变）；入账完成后 per-fund / 账户 scope 展示用 **`amount + ep`**，header 用 **`Σ amount + Σ estimateProfit`**（= `aggregate` 的 `Σ estimateAssets`）。

### 2.2 实现

```
预估资产 = 账户资产 + 实时收益合计
         = Σ amount + Σ estimateProfit
```

单基金：`fundEstimatedAssets` → `amount + ep`（`fund-estimate.js`）。  
组合：`resolvePortfolioRealtimeAssets` → **`Σ per-fund estimateAssets`**（与账户 Tab 一致）。

**错误示例（已废弃）**：`amount - settled + ep`、`baseline + RT1` 替代 `Σ estimateAssets`（手动减仓/outflow 后会导致 Tab 不一致）。

## 3. 规则摘要

### 规则 1 — 账户资产

各基金 `amount` 之和，含已公布净值。对应 Hero「账户资产」主值。

### 规则 2 — 实时收益（row1 / header）

穿透估值 row1，**仅正盘口径**（无盘前/盘后 extended）。

### 规则 3 — 净值入账

- A 股 / 黄金联接：通常当晚更新 **当天** 净值日
- QDII：可能更新 **上一 US 交易日** 净值日
- 入账更新：`amount`、当日收益、持有收益
- **Hero / 列表展示**（入账后）：`预估资产 = Σ amount + Σ estimateProfit`（§2.2）
- **baseline `B[D]`** 同日不变；snap 阶段 header 亦用 Σ per-fund，**禁止**用 `snap.est` 或 `B[D]+RT1` 替代 Σ（§9）

### 规则 3b — 当日收益 pending（北京 16:00）

- **16:00 起**进入「应收官方收益」窗口；未入账前列表 / Hero **当日收益** 显示 **`—`**
- A 股 / 黄金：期望 `lastNavDate ≥ 当日`；QDII：期望 `lastNavDate ≥ 上一中国交易日`
- **16:00 前**仍展示上一已入账日的收益（非 pending）
- 唯一门控：`profit-pending.js` → `isDailyProfitPending`（`fund-display.js` 消费）

### 规则 4 — 21:30 美股正盘

- RT1 跟盘 live（仅 regular）
- EST = `B[D] + RT1`，baseline 不变

### 规则 5 — 多 Tab 互证

| Tab | 集合 | 互证 |
|-----|------|------|
| 支付宝 | accountId=alipay，不 merge | 基准 |
| 全部持仓 | merge by code | 同 code 跨账户一致 |
| 账户概况 | 各账户卡片 | Σ 各卡 RT1 = unmerged 全量 Σ |

### 规则 6 — EOD 冻结（16:00–21:30）

亚太收盘后至美股正盘前：RT1 / EST 冻结（`eodSnap`），per-fund 明细写入 snap。

### 规则 7 — 逐基金正盘门控（row1 / 穿透）

- **仅当**该基金至少一只持仓处于 `regular` 正盘时，才拉行情并重算 row1 / 穿透 RT1
- 无 regular 持仓 → 读 `eodSnap` 中 per-fund `rt1`，不更新实时行情
- 无穿透时（fundgz / index / proxy）：按基金归类市场判断（A 股/黄金用 `isRealtimeMarketOpen`；美股 QDII 用 `usPhase === regular`）

### 规则 8 — QDII 穿透 T+1 live（21:30 US 正盘，例 270023）

当组合内 **任一**持仓 `quoteSession === 'regular'`（通常 US 正盘）：

| 项 | 规则 |
|----|------|
| RT1 计算 | `liveRt1Only: true` — 仅 `countsTowardLiveRt1`（`quoteSession === 'regular'`）持仓加权 |
| 已收盘持仓（HK/JP/亚太等） | **不计入** T+1 RT1；`changePct` 置 `null` |
| A 股/台股 **当日已收盘**（`quoteMode=close`，非 21:30–09:30 suppress） | **仍展示**收盘涨跌幅与「已收盘」；仅不参与 row1 加权 |
| 详情页展示（HK/JP 等休市） | 涨跌幅列 **`—`**；`liveRt1Excluded: true`（尚未进入该市场 T+1 正盘） |
| 唯一 writer | `maskHoldingsForLiveRt1Display`（`holdings-pipeline.js`） |

**易错**：`refreshFundHoldingsDisplay`（`/api/fund/:code/detail`）在 `applySessionQuotes` 后 **必须**再调 `maskHoldingsForLiveRt1Display`，否则详情页仍显示腾讯等收盘涨跌幅（列表/live 已掩码、详情未掩码）。

实现链：`computeFundImpactFromPack` + `refreshFundHoldingsDisplay` → 同一掩码逻辑；测试 `server/live-rt1-holdings.test.js`。

### 规则 8b — QDII 穿透估值增强（FX 拆分 + fundgz 融合）

| 项 | 规则 |
|----|------|
| FX | `computeHoldingsImpactBreakdown`：持仓加权 + **USD 暴露 × USDCNY** + **HKD 暴露 × HKDCNY**（缺 HKD 时 ≈ 0.85×USD） |
| 融合 | 持仓策略且 fundgz 新鲜（≤3h）时：`blendEnsembleImpact(holdings, fundgz, α)`；α 由 `quoteCoverage`、报告龄、fundgz 新鲜度决定 |
| 输出 | `impactSource`: `holdings` / `ensemble` / `fundgz`；详情 API 附带 `valuationConfidence`、`holdingsImpactPct`、`fundgzImpactPct` |
| 唯一 writer | `applyHoldingsEnsemble`（`qdii-valuation.js`），由 `market.js` 穿透路径调用 |

回测：`node scripts/backtest-valuation.js --code=270023`；单测：`npm run test:qdii-valuation`。

### 规则 9 — 多 Tab 预估一致

| Tab | EST / RT1 来源 | 禁止 |
|-----|----------------|------|
| 支付宝 / 账户 scope | API `totalsByAccount[id]` | 前端 `amount×pct` 或 `amount−settled+ep` |
| 全部持仓 / 账户概况 | API `live.totals` | 本地重算 Hero EST |
| 列表行 fallback | API `estimateAssets` 或 `amount+ep` | `amount−settled+ep` |

三 Tab 互证：`Σ estimateProfit`（scope 内）与 header RT1 一致；`realtimeAssets === Σ estimateAssets`。

## 4. A 股基金 + 美股正盘

跟 A 股时段的基金（如示例 `022364`、`000216`）：

- **每交易日 21:30 至次交易日 9:30 前** → 实时收益显示 **`—`**（含 21:30–04:00 美股正盘、04:00–09:30 休市）
- **同日 15:00–21:30** → 可展示最后一次收盘估值 snapshot

## 5. 市场标签

顶栏状态条示例：`盘中 · 美股`、`休市`。多市场不同段时用 `/` 分隔，如 `盘中 · 亚太`。  
**不**单独展示「黄金」；黄金联接按 A 股时段归类。无盘前/盘后/夜盘时段。

## 6. UI：实时收益

竖排：金额 + 收益率（Hero / 账户卡 / 列表统一模式 A）。

## 7. 北京时间轴（5/27 示例）

| 时段 | RT1 | EST |
|------|-----|-----|
| 00:00–04:00 | US 正盘 live | live |
| 04:00–08:00 | 冻结（正盘收市 snap） | snap |
| 08:00–16:00 | 亚太 per-fund live / snap | live |
| 16:00–21:30 | **EOD snap**（per-fund rt1 冻结） | **Σ amount + Σ ep**（入账后 amount 已更新） |
| 21:30–24:00 | US 正盘 live | live |

## 8. Suppress 三处

`buildFundSnapEntry` / `applyFundRt1Snap` / `finalizeLiveFundDisplayRow` — A 股 21:30–09:30 与周末不得写回数值 RT1。

## 9. 回归检查（改 RT1/EST/穿透/详情必跑）

```bash
npm run test:fund-estimate && npm run test:realtime-profit
npm run test:qdii-valuation
node server/live-rt1-holdings.test.js && node server/scope-totals.test.js
npm run test:display-session && npm run test:live-pipeline
npm run build   # 动 src/components/session.js 或 detail-page
```

**人工 spot check**（US 正盘时段）：

```bash
# 示例：US 正盘时段 QDII 详情，已收盘 HK 持仓应被掩码（基金 code 以你持仓为准）
curl -s http://localhost:8788/api/fund/270023/detail | jq '.holdings[] | {name,changePct,quoteSession}'
```
