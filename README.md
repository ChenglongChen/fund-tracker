# fund-tracker

多账户基金持仓看板。聚合各渠道持仓，展示当日收益与盘中实时预估，支持分市场行情、账户概况与大盘指数。

**文档**：[docs/README.md](./docs/README.md) — 架构、数据流、实时收益规格、用户手册、开发指南  
**Cursor**：[AGENTS.md](./AGENTS.md) — Agent 入口；规则见 [.cursor/rules/](./.cursor/rules/)

## 功能

- 多账户切换：账户概况、全部持仓、单渠道视图
- **实时收益 row1 + 盘前/盘后 row2**（Hero、账户卡、列表三处同构）
- **预估资产**：`账户资产 + 实时收益`（canonical：`baseline + RT1`）
- 当日收益：东财公布净值自动入账
- 实时穿透：重仓估值或联接 proxy；美股 extended 与 regular 拆分
- 分市场会话：A 股、美股 QDII 等按时段 live / snap / 隐藏（`—`）
- 账户概况：各账户资产、实时/当日收益、涨跌家数
- 大盘指数：上证、沪深300、恒生、标普500 等
- 隐私模式、深色 / 浅色主题

## 环境要求

- Node.js 18+
- npm

## 安装与运行

### 开发

```bash
npm install
npm run dev
```

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:5178 |
| API | http://localhost:8788 |

开发模式下 Vite 将 `/api` 代理至 API 服务。

### 生产

```bash
npm install
npm run build
PORT=8788 npm start
```

浏览器访问 `http://<主机>:8788`。Node 同时提供静态页面与 API。

## 持仓数据

首次启动时，若 `data/portfolio.json` 不存在，会从 `src/portfolio.json` 复制示例结构。请将其替换为你自己的持仓，或通过 API / 页面保存。

`data/` 目录说明见 [data/README.md](./data/README.md)。生产部署请挂载 `data/` 以持久化持仓与 **day-display-state** snap。

## 收益说明（摘要）

| 概念 | 说明 |
|------|------|
| **账户资产** | Σ 各基金已入账 `amount` |
| **实时收益** | 穿透 row1；盘前/盘后不含 extended row2 |
| **预估资产** | 账户资产 + header 实时收益合计 |
| **当日收益** | 净值公布后入账的官方盈亏 |

细则见 [docs/realtime-spec.md](./docs/realtime-spec.md)。

**特殊规则**：A 股/黄金联接在 **美股正盘**且 A 股已收市时，实时列显示 `—`。

## 项目结构

```
fund-tracker/
├── docs/          # 架构、数据流、规格、手册
├── src/           # 前端界面
├── server/        # API、行情、入账、估值与展示状态机
├── data/          # 配置与持久化数据
├── scripts/       # 校准、回测、验收脚本
└── dist/          # 构建输出
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/portfolio` | 读取持仓 |
| PUT | `/api/portfolio` | 更新持仓 |
| GET | `/api/live` | 实时估值、totals、displayState（约 1s 刷新） |
| GET | `/api/settings` | 读取设置 |
| PUT | `/api/settings` | 更新设置（如资产口径） |
| GET | `/api/fund/:code/detail` | 单基金重仓穿透 |
| GET | `/api/history/daily` | 历史每日汇总 |
| POST | `/api/settle/run` | 净值入账检测 |
| GET | `/api/status` | 服务状态 |

`/api/live` 返回 `totals.baseline`、`displayState.phase`、`displayState.accrualDay` 等，供调试 snap。

## 测试与验收

```bash
npm run test:fund-estimate
npm run test:realtime-profit
npm run verify:alipay-realtime    # 需 API 运行
npm run verify:tab-reconcile
```

## 估值校准（可选）

```bash
npm run calibrate:valuation
npm run backtest:valuation
npm run compare:holdings
npm run audit:impact-xyz
```

## 免责声明

本项目的实时预估与自动入账均来自公开行情与东财数据，仅供参考，不构成投资建议，亦不等同于任何销售平台的清算结果。投资有风险，决策请自行判断。
