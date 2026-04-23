import { getAuthedClient } from "../google";
import { sendDraft } from "../ltbb-gmail";
import {
  getAction,
  listActions,
  updateAction,
  type Action,
} from "../ltbb-actions";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_LTBB_CHAT_ID;
if (!TOKEN) {
  console.error("[ltbb-approvals] missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const PUBLIC_HOST = process.env.PUBLIC_HOST || `http://localhost:${process.env.PORT || 8000}`;
const REDIRECT_URI = `${PUBLIC_HOST}/oauth/callback`;
const SAFE_MODE = process.env.SAFE_MODE === "1";
const POLL_TIMEOUT_S = 30;
const ENQUEUE_CHECK_MS = 5_000;
const STATE_PATH = "./data/ltbb-approvals.json";

type DaemonState = { lastUpdateId: number };

const loadDaemonState = async (): Promise<DaemonState> => {
  try {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(STATE_PATH, "utf-8")) as DaemonState;
  } catch {
    return { lastUpdateId: 0 };
  }
};

const saveDaemonState = async (s: DaemonState) => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(s, null, 2));
};

const tg = async (method: string, body: Record<string, unknown>) => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!data.ok) throw new Error(`tg ${method}: ${data.description}`);
  return data.result;
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const approvalKeyboard = (actionId: string) => ({
  inline_keyboard: [[
    { text: "Approve & Send", callback_data: `approve:${actionId}` },
    { text: "Reject", callback_data: `reject:${actionId}` },
  ]],
});

const formatActionMessage = (a: Action): string => {
  const lines = [
    `<b>LTBB outreach proposal</b>`,
    `Project: <code>${esc(a.project)}</code>`,
    `To: <b>${esc(a.partnerCompany || a.partnerEmail)}</b> &lt;${esc(a.partnerEmail)}&gt;`,
    `Subject: ${esc(a.subject)}`,
    `Proposed by: ${esc(a.proposedBy)}`,
    ``,
    `━━━`,
    esc(a.bodyPreview || "(no preview)"),
    `━━━`,
  ];
  if (a.reasoning) {
    lines.push(``, `<i>Reasoning:</i> ${esc(a.reasoning)}`);
  }
  lines.push(``, `<i>Edit the draft in Gmail Drafts before approving if needed.</i>`);
  return lines.join("\n");
};

const announceAction = async (a: Action) => {
  if (!CHAT_ID) {
    console.error("[ltbb-approvals] TELEGRAM_LTBB_CHAT_ID not set — cannot announce");
    return;
  }
  try {
    const res = (await tg("sendMessage", {
      chat_id: CHAT_ID,
      text: formatActionMessage(a),
      parse_mode: "HTML",
      reply_markup: approvalKeyboard(a.id),
    })) as { message_id: number };
    await updateAction(a.id, { telegramMsgId: res.message_id });
    console.log(`[ltbb-approvals] announced ${a.id} → msg ${res.message_id}`);
  } catch (e) {
    console.error(`[ltbb-approvals] announce ${a.id} failed:`, (e as Error).message);
  }
};

const scanAndAnnounce = async () => {
  const pending = await listActions({ status: "pending" });
  for (const a of pending) {
    if (a.telegramMsgId) continue;
    await announceAction(a);
  }
};

const editMsg = async (msgId: number, html: string) => {
  if (!CHAT_ID) return;
  await tg("editMessageText", {
    chat_id: CHAT_ID,
    message_id: msgId,
    text: html,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [] },
  }).catch(() => {});
};

const handleApprove = async (a: Action) => {
  if (SAFE_MODE) {
    await updateAction(a.id, {
      status: "sent_simulated",
      decidedAt: new Date().toISOString(),
      result: { messageId: "SIMULATED", threadId: "SIMULATED" },
    });
    if (a.telegramMsgId) {
      await editMsg(
        a.telegramMsgId,
        `<b>Approved (SAFE_MODE · not actually sent)</b>\nTo: ${esc(a.partnerCompany || a.partnerEmail)}\nSubject: ${esc(a.subject)}`,
      );
    }
    console.log(`[ltbb-approvals] approved ${a.id} (SAFE_MODE · no Gmail send)`);
    return;
  }
  const client = await getAuthedClient("auri", REDIRECT_URI);
  if (!client) {
    await updateAction(a.id, {
      status: "failed",
      decidedAt: new Date().toISOString(),
      result: { error: "Auri Google account not authorized" },
    });
    if (a.telegramMsgId) {
      await editMsg(a.telegramMsgId, `Rejected: Auri Gmail not authorized. Run OAuth flow first.`);
    }
    return;
  }
  try {
    const res = await sendDraft(client, a.draftId);
    await updateAction(a.id, {
      status: "sent",
      decidedAt: new Date().toISOString(),
      result: { messageId: res.messageId, threadId: res.threadId },
    });
    if (a.telegramMsgId) {
      await editMsg(
        a.telegramMsgId,
        `<b>Sent</b> to ${esc(a.partnerCompany || a.partnerEmail)}\nSubject: ${esc(a.subject)}`,
      );
    }
    console.log(`[ltbb-approvals] sent ${a.id} → ${a.partnerEmail}`);
  } catch (e) {
    const msg = (e as Error).message;
    await updateAction(a.id, {
      status: "failed",
      decidedAt: new Date().toISOString(),
      result: { error: msg },
    });
    if (a.telegramMsgId) {
      await editMsg(a.telegramMsgId, `Send failed: ${esc(msg)}`);
    }
  }
};

const handleReject = async (a: Action) => {
  await updateAction(a.id, {
    status: "rejected",
    decidedAt: new Date().toISOString(),
  });
  if (a.telegramMsgId) {
    await editMsg(
      a.telegramMsgId,
      `<b>Rejected</b> · ${esc(a.partnerCompany || a.partnerEmail)}\nSubject: ${esc(a.subject)}`,
    );
  }
  console.log(`[ltbb-approvals] rejected ${a.id}`);
};

const handleCallback = async (cb: any) => {
  const data = cb.data as string;
  await tg("answerCallbackQuery", { callback_query_id: cb.id }).catch(() => {});
  const [verb, actionId] = data.split(":");
  if (!actionId) return;
  const action = await getAction(actionId);
  if (!action) {
    if (cb.message?.message_id) {
      await editMsg(cb.message.message_id, `<i>Action ${esc(actionId)} not found.</i>`);
    }
    return;
  }
  if (action.status !== "pending") {
    if (cb.message?.message_id) {
      await editMsg(
        cb.message.message_id,
        `<i>Already ${esc(action.status)}. No action taken.</i>`,
      );
    }
    return;
  }
  if (verb === "approve") {
    await handleApprove(action);
  } else if (verb === "reject") {
    await handleReject(action);
  }
};

const handleTextMessage = async (msg: any) => {
  const text = (msg.text as string | undefined)?.trim();
  const chatId = msg.chat?.id;
  if (!text || !chatId) return;

  if (text === "/chatid" || text.startsWith("/chatid@")) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `Chat ID: <code>${chatId}</code>\nSet TELEGRAM_LTBB_CHAT_ID=${chatId} and restart the daemon.`,
      parse_mode: "HTML",
    });
    return;
  }

  if (!CHAT_ID || String(chatId) !== String(CHAT_ID)) return;

  if (text === "/pending") {
    const pending = await listActions({ status: "pending" });
    await tg("sendMessage", {
      chat_id: chatId,
      text: pending.length
        ? `${pending.length} pending:\n` + pending.map((a) => `• ${a.id} → ${a.partnerCompany || a.partnerEmail}`).join("\n")
        : "No pending actions.",
    });
    return;
  }

  if (text === "/status") {
    const all = await listActions();
    const by: Record<string, number> = {};
    for (const a of all) by[a.status] = (by[a.status] || 0) + 1;
    const summary = Object.entries(by).map(([k, v]) => `${k}: ${v}`).join(" · ") || "empty";
    await tg("sendMessage", { chat_id: chatId, text: `Queue: ${summary}` });
    return;
  }

  if (text === "/help" || text === "/start") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Commands:\n/chatid — show this chat's id\n/pending — list pending actions\n/status — queue counts",
    });
  }
};

const pollUpdates = async () => {
  const state = await loadDaemonState();
  while (true) {
    try {
      const updates = (await tg("getUpdates", {
        offset: state.lastUpdateId + 1,
        timeout: POLL_TIMEOUT_S,
        allowed_updates: ["message", "callback_query"],
      })) as any[];
      for (const u of updates) {
        state.lastUpdateId = u.update_id;
        if (u.callback_query) await handleCallback(u.callback_query);
        else if (u.message) await handleTextMessage(u.message);
        await saveDaemonState(state);
      }
    } catch (e) {
      console.error("[ltbb-approvals] poll error:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
};

const announceLoop = async () => {
  while (true) {
    try {
      if (CHAT_ID) await scanAndAnnounce();
    } catch (e) {
      console.error("[ltbb-approvals] scan error:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, ENQUEUE_CHECK_MS));
  }
};

const main = async () => {
  console.log(
    `[ltbb-approvals] started — chat=${CHAT_ID ?? "(unset, /chatid only)"} host=${PUBLIC_HOST} safe_mode=${SAFE_MODE}`,
  );
  await Promise.all([announceLoop(), pollUpdates()]);
};

main().catch((e) => {
  console.error("[ltbb-approvals] fatal:", e);
  process.exit(1);
});
