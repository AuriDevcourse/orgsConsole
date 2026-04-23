import { getAuthedClient } from "../google";
import { readPartnersSheet, type SheetPartner } from "../ltbb-sheet";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_LTBB_CHAT_ID;
if (!TOKEN || !CHAT_ID) {
  console.error("[briefing] TELEGRAM_BOT_TOKEN or TELEGRAM_LTBB_CHAT_ID unset");
  process.exit(1);
}

const EVENT_DATE = "2026-05-05";
const MAX_COLD_LIST = 8;

const tg = async (method: string, body: Record<string, unknown>) => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json()) as { ok: boolean; description?: string };
  if (!data.ok) throw new Error(`tg ${method}: ${data.description}`);
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const daysBetween = (target: string, today: string): number => {
  const ta = new Date(target + "T00:00:00Z").getTime();
  const tb = new Date(today + "T00:00:00Z").getTime();
  return Math.round((ta - tb) / 86_400_000);
};

const shortenStep = (s: string): string =>
  s.replace(/^(URGENT|OVERDUE)\s*(\([^)]+\))?\s*:?\s*/i, "").slice(0, 90);

const copenhagenToday = (): string => {
  const iso = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Copenhagen" });
  return iso.slice(0, 10);
};

const pickOldestFirst = (partners: SheetPartner[]): SheetPartner[] => {
  const scored = partners.map((p) => {
    const m = p.nextStep.match(/(\d+)d\s+(tyla|silent)/i);
    const daysSilent = m ? Number(m[1]) : 0;
    return { p, daysSilent };
  });
  scored.sort((a, b) => b.daysSilent - a.daysSilent);
  return scored.map((x) => x.p);
};

const main = async () => {
  const host = process.env.PUBLIC_HOST || "http://localhost:8000";
  const client = await getAuthedClient("auri", `${host}/oauth/callback`);
  if (!client) {
    console.error("[briefing] Auri not authorized");
    process.exit(1);
  }

  const partners = await readPartnersSheet(client);
  const today = copenhagenToday();
  const daysToEvent = daysBetween(EVENT_DATE, today);

  const urgent = pickOldestFirst(partners.filter((p) => /URGENT/i.test(p.nextStep)));
  const overdue = pickOldestFirst(partners.filter((p) => /OVERDUE/i.test(p.nextStep)));
  const coldReady = partners.filter(
    (p) => p.status === "Nesusiekta" && p.email && p.email.includes("@"),
  );

  const byStatus: Record<string, number> = {};
  for (const p of partners) {
    const key = p.status || "(empty)";
    byStatus[key] = (byStatus[key] || 0) + 1;
  }

  const lines: string[] = [];
  const eventTag =
    daysToEvent > 0 ? `${daysToEvent}d to event` :
    daysToEvent === 0 ? "EVENT TODAY" :
    `${-daysToEvent}d after event`;
  lines.push(`<b>LTBB · ${eventTag} · ${today}</b>`);
  lines.push("");

  if (urgent.length) {
    lines.push(`<b>URGENT (${urgent.length}):</b>`);
    for (const p of urgent) {
      lines.push(` · <b>${esc(p.company)}</b> — ${esc(shortenStep(p.nextStep))}`);
    }
    lines.push("");
  }

  if (overdue.length) {
    lines.push(`<b>OVERDUE (${overdue.length}):</b>`);
    for (const p of overdue) {
      lines.push(` · <b>${esc(p.company)}</b> — ${esc(shortenStep(p.nextStep))}`);
    }
    lines.push("");
  }

  if (coldReady.length) {
    const show = coldReady.slice(0, MAX_COLD_LIST);
    const names = show.map((p) => p.company).join(", ");
    const extra = coldReady.length > MAX_COLD_LIST ? ` (+${coldReady.length - MAX_COLD_LIST} more)` : "";
    lines.push(`<b>COLD LEADS READY (${coldReady.length}):</b>`);
    lines.push(` ${esc(names)}${extra}`);
    lines.push("");
  }

  if (!urgent.length && !overdue.length) {
    lines.push(`<i>Clear queue · nothing flagged urgent.</i>`);
    lines.push("");
  }

  const statusOrder = ["Sutiko", "Derimasi", "Laukiama atsakymo", "Nesusiekta", "Nenori"];
  const statusLine = statusOrder
    .filter((s) => byStatus[s])
    .map((s) => `${esc(s)}: ${byStatus[s]}`)
    .join("  ·  ");
  if (statusLine) {
    lines.push(`<i>Pipeline:</i> ${statusLine}`);
  }

  await tg("sendMessage", {
    chat_id: CHAT_ID,
    text: lines.join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  console.log(
    `[briefing] posted — urgent=${urgent.length} overdue=${overdue.length} cold=${coldReady.length} total=${partners.length}`,
  );
};

main().catch((e) => {
  console.error("[briefing] fatal:", e);
  process.exit(1);
});
