# data/ 目录说明

| 文件 | 是否提交 Git | 说明 |
|------|-------------|------|
| `valuation-profiles.json` | ✅ 是 | 各基金估值策略与权重校准结果 |
| `portfolio.json` | ❌ 否 | 持仓、份额、净值日期（运行时） |
| `app-state.json` | ❌ 否 | 资产口径、日内 tick、每日汇总 |
| `day-display-state.json` | ❌ 否 | **baseline**、盘前/盘后/EOD **snap**、`currentPhase` |
| `impact-snapshots.json` | ❌ 否 | 穿透 `impactPctRegular` 按 fundId 持久化 |
| `_*.pdf` / `_*.js` / `_calibrate-run.log` | ❌ 否 | 临时文件，可删 |

## day-display-state.json

展示层状态，与 `portfolio.json` 分离：

- `baseline[scope]` — 入账资产\_{D−1}，日切写入
- `premarketSnap` / `afterhoursSnap` — RT1、EST、per-fund `amountAtSnap`
- `eodSnap` — 全日休市定稿
- `rt1AccrualDay` — 00:00–04:00 US 尾段仍归属前一日

服务启动时 `loadDayDisplayState()` 加载；**重启后恢复 snap**，避免 header 跳变。

详见 [docs/data-flow.md](../docs/data-flow.md#5-持久化)。

## 首次启动

若不存在 `portfolio.json`，从 `src/portfolio.json` 复制种子数据。

## 生产部署

挂载整个 `data/` 目录以持久化持仓与展示状态。
