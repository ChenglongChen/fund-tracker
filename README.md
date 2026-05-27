# fund-tracker

多账户基金持仓看板。聚合各渠道持仓，展示当日收益与盘中实时预估，支持分市场行情、账户概况与大盘指数。

## 功能

- 多账户切换：账户概况、全部持仓、单渠道视图
- 当日收益：基于公布净值自动入账
- 实时收益：重仓穿透估值或联接基金 proxy 估值
- 分市场会话：A 股、黄金、美股、日股、韩股等按交易时段刷新或冻结
- 账户概况：各账户资产、实时/当日收益、涨跌家数
- 大盘指数：上证、沪深300、恒生、标普500 等（账户概况页）
- 隐私模式：一键隐藏金额，保留涨跌幅
- 深色 / 浅色主题

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

`data/` 目录说明：

| 文件 | 说明 |
|------|------|
| `portfolio.json` | 持仓、份额、净值日期（运行时，勿提交 Git） |
| `app-state.json` | 资产口径、日内记录（运行时，勿提交 Git） |
| `valuation-profiles.json` | 各基金估值策略与权重参数（需保留） |

生产部署请挂载 `data/` 以持久化持仓与状态。详见 [data/README.md](./data/README.md)。

## 收益说明

**当日收益** — 东财公布净值入账后的已实现盈亏。服务端定期检测净值日期推进，自动更新份额与金额；也可调用 `POST /api/settle/run` 手动触发（`?dryRun=1` 仅预览）。

**实时收益** — 盘中估算。QDII 等基金通过重仓股行情穿透计算；联接 / 黄金等通过 proxy 基金估值。各市场仅在对应交易时段内更新实时数据。

**预估资产** — 入账资产加上各市场最新实时盈亏。

## 项目结构

```
fund-tracker/
├── src/           # 前端界面
├── server/        # API、行情、入账、估值引擎
├── data/          # 配置与持久化数据
├── scripts/       # 校准、回测、审计工具
└── dist/          # 构建输出
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/portfolio` | 读取持仓 |
| PUT | `/api/portfolio` | 更新持仓 |
| GET | `/api/live` | 实时估值与指数（缓存，约 1s 刷新） |
| GET | `/api/settings` | 读取设置 |
| PUT | `/api/settings` | 更新设置（如资产口径） |
| GET | `/api/fund/:code/detail` | 单基金重仓穿透 |
| GET | `/api/history/daily` | 历史每日汇总 |
| POST | `/api/settle/run` | 净值入账检测 |
| GET | `/api/status` | 服务状态 |

## 估值校准（可选）

```bash
npm run calibrate:valuation   # 校准权重参数 → data/valuation-profiles.json
npm run backtest:valuation    # 回测估值效果
npm run compare:holdings      # 对比持仓与参考数据
npm run audit:impact-xyz      # 审计穿透结果
```

穿透估值基于基金年报与最新重仓合并，权重模型可通过校准脚本按历史净值优化。

## 免责声明

本项目的实时预估与自动入账均来自公开行情与东财数据，仅供参考，不构成投资建议，亦不等同于任何销售平台的清算结果。投资有风险，决策请自行判断。
