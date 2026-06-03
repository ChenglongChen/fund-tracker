
# 多端客户端

## 定稿栈

| 端 | 方案 | UI |
|----|------|-----|
| Web PWA | Vite SPA | `src/` |
| Mac | **Swift + WKWebView** + Node sidecar | 复用 `src/` / `dist/` |
| iPhone | Capacitor 6 | 复用 `src/` |
| 微信小程序 | 原生 WXML | `apps/miniprogram/` |

共享逻辑：`packages/core`、`packages/api-client`、`packages/storage`。

详见：[mac-app.md](./mac-app.md) · [ios-app.md](./ios-app.md) · [miniprogram.md](./miniprogram.md)

## Remote-First

- 生产：**单一 Remote API** + 挂载 `data/` volume
- Mac 本地模式：`FUND_TRACKER_DATA_DIR` → Application Support（离线增强）
- 禁止 v1 双写；同步用显式导入/导出

## 数据同步（v1）

| 操作 | 入口 | 说明 |
|------|------|------|
| 导出 portfolio | Web/Mac「我的 → 导出 portfolio.json」 | 本地 JSON 备份 |
| 从 Remote 拉取 | 「我的 → 从 Remote 拉取」 | `GET` + `PUT /api/portfolio` |
| Mac 本地 → Remote | 先切 Remote API，再拉取/保存 | 或 rsync `data/` 到 VPS volume |
| Remote 唯一源（推荐） | 各端连同一 HTTPS API | iPhone / 小程序 / 多设备一致 |

**禁止 v1 双写。** 切换 Mac 本地/远程模式后需重启 Mac App（设置页保存时自动提示）。

## API 安全

| 变量 | 说明 |
|------|------|
| `FUND_TRACKER_API_TOKEN` | 设置后 `/api/*` 需 `Authorization: Bearer`（`/api/health` 除外） |
| `FUND_TRACKER_CORS_ORIGINS` | 逗号分隔 origin；`*` 或未设置则 dev 宽松 |
| `FUND_TRACKER_DATA_DIR` | 数据目录（Mac App 自动设置） |

复制 `.env.example` → `.env` 配置 token。

## 部署

```bash
# 开发：Cloudflare Tunnel → localhost:8788
cloudflared tunnel --url http://localhost:8788

# 生产：仅 API 容器（挂载 data volume）
docker compose -f docker-compose.api.yml up -d
```

验收：

```bash
curl -s http://localhost:8788/api/health
curl -s -H "Authorization: Bearer $FUND_TRACKER_API_TOKEN" http://localhost:8788/api/live | head
```

## 客户端 API 基址

- Web dev：Vite proxy `/api`
- 生产 / 移动端：`VITE_API_BASE` 或「我的 → API 连接」
- Token：`VITE_API_TOKEN` 或 storage `fund-tracker-api-token`

## Monorepo

```
packages/core          # ViewModel + format
packages/api-client    # createClient({ baseUrl, getToken })
packages/storage       # web | mp 键值
apps/mac               # Swift 轻壳（mac:build）
apps/ios               # Capacitor
apps/miniprogram       # 微信原生 MVP
```

## 测试

```bash
npm run test:api-contract
npm run test:display-session && npm run test:live-pipeline && npm run test:realtime-profit
npm run build
```
