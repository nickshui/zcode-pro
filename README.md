# Zcode-Pro

**基于 [zai-org/ZCode](https://github.com/zai-org/ZCode) 开源版增强的 AI 编程工作台**，主打一项上游暂时没有的能力：**任意消息级回滚（Kilo Code 风格的 Checkpoint / Rewind）**——在桌面客户端对话界面上，随时回到任意一条历史消息的"对话原点"，可选同时回滚该消息之后的文件改动。

> 上游基线：`zai-org/ZCode` v3.15.1（tag `v3.15.1`；合并提交见 git 历史）
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

## 构建可安装的桌面客户端

```bash
pnpm bootstrap                                   # 首次：安装依赖 + 准备桌面运行时资产
ZCODE_ENV=production pnpm --dir packages/desktop build
# 产物：packages/desktop/dist/ZCode-<version>-win-x64.exe（交互式 NSIS 安装器）
```

**`ZCODE_ENV=production` 不能省**：不设置时构建链默认按 test 环境处理，
产物会落成 "ZCode Preview" 身份并指向测试后端（见
`packages/desktop/scripts/desktop-product-identity.mjs` 与 `scripts/builtin-provider-config.mjs`）。

也可以不改身份、直接复用现有生产身份；两种方式的差异见下节。

### 本地构建并发布到 GitHub Releases

本地一条命令完成"构建 → 打 tag → 上传安装包到 Draft Release"：

```bash
pnpm release:desktop
```

前置（一次性）：安装 GitHub 官方 CLI 并登录——Release 上传走 HTTP API，
git 的 SSH key 不覆盖这步，必须 `gh auth login`：

```bash
winget install --id GitHub.cli
gh auth login        # 浏览器授权
```

说明：安装包放 **Release 附件**而不是提交进 git 仓库——GitHub 硬性拒绝 >100MB 的
普通文件，Electron 安装包必然超限；Release 附件不受限且不膨胀 clone 体积。
产物为 Draft Release，网页核对后再点 Publish。常用变体：

```bash
pnpm release:desktop -- --skip-build              # 只上传 dist 里现成的 exe
pnpm release:desktop -- --tag pro-v3.15.1-beta.1  # 自定义 tag（默认 pro-v<version>）
```

### 与官方版 ZCode 的共存与数据安全（Windows 实测结论）

安装包默认**按用户安装**到 `%LOCALAPPDATA%\Programs\zcode`，与官方版的
`C:\Program Files\ZCode` 互不写对方目录，"应用与功能"中呈现为两条独立记录。数据层面：

- **不删除、不重写官方数据**：登录态、会话历史、设置存放在共享的
  `%APPDATA%\ZCode` 与 `~/.zcode`，增强版只读取与增量追加；装完即用，无需重新登录。
- **随时可回退**：卸载增强版或重装官方版即可还原官方客户端，卸载过程不清理上述数据目录。
- 两点已知行为（非数据损坏，但需要知晓）：
  1. 同名身份共用单实例锁，增强版与官方版**不能同时运行**；
  2. 打包版连接官方更新线，官方发布更新版本后会被自动更新覆盖回官方构建，
     届时需重新打包安装增强版（或关注本仓库的自动发布流程）。

## 增强能力路线

见 [docs/ROADMAP.md](docs/ROADMAP.md)。当前主线：

| 阶段 | 能力 | 状态 |
| --- | --- | --- |
| Phase 1 | 任意消息**对话回滚**（`rewindConversation` 命令 + 行级 `canRewind` + UI 按钮） | ✅ 完成并通过无头 e2e（`scripts/e2e-rewind.mjs`） |
| Phase 2 | agent 侧 shadow git 全仓快照，覆盖 bash 等一切文件副作用（UI 第二按钮"回滚对话和文件"） | ✅ 完成并通过 e2e（bash 追加被整树回滚） |
| Phase 3 | 撤销/重做闭环：撤销后横幅 + 重做（redo = 撤销从未发生，含文件）+ 原提问回填输入框 | ✅ 完成并通过 e2e（redo 恢复 3 消息 + 2 文件变更） |

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
