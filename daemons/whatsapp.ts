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
const CTRL_PORT = Number(process.env.WA_CTRL_PORT) || 8787;
const MAX_MESSAGES = 500;

type GroupConfig = { id: string; fragment: string };

// Default groups. Override with WA_GROUPS="id:fragment,id:fragment" (case-insensitive match on group subject).
const DEFAULT_GROUPS: GroupConfig[] = [
  { id: "aiw", fragment: "ai workshops" },
  { id: "lpc", fragment: "lpc chatas" },
];

const parseGroupsEnv = (raw: string | undefined): GroupConfig[] => {
  if (!raw) return DEFAULT_GROUPS;
  const out: GroupConfig[] = [];
  for (const part of raw.split(",")) {
    const [id, ...rest] = part.split(":");
    const fragment = rest.join(":").trim();
    if (!id || !fragment) continue;
    out.push({ id: id.trim(), fragment: fragment.toLowerCase() });
  }
  return out.length ? out : DEFAULT_GROUPS;
};

const GROUPS = parseGroupsEnv(process.env.WA_GROUPS);

type StoredMessage = {
  id: string;
  from: string;
  name?: string;
  text: string;
  ts: number;
  fromMe: boolean;
};

type Participant = { jid: string; name?: string; admin?: "admin" | "superadmin" | null };

type GroupState = {
  fragment: string;
  jid?: string;
  name?: string;
  participants?: Participant[];
  participantNames?: Record<string, string>;
  messages: StoredMessage[];
  lastSync?: string;
  error?: string;
};

type Store = {
  connected: boolean;
  qrPending?: boolean;
  qrUpdatedAt?: string;
  lastSync?: string;
  error?: string;
  groups: Record<string, GroupState>;
};

const emptyStore = (): Store => {
  const groups: Record<string, GroupState> = {};
  for (const g of GROUPS) groups[g.id] = { fragment: g.fragment, messages: [] };
  return { connected: false, groups };
};

const loadStore = async (): Promise<Store> => {
  try {
    const raw = JSON.parse(await readFile(DATA_PATH, "utf-8")) as Partial<Store> & {
      group?: string;
      groupJid?: string;
      messages?: StoredMessage[];
    };
    const base = emptyStore();
    base.connected = !!raw.connected;
    base.qrPending = raw.qrPending;
    base.qrUpdatedAt = raw.qrUpdatedAt;
    base.lastSync = raw.lastSync;
    base.error = raw.error;
    // Migrate legacy flat format → groups.aiw
    if (!raw.groups && raw.messages && base.groups.aiw) {
      base.groups.aiw.jid = raw.groupJid;
      base.groups.aiw.name = raw.group;
      base.groups.aiw.messages = raw.messages;
    }
    if (raw.groups) {
      for (const [id, gs] of Object.entries(raw.groups)) {
        if (base.groups[id]) {
          base.groups[id] = { ...base.groups[id], ...gs, fragment: base.groups[id].fragment };
        }
      }
    }
    return base;
  } catch {
    return emptyStore();
  }
};

const saveStore = async (s: Store) => {
  await mkdir(dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(s, null, 2));
};

const extractText = (msg: unknown): string => {
  const any = (msg ?? {}) as Record<string, unknown>;
  const a = any as any;
  return (
    a.conversation ??
    a.extendedTextMessage?.text ??
    a.imageMessage?.caption ??
    a.videoMessage?.caption ??
    a.documentMessage?.caption ??
    ""
  );
};

let store: Store;
let sock: WASocket | null = null;

const resolveGroups = async (s: WASocket) => {
  const all = await s.groupFetchAllParticipating();
  const matches: { id: string; jid: string; name: string; meta: any }[] = [];
  for (const g of GROUPS) {
    const hit = Object.entries(all).find(([, meta]) => {
      const name = (meta as { subject?: string }).subject ?? "";
      return name.toLowerCase().includes(g.fragment);
    });
    if (hit) matches.push({ id: g.id, jid: hit[0], name: (hit[1] as any).subject, meta: hit[1] });
  }
  return matches;
};

const updateParticipantsFromMeta = (gs: GroupState, meta: any) => {
  const ps: Participant[] = (meta?.participants ?? []).map((p: any) => ({
    jid: p.id ?? p.jid ?? "",
    name: p.name ?? p.notify ?? undefined,
    admin: (p.admin ?? null) as Participant["admin"],
  }));
  if (ps.length) gs.participants = ps;
};

const jidToGroupId = (jid: string): string | null => {
  for (const [id, gs] of Object.entries(store.groups)) {
    if (gs.jid === jid) return id;
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
      store.connected = true;
      store.error = undefined;
      const matches = await resolveGroups(sock!);
      const matchedIds = new Set(matches.map((m) => m.id));
      for (const m of matches) {
        const gs = store.groups[m.id];
        if (!gs) continue;
        gs.jid = m.jid;
        gs.name = m.name;
        gs.error = undefined;
        gs.lastSync = new Date().toISOString();
        updateParticipantsFromMeta(gs, m.meta);
        console.log(`[whatsapp] watching "${m.name}" as ${m.id} (${m.jid})`);
      }
      for (const g of GROUPS) {
        if (!matchedIds.has(g.id) && store.groups[g.id]) {
          store.groups[g.id].error = `no group matched "${g.fragment}"`;
          console.warn(`[whatsapp] ${store.groups[g.id].error}`);
        }
      }
      store.lastSync = new Date().toISOString();
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

  sock.ev.on("groups.update", async (updates) => {
    let dirty = false;
    for (const upd of updates) {
      if (!upd.id) continue;
      const gid = jidToGroupId(upd.id);
      if (!gid) continue;
      const gs = store.groups[gid];
      if (upd.subject) gs.name = upd.subject;
      dirty = true;
    }
    if (dirty) await saveStore(store);
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    let dirty = false;
    for (const m of messages) {
      const jid = m.key.remoteJid;
      if (!jid) continue;
      const gid = jidToGroupId(jid);
      if (!gid) continue;
      const gs = store.groups[gid];
      const text = extractText(m.message).trim();
      if (!text) continue;
      const participant = m.key.participant ?? m.key.remoteJid ?? "";
      if (m.pushName && participant) {
        gs.participantNames = gs.participantNames ?? {};
        gs.participantNames[participant] = m.pushName;
      }
      gs.messages.push({
        id: m.key.id ?? String(Date.now()),
        from: participant,
        name: m.pushName ?? undefined,
        text,
        ts: Number(m.messageTimestamp ?? Math.floor(Date.now() / 1000)),
        fromMe: !!m.key.fromMe,
      });
      if (gs.messages.length > MAX_MESSAGES) {
        gs.messages = gs.messages.slice(-MAX_MESSAGES);
      }
      gs.lastSync = new Date().toISOString();
      dirty = true;
    }
    if (dirty) {
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

    // POST /send  body: { text, group? } — default group = first configured (aiw)
    if (url.pathname === "/send" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { text?: string; group?: string } | null;
      const text = body?.text?.trim();
      const groupId = body?.group ?? GROUPS[0]?.id;
      if (!text) return Response.json({ error: "missing text" }, { status: 400 });
      if (!groupId || !store?.groups[groupId]) {
        return Response.json({ error: `unknown group "${groupId}"` }, { status: 400 });
      }
      const gs = store.groups[groupId];
      if (!sock || !store.connected || !gs.jid) {
        return Response.json({ error: "whatsapp not connected for that group" }, { status: 503 });
      }
      try {
        const res = await sock.sendMessage(gs.jid, { text });
        return Response.json({
          ok: true,
          id: res?.key?.id,
          group: gs.name,
          groupId,
          ts: new Date().toISOString(),
        });
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500 });
      }
    }

    // GET /status — quick peek at what the daemon sees
    if (url.pathname === "/status") {
      return Response.json({
        connected: store?.connected ?? false,
        groups: Object.fromEntries(
          Object.entries(store?.groups ?? {}).map(([id, gs]) => [
            id,
            { name: gs.name, jid: gs.jid, msgCount: gs.messages.length, error: gs.error, lastSync: gs.lastSync },
          ]),
        ),
      });
    }

    return new Response("not found", { status: 404 });
  },
});
console.log(`[whatsapp] control server on http://127.0.0.1:${CTRL_PORT}`);
console.log(`[whatsapp] watching groups: ${GROUPS.map((g) => `${g.id}="${g.fragment}"`).join(", ")}`);
