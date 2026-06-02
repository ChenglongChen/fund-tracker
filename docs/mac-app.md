
# Mac App（Electron）

## 开发

```bash
npm install
npm run mac:dev
```

会先 `vite build`，再启动 Electron。

| 模式 | API | 数据 |
|------|-----|------|
| **本地**（默认） | `127.0.0.1:8790` 内嵌 server | `~/Library/Application Support/@fund-tracker/mac/data/` |
| **远程** | 用户在「我的 → API 连接」配置 | Remote API 的 `data/` volume |

切换本地/远程：在「我的」保存 API 模式后 **自动重启** Mac App。

## 同步 dev 真实持仓

Mac App 首次启动会用种子数据；若 dev 环境 `data/` 已是真实持仓，一键同步：

```bash
npm run sync:mac-data
```

从项目 `data/` 复制 `portfolio.json`、`app-state.json`、`day-display-state.json` 等到 App 数据目录；旧文件备份到 `data/.backup-*`。同步后重启 App。


```bash
npm run mac:build
```

产出：`build/mac/`（`.app` / `.dmg`）

## 与 Remote 同步

1. **Remote → Mac 本地**：切 Remote 模式 →「从 Remote 拉取」→ 切回本地（需手动复制 `data/` 或后续脚本）
2. **Mac 本地 → Remote**：本地模式「导出 portfolio.json」→ Remote 环境 `PUT /api/portfolio`；或 rsync `data/` 到服务器
3. **推荐日常**：各端均连 Remote API，Mac 本地模式仅离线/隐私场景

## Gatekeeper

未 Notarize 的 build 需在「隐私与安全性」中允许打开：

```bash
xattr -cr "/Applications/Fund Tracker.app"
```

## 技术要点

- `contextIsolation: true`，`nodeIntegration: false`
- `server/startFundTrackerServer()` 供 Electron 内嵌启动
- 桌面设置持久化：`desktop-settings.json`（与 Web localStorage API 模式对齐）
