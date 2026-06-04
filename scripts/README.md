# scripts/

长期保留的脚本目录。**一次性**调试、外部站点对照、抓包分析 → 放 [`.tmp/`](../.tmp/README.md)。

| 文件 | 类型 | 何时跑 |
|------|------|--------|
| `verify-alipay-realtime.js` | 反复验收 | 改 RT1/EST 后，需 API 运行 |
| `verify-tab-reconcile.js` | 反复验收 | 改 scope 合计 / 多 Tab 后 |
| `verify-profit-calendar.js` | 反复验收 | 改收益日历 / ledger；需 fixture |
| `backfill-profit-ledger.js` | 偶发维护 | 历史 ledger 回填 |
| `calibrate-valuation.js` | 偶发维护 | 新基金 / 调权重 → `valuation-profiles.json` |
| `backtest-valuation.js` | 偶发维护 | 校准前后看 MAE |
| `install-mac-app.sh` | Mac 工具链 | `npm run mac:install` |
| `build-mac.sh` | Mac 工具链 | `npm run mac:build` |
| `run-mac-dev.sh` | Mac 工具链 | `npm run mac:dev` |
| `sync-mac-icon.sh` | Mac 工具链 | `npm run mac:build` |
| `sync-data-to-mac-app.sh` | Mac 工具链 | `npm run sync:mac-data` |
| `capture-readme-screenshot.mjs` | 文档 | `npm run screenshot:readme` → `docs/screenshots/`（数据：`fixtures/screenshot/`） |
| `trim-icon-square.py` | Mac 工具链 | 被 `sync-mac-icon.sh` 调用 |

## fixtures/

| 文件 | 说明 |
|------|------|
| `alipay-may-2026.example.json` | 收益日历验收结构示例 |
| `alipay-may-2026.local.json` | 私有基准（不提交 Git） |

已移除的一次性对照脚本不再保留；临时实验请放在 `.tmp/`。
