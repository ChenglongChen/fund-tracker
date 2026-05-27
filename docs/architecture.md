# 技术方案

## 1. 总体架构

```
                    ┌──────────────────────────────────────────┐
                    │  Vite SPA (src/)                          │
                    │  ViewModel → Components → Format          │
                    │  main.js 编排 · 1s poll /api/live         │
                    └────────────────────┬─────────────────────┘
                                         │ JSON
                    ┌────────────────────▼─────────────────────┐
                    │  Node API (server/index.js :8788)         │
                    │  live.js → live-pipeline.js（唯一编排）    │
                    └────────────────────┬─────────────────────┘
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
   data/portfolio.json          data/day-display-state.json        东财/新浪
   data/app-state.json         data/impact-snapshots.json
```

- **后端**：穿透 live 算、展示 snap 读；计算与状态各一层单一 writer。
- **前端**：只读 API canonical；组件复用；DOM patch 优先。
- 前端细节见 [frontend-architecture.md](./frontend-architecture.md)。

## 2. 后端分层（Ground truth）

| 层 | 模块 | 职责 | Writer |
|----|------|------|--------|
| L0 | `market.js` | 穿透 impact | raw pct |
| L1 | `display-session.js` | phase / snapKey / RT1 模式 | **会话唯一入口** |
| L1 | `market-session.js` | display impact、suppress | 裁剪 pct |
| L2 | `fund-display.js` | per-fund ep / EST / row2 | **estimateProfit** |
| L3 | `live-pipeline.js` | 固定流水线编排 | — |
| L4 | `aggregate.js` | 组合求和 | **Σ ep only** |
| L5 | `components/snap-*` + `day-display-state.js` | snap seed/read | 复制 L2 |
| L5 | `day-display-state.js` | baseline 持久化 | baseline |

### 流水线（不可打乱）

```
resolveDisplaySession (一次/tick)
→ buildDisplayFundRows
→ reconcileDisplayState(session)
→ tryBackfillSnapFromTicks
→ applyDisplaySnapAndTotals(session)
```

### 估算公式库

`fund-estimate.js` — **仅**被 `fund-display.js` 调用；禁止 aggregate / 前端重算。

## 3. 前端分层

| 层 | 模块 |
|----|------|
| Pages | `main.js` |
| ViewModel | `live-view-model.js`, `summary.js`, `accounts.js` |
| Components | `components/metrics.js`, `components/session.js` |
| Format | `format.js`, `display-format.js` |

## 4. 模块地图

```
server/
├── live.js                    cache；调 live-pipeline
├── live-pipeline.js           展示唯一编排
├── display-session.js         会话状态唯一接口
├── fund-display.js            per-fund 唯一计算
├── components/                suppress · snap-* · market-hours · table-head
├── day-display-state.js       持久化
├── market.js / market-session.js
├── fund-estimate.js           公式库
├── aggregate.js               求和
└── settle.js                  入账（不清 snap）

src/
├── main.js
├── live-view-model.js
├── summary.js
├── fund-display-ui.js
├── components/metrics.js
├── components/session.js
├── format.js / display-format.js
└── accounts.js
```

## 5. 设计原则

1. **Single writer**：ep、phase、header RT1 各一处计算/解析。
2. **穿透 live、展示 snap**：tick 始终算穿透；冻结只影响展示读 snap。
3. **入账与 snap 解耦**：NAV 只动 AMT/DAY/持有。
4. **前后端互证**：`verify:tab-reconcile`、`verify:alipay-realtime`。
5. **UI 组件复用**：模式 A/B 指标块统一走 `components/metrics.js`。
