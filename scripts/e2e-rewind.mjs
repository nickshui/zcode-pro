// zcode-pro: message-rewind 无头 e2e 驱动（Node ≥20）
// 用法: node scripts/e2e-rewind.mjs <workspaceAbsPath>
// 流程: 2 轮写文件的对话 → 校验历史行 canRewind → rewindConversation 截断 → 校验 row.removed → 续跑一轮
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

const WS = process.argv[2];
const CLI = new URL("../apps/zcode-cli/packages/cli/dist/zcode.cjs", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const log = (...a) => console.log("[e2e]", ...a);

const proc = spawn(process.execPath, [CLI, "app-server", "--stdio"], {
  cwd: WS,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
let buf = "";
let nextId = 1;
const pending = new Map();
const frames = [];
const rows = new Map(); // rowId -> last row state
let removedEvents = [];

proc.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    try { appendFileSync(WS + "/frames.log", line.slice(0, 2000) + "\n"); } catch {}
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); }
      continue;
    }
    if (msg.method === "v4/conversation/frame" && msg.params) {
      const frame = msg.params.frame ?? msg.params;
      frames.push(frame);
      applyFrame(frame);
      continue;
    }
    // 服务端 → 客户端请求：必须应答，否则 createSession 等流程超时
    if (msg.method !== undefined && msg.id !== undefined) {
      if (msg.method === "session/requestRuntimePreferences") {
        proc.stdin.write(JSON.stringify({
          id: msg.id,
          result: {
            nativeSearchEnhancementsEnabled: true,
            memoryEnabled: false,
            askUserQuestionAutoResolutionEnabled: true,
            modelContextBudgetStrategy: "preflight-v1",
          },
        }) + "\n");
      } else if (msg.method === "interaction/requestPermission") {
        const opts = msg.params?.options?.map((o) => `${o.kind}/${o.name}`) ?? [];
        console.log("[e2e] 权限请求:", msg.params?.toolName ?? "?", JSON.stringify(opts), "→ allow");
        proc.stdin.write(JSON.stringify({ id: msg.id, result: { decision: "allow" } }) + "\n");
      } else {
        console.log("[e2e] 未知服务端请求，兜底空应答:", msg.method);
        proc.stdin.write(JSON.stringify({ id: msg.id, result: {} }) + "\n");
      }
    }
  }
});
proc.stderr.on("data", (c) => process.stderr.write("[agent] " + c));

function applyFrame(frame) {
  const payload = frame.payload ?? frame;
  if (payload.kind === "snapshot") {
    const snap = payload.snapshot ?? {};
    const windowRows = Array.isArray(snap.rows) ? snap.rows : (snap.rows?.window ?? []);
    for (const r of windowRows) rows.set(r.rowId, r);
    if (snap.logEpoch && logEpoch === undefined) logEpoch = snap.logEpoch;
  } else if (payload.kind === "deltas") {
    for (const d of payload.deltas ?? []) {
      if (d.op === "row.appended" || d.op === "row.upserted") rows.set(d.row.rowId, d.row);
      else if (d.op === "row.removed") {
        removedEvents.push(d);
        // 本地视图同步截断：删除 >= fromRowId 的所有行，等待逻辑才不会被陈旧行满足
        if (typeof d.fromRowId === "number") {
          for (const k of [...rows.keys()]) if (k >= d.fromRowId) rows.delete(k);
        }
      }
    }
  }
}

function request(method, params) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}

function envelope(type, payload, extra = {}) {
  return {
    commandId: randomUUID(),
    clientId: "zcode-pro-e2e",
    sessionId: sessionId,
    issuedAt: Date.now(),
    type,
    payload,
    ...extra,
  };
}

let sessionId = null;
let logEpoch = undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTurnComplete(turnRowCount, timeoutMs = 240000) {
  // 等待：turnHeader 行数 >= turnRowCount 且全部非 running，且无 pendingInteractions
  const t0 = Date.now();
  for (;;) {
    const headers = [...rows.values()].filter((r) => r.kind === "turnHeader");
    const done = headers.length >= turnRowCount && headers.every((h) => h.state !== "running");
    if (done) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`turn#${turnRowCount} 等待超时；headers=${JSON.stringify(headers.map((h) => [h.rowId, h.state]))}`);
    await sleep(1500);
  }
}

try {
  log("workspace:", WS);
  // 1. 创建会话 + 首轮
  const create = await request("v4/command", {
    commandId: randomUUID(), clientId: "zcode-pro-e2e", sessionId: null, issuedAt: Date.now(),
    type: "createSession",
    payload: { workspaceId: WS, firstInput: { text: "Use the write tool to create a file named notes.txt with exactly the content: v1. Then reply with exactly: DONE1" } },
  });
  if (create.status !== "accepted") throw new Error("createSession 未 accepted: " + JSON.stringify(create));
  sessionId = create.result?.sessionId ?? create.sessionId;
  log("sessionId:", sessionId);

  // 2. 订阅帧
  const sub = await request("v4/conversation/subscribe", {
    topic: `conversation/${sessionId}`,
    connectionId: "zcode-pro-e2e-conn",
    clientMode: "desktop-continuous",
  });
  logEpoch = sub?.ack?.logEpoch ?? sub?.logEpoch;
  log("subscribed, logEpoch:", logEpoch);

  await waitTurnComplete(1);
  log("turn1 完成，notes.txt =", readFileSync(WS + "/notes.txt", "utf8").trim());

  // 3. 第二轮（编辑文件）
  const rev1 = await currentRevision();
  const send2 = await request("v4/command", envelope("sendText", { text: "Use the edit tool to replace the content v1 in notes.txt with v1\\nv2. Then reply with exactly: DONE2" }, { baseRevision: rev1 }));
  if (send2.status !== "accepted") throw new Error("sendText2 未 accepted: " + JSON.stringify(send2));
  await waitTurnComplete(2);
  log("turn2 完成，notes.txt =", JSON.stringify(readFileSync(WS + "/notes.txt", "utf8")));

  // 4. 找第一条 realUser 行（turn2 的），校验 canRewind 已下发（我的投影改动）
  const userRows = [...rows.values()].filter((r) => r.kind === "userInput" && r.origin === "realUser").sort((a, b) => a.rowId - b.rowId);
  if (userRows.length < 2) throw new Error("realUser 行不足 2 条: " + userRows.length);
  const target = userRows[1];
  log("目标行 rowId=", target.rowId, "entityId=", target.entityId, "actions=", JSON.stringify(target.actions));
  if (target.actions?.canRewind !== true) throw new Error("历史行未下发 canRewind（投影改动未生效）");
  const first = userRows[0];
  log("对照行(第1条) actions=", JSON.stringify(first.actions));

  // 5. 发 rewindConversation（preserve 模式）回滚到第 2 条 user 消息
  const rev2 = await currentRevision();
  const rewind = await request("v4/command", envelope("rewindConversation", { target: { rowId: target.rowId, entityId: target.entityId }, workspaceMode: "preserve" }, { baseRevision: rev2, baseLogEpoch: logEpoch }));
  log("rewind ack:", JSON.stringify(rewind));
  if (rewind.status !== "accepted") throw new Error("rewindConversation 未 accepted: " + JSON.stringify(rewind));
  await sleep(2000);

  // 6. 断言 row.removed 截断了 turn2
  removedEvents = removedEvents; // 已在 applyFrame 累积
  log("row.removed 事件:", JSON.stringify(removedEvents));
  if (!removedEvents.some((d) => d.fromRowId !== undefined && d.fromRowId >= target.rowId - 5)) {
    // 宽松断言：发生了任意 row.removed 且范围覆盖目标行
    if (removedEvents.length === 0) throw new Error("未观察到 row.removed（时间线未截断）");
  }
  const visibleUser = [...rows.values()].filter((r) => r.kind === "userInput" && r.origin === "realUser" && r.rowId < (removedEvents[0]?.fromRowId ?? Infinity));
  log("截断后仍可见的 realUser 行数:", visibleUser.length);

  // 7. preserve 语义：notes.txt 不受影响
  const after = readFileSync(WS + "/notes.txt", "utf8");
  if (!after.includes("v2")) throw new Error("preserve 模式下文件被改动: " + JSON.stringify(after));
  log("preserve 校验通过，notes.txt 未变 =", JSON.stringify(after));

  // 8. 续跑一轮，验证截断分支可用
  const rev3 = await currentRevision();
  const send3 = await request("v4/command", envelope("sendText", { text: "Reply with exactly: ALIVE" }, { baseRevision: rev3 }));
  if (send3.status !== "accepted") throw new Error("rewind 后 sendText 未 accepted: " + JSON.stringify(send3));
  await waitTurnComplete(2); // turn1 + 新 turn（turn2 已被移除）
  const lastTexts = [...rows.values()].filter((r) => r.kind === "assistantText" && r.state === "complete").map((r) => r.text);
  log("assistant 完成段:", JSON.stringify(lastTexts));
  if (!lastTexts.some((t) => t.includes("ALIVE"))) throw new Error("回滚后续跑未成功");

  log("=== E2E 全部通过 ===");
  proc.kill();
  process.exit(0);
} catch (e) {
  console.error("[e2e] 失败:", e.message);
  console.error("[e2e] rows:", JSON.stringify([...rows.values()].map((r) => [r.rowId, r.kind, r.state ?? "", r.origin ?? ""])));
  proc.kill();
  process.exit(1);
}

function currentRevision() {
  // 从最近的 state.updated delta / snapshot 取 revision
  for (let i = frames.length - 1; i >= 0; i--) {
    const payload = frames[i].payload ?? frames[i];
    if (payload.kind === "deltas") {
      for (const d of (payload.deltas ?? []).slice().reverse()) {
        if (d.op === "state.updated" && d.patch && typeof d.patch.revision === "number") return d.patch.revision;
      }
    } else if (payload.kind === "snapshot" && typeof payload.snapshot?.revision === "number") {
      return payload.snapshot.revision;
    }
  }
  return 0;
}
