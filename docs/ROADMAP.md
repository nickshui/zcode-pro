# Zcode-Pro 路线图

## 主线：任意消息级回滚（对齐 Kilo Code 体验）

### Phase 1 —— 任意消息对话回滚（纯加法）✅ 完成（e2e + GUI 视觉验收通过）

无头 e2e：`node scripts/e2e-rewind.mjs <工作区绝对路径>`（直连 app-server stdio 走 v4 协议，
覆盖 createSession/sendText/rewind/续跑全链路）。

GUI 视觉验收（dev 桌面 + computer-use 实点，2026-10-09）：
- 历史行渲染"回滚到此/回滚对话和文件"且无"编辑"（latest-only 语义未破坏）
- 撤销 → 横幅"已还原 N 条消息"+文件状态+窗口提示+原提问（含附件）回填输入框
- 重做 → 横幅消失、全部消息回归；此前一次"重做无效"系半崩溃 dev 编排留下的
  旧 agent 进程所致（干净重启后消失），代码本身无缺陷

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

### Phase 3 —— 撤销/重做闭环 ✅ 完成（e2e：redo 恢复 3 消息 + 2 文件变更）

实现（对齐 Kilo /undo /redo 语义）：
- **undo 日志**（durable sidecar，`~/.zcode/cli/snapshots/<ws>/undo-journal/`）：
  每次 rewindConversation 前采集撤销点——当时的 revert 状态、工作区整树 hash、
  active 消息数；新 prompt 开始即作废（Kilo 同款窗口语义）
- **redo（unrewindConversation 命令）**：恢复撤销点 = setRevert/clearRevert 回滚
  分支状态（消息 append-only，前缀恢复即整分支回归）→ 撤销时动过文件则整树恢复
  到 pre-undo 快照 → 落 `RewindReverted` 事件 → 强制投影 rehydrate
- **投影回归**：冷合并抑制被撤销的 RewindTriggered（视为从未发生），durable
  transcript 按恢复后的 revert 状态重建完整分支；publisher.rehydrate 把现有订阅
  标记 resync，客户端收到全新快照——被截断的消息行（含工具/子 agent 行）全部回归
- **UI**：撤销后横幅（"已还原 N 条消息" + 文件状态 + 重做按钮 + 窗口提示），
  被撤销的原提问回填输入框（"打回最初发送状态"）
- e2e 断言：redo 后 DONE2 回归 + notes.txt 恢复 pre-undo 状态 + 新消息后 redo 被拒

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
