# Zcode-Pro 路线图

## 主线：任意消息级回滚（对齐 Kilo Code 体验）

### Phase 1 —— 任意消息对话回滚（纯加法）✅ 完成（e2e 通过）

无头 e2e：`node scripts/e2e-rewind.mjs <工作区绝对路径>`（直连 app-server stdio 走 v4 协议，
覆盖 createSession/sendText/rewind/续跑全链路）。

目标：GUI 任意 user 消息行 hover 出现"回滚到此消息"按钮，点击后该消息之后的所有
对话被截断（branch cut 软删除，可冷恢复），工作区文件保持不变（`workspaceMode=preserve`）。

改动集（全部为新增，不触碰既有守卫）：

- 协议：`rows.ts` actions 新增 `canRewind`；`command.ts` 新增 `rewindConversation`
- agent：`product-projection.ts` 为全部 active-chain user 行下发 `canRewind`；
  `resolveRowActionTarget` 新增 `rewindConversation` 分支；新 handler 调
  core 现成的 `rewindConversationToMessage()`
- UI：`ConversationRowView` 按钮 → `ConversationTurnGroup` 条件透传 →
  `SessionPane.dispatchCommand("rewindConversation")` → 复用
  `ConversationFileRewindDialog` 作确认弹窗
- core：**零改动**

### Phase 2 —— agent 侧 shadow git 全仓快照 ✅ 完成（e2e 通过：bash 追加被整树回滚）

实现：`core/src/runtime/methods/turn-workspace-snapshot.ts`——每个真实用户轮开始
（用户消息持久化后、工具执行前）以临时 `GIT_INDEX_FILE` + `git add -A` +
`write-tree` 拍 content-addressed 快照，关联存进影子仓（`~/.zcode/cli/snapshots/
<sha1(workspace)>`）自身的 `refs/zcode-pro/turnsnap/<sessionId>/<messageId>`——
自描述、跨重启、不进 CheckpointCreated 事件流（避免污染既有 edit/retry 级联预检）。
回滚：`diff-tree` 目标树与当前树，A→删除、M/D→`read-tree + checkout-index` 恢复。
UI：user 行第二个按钮"回滚对话和文件"（FileClock 图标）。

方案：将 `packages/services/src/git/repo/gitCheckpointRepo.ts`（临时
`GIT_INDEX_FILE` + `write-tree` + hidden ref，不污染用户 git）移植为 CLI agent
core 内的 checkpoint 后端，在工具批次边界做全仓快照，与现有
`CheckpointCreated` 事件机制并轨。

为什么不用桌面侧 `gitCheckpointService`：事务边界闭合不了（回滚正确性依赖
单进程内"停后台任务 → 恢复文件 → 提交 branch cut"的原子序），且桌面只能从
投影帧反推 turn 边界，存在部分写入竞态。详见设计文档。

### Phase 3 —— 两阶段回滚 + redo（借鉴 Kilo）

- revert 时**先拍当前快照再回滚**，redo（unrevert）整树还原
- 对话截断惰性化：先标记隐藏、下一条 prompt 时才真正清理（ZCode 的 branch cut
  软删除天然适配）
- 回滚 banner：展示被撤销的文件 +/- 统计（解析 diff）

### Phase 4 —— 回流上游（可选）

每个 Phase 保持独立 PR 粒度，向 `zai-org/ZCode` 提交。核心论点：core 原语
已存在，这是"补 UI 入口"而非架构变更；latest-only 守卫保持不动。

## 副线（备选池，暂不动工）

- 行级 `canRewind` 与 `canRewindFiles` 的组合入口（一次点击同时回滚对话+文件）
- 回滚点导航面板（会话内 checkpoint 时间线）
- 快照存储 GC 策略（对齐 Kilo 的每小时 `git gc --prune=7.days`）

## 明确不做

- 修改 `editUserQuery` / `retryTurn` 的 latest-only 守卫（破坏上游产品语义与 e2e）
- 桌面侧调用 `gitCheckpointService` 做回滚真值源（见 Phase 2 说明）
- 任何对既有命令行为/协议字段的修改
