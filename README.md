# Zcode-Pro

**基于 [zai-org/ZCode](https://github.com/zai-org/ZCode) 开源版增强的 AI 编程工作台**，主打一项上游暂时没有的能力：**任意消息级回滚（Kilo Code 风格的 Checkpoint / Rewind）**——在桌面客户端对话界面上，随时回到任意一条历史消息的"对话原点"，可选同时回滚该消息之后的文件改动。

> 上游基线：`zai-org/ZCode` v3.14.3（tag `upstream/v3.14.3`）
> 许可证：Apache-2.0（继承上游，含 NOTICE.md 与 THIRD-PARTY-NOTICES.md）

## 这个项目解决什么问题

上游 ZCode 的 core runtime **已经具备**任意消息粒度的回滚原语
（`rewindToMessage(scope: Conversation | Workspace | Both)`），但产品协议层有意收紧了入口：

- `editUserQuery` 仅允许编辑**最后一条**用户提问（守卫 `guard.latestQueryEditOnly`）
- `retryTurn` 仅允许重试**最后一条** assistant 回复（守卫 `guard.latestAssistantRetryOnly`）
- 协议裁决注释（`packages/shared/src/zcode-protocol-v4/command.ts:3`）：
  *"conversation rewind 无独立命令（裁决：= editUserQuery 的 UI 入口）"*

因此用户在 GUI 上无法"回到任意对话原点"。Zcode-Pro 以**纯加法**方式补齐这条链路，
不修改任何既有命令的语义与守卫。

## 项目铁律

1. **纯加法原则**：所有增强以新增命令 / 新增 action 键 / 新增 handler 的方式落地，
   不改动上游既有功能的行为、守卫与协议语义。
2. **可同步**：`main` 分支与上游逐提交可合并，增强工作全部隔离在
   `feat/*` 分支与清晰标注的增补块中。
3. **可回流**：每个增强保持独立、自洽、可单独向上游提 PR。

## 快速开始

构建与开发方式与上游完全一致，见 [docs/UPSTREAM-README.md](docs/UPSTREAM-README.md)。

```bash
pnpm bootstrap          # 安装依赖 + 准备桌面运行资源

# 桌面版开发（改了 agent/CLI 代码后用这个）
pnpm --dir packages/desktop dev:local-cli

# 只改 packages/ui 时用更快的
pnpm --dir packages/desktop dev:runtime
```

运行自建的桌面版后，用你的 Z.ai Coding Plan API Key 登录即可连接官方模型服务。

## 增强能力路线

见 [docs/ROADMAP.md](docs/ROADMAP.md)。当前主线：

| 阶段 | 能力 | 状态 |
| --- | --- | --- |
| Phase 1 | 任意消息**对话回滚**（`rewindConversation` 命令 + 行级 `canRewind` + UI 按钮） | ✅ 完成并通过无头 e2e（`scripts/e2e-rewind.mjs`） |
| Phase 2 | agent 侧 shadow git 全仓快照，覆盖 bash 等一切文件副作用（UI 第二按钮"回滚对话和文件"） | ✅ 完成并通过 e2e（bash 追加被整树回滚） |
| Phase 3 | 两阶段回滚 + redo（借鉴 Kilo revert/unrevert 设计） | 设计中 |

技术设计文档：[docs/design/message-rewind.md](docs/design/message-rewind.md)

## 目录导览

```
apps/zcode-cli/            # Agent CLI 与运行时（core 原语、v4 网关、命令 handler）
packages/desktop/          # Electron 桌面应用（main / preload / renderer / host / scheduler）
packages/ui/               # 桌面与 Web 共用的 React 界面（v4 会话界面）
packages/shared/           # v4 协议定义（rows / command / transport）
packages/services/         # 桌面 host 侧服务（含未接线的 gitCheckpointService）
docs/                      # Zcode-Pro 项目文档（上游 README 也在此）
```

## 与上游同步

```bash
git fetch upstream
git checkout main && git merge upstream/main
# 解决冲突后：增强相关文件均为"新增块"，冲突面预期很小
```

详见 [docs/UPSTREAM-SYNC.md](docs/UPSTREAM-SYNC.md)。

## 致谢

- [zai-org/ZCode](https://github.com/zai-org/ZCode) —— 本项目的全部基础（Apache-2.0）
- [Kilo Code](https://github.com/Kilo-Org/kilo) —— 快照/回滚交互的设计参照（Apache-2.0 系）
