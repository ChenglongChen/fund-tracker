# Mac App 优化路线图

> 定位：**小工具** — 本地/远程 API 算收益，Mac 端只做壳 + 展示。  
> 优先级：**启动速度 → 运行时响应 → 安装体积 → 壳替换（Electron → 轻壳）**。

---

## 1. 目标与验收指标

### 1.1 产品目标

| 维度 | 目标 | 说明 |
|------|------|------|
| 安装体积 | **≤ 80 MB**（中期） | Electron 现 ~255 MB；换轻壳后可达 |
| 冷启动到首屏 | **≤ 2 s** 见骨架；**≤ 5 s** 有完整 RT1 | 先开窗 + loading，不白屏等待 |
| 热启动 | **≤ 1 s** 见上次数据 | 读 cache / stale-while-revalidate |
| 收益刷新延迟 | **≤ 1 s**（正盘 live） | 受外部行情 API 限制，非 UI 轮询 |
| CPU / 内存 | 后台 **< 5% CPU**、**< 300 MB RSS** | Electron 现常 > 400 MB |
| 可维护性 | 壳与业务分离 | 计算只在 `server/`，Mac 不含 PDF 等重型依赖 |

### 1.2 基线（2026-05，Electron 优化后）

| 指标 | 当前值 | 瓶颈 |
|------|--------|------|
| `.app` 体积 | ~255 MB | Electron Framework ~243 MB（95%） |
| `app.asar` | ~900 KB | 业务代码已足够小 |
| 冷启动 | 3–15 s（视网络） | **双重等待 live** + 首 tick 拉全量行情 |
| 轮询 | 前后端各 500 ms | 已对齐；API 支持 ETag/304 |
| 计算 | ~9k 行 `server/` | 复杂度在 domain，不宜拆到 UI |

---

## 2. 架构原则（长期不变）

```
┌─────────────────────────────────────────────────────────┐
│  Mac 壳（Electron → 将来 Swift/Capacitor）               │
│  · 窗口 / 设置 / 可选本地 sidecar                          │
│  · 加载 dist/（Vite 静态页）                               │
└───────────────────────────┬─────────────────────────────┘
                            │ http://127.0.0.1:8790 或远程
┌───────────────────────────▼─────────────────────────────┐
│  Node API（唯一大脑）server/                               │
│  live.js 500ms tick → live-pipeline → fund-display       │
└─────────────────────────────────────────────────────────┘
```

**禁止**：在 Mac 壳或前端重算 `estimateProfit` / header RT1。  
**允许**：壳层优化启动、缓存、网络；后端优化 tick 结构与 I/O。

---

## 3. 壳方案对比（Mac 专项）

| 方案 | 体积 | 启动 | 开发成本 | 本地 API | 推荐阶段 |
|------|------|------|----------|----------|----------|
| **A. 继续 Electron（现状）** | ~255 MB | 慢（Chromium） | 0 | ✅ 内嵌 Node | ✅ 已完成打包精简 |
| **B. Swift + WKWebView + Node sidecar** | **~50–80 MB** | 快 | 1–2 周 | ✅ 子进程 Node | **⭐ 中期主选** |
| **C. Capacitor macOS** | ~20 MB 壳 + sidecar | 中 | 3–5 天 | ✅ 同 B | 备选（与 iOS 统一） |
| **D. 纯远程（无本地 Node）** | **~10–20 MB** | 最快 | 2–3 天 | ❌ 需 Docker/NAS | 可选模式，非默认 |

> **Electron 已移除。** 壳终局为 Swift + WKWebView，见 [mac-app.md](./mac-app.md)。

---

## 4. 分阶段路线图

```
Phase 0  打包精简（已完成）
Phase 1  启动体验（1 周，不改壳）
Phase 2  运行时响应（1–2 周，主要改 server/）
Phase 3  Electron 体验收尾（3 天）
Phase 4  Swift 轻壳替换（1–2 周）
Phase 5  前端组件化 / Vue（可选，与 iPhone 共用）
```

---

## 5. 详尽任务清单

### Phase 0 — 打包精简 ✅ 已完成

- [x] `electron-builder.yml` 排除完整 `node_modules`、测试、docs、scripts
- [x] `pdf-parse` 改 optional + 动态 import（Mac 包不含 PDF 栈）
- [x] `compression: maximum`，`electronLanguages: [en, zh_CN]`
- [x] 去掉重复打包 `packages/**`
- [x] 体积 342 MB → **~255 MB**，`app.asar` **~900 KB**

---

### Phase 1 — 启动体验（优先做，仍用 Electron）

**问题**：`main.mjs` 在 `startEmbeddedServer` 里 `await waitForLiveReady`（最多 30 s）**之后才** `createWindow`；前端 `bootstrap()` 又 `fetchLiveWhenReady`（最多 20 s）——**串行双重等待** + 用户看白屏。

#### 1.1 先开窗、后数据（P0）

- [ ] **Mac 壳**：`createWindow` 提前到 `bootstrapServer` 之后 / health OK 即可，**不要**等 live ready
- [ ] **Mac 壳**：窗口先加载带 `?boot=1` 或本地 `dist/index.html` loading 页，API ready 后 `loadURL` 到 `http://127.0.0.1:8790/`（或 SPA 自行 retry）
- [ ] **前端**：loading 态已有（`state.view = 'loading'`），确保 desktop 下首屏即显示 shell 骨架（Hero 占位 + 列表 skeleton）
- [ ] **验收**：Dock 点击 → **≤ 1 s** 出现窗口与 loading UI

**涉及文件**：`apps/mac/electron/main.mjs`，`src/main.js`，`src/style.css`（skeleton）

#### 1.2 服务端就绪信号（P0）

- [ ] `startFundTrackerServer` 返回前调用 `waitForLiveCacheReady` **可选**，由壳决定是否等待
- [ ] 新增 `GET /api/live/status`：`{ ready, fundsCount, updatedAt, warming }` 供壳/前端轻量轮询（避免反复拉全量 `/api/live`）
- [ ] 首 tick 失败时 API 仍返回 `200` + `{ funds: [], warming: true }`，前端不误报 error

**涉及文件**：`server/index.js`，`server/live.js`

#### 1.3 冷启动计算分层（P1）

首 tick `refreshLive` 当前串行：`portfolio` + `fetchMarketStrip` + **每只基金** `fetchFundNavInfo` + `resolvePortfolioImpacts` → 网络 RTT 决定启动时间。

- [ ] **Fast path**：若有 `day-display-state` / snap，首 tick 仅用缓存 impact 跑 `runLiveDisplayPipeline`，**跳过** NAV 拉取
- [ ] **Slow path**：首屏显示后后台补 NAV、补 Asia/Stooq，完成后 `requestLiveRefresh`
- [ ] `fundImpactSourceCache` 持久化到 `data/app-state.json`（或现有 snapshot），**跨重启**不必 5 min 全量 refresh
- [ ] 限制并发：`fetchFundNavInfo` 用 pool（如 concurrency=6），避免 30+ 基金同时打东财

**涉及文件**：`server/live.js`，`server/market.js`，`server/bootstrap.js`

#### 1.4 静态资源与前端包（P2）

- [ ] Vite：`build.rollupOptions.output.manualChunks` 拆 vendor（若将来引入 Vue 再议）
- [ ] 压缩 `public/icon-512.png`（现 ~400 KB，Mac 不需要 512 进 dist）
- [ ] `index.html`：`preload` 关键 CSS；defer 非首屏脚本
- [ ] Electron：`win.loadURL` 同源静态由 Node 提供，确认 `sendFile` 对 `dist/assets/*.js` 有 **Cache-Control**（`max-age=86400`）

**涉及文件**：`vite.config.js`，`server/index.js`，`public/*`

#### Phase 1 验收

```bash
# 计时：从 open 到 window visible
time open -a "Fund Tracker"

# API 就绪
curl -s http://127.0.0.1:8790/api/live/status | jq

# 测试
npm run test:display-session && npm run test:live-pipeline
```

| 检查项 | 通过标准 |
|--------|----------|
| 窗口出现 | ≤ 1.5 s |
| Loading 骨架 | 开窗即见 |
| 完整 RT1 | ≤ 5 s（正常网络） |
| RT1 数值 | 与优化前 `verify:tab-reconcile` 一致 |

---

### Phase 2 — 运行时响应（计算与网络）

**问题**：用户感知「卡」通常来自 (1) 外部行情慢 (2) 每 500 ms 全量 pipeline (3) 前端 DOM 全量 patch。

#### 2.1 后端 tick 优化（P0）

- [ ] **Quote / Display 分离**：行情指纹未变时，只跑 `reapplyDisplayFromCachedFunds`（已有），**不**重新 `resolvePortfolioImpacts`
- [ ] `needsLiveQuotes === false` 时，`LIVE_REFRESH_SLOW_MS` 提到 **2000–3000 ms**（snap 阶段降频）
- [ ] `recordLiveSnapshot` 仅在 full refresh 写盘（已部分实现），避免每 500 ms 写 JSON
- [ ] 合并 `fetchMarketStrip` 内重复 HTTP（指数 + 汇率一次 batch）

**涉及文件**：`server/live.js`，`server/market.js`，`server/session-quotes.js`

#### 2.2 API 与前端轮询（P1）

- [ ] 前端已用 `If-None-Match` + `304`（`packages/api-client`）——确认 `fetchLiveWhenReady` 首调也传 revision
- [ ] 隐藏 Tab / 非 live 视图：停 poll（已有 `visibilitychange`，确认 Mac 多窗口不误触）
- [ ] Desktop：**后台** poll 降到 1000 ms；**前台** 保持 500 ms
- [ ] `/api/live` 响应体：列表页不需要的字段（如大 `holdings`）不塞进 live payload

**涉及文件**：`src/main.js`，`server/index.js`，`server/live-pipeline.js`

#### 2.3 前端渲染（P2）

- [ ] `patchListDom` 仅更新变更行（按 `fund.id` + `estimateProfit` / `impactPct` diff）
- [ ] 首屏 `refreshListView` 与 `applyLive` 合并，避免连续 paint 两次
- [ ] Mac 宽屏：`desktop-layout.js` resize 加 `requestAnimationFrame` throttle（已有则跳过）

**涉及文件**：`src/main.js`，`src/pages/list-page.js`，`src/desktop-layout.js`

#### 2.4 可观测性（P1）

- [ ] `GET /api/debug/timing`（仅 localhost）：最近 tick 各阶段 ms（strip / impacts / pipeline / 写盘）
- [ ] Mac 壳：开发菜单或 `Cmd+Opt+I` 打开 DevTools（可选，默认关）
- [ ] 日志：`refreshLive` 超 2 s 打 `[live] slow tick` + 分解耗时

**涉及文件**：`server/live.js`，`apps/mac/electron/main.mjs`

#### Phase 2 验收

```bash
npm run test:fund-estimate && npm run test:realtime-profit
npm run verify:alipay-realtime   # API 运行时
```

| 检查项 | 通过标准 |
|--------|----------|
| Snap 阶段 CPU | 较现版下降（Activity Monitor 目测） |
| 304 命中率 | 无行情变化时 > 80% poll 返回 304 |
| RT1 正确性 | verify 脚本全过 |
| 正盘 live 延迟 | 行情变后 ≤ 1 s UI 更新 |

---

### Phase 3 — Electron 体验收尾

- [ ] **Splash**：`BrowserWindow` 先 400×300 splash，ready 后 expand（可选，若 1.1 已够可跳过）
- [ ] **单实例锁**：`app.requestSingleInstanceLock()`，重复打开聚焦已有窗口
- [ ] **菜单栏**：Fund Tracker 菜单 — 刷新、切换本地/远程、打开数据目录
- [ ] **远程模式**：默认 `dist/index.html` + 配置 API base，不启动 embedded server（启动最快）
- [ ] **文档**：`docs/manual.md` 增补 Mac 本地/远程模式说明

---

### Phase 4 — Swift 轻壳替换 Electron（推荐中期）

#### 4.1 工程结构

```
apps/mac/
├── FundTracker.xcodeproj
├── FundTracker/
│   ├── App.swift              # @main
│   ├── ContentView.swift      # WKWebView
│   ├── ServerProcess.swift    #  spawn Node sidecar
│   ├── Settings.swift         # 迁移 desktop-settings.json
│   └── Resources/
│       ├── dist/              # npm run build 拷贝
│       └── fund-tracker-server # Node SEA 或 node + server  bundle
```

#### 4.2 任务清单

- [ ] 新建 Xcode 工程，`WKWebView` 加载 bundle 内 `dist/index.html` 或 `http://127.0.0.1:8790`
- [ ] `ServerProcess`：`Process()` 启动 sidecar，传 `FUND_TRACKER_DATA_DIR`、`PORT`
- [ ] 打包 sidecar：**Node SEA**（`node --experimental-sea-config`）单文件 ~40–60 MB，或首版直接用系统 `node` + `server/` 目录（开发期）
- [ ] 迁移 IPC：`desktop-settings.json` 路径改为 `~/Library/Application Support/@fund-tracker/mac/`
- [ ] 注入 `window.fundTrackerDesktop = { isDesktop: true, ... }` via WKUserScript（替代 preload）
- [ ] 签名 / Notarization 脚本：`scripts/build-mac.sh`
- [ ] `package.json`：`mac:swift:build`，Electron 改 `mac:build:electron`
- [ ] 体积目标：**≤ 80 MB** 安装包

#### 4.3 Sidecar vs 内嵌 Node（Electron 现状）

| | Electron 内嵌 | Swift + sidecar |
|--|---------------|-----------------|
| 进程模型 | 单进程 Chromium+Node | UI 进程 + Node 子进程 |
| 内存 | 高（双 V8 + Chromium） | 低（WebKit 系统共享） |
| 崩溃隔离 | API 崩了整个 app 挂 | 可重启 sidecar |
| 启动 | Chromium 冷启动慢 | WebKit + 小 exe 快 |

**计算逻辑不变**：sidecar 仍跑现有 `server/index.js`，**不重写** snap / RT1。

#### Phase 4 验收

| 检查项 | 通过标准 |
|--------|----------|
| 体积 | ≤ 80 MB |
| 功能 | 与 Electron 版 tab / RT1 / 设置一致 |
| 启动 | 优于 Electron 基线 30%+ |
| 数据目录 | 与 Electron 共用，升级无迁移 |

---

### Phase 5 — 前端框架（可选，配合 iPhone）

与 Mac 壳 **解耦**，可并行排期：

- [ ] Vue 3 + Vite 迁核心页（列表 / Hero / 详情）
- [ ] Capacitor iOS 用同一 `dist`
- [ ] 小程序继续薄页 or uni-app

详见将来 `docs/platform-strategy.md`（跨端总览）。

---

## 6. 加载速度：谁该做什么

| 环节 | 负责层 | 优化手段 |
|------|--------|----------|
| Dock → 窗口 | Mac 壳 | 先开窗；勿 block 等 live |
| 窗口 → 骨架 UI | 前端 `dist` | loading view；小 bundle |
| 骨架 → RT1 数字 | Node API | fast path + 缓存 impact；并发 NAV |
| RT1 数字 → 持续更新 | Node + 前端 | 500 ms tick；304；snap 降频 |
| 外部行情延迟 | Node `market.js` | 缓存 fingerprint；合并 HTTP；Stooq 异步补 |

**结论**：启动慢的主因是 **等 API 首 tick + 双重 wait**，不是 SPA 本身（~600 KB）。  
**结论**：运行慢的主因是 **外部 API + 全量 pipeline**，不是 Mac 壳 UI。

---

## 7. 计算逻辑：要不要动、怎么动

### 7.1 不应为了「小工具」而删的逻辑

以下属于 **产品正确性**，保留在 `server/`，仅优化 **何时算、算多频**：

- `display-session.js` — 时段 / snapKey
- `live-pipeline.js` — 展示编排
- `fund-display.js` — `estimateProfit` 唯一计算
- `market-session.js` — suppress / display impact

### 7.2 可以精简的

| 项目 | 动作 |
|------|------|
| Mac 包内 PDF 解析 | ✅ 已移除 |
| 首 tick 全量 NAV | Phase 1.3 改 deferred |
| Snap 阶段 500 ms 全量 tick | Phase 2.1 降频 |
| 跨重启 impact 缓存丢失 | Phase 1.3 持久化 |
| 前端重复 bootstrap wait | Phase 1.1 去掉壳层 wait |

### 7.3 响应速率：推荐默认参数（调优目标）

| 参数 | 现值 | 建议 |
|------|------|------|
| `LIVE_REFRESH_MS` | 500 | 保持（正盘） |
| `LIVE_REFRESH_SLOW_MS` | 500 | **2000–3000**（snap / 无 live quote） |
| `REFRESH_MS`（前端） | 500 | 前台 500 / 后台 1000 |
| `LIVE_FULL_REFRESH_MS` | 5 min | 保持；有持久化 cache 可延到 15 min |
| 首 tick NAV | 同步全量 | **延迟 + 并发池** |

---

## 8. 文件级改动地图

| 阶段 | 主要文件 |
|------|----------|
| 1.1 启动 | `apps/mac/electron/main.mjs` |
| 1.2 API status | `server/index.js`, `server/live.js` |
| 1.3 冷启动 | `server/live.js`, `server/market.js`, `server/bootstrap.js` |
| 2.1 tick | `server/live.js`, `server/market.js` |
| 2.2 轮询 | `src/main.js`, `packages/api-client` |
| 2.3 渲染 | `src/main.js`, `src/pages/list-page.js` |
| 3 收尾 | `apps/mac/electron/main.mjs`, `docs/manual.md` |
| 4 Swift | `apps/mac/*`, `scripts/build-mac.sh` |

**不要动**（除非改口径）：`fund-display.js`, `aggregate.js`, `display-session.js` 的核心公式。

---

## 9. 不建议做的事

| 做法 | 原因 |
|------|------|
| 继续抠 Electron 体积到 < 200 MB | Chromium 地板 ~230 MB，投入产出低 |
| Mac 端重写 RT1 / snap 逻辑 | 多端不一致，违反 AGENTS.md |
| 首版全 SwiftUI 原生 UI | 工作量大；小程序/iPhone 无法复用 |
| 为启动速度去掉 `live-pipeline` | 会破坏 snap / suppress 正确性 |
| 在 Mac 包内恢复 pdf-parse | +78 MB，与小工具定位不符 |

---

## 10. 推荐执行顺序（接下来 2–3 周）

**Week 1 — Phase 1（体验立竿见影）**

1. 去掉 `main.mjs` 的 `waitForLiveReady` 阻塞 → 先开窗  
2. 加 `/api/live/status` + loading skeleton  
3. `fetchFundNavInfo` 并发池 + 首 tick fast path  

**Week 2 — Phase 2（响应与 CPU）**

4. Snap 阶段 `LIVE_REFRESH_SLOW_MS` 提至 2 s  
5. Quote 指纹未变跳过 impact 重算  
6. `/api/debug/timing` + slow tick 日志  

**Week 3 — Phase 3 + Phase 4 启动**

7. Electron 单实例 + 菜单  
8. 搭 `apps/mac` 骨架，远程模式先跑通  
9. 并行 Node SEA sidecar 调研  

---

## 11. 命令速查

```bash
# 开发
npm run dev                    # Web :5178 + API :8788
npm run mac:dev                # Electron 开发

# 构建安装（Electron）
npm run build && npm run mac:build && npm run mac:install

# 验收
npm run test:display-session && npm run test:live-pipeline
npm run test:fund-estimate && npm run test:realtime-profit
npm run verify:tab-reconcile   # 需 API

# 体积分析
du -sh "/Applications/Fund Tracker.app/Contents/"*
npx asar list "/Applications/Fund Tracker.app/Contents/Resources/app.asar" | head
```

---

## 12. 相关文档

- [architecture.md](./architecture.md) — 全栈分层  
- [realtime-spec.md](./realtime-spec.md) — RT1 / snap 口径（改 Phase 2 时必读）  
- [frontend-architecture.md](./frontend-architecture.md) — 前端 single source  
- [development.md](./development.md) — 测试与验收命令  
