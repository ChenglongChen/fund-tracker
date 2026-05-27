# fund-tracker 文档索引

本目录描述 **实时收益 / 预估资产 / 多账户看板** 的产品规格、技术方案与运维说明。内容以 **「实时收益功能规格与修复计划（5/27 支付宝账户基准）」** 为实现依据，并反映当前代码状态。

| 文档 | 说明 |
|------|------|
| [architecture.md](./architecture.md) | 系统架构、模块职责、分层设计 |
| [data-flow.md](./data-flow.md) | 端到端数据流、状态机、持久化 |
| [realtime-spec.md](./realtime-spec.md) | 功能规格：公式、时段规则、UI 口径 |
| [manual.md](./manual.md) | 用户使用手册 |
| [development.md](./development.md) | 开发、测试、验收脚本 |

## 快速参考

### 核心公式（portfolio / header）

```
账户资产     = Σ amount
实时收益 RT1 = Σ estimateProfit（row1，不含盘前/盘后 row2）
预估资产 EST = baseline + RT1  ≈  账户资产 + RT1（scope 内合计）
```

### 关键文件

| 路径 | 职责 |
|------|------|
| `server/market.js` | 行情、穿透、fundgz/proxy |
| `server/market-session.js` | 交易时段、展示 impact、A 股/美股会话 |
| `server/fund-estimate.js` | RT1/EST 涨跌幅与金额公式 |
| `server/display-state-machine.js` | 盘前/盘后/EOD snap 协调 |
| `server/day-display-state.js` | baseline/snap 持久化 |
| `server/live.js` | `/api/live` 组装与 1s 刷新 |
| `server/settle.js` | 净值入账（不清 snap） |
| `src/main.js` | Hero、列表、账户概况 UI |
| `data/day-display-state.json` | 运行时 baseline / snap（勿提交 Git） |

### 验收命令

```bash
npm run test:fund-estimate
npm run test:realtime-profit
npm run verify:alipay-realtime
npm run verify:tab-reconcile
```
