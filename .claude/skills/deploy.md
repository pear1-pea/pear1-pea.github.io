---
name: deploy
description: 构建、提交并部署博客到 GitHub Pages
---

# Build and Deploy

当前项目使用 Astro 构建，通过 GitHub Actions 自动部署到 GitHub Pages。

## 流程

1. **检查状态** — 运行 `git status` 确认当前改动
2. **本地构建验证** — 运行 `pnpm build` 确保没有构建错误
3. **提交** — 根据改动内容写合适的 commit message
4. **推送** — `git push origin source` 触发 CI/CD
5. **等待部署** — 使用 `gh run watch` 等待 GitHub Actions 完成

## 注意事项

- 博客内容在 `src/content/posts/` 目录
- 配置文件在 `src/config.ts`
- 部署在 `source` 分支上触发
- 先构建再推送，避免 CI 失败导致反复提交
