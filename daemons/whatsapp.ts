import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from "baileys";
import qrcode from "qrcode-terminal";
import QR from "qrcode";
import pino from "pino";

const AUTH_DIR = "./credentials/whatsapp";
const DATA_PATH = "./data/whatsapp.json";
const QR_PNG_PATH = "./data/whatsapp-qr.png";
const GROUP_NAME_FRAGMENT = (process.env.WA_GROUP || "ai workshops").toLowerCase();
const MAX_MESSAGES = 500;
const CTRL_PORT = Number(process.env.WA_CTRL_PORT) || 8787;

type StoredMessage = {
  id: string;
  from: string;
  name?: string;
  text: string;
  ts: number;
  fromMe: boolean;
};

type Store = {
  connected: boolean;
  group?: string;
  groupJid?: string;
  lastSync?: string;
  error?: string;
  qrPending?: boolean;
  qrUpdatedAt?: string;
  messages: StoredMessage[];
};

const loadStore = async (): Promise<Store> => {
  try {
    return JSON.parse(await readFile(DATA_PATH, "utf-8")) as Store;
  } catch {
    return { connected: false, messages: [] };
  }
};

const saveStore = async (s: Store) => {
  await mkdir(dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(s, null, 2));
};

const extractText = (msg: unknown): string => {
  const m = msg as Record<string, unknown> | null;
  if (!m) return "";
  const any = m as any;
  return (
    any.conversation ??
    any.extendedTextMessage?.text ??
    any.imageMessage?.caption ??
    any.videoMessage?.caption ??
    any.documentMessage?.caption ??
    ""
  );
};

let store: Store;
let sock: WASocket | null = null;

const resolveGroup = async (s: WASocket): Promise<{ jid: string; name: string } | null> => {
  const groups = await s.groupFetchAllParticipating();
  for (const [jid, meta] of Object.entries(groups)) {
    const name = (meta as { subject?: string }).subject ?? "";
    if (name.toLowerCase().includes(GROUP_NAME_FRAGMENT)) {
      return { jid, name };
    }
  }
  return null;
};

const start = async () => {
  store = await loadStore();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "warn" }) as any,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      console.log("\n[whatsapp] scan this QR on your phone (WhatsApp → Settings → Linked Devices):\n");
      qrcode.generate(qr, { small: true });
      await mkdir(dirname(QR_PNG_PATH), { recursive: true });
      await QR.toFile(QR_PNG_PATH, qr, { width: 320, margin: 2 });
      store.qrPending = true;
      store.qrUpdatedAt = new Date().toISOString();
      store.connected = false;
      await saveStore(store);
    }
    if (connection === "open") {
      console.log("[whatsapp] connected");
      store.qrPending = false;
      const g = await resolveGroup(sock!);
      if (!g) {
        store.connected = true;
        store.error = `no group matched "${GROUP_NAME_FRAGMENT}"`;
        console.error("[whatsapp]", store.error);
      } else {
        store.connected = true;
        store.group = g.name;
        store.groupJid = g.jid;
        store.error = undefined;
        store.lastSync = new Date().toISOString();
        console.log(`[whatsapp] watching group: ${g.name} (${g.jid})`);
      }
      await saveStore(store);
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`[whatsapp] closed (code=${code}) — ${loggedOut ? "logged out; delete credentials/whatsapp and re-run" : "reconnecting"}`);
      store.connected = false;
      store.error = loggedOut ? "logged out — re-scan QR" : `reconnecting (code ${code})`;
      await saveStore(store);
      if (!loggedOut) setTimeout(start, 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    if (!store.groupJid) return;
    let dirty = false;
    for (const m of messages) {
      if (m.key.remoteJid !== store.groupJid) continue;
      const text = extractText(m.message).trim();
      if (!text) continue;
      const participant = m.key.participant ?? m.key.remoteJid ?? "";
      store.messages.push({
        id: m.key.id ?? String(Date.now()),
        from: participant,
        name: m.pushName ?? undefined,
        text,
        ts: Number(m.messageTimestamp ?? Math.floor(Date.now() / 1000)),
        fromMe: !!m.key.fromMe,
      });
      dirty = true;
    }
    if (dirty) {
      if (store.messages.length > MAX_MESSAGES) {
        store.messages = store.messages.slice(-MAX_MESSAGES);
      }
      store.lastSync = new Date().toISOString();
      await saveStore(store);
    }
  });
};

start().catch((e) => {
  console.error("[whatsapp] fatal:", e);
  process.exit(1);
});

Bun.serve({
  port: CTRL_PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/send" && req.method === "POST") {
      if (!sock || !store?.connected || !store.groupJid) {
        return Response.json({ error: "whatsapp not connected" }, { status: 503 });
      }
      const body = (await req.json().catch(() => null)) as { text?: string } | null;
      const text = body?.text?.trim();
      if (!text) return Response.json({ error: "missing text" }, { status: 400 });
      try {
        const res = await sock.sendMessage(store.groupJid, { text });
        return Response.json({
          ok: true,
          id: res?.key?.id,
          group: store.group,
          ts: new Date().toISOString(),
        });
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500 });
      }
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`[whatsapp] control server on http://127.0.0.1:${CTRL_PORT}`);
