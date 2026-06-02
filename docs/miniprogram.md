
# 微信小程序（原生 MVP）

## 范围

- Tab：**持仓** + **收益**（只读展示）
- 数据：Remote API canonical 字段（`estimateProfit`、`live.totals`）
- 无 Taro/uni-app；后续可打包 `packages/core` 纯函数

## 前置（Gate1）

- Remote API **HTTPS** + 微信合法域名备案
- 服务器 `FUND_TRACKER_CORS_ORIGINS` 含小程序请求来源（若需要）
- `FUND_TRACKER_API_TOKEN` 与小程序内配置一致

## 开发

1. 微信开发者工具 → 导入项目 → 选择 `apps/miniprogram/`
2. 在「收益」Tab 配置 API 地址与 Token
3. 开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名」（仅 dev）

## 发布

1. 微信公众平台配置 request 合法域名为 Remote API 域名
2. 上传体验版 → 核对持仓/收益与 Web 数值一致

## 目录

```
apps/miniprogram/
├── app.js / app.json / app.wxss
├── utils/api.js      # wx.request 封装
├── utils/format.js   # 与 packages/core/format 对齐的子集
└── pages/
    ├── holdings/     # 持仓列表 + Hero totals
    └── profit/       # API 配置 + 收益日历摘要
```
