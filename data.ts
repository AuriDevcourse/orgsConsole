import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const VAULT = process.env.VAULT || "/home/auri/vault";
const LYS_DIR = join(VAULT, "LYS");
const LTBB_DIR = join(VAULT, "Personal/LT Big Brother");
const AIW_DIR = join(VAULT, "AI Workshop");
const WHATSAPP_DATA = "./data/whatsapp.json";
const LPC_SUMMARY = "./data/lpc-summary.json";

type WAStoredMessage = { id: string; from: string; name?: string; text: string; ts: number; fromMe: boolean };
type WAParticipant = { jid: string; name?: string; admin?: "admin" | "superadmin" | null };
type WAGroupState = {
  fragment?: string;
  jid?: string;
  name?: string;
  participants?: WAParticipant[];
  messages: WAStoredMessage[];
  lastSync?: string;
  error?: string;
};
type WAStore = {
  connected: boolean;
  qrPending?: boolean;
  qrUpdatedAt?: string;
  lastSync?: string;
  error?: string;
  groups: Record<string, WAGroupState>;
  // legacy fields (pre-multi-group daemon)
  group?: string;
  groupJid?: string;
  messages?: WAStoredMessage[];
};

const emptyGroup = (): WAGroupState => ({ messages: [] });

const loadWAStore = async (): Promise<WAStore> => {
  try {
    const raw = JSON.parse(await readFile(WHATSAPP_DATA, "utf-8")) as Partial<WAStore>;
    return {
      connected: !!raw.connected,
      qrPending: raw.qrPending,
      qrUpdatedAt: raw.qrUpdatedAt,
      lastSync: raw.lastSync,
      error: raw.error,
      groups: raw.groups ?? {},
      group: raw.group,
      groupJid: raw.groupJid,
      messages: raw.messages,
    };
  } catch {
    return { connected: false, groups: {} };
  }
};

const readGroup = (store: WAStore, id: string): WAGroupState => {
  const g = store.groups?.[id];
  if (g) return g;
  // Legacy shim: if reading "aiw" and only top-level messages exist, synthesize.
  if (id === "aiw" && store.messages) {
    return {
      jid: store.groupJid,
      name: store.group,
      messages: store.messages,
      lastSync: store.lastSync,
      error: store.error,
    };
  }
  return emptyGroup();
};

export type Task = { text: string; done: boolean; owner?: string; due?: string };
export type Partner = {
  category: string;
  company: string;
  website: string;
  rating: string;
  scandals: string;
  contact: string;
  role: string;
  email: string;
  linkedin: string;
  phone: string;
  note: string;
  status: string;
};

const extractTasks = (md: string, limit = 30): Task[] => {
  const tasks: Task[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*-\s*\[( |x|X)\]\s+(.+)$/);
    if (!m) continue;
    const text = m[2].replace(/\*\*/g, "").trim();
    const ownerMatch = text.match(/@([\w\p{L}-]+)/u);
    const dueMatch = text.match(/\*\*([^*]+)\*\*|IKI\s+([A-ZĄČĘĖĮŠŲŪŽ0-9\s]+)/i);
    tasks.push({
      text,
      done: m[1].toLowerCase() === "x",
      owner: ownerMatch?.[1],
      due: dueMatch?.[1] || dueMatch?.[2]?.trim(),
    });
    if (tasks.length >= limit) break;
  }
  return tasks;
};

const safeRead = async (p: string) => {
  try { return await readFile(p, "utf-8"); } catch { return ""; }
};

export async function getLYS() {
  const weekTasks = await safeRead(join(LYS_DIR, "Savaitės Užduotys.md"));
  const budget = await safeRead(join(LYS_DIR, "Biudžetas ir Finansai.md"));
  const readme = await safeRead(join(LYS_DIR, "README.md"));
  const membersFile = await safeRead(join(LYS_DIR, "Bendruomenės Nariai.md"));

  const tasks = extractTasks(weekTasks);
  const active = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);

  const boardMembers: { role: string; name: string }[] = [];
  const boardMatch = membersFile.match(/### Dabartinė Valdyba[^\n]*\n\n?\| Pozicija \| Narys \|\n\|[-\s|]+\|\n((?:\|[^\n]+\|\n?)+)/);
  if (boardMatch) {
    for (const line of boardMatch[1].split("\n")) {
      const cells = line.split("|").map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
      if (cells.length >= 2 && cells[0] && cells[1]) {
        boardMembers.push({ role: cells[0], name: cells[1] });
      }
    }
  }

  let events: { name: string; date?: string }[] = [];
  try {
    const eventsDir = join(LYS_DIR, "Renginiai");
    const files = await readdir(eventsDir);
    for (const f of files.slice(0, 10)) {
      if (!f.endsWith(".md")) continue;
      const name = f.replace(/\.md$/, "");
      const content = await safeRead(join(eventsDir, f));
      const dm = content.match(/(\d{4}-\d{2}-\d{2})/);
      events.push({ name, date: dm?.[1] });
    }
  } catch {}

  let meetings: { name: string; date: string; path: string }[] = [];
  try {
    const mDir = join(LYS_DIR, "Susitikimai 2025");
    const files = await readdir(mDir);
    for (const f of files.slice(0, 10)) {
      if (!f.endsWith(".md")) continue;
      const s = await stat(join(mDir, f));
      meetings.push({
        name: f.replace(/\.md$/, ""),
        date: s.mtime.toISOString().slice(0, 10),
        path: f,
      });
    }
    meetings.sort((a, b) => b.date.localeCompare(a.date));
  } catch {}

  const budgetMatch = budget.match(/(?:DKK|€|EUR)[\s:]*(\d[\d.,\s]*)/i);
  const fundingAmount = budgetMatch?.[1]?.trim() || "22,800 DKK";

  return {
    name: "Lithuanian Youth Society",
    nameLocal: "Lietuvių Jaunimo Sąjunga (Danija)",
    president: "Aurimas Bačiauskas",
    email: "lithuanian.youth.society@gmail.com",
    boardMembers,
    upcomingEvents: events,
    recentMeetings: meetings.slice(0, 5),
    fundingLabel: "SC finansavimas — panaudoti iki 2026-05-01",
    fundingAmount,
    readmeSnippet: readme.split("\n").slice(0, 6).join("\n"),
  };
}

const parseCSV = (text: string): Partner[] => {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const rows: Partner[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    if (cells.length < 12) continue;
    rows.push({
      category: cells[0] || "",
      company: cells[1] || "",
      website: cells[2] || "",
      rating: cells[3] || "",
      scandals: cells[4] || "",
      contact: cells[5] || "",
      role: cells[6] || "",
      email: cells[7] || "",
      linkedin: cells[8] || "",
      phone: cells[9] || "",
      note: cells[10] || "",
      status: cells[11] || "Nesusisiekta",
    });
  }
  return rows;
};

const parseCSVLine = (line: string): string[] => {
  const cells: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { cells.push(cur); cur = ""; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells;
};

type AIWMember = { name: string; status: string };
type AIWSession = { num: number; date: string; file: string; topic?: string };
type AIWMessage = { id: string; from: string; name?: string; text: string; ts: number; fromMe: boolean };

const parseMembers = (md: string): AIWMember[] => {
  const members: AIWMember[] = [];
  const tableMatch = md.match(/## Members[^\n]*\n+\|[^\n]+\|\n\|[-\s|]+\|\n((?:\|[^\n]+\|\n)+)/);
  if (!tableMatch) return members;
  for (const line of tableMatch[1].split("\n")) {
    const cells = line.split("|").map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cells.length < 2) continue;
    members.push({ name: cells[0], status: cells[1] });
  }
  return members;
};

export async function getAIWorkshop() {
  const readme = await safeRead(join(AIW_DIR, "AI Workshop.md"));
  const growth = await safeRead(join(AIW_DIR, "Community Growth.md"));
  const funding = await safeRead(join(AIW_DIR, "Funding Opportunities.md"));

  const members = parseMembers(readme);

  let sessions: AIWSession[] = [];
  try {
    const files = await readdir(join(AIW_DIR, "Sessions"));
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const m = f.match(/#(\d+)\s+SESSION\s+(\d{4}-\d{2}-\d{2})/);
      if (!m) continue;
      sessions.push({ num: Number(m[1]), date: m[2], file: f });
    }
    sessions.sort((a, b) => b.num - a.num);
  } catch {}

  const actionItemsMatch = readme.match(/## Action Items\n((?:[-*]\s*\[[ x]\][^\n]+\n?)+)/);
  const actionItems = actionItemsMatch ? extractTasks(actionItemsMatch[1], 20) : [];

  const now = Date.now();
  const upcoming = sessions.find((s) => new Date(s.date).getTime() >= now - 86400000);
  const past = sessions.filter((s) => new Date(s.date).getTime() < now);

  let whatsapp: {
    connected: boolean;
    group?: string;
    lastSync?: string;
    messages: AIWMessage[];
    error?: string;
    qrPending?: boolean;
    qrUpdatedAt?: string;
  } = { connected: false, messages: [] };
  try {
    const store = await loadWAStore();
    const g = readGroup(store, "aiw");
    whatsapp = {
      connected: !!store.connected,
      group: g.name,
      lastSync: g.lastSync ?? store.lastSync,
      messages: (g.messages ?? []).slice(-50),
      error: g.error ?? store.error,
      qrPending: !!store.qrPending,
      qrUpdatedAt: store.qrUpdatedAt,
    };
    if (!g.messages?.length && !g.jid && !whatsapp.error) {
      whatsapp.error = "daemon not running (no ./data/whatsapp.json yet)";
    }
  } catch {
    whatsapp.error = "daemon not running (no ./data/whatsapp.json yet)";
  }

  return {
    name: "AI Workshop",
    tagline: "Build with AI. Show what you learned.",
    cadence: "Every second Sunday, 12:30–14:30 (Copenhagen)",
    lumaUrl: "https://luma.com/7s5iruxh?tk=M3vLXU",
    email: "baciauskas.aurimas@gmail.com",
    memberCount: members.length,
    members,
    sessionCount: sessions.length,
    pastSessionCount: past.length,
    upcomingSession: upcoming?.date ?? null,
    nextSessionNum: upcoming?.num ?? null,
    sessions: sessions.slice(0, 8),
    actionItemsPending: actionItems.filter((t) => !t.done).slice(0, 10),
    actionItemsDone: actionItems.filter((t) => t.done).length,
    growthSnippet: growth.split("\n").slice(0, 12).join("\n"),
    fundingSnippet: funding.split("\n").slice(0, 12).join("\n"),
    whatsapp,
  };
}

export async function getLTBB() {
  const csv = await safeRead(join(LTBB_DIR, "LTBB_renginiu_partneriai_2026_verified.csv"));
  const partners = parseCSV(csv);
  const template = await safeRead(join(LTBB_DIR, "Partnerysčių email šablonas 2026.md"));
  const meetingNotes = await safeRead(join(LTBB_DIR, "Meeting with Neda Juronyte.md"));
  const about = await safeRead(join(LTBB_DIR, "About LT Big Brother.md"));

  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const p of partners) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
  }

  const pending = partners.filter(p => p.status === "Nesusisiekta" || !p.status);
  const contacted = partners.filter(p => p.status !== "Nesusisiekta" && p.status);

  const templateMatch = template.match(/## Šablonas\s*\n([\s\S]+?)(?=\n---|\n##|$)/);
  const templateBody = (templateMatch?.[1] || "").trim();

  return {
    name: "LT Big Brother",
    nameLocal: "Mentorspace Lithuania, VšĮ",
    role: "Partner Outreach (volunteer)",
    email: "baciauskas.aurimas@gmail.com",
    partnerContactEmail: "ruta@ltbigbrother.com",
    partners,
    partnersByStatus: byStatus,
    partnersByCategory: byCategory,
    pendingCount: pending.length,
    contactedCount: contacted.length,
    totalCount: partners.length,
    emailTemplate: templateBody,
    aboutSnippet: about.split("\n").slice(0, 12).join("\n"),
    hasHunter: true,
    hasFavro: true,
    onePagerReady: false,
  };
}

// ---- LPC (Lithuania Professionals in Copenhagen) ----

type LPCSummary = {
  refreshedAt: string;
  model?: string;
  events: { title: string; date?: string; details?: string }[];
  topics: { title: string; summary: string }[];
};

const loadLPCSummary = async (): Promise<LPCSummary | null> => {
  try {
    return JSON.parse(await readFile(LPC_SUMMARY, "utf-8")) as LPCSummary;
  } catch {
    return null;
  }
};

export async function getLPC() {
  const store = await loadWAStore();
  const g = readGroup(store, "lpc");
  const summary = await loadLPCSummary();

  const participants = g.participants ?? [];
  const members = participants.map((p) => ({
    name: p.name || p.jid.split("@")[0],
    jid: p.jid,
    role: p.admin === "superadmin" ? "Owner" : p.admin === "admin" ? "Admin" : "Member",
  }));

  const messages = (g.messages ?? []).slice(-100);

  let whatsappError: string | undefined = g.error ?? store.error;
  if (!messages.length && !g.jid && !whatsappError) {
    whatsappError = "daemon not running (no ./data/whatsapp.json yet)";
  }

  return {
    name: "LPC",
    nameLocal: "Lithuania Professionals in Copenhagen",
    whatsapp: {
      connected: !!store.connected && !!g.jid,
      group: g.name,
      lastSync: g.lastSync ?? store.lastSync,
      error: whatsappError,
      qrPending: !!store.qrPending,
      qrUpdatedAt: store.qrUpdatedAt,
      messages,
    },
    memberCount: members.length,
    members,
    summary: summary ?? null,
  };
}
