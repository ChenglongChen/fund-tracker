
# Mac App（Swift 轻壳）

> `npm run mac:build` — WKWebView + Node sidecar。业务逻辑在 `server/` + `dist/`，壳层在 `apps/mac/`。

## 架构

```
Fund Tracker.app
├── MacOS/Fund Tracker          ← Swift + WKWebView（~300 KB）
└── Resources/app/
    ├── dist/                   ← Vite 构建
    ├── server/                 ← Node API（未改业务逻辑）
    ├── node/bin/node           ← 仅 node 二进制（~73 MB strip 后）
    └── node_modules/@fund-tracker/
```

## 开发

```bash
npm run mac:dev     # 编译 Swift 壳 + 用仓库根目录与本机 node
npm run mac:open    # Xcode 打开工程
npm run dev         # 仅 Web + API 浏览器调试
```

Xcode 调试：Environment `FUND_TRACKER_APP_ROOT` = 仓库根目录。

## 打包安装

```bash
npm run mac:build
npm run mac:install
```

典型体积 **~80–95 MB**（无 Chromium）。

默认窗口为 **iPhone 15 逻辑尺寸（393×852 pt）**，布局与 iPhone PWA 一致；手动拉大窗口后会切换为宽表布局。

## 模式与数据

| 项目 | 路径 |
|------|------|
| 设置 | `~/Library/Application Support/@fund-tracker/mac/desktop-settings.json` |
| 数据 | `~/Library/Application Support/@fund-tracker/mac/data/` |
| 本地 API | `http://127.0.0.1:8790` |

| 模式 | 行为 |
|------|------|
| **本地**（默认） | Node sidecar → WKWebView 加载 `http://127.0.0.1:8790/` |
| **远程** | 加载 bundle 内 `dist/index.html` |

## iPhone 同 WiFi

Mac App 保持运行 → **我的** 页复制局域网地址 → iPhone Safari 打开。

### 与 Mac 窗口一致的体验

Mac 默认窗口为 iPhone 15 尺寸（393×852）；在 iPhone 上建议：

1. **添加到主屏幕**（推荐）：Safari 分享 → **添加到主屏幕** → 从桌面图标打开。全屏无地址栏，布局与 Mac 壳一致。
2. **Safari 直接访问**：已自动启用手机壳布局；底部仍会有 Safari 工具栏，观感略不同于 Mac。

局域网地址示例：`http://192.168.x.x:8790/`（端口以 **我的** 页显示为准）。

## 同步持仓

```bash
npm run sync:mac-data
```

## Gatekeeper

```bash
xattr -cr "/Applications/Fund Tracker.app"
```

详见 [platform-strategy.md](./platform-strategy.md)。
