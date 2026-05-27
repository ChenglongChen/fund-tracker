# 我的持有 · 养基宝式持仓 + 服务端实时预估

本地自用持仓看板：养基宝式 **已入账快照** + **盘中穿透预估值**。部署后由 **Node 服务端**（零第三方运行时依赖）负责行情代理、15 秒估值刷新、东财净值 **自动入账**。

## 为什么要前端 + 后端？

| 纯前端（旧） | 前端 + 后端（现） |
|-------------|------------------|
| 部署后新浪/东财 **CORS 失败** | 服务端统一拉行情 |
| 浏览器每 15s 拉 16 只重仓，慢且易限流 | 服务端缓存 `/api/live`，前端只读一条 JSON |
| 无法定时入账 | `fundgz` 检测 `jzrq` 推进 → 自动更新持仓 |
| 持仓在 localStorage | 持久化 `data/portfolio.json` |

结论：**部署必须用当前架构**；纯静态只适合 `npm run dev` 时代的本地调试。

## 两套数据

| 类型 | 更新方式 | 界面 |
|------|----------|------|
| **已入账** | 东财公布净值后服务端自动入账；或与支付宝不一致时手动 PUT | 「当日收益」「快照」 |
| **实时预估** | 服务端每 15s 穿透重算 | 「实时预估」「穿透」 |

### 自动入账逻辑

1. 首次运行：按东财 `dwjz` 为每只基金推算 `shares = amount / dwjz`。
2. 当 `jzrq`（公布净值日期）**晚于** 该基金 `lastNavDate`：  
   `yesterdayProfit = shares × (新 dwjz − 旧净值)`，`amount = shares × 新 dwjz`，`totalProfit` 累加。
3. 每 **30 分钟** 扫描一次；也可在页面「触发入账检测」或 `POST /api/settle/run`。

> 自动入账对齐 **东财公布净值**，与支付宝截图可能有分位差异；以支付宝为准时请手动保存 JSON 覆盖。

## 运行

### 开发（Vite + API 同时起）

```bash
cd tools/fund-tracker
npm install
npm run dev
```

- 页面：`http://localhost:5178`（`/api` 代理到 `8788`）
- API：`http://localhost:8788/api/health`

### 生产部署

```bash
npm install
npm run build
PORT=8788 npm start
```

访问 `http://<主机>:8788`。持久化挂载 **`data/portfolio.json`**（持仓与 `shares` / `lastNavDate`）。

### API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/portfolio` | 持仓快照 |
| PUT | `/api/portfolio` | 手动覆盖持仓 |
| GET | `/api/live` | 指数 + 各基金穿透涨跌幅（缓存） |
| GET | `/api/fund/:code/detail` | 单只重仓明细 |
| POST | `/api/settle/run` | 立即入账检测（`?dryRun=1` 仅预览） |
| GET | `/api/status` | 快照日期、估值更新时间 |

## 手动改持仓

编辑 `data/portfolio.json` 或通过页面底部导入 → **保存到服务端**（`PUT /api/portfolio`）。  
`src/portfolio.json` 仅作首次种子；服务启动时若 `data/` 无文件会自动复制。

## 穿透估值

年报 + 最新重仓合并，权重不归一化，叠加汇率。算法参考 [纳指估值](https://web1.345569.xyz/)。

## 免责

穿透预估值仅供参考。自动入账来自东财 `fundgz`，不等同支付宝清算。
