# fund-tracker

本地自用基金持仓看板，参考养基宝交互：多账户、已入账快照 + 盘中穿透预估、账户概况与底部大盘指数。

## 功能概览

- **多账户 Tab**：账户概况 / 全部持仓 / 各渠道子账户
- **两套收益**：当日收益（东财公布净值入账）与实时收益（持仓穿透 / 联接 proxy 估值）
- **分市场会话**：A 股、黄金、美股、日股、韩股等按交易时段冻结或刷新行情
- **账户概况卡片**：各账户资产、实时/当日收益及涨跌家数（红涨绿跌）
- **底部指数条**（账户概况 Tab）：上证、沪深300、恒生、标普500 等
- **一键隐藏资产**：眼睛图标，金额打码、百分比仍可见
- **服务端缓存**：前端约 1s 读 `/api/live`，服务端后台刷新估值

## 架构

| 纯静态 | 当前（Vite + Node） |
|--------|---------------------|
| 浏览器直连新浪/东财易 CORS / 限流 | 服务端统一拉行情 |
| 无法定时入账 | `fundgz` 检测 `jzrq` 推进 → 自动更新持仓 |
| 持仓在 localStorage | 持久化 `data/portfolio.json` |

部署生产环境请使用 **`npm run build` + `npm start`**，由 Node 同时提供 API 与静态资源。

## 快速开始

```bash
git clone https://github.com/ChenglongChen/fund-tracker.git
cd fund-tracker
npm install
npm run dev
```

- 页面：http://localhost:5178（`/api` 代理到 8788）
- API：http://localhost:8788/api/status

首次启动若 `data/portfolio.json` 不存在，会从 `src/portfolio.json` 复制种子持仓，请按需改成你自己的数据。

## 生产部署

```bash
npm install
npm run build
PORT=8788 npm start
```

访问 `http://<主机>:8788`。请挂载 **`data/`** 目录（至少包含运行后生成的 `portfolio.json`、`app-state.json`）。

## 目录结构

```
fund-tracker/
├── src/                 # 前端（Vite）
├── server/              # API、行情、入账、穿透估值
├── data/                # 持久化与配置（见 data/README.md）
├── scripts/             # 校准、回测、审计脚本
│   └── fixtures/        # 审计用参考快照（可选）
└── dist/                # 构建产物（不提交）
```

### data/ 里什么该提交？

| 文件 | Git | 说明 |
|------|-----|------|
| `valuation-profiles.json` | ✅ | 估值策略与权重校准，需入库 |
| `portfolio.json` | ❌ | 个人持仓，运行时生成 |
| `app-state.json` | ❌ | 日内状态，运行时写入 |
| `_*.pdf` / `_*.js` 等 | ❌ | 临时抓包，勿提交 |

详见 [data/README.md](./data/README.md)。

## 数据与入账

### 已入账 vs 实时预估

| 类型 | 来源 | 界面 |
|------|------|------|
| **已入账** | 东财公布净值，服务端自动入账 | 当日收益、账户资产 |
| **实时预估** | 重仓穿透或联接 fundgz proxy | 实时收益、预估资产 |

### 自动入账

1. 首次运行：按东财 `dwjz` 推算 `shares = amount / dwjz`。
2. 当 `jzrq` 晚于该基金 `lastNavDate`：更新 `amount`、`yesterdayProfit`、`totalProfit`。
3. 每 **30 分钟** 扫描；也可 `POST /api/settle/run`（`?dryRun=1` 仅预览）。

> 自动入账对齐东财公布净值，与支付宝可能有差异；以渠道为准时请 `PUT /api/portfolio` 手动覆盖。

### 实时刷新

- 服务端约 **1s** 刷新 `/api/live` 缓存；持仓列表首次加载后走 DOM patch，避免整页闪烁。
- 重仓穿透结果缓存 5 分钟；联接类基金（如黄金 000216）走 **proxy 快速通道** 直接读 fundgz。
- 黄金/联接类 fundgz 涨跌幅通常 **分钟级** 更新，属数据源频率，非刷新停止。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/portfolio` | 持仓与账户 |
| PUT | `/api/portfolio` | 手动覆盖持仓 |
| GET | `/api/live` | 指数 + 各基金估值（缓存） |
| GET | `/api/settings` | 资产口径等 |
| PUT | `/api/settings` | 切换 settled / realtime 口径 |
| GET | `/api/fund/:code/detail` | 单只重仓穿透 |
| GET | `/api/history/daily` | 每日汇总记录 |
| POST | `/api/settle/run` | 立即入账检测 |
| GET | `/api/status` | 快照日期、估值更新时间 |

## 开发脚本

```bash
npm run calibrate:valuation   # 校准 → data/valuation-profiles.json
npm run backtest:valuation      # 回测估值算法
npm run compare:holdings        # 对比持仓与 fixtures 参考
npm run audit:impact-xyz        # 审计穿透与 xyz 快照
```

## 穿透估值

年报 + 最新重仓合并，权重模型可校准（`scripts/calibrate-valuation.js`）。算法参考 [纳指估值](https://web1.345569.xyz/)。

## 免责

穿透预估值仅供参考。自动入账来自东财 `fundgz`，不等同任何渠道清算结果。
