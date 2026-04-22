import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
if (!TOKEN || !CHAT_ID) {
  console.error("[announcer] missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  process.exit(1);
}

const VAULT = process.env.VAULT || "/home/auri/vault";
const SESSIONS_DIR = join(VAULT, "AI Workshop/Sessions");
const STATE_PATH = "./data/announcer.json";
const WHATSAPP_SEND_URL = "http://127.0.0.1:8787/send";
const CHECK_INTERVAL_MS = 60_000;
const POLL_TIMEOUT_S = 30;
const LEAD_DAYS = 7;

type Pending = {
  sessionDate: string;
  draft: string;
  telegramMsgId?: number;
  status: "pending" | "editing";
  createdAt: string;
};

type State = {
  pending: Pending | null;
  sent: Record<string, { sentAt: string; text: string }>;
  lastUpdateId: number;
};

const loadState = async (): Promise<State> => {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf-8")) as State;
  } catch {
    return { pending: null, sent: {}, lastUpdateId: 0 };
  }
};

const saveState = async (s: State) => {
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

const findLatestSessionDate = async (): Promise<string | null> => {
  try {
    const files = await readdir(SESSIONS_DIR);
    const dates = files
      .map((f) => f.match(/#(\d+)\s+SESSION\s+(\d{4}-\d{2}-\d{2})/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => m[2])
      .sort();
    return dates[dates.length - 1] ?? null;
  } catch {
    return null;
  }
};

const addDays = (iso: string, d: number): string => {
  const t = new Date(iso + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

const daysBetween = (a: string, b: string): number => {
  const ta = new Date(a + "T00:00:00Z").getTime();
  const tb = new Date(b + "T00:00:00Z").getTime();
  return Math.round((ta - tb) / 86_400_000);
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const computeNextSessionDate = async (): Promise<string | null> => {
  const latest = await findLatestSessionDate();
  if (!latest) return null;
  let next = latest;
  const today = todayISO();
  while (daysBetween(next, today) < 0) next = addDays(next, 14);
  return next;
};

const formatPretty = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
};

const buildDraft = (sessionDate: string): string =>
  `Hey all 👋

Next AI Workshop is ${formatPretty(sessionDate)} at 12:30.

Who's joining? React 👍 or drop a reply.

Topic ideas welcome too.`;

const approvalKeyboard = () => ({
  inline_keyboard: [[
    { text: "✅ Send", callback_data: "approve" },
    { text: "✏️ Edit", callback_data: "edit" },
    { text: "❌ Cancel", callback_data: "cancel" },
  ]],
});

const sendDraftToTelegram = async (state: State, draft: string, sessionDate: string) => {
  const res = (await tg("sendMessage", {
    chat_id: CHAT_ID,
    text:
      `📣 *AI Workshop reminder ready*\n` +
      `Session: ${formatPretty(sessionDate)} (in ${daysBetween(sessionDate, todayISO())}d)\n\n` +
      `━━━\n${draft}\n━━━\n\n` +
      `Post to WhatsApp group?`,
    parse_mode: "Markdown",
    reply_markup: approvalKeyboard(),
  })) as { message_id: number };
  state.pending = {
    sessionDate,
    draft,
    telegramMsgId: res.message_id,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await saveState(state);
};

const tick = async (state: State) => {
  const next = await computeNextSessionDate();
  if (!next) return;
  if (state.sent[next]) return;
  if (state.pending && state.pending.sessionDate === next) return;
  const daysOut = daysBetween(next, todayISO());
  if (daysOut > LEAD_DAYS) return;
  if (daysOut < 0) return;
  const draft = buildDraft(next);
  console.log(`[announcer] next=${next} daysOut=${daysOut} → drafting`);
  await sendDraftToTelegram(state, draft, next);
};

const postToWhatsApp = async (text: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    const r = await fetch(WHATSAPP_SEND_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = (await r.json()) as { ok?: boolean; error?: string };
    if (!r.ok || data.error) return { ok: false, error: data.error || `status ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
};

const editMsg = async (msgId: number, text: string, withButtons: boolean) => {
  await tg("editMessageText", {
    chat_id: CHAT_ID,
    message_id: msgId,
    text,
    parse_mode: "Markdown",
    ...(withButtons ? { reply_markup: approvalKeyboard() } : { reply_markup: { inline_keyboard: [] } }),
  }).catch(() => {});
};

const handleCallback = async (state: State, cb: any) => {
  const data = cb.data as string;
  const msgId = cb.message?.message_id as number | undefined;
  await tg("answerCallbackQuery", { callback_query_id: cb.id }).catch(() => {});
  if (!state.pending) {
    if (msgId) await editMsg(msgId, "_This draft expired._", false);
    return;
  }
  const pending = state.pending;
  if (data === "approve") {
    const result = await postToWhatsApp(pending.draft);
    if (result.ok) {
      state.sent[pending.sessionDate] = { sentAt: new Date().toISOString(), text: pending.draft };
      state.pending = null;
      await saveState(state);
      if (msgId) {
        await editMsg(
          msgId,
          `✅ *Sent to AI Workshops group*\n\n━━━\n${pending.draft}\n━━━`,
          false,
        );
      }
    } else {
      if (msgId) await tg("sendMessage", { chat_id: CHAT_ID, text: `❌ Send failed: ${result.error}` });
    }
  } else if (data === "cancel") {
    state.sent[pending.sessionDate] = { sentAt: new Date().toISOString(), text: "(cancelled)" };
    state.pending = null;
    await saveState(state);
    if (msgId) await editMsg(msgId, "❌ Cancelled. No reminder this cycle.", false);
  } else if (data === "edit") {
    pending.status = "editing";
    await saveState(state);
    await tg("sendMessage", {
      chat_id: CHAT_ID,
      text: "✏️ Send me the new message text. The next message you send here will replace the draft.",
    });
  }
};

const handleTextMessage = async (state: State, msg: any) => {
  const text = (msg.text as string | undefined)?.trim();
  if (!text) return;
  if (text.startsWith("/")) {
    if (text === "/next") {
      const next = await computeNextSessionDate();
      await tg("sendMessage", {
        chat_id: CHAT_ID,
        text: next
          ? `Next AI Workshop: ${formatPretty(next)} (in ${daysBetween(next, todayISO())}d)`
          : "Could not compute next session (no vault files).",
      });
    } else if (text === "/test") {
      const next = (await computeNextSessionDate()) ?? todayISO();
      await sendDraftToTelegram(state, buildDraft(next), next);
    } else if (text === "/status") {
      await tg("sendMessage", {
        chat_id: CHAT_ID,
        text:
          `pending: ${state.pending ? state.pending.sessionDate : "none"}\n` +
          `sent dates: ${Object.keys(state.sent).join(", ") || "none"}`,
      });
    } else {
      await tg("sendMessage", {
        chat_id: CHAT_ID,
        text: "Commands: /next  /test  /status",
      });
    }
    return;
  }
  if (state.pending?.status === "editing") {
    state.pending.draft = text;
    state.pending.status = "pending";
    await saveState(state);
    if (state.pending.telegramMsgId) {
      await editMsg(
        state.pending.telegramMsgId,
        `📣 *AI Workshop reminder ready* (edited)\n\n━━━\n${text}\n━━━\n\nPost to WhatsApp group?`,
        true,
      );
    }
    await tg("sendMessage", { chat_id: CHAT_ID, text: "Updated draft ↑" });
  }
};

const pollUpdates = async (state: State) => {
  while (true) {
    try {
      const updates = (await tg("getUpdates", {
        offset: state.lastUpdateId + 1,
        timeout: POLL_TIMEOUT_S,
        allowed_updates: ["message", "callback_query"],
      })) as any[];
      for (const u of updates) {
        state.lastUpdateId = u.update_id;
        if (u.callback_query) await handleCallback(state, u.callback_query);
        else if (u.message) await handleTextMessage(state, u.message);
        await saveState(state);
      }
    } catch (e) {
      console.error("[announcer] poll error:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
};

const schedulerLoop = async (state: State) => {
  while (true) {
    try {
      await tick(state);
    } catch (e) {
      console.error("[announcer] tick error:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
  }
};

const main = async () => {
  const state = await loadState();
  console.log(
    `[announcer] started — chat=${CHAT_ID} lastUpdate=${state.lastUpdateId} pending=${
      state.pending?.sessionDate ?? "none"
    }`,
  );
  await Promise.all([schedulerLoop(state), pollUpdates(state)]);
};

main().catch((e) => {
  console.error("[announcer] fatal:", e);
  process.exit(1);
});
