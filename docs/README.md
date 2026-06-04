# 文档索引

fund-tracker 的规格与架构说明。新读者建议：**README → manual → development**；改实时口径则优先 **realtime-spec**。

## 用户

| 文档 | 说明 |
|------|------|
| [manual.md](./manual.md) | 界面、收益列、预估资产、常见问题 |
| [screenshots/README.md](./screenshots/README.md) | README 预览图与示例数据包 |

## 开发者与贡献者

| 文档 | 说明 |
|------|------|
| [development.md](./development.md) | 环境、测试、验收脚本、改代码检查清单 |
| [architecture.md](./architecture.md) | 全栈分层与模块地图 |
| [backend-architecture.md](./backend-architecture.md) | 后端 snap、single writer |
| [frontend-architecture.md](./frontend-architecture.md) | ViewModel、组件、禁止重算 row1 |
| [data-flow.md](./data-flow.md) | 数据流、状态机、持久化 |
| [realtime-spec.md](./realtime-spec.md) | **Canonical** 公式、时段、UI 口径 |
| [profit-calendar-spec.md](./profit-calendar-spec.md) | 收益 Tab / ledger |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献流程与提交前检查 |
| [../AGENTS.md](../AGENTS.md) | Cursor / Agent 入口 |

## 多端与部署

| 文档 | 说明 |
|------|------|
| [multi-platform.md](./multi-platform.md) | Web / Mac / iOS / 小程序、Remote API、Docker |
| [mac-app.md](./mac-app.md) | Mac Swift 壳 + Node sidecar |
| [ios-app.md](./ios-app.md) | Capacitor iOS |
| [miniprogram.md](./miniprogram.md) | 微信小程序 MVP |

## 规划（非当前实现必读）

以下文档描述中长期方向，**与仓库现状可能不一致**（例如当前主 UI 为 Vite + 原生 JS，非 Vue 3）：

| 文档 | 说明 |
|------|------|
| [platform-strategy.md](./platform-strategy.md) | 跨端技术选型备忘 |
| [mac-app-roadmap.md](./mac-app-roadmap.md) | Mac App 维护者 backlog |

## 核心公式（速查）

```
账户资产 = Σ amount（已入账）
RT1      = Σ estimateProfit（row1；禁止前端用 pct×amount 重算）
预估资产 = Σ estimateAssets = Σ (amount + ep)（与列表行一致）
```

snap 阶段 header 可用 `baseline + RT1` 防入账跳变；细则见 [realtime-spec.md](./realtime-spec.md)。

## 测试命令

见 [development.md §2](./development.md#2-测试) 与 [CONTRIBUTING.md](../CONTRIBUTING.md#提交前检查)。
