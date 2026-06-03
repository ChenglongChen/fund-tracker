# 平台与技术选型（中长期）

> **产品定位**：个人/小团队用的**轻量资金持仓看板** — 跟踪全市场收益、多账户汇总，不是金融终端。  
> **选型原则**：计算集中、展示分散；一套 Web UI 覆盖主端；各端壳尽量薄；不为「全栈统一」牺牲小程序与 Mac 体验。

---

## 1. 我们要解决什么问题

| 诉求 | 含义 |
|------|------|
| 小工具 | 核心就：持仓列表、实时 RT1、预估 EST、简单改持仓 |
| 多端 | 浏览器 PWA、Mac 桌面、iPhone App、微信小程序（只读为主） |
| 长期可维护 | 不再出现 `main.js` 1600 行、Electron 255 MB、各端各算一遍 |
| 计算可信 | QDII / 盘前盘后 / A 股静默等规则**只在一处**实现 |

**结论**：庞杂感来自 **历史演进（PWA → Electron → 手写 DOM）**，不是「基金跟踪」本身需要很复杂。中长期要通过 **分层 + 选型** 把复杂度关进 `server/`。

---

## 2. 推荐总架构（定稿）

```
                         ┌─────────────────────────────┐
                         │   Node API（唯一大脑）        │
                         │   server/ + Docker 部署      │
                         │   计算 · snap · 持久化        │
                         └──────────────┬──────────────┘
                                        │ HTTPS / JSON
          ┌─────────────────────────────┼─────────────────────────────┐
          ▼                             ▼                             ▼
   ┌──────────────┐            ┌──────────────┐            ┌──────────────┐
   │  Web 主 UI    │            │  Apple 壳     │            │  微信小程序   │
   │  Vue 3 SPA   │◄──同 dist──│  Capacitor   │            │  薄客户端     │
   │  Vite 构建   │            │  iOS         │            │  WXML 2–3 页 │
   └──────┬───────┘            │  Swift Mac   │            └──────────────┘
          │                    │  WKWebView   │
          │                    └──────┬───────┘
          │                           │ 可选本地
          │                    ┌──────▼───────┐
          └────────────────────│ Node sidecar │  仅 Mac 离线 / 无 NAS 时
                               │ (SEA 单文件) │
                               └──────────────┘
```

### 2.1 各层选型（一句话）

| 层 | 选型 | 不选 |
|----|------|------|
| **计算与状态** | **Node.js 单体 API**（现有 `server/`） | Swift/Rust 重写后端、前端算 RT1 |
| **主 UI** | **Vue 3 + Vite + Pinia** | 继续堆 vanilla `main.js`、全 SwiftUI |
| **共享逻辑** | **`packages/core` + `api-client`**（已有 monorepo） | 各端复制 format/summary |
| **Web / PWA** | 同上 Vue SPA | 另起 Next/Nuxt（无 SEO 需求） |
| **iPhone** | **Capacitor 7** 包 `dist/` | React Native、纯 SwiftUI 首版 |
| **Mac** | **Swift + WKWebView** + Node sidecar | Electron（长期弃用）、全 SwiftUI |
| **微信小程序** | **原生薄页**（现 `apps/miniprogram`） | 首版就上 uni-app 全量迁移 |
| **部署** | **Docker Compose** 为「家」；Mac sidecar 为补充 | 每端内置完整后端 |

---

## 3. 为什么是这个组合

### 3.1 后端：坚持 Node，不换语言

- 已有 ~9k 行 domain（`display-session`、`live-pipeline`、`fund-display`）和完整测试；**迁移成本 >> 收益**。
- 基金估值、多市场时段是**规则引擎**，适合放在服务端单 writer，与 UI 框架无关。
- Docker 一处部署 → 手机、小程序、浏览器都连同一个 API；Mac 本地 sidecar 只在「没开 NAS」时用。

**中长期演进**：收 API 面、删 dead code、优化 tick，**不**换栈。

### 3.2 前端：迁到 Vue 3，而不是 React / Flutter

| 因素 | Vue 3 | React | Flutter |
|------|-------|-------|---------|
| 从 vanilla 迁移 | 模板直观，渐进式 | 也可，JSX 略陡 | 全重写 |
| iPhone（Capacitor） | ✅ 任意 SPA | ✅ | ❌ 另一套 UI |
| 小程序 | 将来可 **uni-app（Vue 语法）** 扩 | Taro（React） | 不支持 |
| 国内资料 / 生态 | 好 | 好 | 中 |
| 与现有 `packages/core` | ESM 直接 import | 同 | 不能复用 |

**不选 Flutter**：小程序无法覆盖，等于永远两套 UI。  
**不选全 SwiftUI**：iPhone + Mac + 小程序三套 UI，与「小工具」人力不匹配。

### 3.3 iPhone：Capacitor，不是 Expo / RN

- 已有 `apps/ios/capacitor.config.json`，`webDir: dist`。
- **与 Web/Mac 共用同一套 Vue 构建物**，改 UI 只改一处。
- 原生能力（推送、生物识别）按需加 Capacitor 插件，不必首版全上。

### 3.4 Mac：Swift 壳，不是 Electron，也不是 Capacitor macOS 优先

| | Electron | Capacitor macOS | Swift + WKWebView |
|--|----------|-----------------|-------------------|
| 体积 | ~255 MB | ~20 MB + sidecar | ~15 MB + sidecar |
| 启动 | 慢 | 中 | 快 |
| 与 iOS  toolchain | 无关 | 统一 | Mac 单独 Xcode |
| 长期维护 | Chromium 负担 | 社区 mac 支持弱于 iOS | Apple 一等公民 |

**中长期主路径**：Mac 用 **Swift 轻壳** 加载 `dist/`，本地模式 spawn **Node SEA sidecar**（与 Electron 内嵌同一份 `server/` 逻辑）。  
Capacitor macOS 作备选，仅当希望 **Apple 双端完全同一套壳代码** 时再评估。

### 3.5 微信小程序：薄客户端，不强行与 Web 同代码

- 微信运行时、组件、包体积限制与 Web 不同；**强行 uni-app 一套代码** 往往牺牲 Web/Mac 体验。
- 现 `apps/miniprogram` 已正确：**只调 API、只展示 Hero + 列表**。
- **中长期**：功能继续薄；若要与 App 功能对齐到 80%+，再开 **`apps/miniprogram-uni`（uni-app）** 分支，而不是推翻 Web 栈。

---

## 4. 不推荐的路线

| 路线 | 为何不做 |
|------|----------|
| **继续 Electron 作为 Mac 终局** | 体积/内存/启动是结构性问题，优化有顶 |
| **全栈 Swift（UI + 计算）** | 小程序无法复用；后端重写 6 个月+ |
| **Flutter 一码多端** | 不含微信小程序；Web 体验一般 |
| **uni-app 统吃 H5+App+小程序** | 可后期部分采用；**不宜**作为 Web/Mac 主栈 |
| **前端重算 RT1** | 破坏 AGENTS.md single writer，多端必不一致 |
| **每个端内置完整 Node** | iPhone/小程序包体积与审核都不合适 |

---

## 5. 目标形态（12–18 个月）

### 5.1 仓库结构

```
fund-tracker/
├── packages/
│   ├── core/           # ViewModel、format、summary（已有）
│   ├── api-client/     # HTTP + ETag（已有）
│   └── storage/        # 本地 key（已有）
├── server/             # Node API，唯一计算（保留）
├── src/                # Vue 3 SPA（由 vanilla 迁入）
├── apps/
│   ├── ios/            # Capacitor iOS
│   ├── mac/            # Swift + WKWebView（Mac App）
│   └── miniprogram/    # 微信薄页（保留）
├── dist/               # Vite 产出，各壳共用
└── docker-compose.api.yml
```

### 5.2 各端职责

| 端 | 职责 | 不算 RT1 |
|----|------|----------|
| `server/` | 行情、pipeline、snap、持久化 | — |
| `src/` (Vue) | 页面、轮询、展示、设置 | ✅ |
| Capacitor iOS | 壳、Safe Area、可选推送 | ✅ |
| Swift Mac | 窗口、sidecar 生命周期、深链 | ✅ |
| 小程序 | 2–3 页只读 | ✅ |

### 5.3 部署模式（产品层）

| 模式 | 适用 | API 来源 |
|------|------|----------|
| **家庭 Docker（推荐默认）** | 在家 WiFi、小程序、浏览器 | NAS / 树莓派 / Mac mini |
| **Mac 本地 sidecar** | 离线、没开 Docker | 本机 Node SEA |
| **纯远程** | 有公网/VPN API | 不配 sidecar |

---

## 6. 迁移路线图（中长期，非短期补丁）

```
2026 Q2   定选型（本文档）+ 冻结 Electron 新功能
2026 Q2–Q3  Vue 3 迁核心页（列表 / Hero / 详情 / 设置）
2026 Q3     Capacitor iOS TestFlight；Docker 作日常主 API
2026 Q3–Q4  Swift Mac 壳 + Node SEA；Electron 标记 legacy
2026 Q4     小程序维持薄页；视需求评估 uni-app 子集
2027+       按需 SwiftUI 局部原生（Widget、菜单栏）— 非必须
```

### 6.1 Phase A — 前端现代化（3–4 个月，与壳并行）

- [ ] 引入 Vue 3 + Pinia + Vue Router，`src/` 逐步替换 `main.js` 上帝文件
- [ ] 保留 `packages/core` 为 ViewModel 层；组件对齐 `components/metrics.js` 模式 A/B
- [ ] PWA 行为不变；`npm run build` 仍产出 `dist/`
- [ ] **验收**：`verify:tab-reconcile`、现有 E2E 目测、移动端 Safari

**不做的**：顺便改 RT1 公式、合并 `server/` 模块。

### 6.2 Phase B — Apple 双端（2–3 个月）

- [ ] **iPhone**：Capacitor sync + App Store（远程 API 或家庭 Docker）
- [x] **Mac**：`apps/mac/`（Swift 轻壳，已替代 Electron）
- [ ] Sidecar：Node SEA 打包 `server/`，数据目录 `~/Library/Application Support/@fund-tracker/`
- [ ] **验收**：Mac ≤80 MB；iOS 与 Web RT1 一致

### 6.3 Phase C — 小程序与运维（持续）

- [ ] 小程序：持仓 + 汇总两页稳定；API 鉴权与 Docker 一致
- [ ] 后端：tick 优化、API 版本化（`/api/v1` 可选）
- [ ] 文档：`realtime-spec.md` 与 API 契约测试 `test:api-contract`

---

## 7. 决策表：你的问题直接回答

### 「用什么框架？」

| 层次 | 框架 |
|------|------|
| 后端 | **Node.js**（Express 级原生 http 即可，不强行上 Nest） |
| 主 UI | **Vue 3 + Vite + Pinia** |
| iPhone | **Capacitor** |
| Mac | **Swift + WKWebView**（非 Electron） |
| 小程序 | **微信原生**（薄）；将来可选 **uni-app** 子项目 |
| Monorepo | **npm workspaces**（保持 `packages/*`） |

### 「UI 用什么？」

- **主界面**：Vue 单页 + 现有 iOS 风 CSS 设计 token（不必换设计系统）
- **不用**：SwiftUI 做主 UI、Ant Design 全量、Electron 内嵌 Chromium

### 「计算放哪？」

- **只在 `server/`**；前端 / 壳 / 小程序 **只读** `estimateProfit`、`live.totals`
- Mac sidecar 跑的是**同一份** `server/index.js`，不是「Mac 专用简化版」

### 「现在不重构，以后会怎样？」

| 若不重构 | 后果 |
|----------|------|
| vanilla `main.js` | 加 iPhone/Mac 功能成本指数上升 |
| Electron | 体积/内存永久背锅 |
| 小程序复制逻辑 | 与 App 数字不一致 |
| 无 Docker 主站 | 每端都要塞后端 |

---

## 8. 人力与优先级（小团队现实）

假设 **1 人主力 + 偶发**：

1. **必须先做**：Vue 迁核心 UI + API 契约测试（否则多端必痛）
2. **其次**：Capacitor iOS 或 Swift Mac **二选一先 ship** — 建议 **先 iPhone（Capacitor）**，因配置已有、无 Electron 包袱
3. **再次**：Swift Mac 替 Electron
4. **可滞后**：小程序加页、uni-app、Widget、菜单栏

---

## 9. 与现有文档关系

| 文档 | 关系 |
|------|------|
| [architecture.md](./architecture.md) | 后端分层不变；前端改为 Vue 组件层 |
| [frontend-architecture.md](./frontend-architecture.md) | Phase A 完成后更新 |
| [mac-app-roadmap.md](./mac-app-roadmap.md) | Mac **实现细节**；壳终局以本文 §3.4 为准 |
| [realtime-spec.md](./realtime-spec.md) | 口径权威；任何框架不得改公式 |

---

## 10. 总结（Executive Summary）

**中长期唯一推荐栈**：

> **Node API（Docker 为主） + Vue 3 Web UI + Capacitor（iPhone） + Swift 轻壳（Mac） + 微信原生薄小程序**

**核心信念**：

1. 你是**小工具**，不是 OS 级应用 — 壳要薄、脑要集中。  
2. **一套 Web UI** 服务浏览器和 Apple 内嵌 WebView，性价比最高。  
3. **Electron 是过渡**，不是终局。  
4. **小程序单独薄做**，不为统一而统一。  
5. **现在最值得的投资**是 Vue 化前端 + API 契约，而不是换后端语言或全原生重写。

若团队只有一条行动线：**2026 下半年完成 Vue 迁移 + Capacitor iOS 上架 + 规划 Swift Mac 替 Electron**。
