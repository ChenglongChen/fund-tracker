# Contributing

感谢关注 fund-tracker。本项目面向个人/小团队自用与二次开发，欢迎 Issue 与 Pull Request。

## 开始之前

- Node.js **18+**，npm
- 阅读 [README.md](./README.md) 与 [docs/README.md](./docs/README.md) 了解文档分层
- 改实时收益 / snap / 展示口径前必读 [docs/realtime-spec.md](./docs/realtime-spec.md) 与 [AGENTS.md](./AGENTS.md)

## 本地开发

```bash
npm install
npm run dev          # Web :5178 + API :8788
```

仅 API：`npm run dev:api`。生产同端口：`npm run build && PORT=8788 npm start`。

复制 [.env.example](./.env.example) → `.env` 仅在需要 Remote API 鉴权时配置 token。

## 提交前检查

按改动范围执行（不必每次全跑）：

```bash
npm run test:fund-estimate && npm run test:realtime-profit
npm run test:display-session && npm run test:display-state && npm run test:live-pipeline
npm run test:profit-calendar
npm run build    # 若修改 src/
```

改 RT1/EST/snap 时建议再跑：`npm run verify:alipay-realtime`、`npm run verify:tab-reconcile`（需 API 已启动）。

完整命令表见 [docs/development.md](./docs/development.md)。

## 文档

- 行为 / 口径变更：先更新 `docs/realtime-spec.md` 或 `docs/data-flow.md`，再改代码
- README 预览图：改 `scripts/fixtures/screenshot/` 后执行 `npm run screenshot:readme`
- 勿在文档中写入真实持仓金额、基金代码组合或 API 密钥

## 隐私与仓库卫生

**不要提交：**

- `data/portfolio.json`、`app-state.json`、`day-display-state.json` 等运行时数据
- `.env`、`scripts/fixtures/*.local.json`
- 本地校准的 `data/valuation-profiles.json`

公开前可执行 `git status` 确认无上述文件；可选 `gitleaks detect --source .`。

## Pull Request 建议

- 保持 **最小 diff**，匹配现有 ESM 与命名风格
- 说明「为什么」与测试方式
- 避免无关重构或与 Issue 无关的格式化

## 架构约束（易踩坑）

| 数据 | 唯一 writer |
|------|-------------|
| per-fund `estimateProfit` | `server/fund-display.js` |
| header `realtimeProfit` | `server/aggregate.js`（Σ ep） |
| phase / snapKey | `server/display-session.js` |
| 展示流水线 | `server/live-pipeline.js` |

前端 row1 只读 API `estimateProfit`，禁止 `impactPct × amount` 重算。详见 [docs/backend-architecture.md](./docs/backend-architecture.md)。

## 问题反馈

- Bug / 功能建议：GitHub Issues
- 安全相关问题：见 [SECURITY.md](./SECURITY.md)
