# fund-tracker 文档索引

本目录描述 **实时收益 / 预估资产 / 多账户看板** 的产品规格、技术方案与运维说明。

| 文档 | 说明 |
|------|------|
| [architecture.md](./architecture.md) | **全栈**架构、后端分层、模块地图 |
| [backend-architecture.md](./backend-architecture.md) | **后端** 组件、snap、single writer |
| [frontend-architecture.md](./frontend-architecture.md) | **前端** ViewModel、组件、single source |
| [data-flow.md](./data-flow.md) | 端到端数据流、状态机、持久化 |
| [realtime-spec.md](./realtime-spec.md) | 功能规格：公式、时段规则、UI 口径 |
| [manual.md](./manual.md) | 用户使用手册 |
| [development.md](./development.md) | 开发、测试、验收脚本 |

## 快速参考

### 核心公式（portfolio / header）

```
账户资产     = Σ amount
实时收益 RT1 = Σ estimateProfit（row1，不含盘前/盘后 row2）
预估资产 EST = baseline + RT1
```

### 后端关键文件（Single writer）

| 路径 | 职责 |
|------|------|
| `server/display-session.js` | phase / snapKey **唯一接口** |
| `server/fund-display.js` | `estimateProfit` **唯一计算** |
| `server/live-pipeline.js` | 展示 **唯一编排** |
| `server/aggregate.js` | Σ ep（禁止重算） |
| `server/live.js` | `/api/live` cache |

### 前端关键文件

| 路径 | 职责 |
|------|------|
| `src/live-view-model.js` | API → fundRows（禁止 pct 重算 row1） |
| `src/summary.js` | scope Hero（SCOPE_ALL 读 totals） |
| `src/components/metrics.js` | 模式 A/B 可复用组件 |

### 验收命令

```bash
npm run test:display-session
npm run test:live-pipeline
npm run test:fund-estimate
npm run test:realtime-profit
npm run build
npm run verify:alipay-realtime
npm run verify:tab-reconcile
```
