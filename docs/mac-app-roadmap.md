# Mac App 优化 backlog

> **受众**：维护者内部备忘，非贡献者必读（见 [docs/README.md](./README.md)）。  
> **现状**：Electron 已移除；当前壳为 **Swift + WKWebView + Node sidecar**（见 [mac-app.md](./mac-app.md)）。

## 已达成（2026-06）

| 指标 | 目标 | 现状 |
|------|------|------|
| 安装体积 | ≤ 80 MB | ~94 MB（含 bundled Node 20） |
| 壳技术 | Swift 轻壳 | `apps/mac/FundTracker/` |
| 本地 API | 8790 | `ServerProcess.defaultPort` |
| 首屏 | 骨架 + stale cache | `boot.html` + WKWebView |
| `/api/live/status` | 就绪探测 | 已实现 |

## 待办（按优先级）

### P1 — 启动与响应

- [ ] sidecar 就绪前 WebView 只读 cache，避免白屏长等
- [ ] Remote 模式首包体积：确认 `dist/` 不含 source map / 调试资源
- [ ] tick 合并：行情 batch 失败时降级策略文档化

### P2 — 体积

- [ ] 评估 Node sidecar 换 SEA / 更小 runtime（非阻塞）
- [ ] 图标与 `public/` 资源 dedupe（512 PNG 与 touch icon）

### P3 — 体验

- [ ] 窗口位置持久化（已有 `WindowPlacement.maxRestorableWidth` 限制）
- [ ] 菜单栏「刷新 / 打开数据目录」快捷键
- [ ] Sparkle 自动更新（可选）

### P4 — 观测

- [ ] `GET /api/debug/timing`（tick 各阶段耗时，仅 dev）
- [ ] 壳层日志与 sidecar stderr 统一输出

## 不在范围

- 前端 Vue 迁移 — 见 [platform-strategy.md](./platform-strategy.md)
- 在 Mac 壳内重算 RT1/EST — 禁止，见 [realtime-spec.md](./realtime-spec.md)

## 相关命令

```bash
npm run mac:dev      # Swift 壳 + sidecar 开发
npm run mac:build    # 产出 build/mac/mac-arm64/Fund Tracker.app
npm run mac:install  # 安装到 /Applications
npm run sync:mac-data
```
