# data/ 目录说明

| 文件 | 是否提交 Git | 说明 |
|------|-------------|------|
| `valuation-profiles.example.json` | ✅ 是 | 示例估值策略（与 `src/portfolio.json` 种子基金一致） |
| `valuation-profiles.json` | ❌ 否 | 本地校准结果（`npm run calibrate:valuation` 生成） |
| `portfolio.json` | ❌ 否 | 持仓、份额、净值日期（运行时） |
| `app-state.json` | ❌ 否 | 资产口径、日内 tick、每日汇总 |
| `day-display-state.json` | ❌ 否 | **baseline**、盘前/盘后/EOD **snap**、`currentPhase` |
| `impact-snapshots.json` | ❌ 否 | 穿透 `impactPctRegular` 按 fundId 持久化 |
| `_*.pdf` / `_*.js` / `_calibrate-run.log` | ❌ 否 | 临时文件，可删 |

## day-display-state.json

展示层状态，与 `portfolio.json` 分离：

- `baseline[scope]` — 入账资产\_{D−1}，日切写入
- `eodSnap` — EOD 冻结（16:00–21:30 等）：RT1、EST、per-fund `amountAtSnap`
- 历史字段名 `premarketSnap` / `afterhoursSnap` 可能仍出现在旧数据；新逻辑以 `eodSnap` + `display-session` phase 为准
- `rt1AccrualDay` — 00:00–04:00 US 尾段仍归属前一日

服务启动时 `loadDayDisplayState()` 加载；**重启后恢复 snap**，避免 header 跳变。

详见 [docs/data-flow.md](../docs/data-flow.md#5-持久化)。

## 首次启动

若不存在 `portfolio.json`，从 `src/portfolio.json` 复制种子数据。

若不存在 `valuation-profiles.json`，运行时自动回退读取 `valuation-profiles.example.json`。

## 生产部署

挂载整个 `data/` 目录以持久化持仓与展示状态。
