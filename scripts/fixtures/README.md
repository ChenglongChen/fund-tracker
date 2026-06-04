# scripts/fixtures/

验收用基准数据。**私有**对照文件放 `*.local.json`，不提交 Git。

| 文件 | 用途 |
|------|------|
| `screenshot/` | README 截图统一数据包（见目录内 README） |
| `alipay-may-2026.example.json` | `verify:profit-calendar` 结构示例 |
| `alipay-may-2026.local.json` | 你的支付宝逐日基准（复制 example 后填写） |

历史一次性对照 fixture 已移除，勿再提交个人基准 JSON。
