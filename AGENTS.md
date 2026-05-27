# AGENTS.md — fund-tracker

多账户基金持仓看板（Node API + Vite SPA）。核心难点在 **实时收益 RT1 / 预估资产 EST / 盘前盘后 snap** 的时段口径一致性。

## 先读文档

| 优先级 | 路径 | 何时读 |
|--------|------|--------|
| 1 | `docs/realtime-spec.md` | 改实时收益、预估、snap、Hero/列表 |
| 2 | `docs/data-flow.md` | 改数据流、持久化、API 字段 |
| 3 | `docs/architecture.md` | 新模块、重构、分层边界 |
| 4 | `docs/development.md` | 测试、验收、调试命令 |

索引：`docs/README.md`

## 运行

```bash
npm install
npm run dev          # web :5178, api :8788
npm run dev:api      # 仅 API
npm run test:fund-estimate && npm run test:realtime-profit
npm run verify:alipay-realtime   # 需 API 运行
```

## Canonical 公式（不可随意改口径）

```
账户资产     = Σ amount
RT1 (row1)   = Σ estimateProfit          # 不含盘前/盘后 row2
EST (header) = baseline + RT1 ≈ 账户资产 + RT1（scope 内）
```

- **穿透层永远 live 算**；**展示层**按 phase 读 snap 或 live
- **settle 入账**只更新 `portfolio.json`（AMT/DAY/持有）；**禁止** clear snap
- 单基金 EST fallback：`amount - settled + ep`；**header 禁止**逐基金累加该式（无 RT1 的基金会多减 settled）

## 模块速查

| 模块 | 文件 |
|------|------|
| Live API | `server/live.js` |
| 组合合计 | `server/aggregate.js` |
| 时段 / display impact | `server/market-session.js` |
| RT1/EST 公式 | `server/fund-estimate.js` |
| Snap 状态机 | `server/display-state-machine.js` |
| Baseline 持久化 | `server/day-display-state.js` |
| 入账 | `server/settle.js` |
| 前端 Hero/列表 | `src/main.js` |
| 账户概况 | `src/accounts.js` |

## 产品规则（易错）

1. **盘前 16:00–21:30**：RT1/EST/row1 **snap**；row2 extended **live**
2. **盘后 04:00–08:00**：与盘前对称；RT1 以正盘收市 snap 为准
3. **21:30 正盘**：discard premarket snap，RT1 live（regular+extended）
4. **A 股/黄金联接 + 美股正盘**：已收市时显示 `—`（`shouldSuppressDomesticRealtimeDuringUsRegular`）
5. **黄金联接**（如 000216）归类为 `cn`，顶栏 **不** 显示「黄金」市场
6. **estimateProfit** 必须来自 **display impact**，不能直接用 raw 穿透 `r`

## 代码风格

- ES modules（`"type": "module"`）
- 最小 diff；匹配现有命名与 JSDoc
- 改口径必补/改 `server/*.test.js` 或 verify 脚本
- 不提交 `data/portfolio.json`、`data/app-state.json`、`data/day-display-state.json`
- 不编辑 Cursor plan 文件；规格以 `docs/` 为准

## 完成前检查

- [ ] 相关 `npm run test:*` 通过
- [ ] 若动 RT1/EST/snap：考虑 `verify:alipay-realtime` / `verify:tab-reconcile`
- [ ] 文档与代码不一致时，优先更新 `docs/realtime-spec.md` 或 `docs/data-flow.md`

## 目录结构

```
fund-tracker/
├── AGENTS.md          ← 本文件
├── docs/              ← 规格与架构（source of truth）
├── server/            ← API、估值、状态机
├── src/               ← 前端 SPA
├── data/              ← 运行时 JSON（见 data/README.md）
├── scripts/           ← 校准、验收
└── .cursor/rules/     ← Cursor 规则
```
