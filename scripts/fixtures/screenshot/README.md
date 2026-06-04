# 截图示例数据包（单一数据源）

README 预览图 `docs/screenshots/*.png` 均来自本目录，由 `npm run screenshot:readme` 一次性生成。

| 文件 | 说明 |
|------|------|
| `portfolio.json` | 5 只示例基金 + 6 个账户（与 `src/portfolio.json` 同步） |
| `app-state.json` | 自选列表 + `profitLedger`（2026-05） |
| `day-display-state.json` | `eod_freeze` + `eodSnap`（固定 RT1/EST） |
| `impact-snapshots.json` | 基金/指数收盘 impact 快照 |
| `fund-detail-packs.json` | 穿透详情页静态持仓（避免实时行情漂移） |

环境变量（脚本自动设置）：

- `FUND_TRACKER_DATA_DIR` → `.tmp/screenshot-data`（本目录副本）
- `FUND_TRACKER_NOW=2026-05-29T17:00:00+08:00`（eod 冻结时段，各页口径一致）
- `FUND_TRACKER_SCREENSHOT=1`（详情页读 `fund-detail-packs.json`；**禁用自动入账**写回 portfolio）

顶栏口径：账户资产 = Σ 入账 `amount`（全仓 31 万 / 支付宝 17 万）；副行预估 = Σ `estimateAssets`（全仓 312,014 / 支付宝 170,710）。

更新示例持仓时请同时改 `portfolio.json` 与本目录，并重新跑 `npm run screenshot:readme`。
