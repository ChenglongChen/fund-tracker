# 前端架构

Vite SPA，面向 iPhone 全屏 PWA。原则：**展示只读 API canonical 字段**，组件可复用，页面只做编排。

## 分层

```
┌─────────────────────────────────────────────────────────┐
│  main.js — 路由 · state · 刷新 · bindEvents              │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  Pages（render + patch*Dom）                             │
│  pages/list-page.js · detail-page.js · manage-page.js   │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  Components（layout / chrome / hero）                    │
│  components/shell.js · hero.js · account-tabs.js        │
│  components/index-dock.js · metrics.js · session.js   │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  Format                                                  │
│  format.js           pct / escape / 原始数字              │
│  display-format.js   金额 + 隐私脱敏                      │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  API（client-api.js）  GET /api/live · /api/portfolio    │
└─────────────────────────────────────────────────────────┘
```

## Single source（前端）

| 数据 | 来源 | 禁止 |
|------|------|------|
| row1 `realTimeProfit` | API `estimateProfit` | `amount × impactPct` 重算 |
| Hero RT1/EST（全账户） | API `live.totals` | 本地 `Σ amount+ep` 或 `amount−settled+ep` 替代 totals |
| Hero RT1/EST（账户 scope） | API `totalsByAccount[id]` | 穿透 pct 重算 |
| 列表行 EST fallback | API `estimateAssets` 或 `amount+ep` | `amount−settled+ep` |
| 持仓穿透估值口径 | fund row / detail API `valuationBasis`（如「美股昨收 · 亚太盘中」）与 `valuationParts`（如「标的 +0.75% · 汇率 +0.21%」） | 前端不推断 |
| 时段 chip | `displayContext`（顶栏） / fund `marketLabel` | 本地时钟推断 |

> **无盘前/盘后**：全市场仅正盘口径，row1 单行。历史「模式 B / row2 extended / `extendedSessionLabel` / `hasExtendedRealtimeLayout`」已移除（`session.js` 中相关函数恒返回 `''`/`false`，待清理）。

## 组件约定（iOS 风格）

### 模式 A — 竖排指标（唯一模式）

金额 + 收益率 pill/sub（Hero、账户卡、列表单列）。

### 复用入口

| 组件 | 文件 | 用途 |
|------|------|------|
| `renderPctPill` / `renderPctSub` | `components/metrics.js` | 收益率 |
| `renderHoldingStackedMetricCol` | `components/metrics.js` | 列表收益列 |
| `holdingStatusLabel` / `holdingStatusClass` | `components/session.js` | 持仓状态（盘中/已收盘/待行情/—） |

## 数据流（500ms）

```
GET /api/live
  → mergeLiveIntoFunds(FUNDS, live)     // live-view-model
  → buildSummary(rows, totals, displayState)  // summary
  → patchListDom / paint                  // main.js
```

`applyDisplayScope`：`SCOPE_ALL` 时传入 `state.liveTotals` 与 `displayState` 作 canonical。

## 目录

```
src/
├── main.js                 路由、state、刷新、事件绑定
├── app/context.js          bindApp / app() 共享上下文
├── live-view-model.js      → @fund-tracker/core（re-export；真逻辑在 packages/core/）
├── summary.js              → @fund-tracker/core（scope 顶栏合计）
├── fund-display-ui.js      详情 metrics 选取
├── format.js               纯格式化
├── display-format.js       金额 + hideAssets
├── dom.js                  DOM 小工具（setTextClass）
├── pages/
│   ├── list-page.js        列表页 render + patchListDom
│   ├── detail-page.js      详情页 + 持仓穿透 patch
│   └── manage-page.js      持有配置 / 添加 / 编辑
├── components/
│   ├── shell.js            app shell、loading、banner
│   ├── hero.js             顶栏 Hero + 账户概况卡
│   ├── account-tabs.js     scope 标签栏
│   ├── index-dock.js       大盘指数 dock / drawer
│   ├── theme-chrome.js     深色模式切换
│   ├── privacy-ui.js       资产隐私 toggle
│   ├── status.js           刷新/行情时间条
│   ├── metrics.js          指标 UI 组件
│   └── session.js          持仓状态标签（盘中/已收盘/待行情）
├── accounts.js             账户 scope
├── column-layout.js        列表列配置
├── client-api.js           HTTP
└── style.css               设计 token · safe-area
```

## 详情页穿透展示

数据：`GET /api/fund/:code/detail` → `state.detail.holdings`（后端已掩码）。

| 字段 | UI | 说明 |
|------|-----|------|
| `changePct == null` | 涨跌幅 **`—`** | `fmtPct` |
| `liveRt1Excluded` | 状态 **`—`** | `holdingStatusLabel`（非「已收盘」） |
| `quoteSession==='regular'` | 盘中 + live 涨跌幅 | 计入 T+1 RT1 |

改 `session.js` / `detail-page.js` 后 `npm run build`；与后端 `live-rt1-holdings.test.js` 联调。

## 新增 UI 检查清单

- [ ] row1 是否只读 `estimateProfit` / `realTimeProfit`（来自 merge）
- [ ] Hero 全账户是否用 `live.totals`；账户 Tab 是否用 `totalsByAccount`
- [ ] EST fallback 是否为 `amount+ep`（`summary.estimatedAssetsForRow`）
- [ ] 详情 closed 持仓（`liveRt1Excluded`）涨跌幅/状态是否为 **`—`**
- [ ] extended 是否用 `components/metrics` 而非内联 HTML
- [ ] 金额是否走 `display-format.fmtMoney`（隐私一致）
- [ ] 500ms 刷新是否优先 `patch*Dom` 而非全量 `paint`
