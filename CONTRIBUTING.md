# 贡献指南

感谢你为 KBCut（口播智剪）做出贡献！

## 开发环境

```bash
git clone https://github.com/cglyvip/kbcut.git
cd kbcut
npm ci
npm run dev
```

**要求：**
- Node.js >= 20
- Windows 10/11 x64（本地调试）

## 代码规范

- 使用 TypeScript，遵循项目现有的 `tsconfig.json` 配置
- 组件使用函数组件 + Hooks
- 状态管理使用 Zustand
- Commit message 遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

| 前缀 | 用途 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | Bug 修复 |
| `perf:` | 性能优化 |
| `chore:` | 构建/工具/依赖变更 |
| `docs:` | 文档更新 |
| `test:` | 测试相关 |
| `refactor:` | 重构 |
| `release:` | 版本发布 |

## 测试

```bash
# 类型检查
npm run typecheck

# 运行单元测试
npm test

# 构建检查
npm run build

# 完整检查（typecheck + test + build）
npm run check
```

提交 PR 前请确保 `npm run check` 通过。

## 提交 PR

1. Fork 本仓库
2. 创建特性分支 `git checkout -b feat/your-feature`
3. 提交代码 `git commit -m "feat: add your feature"`
4. 推送分支 `git push origin feat/your-feature`
5. 在 GitHub 上提交 Pull Request

## 安全提醒

- **不要在代码、Issue、PR 中包含真实的 API Key**
- 测试时使用占位符如 `sk-test-xxx`
- 如不慎泄露，请立即在服务商后台撤销密钥