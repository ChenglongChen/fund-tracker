# Security

## 报告方式

如发现安全问题（例如认证绕过、任意文件读写、依赖中的严重 CVE），请通过 **GitHub Security Advisory** 或私有渠道联系维护者，**勿**在公开 Issue 中粘贴 exploit 细节或真实 token。

## 部署建议

- 公网暴露 API 时务必设置 `FUND_TRACKER_API_TOKEN`，客户端使用 `Authorization: Bearer`
- 通过 `FUND_TRACKER_CORS_ORIGINS` 限制浏览器来源，避免 `*` 用于生产
- 不要将 `.env`、`data/` 目录或含持仓的备份提交到公开仓库

## 公开仓库历史

若曾在 Git 中提交过 `data/valuation-profiles.json`（个人基金校准）等文件，须用 `git filter-repo` 或 BFG 从**全部历史**中剔除后再 `git push --force`。维护者本地可执行：

```bash
pip install git-filter-repo
git filter-repo --invert-paths \
  --path data/valuation-profiles.json \
  --path data/xyz-close-snapshot.json \
  --force
```

推送前用 `git log --all -- data/valuation-profiles.json` 确认无输出。

## 非目标

本项目为个人持仓看板，不提供多租户隔离、审计日志或合规级访问控制。自行评估是否满足你的使用场景。
