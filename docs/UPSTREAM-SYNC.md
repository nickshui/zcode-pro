# 与上游 zai-org/ZCode 同步指南

## 仓库布局

- `main` —— 跟随上游的基线分支，只允许：上游合并 + 项目文档（docs/、README.md）
- `feat/*` —— 增强功能分支，从 `main` 切出，合回 `main`
- remote `upstream` → `https://github.com/zai-org/ZCode.git`（官方）
- remote `origin` → 预留给你自己的 Zcode-Pro 托管地址（创建后自行 `git remote add`）

## 日常同步

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

上游是周期性代码投放仓库（创建于 2026-09-20，整仓仅 3 个提交），同步频率低、
历史浅，冲突面预期很小。

## 冲突原则

增强代码的写法约束（违反会放大未来冲突）：

1. 协议新增键一律加在 schema 对象**末尾**
2. handler 单独成文件，不并入上游既有文件的大函数体
3. UI 改动使用独立的条件分支/props，不重排上游代码行序
4. 投影（product-projection.ts）是唯一需要在上游函数体内加行的文件，
   每处增补用 `// zcode-pro: begin/end` 标记块包裹

## 标记约定

所有 Zcode-Pro 增补代码统一使用标记注释，便于同步时快速定位与回溯：

```ts
// zcode-pro: message-rewind (docs/design/message-rewind.md)
...增补代码...
// zcode-pro: end
```
