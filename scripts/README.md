# scripts/

长期保留的脚本目录。**一次性**调试、外部站点对照、抓包分析 → 放 [`.tmp/`](../.tmp/README.md)。

| 文件 | 类型 | 何时跑 |
|------|------|--------|
| `verify-alipay-realtime.js` | 反复验收 | 改 RT1/EST 后，需 API 运行 |
| `verify-tab-reconcile.js` | 反复验收 | 改 scope 合计 / 多 Tab 后 |
| `calibrate-valuation.js` | 偶发维护 | 新基金 / 调权重 → `valuation-profiles.json` |
| `backtest-valuation.js` | 偶发维护 | 校准前后看 MAE |
| `install-mac-app.sh` | Mac 工具链 | `npm run mac:install` |
| `build-mac.sh` | Mac 工具链 | `npm run mac:build` |
| `run-mac-dev.sh` | Mac 工具链 | `npm run mac:dev` |
| `sync-mac-icon.sh` | Mac 工具链 | `npm run mac:build` |
| `sync-data-to-mac-app.sh` | Mac 工具链 | `npm run sync:mac-data` |
| `trim-icon-square.py` | Mac 工具链 | 被 `sync-mac-icon.sh` 调用 |

已移除的一次性脚本（345569 / xyz 对照类）不再保留；需要时请在 `.tmp/` 重写。
