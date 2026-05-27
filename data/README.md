# data/ 目录说明

| 文件 | 是否提交 Git | 说明 |
|------|-------------|------|
| `valuation-profiles.json` | ✅ 是 | 各基金估值策略与权重校准结果，服务端读取 |
| `portfolio.json` | ❌ 否 | 你的持仓快照、份额、入账日期（运行时生成） |
| `app-state.json` | ❌ 否 | 资产口径、日内 tick、每日汇总（运行时写入） |
| `_*.pdf` / `_*.js` / `_calibrate-run.log` | ❌ 否 | 临时抓包、校准日志，可删 |

首次启动时，若不存在 `portfolio.json`，会自动从 `src/portfolio.json` 复制种子数据。  
生产部署请挂载整个 `data/` 目录以持久化持仓与状态。
