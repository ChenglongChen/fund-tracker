
# Capacitor iOS

## 前置

- macOS + Xcode
- Remote API 已 HTTPS 可访问（Gate1）
- `npm run build` 产出 `dist/`

## 初始化（首次）

```bash
npm install
npm run build
npm run ios:init   # cap add ios（仅首次，等价于 workspace 内 add-ios）
```

## 日常开发

```bash
# 构建 Web 并同步到 ios/
npm run ios:sync

# Xcode 打开
npm run ios:open
```

> **注意**：`ios/` 原生工程由 `cap add ios` 生成，未初始化前 `ios:sync` / `ios:open` 会失败。

## API 配置

构建时注入 Remote API：

```bash
VITE_API_BASE=https://api.example.com VITE_API_TOKEN=your-token npm run ios:sync
```

或在 App 内「我的 → API 连接」填写 Remote 地址与 Token（与 Mac 相同）。

## 与 PWA 关系

Capacitor 版与 PWA 共用 `src/`；PWA 继续作为零成本备选，App Store 版用于后台与安装体验。
