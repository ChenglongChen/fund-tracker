# 实时收益功能规格

> 基准场景：**仓库示例组合**（[`scripts/fixtures/screenshot/`](../scripts/fixtures/screenshot/)，5 只基金、合计 ¥310,000；截图冻结时刻 `2026-05-29T17:00+08:00` · `eod_freeze`）

## 1. 基准数字（示例数据）

| 项目 | 数值 |
|------|------|
| 入账总资产（Σ amount） | ¥310,000（= **B[D]** 日初 baseline） |
| 实时收益 RT1（header） | ¥2,014（16:00 EOD snap 冻结） |
| 预估资产 EST（EOD snap） | ¥312,014（= **B[D] + RT1** = 310,000 + 2,014） |
| 支付宝 scope（3 只） | 资产 ¥170,000 · RT1 ¥710 · EST ¥170,710 |

自托管实盘数字因持仓而异；验收以 `npm run test:*` 与 `docs/development.md` 中的脚本为准。

### 1.1 实盘组合画像（口径设计的真实基准）

示例 fixture 偏 A 股 + 黄金，但**实际自托管组合以美股 QDII 为主**，时间线设计须以此为重心。按估值机制分三桶：

| 桶 | `impactSource` | 典型占比 | 估值驱动 | 代表 |
|----|----------------|----------|----------|------|
| **A. QDII 全球科技穿透型** | `holdings` / `ensemble` | **大头（~⅔）** | 美股为主（60–70%）+ 港股/日韩/A股穿透 | 富国全球科技互联网、广发全球精选、华夏全球科技先锋、嘉实全球产业升级、易方达全球成长精选 |
| **B. QDII 美指型** | `index` | ~⅕ | 纯美股指数（纳指/标普） | 汇添富/广发/南方/大成/华安纳指、博时标普500 |
| **C. A 股主动型** | `fundgz` | ~⅛ | A 股盘中 | 永赢科技智选、红土创新、财通系、易方达信息产业 |

**关键含义**：桶 A 占比最大，其 row1 在**亚太时段（08:00–16:00）= 美股昨收快照（冻结）+ 亚太盘中 live**（见 §7b）。这是「韩股涨、实时收益反而更负」类困惑的根源——美股昨夜跌幅（未入账）才是主导，亚太 live 只是小权重修正。

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

同一 Beijing 日 t 内 **baseline 不变**（snap 防跳变）。

| 阶段 | 预估资产 EST |
|------|----------------|
| **live**（`asia_live` / `us_regular_live`） | `Σ amount + Σ estimateProfit` |
| **snap**（`day_open` / `eod_freeze`） | **`B[D] + RT1`**（冻结；入账后账户资产变、预估不变） |

snap 阶段 per-fund 展示：`estimateAssets = amountAtSnap + ep_snap`（与 header 一致时 `Σ amountAtSnap ≈ B[D]`）。

### 2.2 实现（live 阶段默认式）

live 阶段（`asia_live` / `us_regular_live`）：

```
预估资产 = Σ amount + Σ estimateProfit = Σ estimateAssets
```

snap 阶段见 §2.1 表格（header **`B[D] + RT1`**，per-fund **`amountAtSnap + ep_snap`**）。

**错误示例（已废弃）**：`amount − settled + ep`；snap 阶段用 **`Σ 当前 amount + ep`**（净值入账后会 double-count 当日收益）。

## 3. 规则摘要

### 规则 1 — 账户资产

各基金 `amount` 之和，含已公布净值。对应 Hero「账户资产」主值。

### 规则 2 — 实时收益（row1 / header）

穿透估值 row1，**仅正盘口径**（无盘前/盘后 extended）。

### 规则 3 — 净值入账

- A 股 / 黄金联接：通常当晚更新 **当天** 净值日
- QDII：可能更新 **上一 US 交易日** 净值日
- 入账更新：`amount`、当日收益、持有收益
- **live 阶段** Hero / 列表：`预估 = Σ amount + Σ estimateProfit`
- **snap 阶段** Hero：`预估 = B[D] + RT1`（冻结，见 §2.1）
- **baseline `B[D]`** 同日不变

### 规则 3b — 当日收益 pending（北京 16:00）

- **16:00 起**进入「应收官方收益」窗口；未入账前列表 / Hero **当日收益** 显示 **`—`**
- A 股 / 黄金：期望 `lastNavDate ≥ 当日`；QDII：期望 `lastNavDate ≥ 上一中国交易日`
- **16:00 前**仍展示上一已入账日的收益（非 pending）
- 唯一门控：`profit-pending.js` → `isDailyProfitPending`（`fund-display.js` 消费）

**与 RT1 时间线解耦（易混淆）**：当日收益**只认 16:00 这一个分界**，由**实际官方净值入账**驱动，**没有 21:30 冻结**这回事：

- 16:00 后逐只按官方净值入账刷新：A 股 / 黄金通常**当晚**入账；**QDII 常滞后到次日**（T+1 净值，期望 `lastNavDate ≥ 上一中国交易日`）。
- 未入账期间一律 `—`，入账后显示该日当日收益；**入账时刻不固定**（19:00、21:00、次日皆可能），不应假设 21:30 已全部冻结。
- 对照 RT1：RT1 在 21:30 重置（§7），当日收益**不随之变化**——两者口径独立。

### 规则 4 — 21:30 美股正盘

- RT1 跟盘 live（仅 regular）
- EST = `Σ amount + Σ estimateProfit`（live 口径）

### 规则 5 — 多 Tab 互证

| Tab | 集合 | 互证 |
|-----|------|------|
| 支付宝 | accountId=alipay，不 merge | 基准 |
| 全部持仓 | merge by code | 同 code 跨账户一致 |
| 账户概况 | 各账户卡片 | Σ 各卡 RT1 = unmerged 全量 Σ |

### 规则 6 — EOD 冻结（16:00–21:30）

亚太收盘后至美股正盘前：

- **RT1**：读 `eodSnap` per-fund `rt1`（16:00 seed，禁止 live 覆盖）
- **EST**：header **`B[D] + RT1`**；净值入账后 **账户资产变、预估不变**
- seed 写入 `amountAtSnap` + `rt1` + `est`（`est = B[D] + Σ rt1`）

### 规则 6b — day_open 冻结（04:00–08:00）

美股正盘收市后至亚太开盘前：与 EOD 对称，读 **`eodSnap`**（04:00 边界 seed 或沿用），header RT1/EST 同为 **snap 口径**（§2.1）。

### 规则 7 — 逐基金正盘门控（row1 / 穿透）

**适用**：`asia_live` / `eod_freeze` / `day_open`（**不含** `us_regular_live`——正盘时 `applyFundRt1Snap` 一律 live）。

- **仅当**该基金至少一只持仓处于 `regular` 正盘时，穿透层才拉 live 行情并重算 row1
- 无 regular 持仓 → 读 `eodSnap` per-fund `rt1`
- 无穿透时（fundgz / index / proxy）：A 股/黄金用 `isRealtimeMarketOpen`；美股 QDII 用 `usPhase === regular`
- **`asia_live` 穿透/融合**（`impactSource` = holdings / ensemble）：已算好 row1，**不得**用旧 regularSnapshot 覆盖（`isAsiaLiveHoldingsRow`）

### 规则 7b — 穿透型 QDII × 亚太时段估值口径（美股昨收 + 亚太盘中）

桶 A（穿透/融合型 QDII）在 **`asia_live`（08:00–16:00）且美股非正盘** 时：

- **美股持仓**（通常 60–70% 权重）：用**昨夜美股收盘快照**的 `changePct`（`quoteMode='close'`，盘中冻结，不预测今晚）
- **港股 / 日 / 韩 / A 股持仓**：**今日已开盘**后各自盘中 live（`quoteMode='live'`）
- row1 = `Σ weight × changePct`（美股段为昨收冻结值，亚太段为今日 live）

**这是正确的未入账归因**：QDII `lastNavDate` 滞后（T+1/T+2），昨夜美股跌幅尚未计入净值，作为 RT1 浮动展示是对的；亚太 live 只是同日小权重修正。

**盘前守卫（§8c）**：亚太/港/A 股**今日尚未开盘**时，**不得**用上一交易日 stale 昨收充数——`changePct=null`、`quoteMode='preopen'`，详情显示「待行情」，**不计入 RT1**。仅美股隔夜昨收例外（上面那条，它是未入账浮动）。

**易误读提示（展示层标注）**：

| 项 | 规则 |
|----|------|
| 字段 | `valuationBasis`（fund row + `/api/fund/:code/detail`） |
| 取值 | 满足上述条件 → `美股昨收 · {开盘亚太市场}盘中`（如 `美股昨收 · A股/港股/亚太盘中`）；否则 `null` |
| 唯一 writer | `valuationBasisLabel`（`components/market-hours.js`），`fund-display.buildDisplayFundRow` 与详情 API 消费 |
| 展示 | 详情页 Hero 估值涨跌下方 chip；其余阶段（美股正盘 live、全休市 snap）不标注 |
| 单测 | `server/market-session.test.js`（`valuationBasisLabel` 用例） |

**对比桶 B（美指型）**：无亚太正盘持仓 → 亚太时段读 `eodSnap` 冻结（纳指昨收整日不动），不显示 `valuationBasis`。两桶在亚太时段行为不同是**预期**：桶 A 真有亚太敞口会动，桶 B 不会。

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

### 规则 8c — 盘前守卫：今日未开盘的非美股持仓不计 stale 昨收

**问题**：掩码 `maskHoldingsForLiveRt1Display` 只改**展示**；RT1 实际用 `applySessionQuotes` 后**未掩码** holdings（`computeHoldingsImpactBreakdown`）。故仅靠掩码，A 股/港股盘前虽显示 `—`，其 stale 昨收仍会进 RT1。

**规则**：`applySessionQuotes` 收盘分支增加守卫——市场**今日尚未开盘**（`!hasMarketOpenedToday(market, now)`，含周末）且非美股/other 时：

| 项 | 取值 |
|----|------|
| `changePct` / `changePctRegular` | `null`（→ `estimateFromHoldings` 跳过，**不计入 RT1**） |
| `quoteMode` | `preopen` |
| 详情状态（`holdingStatusLabel`） | **「待行情」** |

- **唯一 writer**：`hasMarketOpenedToday`（`holding-market.js`）+ `applySessionQuotes` 收盘分支守卫
- **美股 / other 例外**：`hasMarketOpenedToday` 恒 `true` → 隔夜昨收保留计入（§7b）
- **当日已开过盘**（盘中或当日已收盘，如 A 股 15:00 后、HK 16:00 后）：`hasMarketOpenedToday=true` → 保留收盘涨跌幅与计入（覆盖规则 8 中「当日已收盘仍展示」一条）
- 各市场开盘时刻（北京）：JP 08:00 / KR 08:30 / A股·HK·TW 09:30 / 黄金 09:00 / EU 15:00
- 单测：`server/holding-market.test.js`（preopen / 当日已收盘 / 美股例外 用例）

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

三 Tab 互证：`Σ estimateProfit`（scope 内）与 header RT1 一致。  
live 阶段：`realtimeAssets === Σ estimateAssets`。  
snap 阶段：`realtimeAssets === B[D] + RT1`，且 `Σ estimateAssets === B[D] + RT1`（`amountAtSnap` 来自 seed）。

## 4. A 股基金 + 美股正盘

跟 A 股时段的基金（如示例 `022364`、`000216`）：

- **每交易日 21:30 至次交易日 9:30 前** → 实时收益显示 **`—`**（含 21:30–04:00 美股正盘、04:00–09:30 休市）
- **同日 15:00–21:30** → 可展示最后一次收盘估值 snapshot

## 5. 市场标签

顶栏状态条示例：`盘中 · 美股`、`休市`。多市场不同段时用 `/` 分隔，如 `盘中 · 亚太`。  
**不**单独展示「黄金」；黄金联接按 A 股时段归类。无盘前/盘后/夜盘时段。

## 6. UI：实时收益

竖排：金额 + 收益率（Hero / 账户卡 / 列表统一模式 A）。

## 7. 北京时间轴（三层统一：RT1 / 持仓穿透 / 当日收益）

一轮 RT1 周期 = **T 21:30 → T+1 21:30**（美股开盘重置 → 次日美股开盘再重置），跨两段 live（美股、亚太）+ 两段冻结。同一轮显示的 RT1 = **美股 T 夜 + 亚太 T+1 日**（美股昨收快照在亚太时段持续计入，直到 21:30 丢弃）。

| 北京时段 | phase | RT1（实时收益） | EST | 持仓穿透状态 | 当日收益 |
|----------|-------|-----------------|-----|--------------|----------|
| **T 21:30–T+1 04:00** | `us_regular_live` | **live 重置**：`liveRt1Only` 仅美股正盘；亚太掩码不计 | live | 美股 **盘中**；亚太/港/A股 已收盘或待行情（不计） | 沿用上一已入账 |
| T+1 04:00–08:00 | `day_open` | **snap 冻结**（美股昨收） | snap `B[D]+RT1` | 美股 已收盘（昨收，**计入** §7b）；亚太 **待行情** | 沿用 |
| **T+1 08:00–16:00** | `asia_live` | **live**：美股昨收(冻结) + 亚太盘中 | live | 美股 已收盘（计入）；亚太开盘后 **盘中** live，未开 **待行情**（不计 §8c） | <16:00 沿用上一已入账 |
| **T+1 16:00–21:30** | `eod_freeze` | **snap 冻结**（美股昨收 + 亚太收盘） | snap `B[D]+RT1` | 美股/亚太 均 已收盘 | **16:00 起进应收窗口**：已入账→当日；未入账→ `—`（§3b） |
| (T+1 21:30 →) | →`us_regular_live` | **丢弃本轮、美股重新 live** | live | 美股 重新 盘中 | 晚间按实际入账逐只刷新 |

要点：

- **两段冻结**（04:00–08:00、16:00–21:30）夹两段 live（美股、亚太）；冻结期 RT1/EST 读 `eodSnap`，**禁止 live 覆盖**。
- **美股昨收延续**：04:00 美股收盘后其昨收快照在 `day_open`+`asia_live` 持续计入（§7b），21:30 才丢弃——这就是「美股 T 夜 + 亚太 T+1」为同一轮显示 RT1 的原因。
- **当日收益与 RT1 解耦**：当日收益只认 16:00 这个分界（§3b），由**实际官方净值入账**驱动（A 股当晚 / QDII 常 T+1），**无 21:30 冻结**。
- **桶 A/B/C 见 §1.1**：上表 RT1「美股昨收 + 亚太 live」描述桶 A（穿透型）；桶 B（美指型）08:00–16:00 无亚太正盘持仓 → 读 `eodSnap` 冻结整日不动；桶 C（A 股）按 A 股时段 live / suppress（§4、§8）。
- **内部细节**：`accrualDay`（baseline/snap 分桶键）把「美股 T 夜」归 T 日；因美股昨收靠持仓级快照延续，**不影响显示**，无需改。

## 8. Suppress 三处

`buildFundSnapEntry` / `applyFundRt1Snap` / `finalizeLiveFundDisplayRow` — A 股 21:30–09:30 与周末不得写回数值 RT1。

## 9. 回归检查（改 RT1/EST/穿透/详情必跑）

```bash
npm run test:fund-estimate && npm run test:realtime-profit
npm run test:qdii-valuation
node server/live-rt1-holdings.test.js && node server/scope-totals.test.js
npm run test:display-session && npm run test:live-pipeline
npm run test:timeline-audit
npm run test:fund-holding-fields
npm run test:regression
npm run build   # 动 src/components/session.js 或 detail-page
```

**人工 spot check**（US 正盘时段）：

```bash
# 示例：US 正盘时段 QDII 详情，已收盘 HK 持仓应被掩码（基金 code 以你持仓为准）
curl -s http://localhost:8788/api/fund/270023/detail | jq '.holdings[] | {name,changePct,quoteSession}'
```

## 10. 字段矩阵（基金 row + 持仓 holding）

### 10.1 持仓层（`session-quotes.applySessionQuotes` → 详情 API）

| 字段 | 写入时机 | 取值 |
|------|----------|------|
| `holdingMarket` | 每 tick | `classifyHoldingMarket(h)`（code/marketId/name） |
| `quoteSession` | 每 tick | `getHoldingSessionPhase(market, now)`：`regular` / `midday` / `closed` |
| `quoteMode` | 每 tick | 正盘有行情 → `live`；休市有快照 → `close`；正盘无行情 → `missing`；**今日未开盘（非美股）→ `preopen`**（§8c） |
| `changePct` | 每 tick | live 价或 session-close / disk-regular 冻结 pct |
| `changePctRegular` | 美股/其他 | 正盘 pct；休市读 regularCloseSnapshot |
| `liveRt1Excluded` | 展示掩码 | `maskHoldingsForLiveRt1Display`：非正盘且无 close 快照时置 true，涨跌幅清空 |

**UI 状态**（`holdingStatusLabel`）：`preopen` → **待行情**（今日未开盘，§8c）；`live`+regular → 盘中；`midday` → 午间休市；`close`/closed → 已收盘；`liveRt1Excluded` → —。

**row1 穿透加权**（`countsTowardLiveRt1`）：仅 `quoteSession === 'regular'` 且非债券货基类持仓计入。美股正盘另启 `liveRt1Only`：仅 US regular 持仓进 row1，亚太正盘时仍保留 US 昨收 + 亚太 live 全穿透。

### 10.2 基金层（pipeline 顺序）

1. **`market.js`** — raw 穿透：`impactPct` / `impactSession` / `hasRegularHolding` / `shouldRefreshLiveRt1` / `holdings[]`
2. **`fund-display.buildDisplayFundRow`** — live `estimateProfit` / `estimateAssets` / `impactPct*`
3. **`applyFundRt1Snap`** — snap 阶段覆盖 ep / est（`amountAtSnap + ep_snap`）
4. **`finalizeLiveFundDisplayRow`** — A 股 suppress：ep/est 清空或仅 amount

| 字段 | live 阶段 | snap 阶段（16–21:30 / 04–08） | suppress（A 股 21:30–09:30、周末） |
|------|-----------|-------------------------------|-------------------------------------|
| `estimateProfit` (row1) | display impact 计算 | eodSnap / day_open per-fund rt1 | `null`（UI —） |
| `estimateAssets` | amount + ep 或 settled 公式 | **amountAtSnap + ep_snap** | amount only |
| `displaySnap` | false | true（有 ready snap） | 依 snap；ep 仍 suppress |
| `shouldRefreshLiveRt1` | 有 regular 持仓或美指门控 | false（读 snap） | false |
| `impactSession` | 来自穿透 | 仍反映当前 live 穿透（chip 用） | closed / suppress |

### 10.3 基金类型 × 时段（门控摘要）

| 类型 | `impactSource` | 亚太 08–16 | EOD snap 16–21:30 | US 正盘 21:30–04 | day_open 04–08 |
|------|----------------|------------|-------------------|------------------|----------------|
| QDII 持仓型（桶 A） | holdings | regular 持仓 → live ep（美股昨收 + 亚太 live，标 `valuationBasis`，§7b） | snap rt1 冻结 | live（liveRt1Only 掩码非 US regular） | snap |
| 美指/指数型 | index | 无 regular → snap / regularSnapshot | snap | live ep | snap |
| A 股 / 黄金联接 | fundgz | live（非 suppress 窗） | snap（非 suppress 窗） | **suppress —** | snap（非 suppress 窗） |

互证测试：`npm run test:fund-holding-fields`（与 `live-rt1-holdings.test.js`、`timeline-audit` 互补）。
