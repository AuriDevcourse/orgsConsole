import type { OAuth2Client } from "google-auth-library";
import { getServices } from "./google";
import type { Partner } from "./data";

export type PartnerSync = {
  email: string;
  company: string;
  hasSent: boolean;
  hasReceived: boolean;
  lastDate?: string;
  threadId?: string;
};

const oneQuery = async (
  gmail: ReturnType<typeof getServices>["gmail"],
  q: string,
): Promise<{ id?: string; threadId?: string; date?: string }> => {
  const r = await gmail.users.messages.list({ userId: "me", q, maxResults: 1 });
  const msg = r.data.messages?.[0];
  if (!msg?.id) return {};
  const full = await gmail.users.messages.get({
    userId: "me",
    id: msg.id,
    format: "metadata",
    metadataHeaders: ["Date"],
  });
  const date = full.data.payload?.headers?.find((h) => h.name === "Date")?.value ?? undefined;
  return { id: msg.id, threadId: full.data.threadId ?? undefined, date };
};

export const syncPartners = async (
  client: OAuth2Client,
  partners: Partner[],
): Promise<PartnerSync[]> => {
  const { gmail } = getServices(client);
  const out: PartnerSync[] = [];
  for (const p of partners) {
    if (!p.email) continue;
    const email = p.email.trim();
    const sent = await oneQuery(gmail, `to:${email} in:sent`);
    const received = await oneQuery(gmail, `from:${email}`);
    const dates = [sent.date, received.date].filter(Boolean) as string[];
    const lastDate = dates.length
      ? dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
      : undefined;
    out.push({
      email,
      company: p.company,
      hasSent: !!sent.id,
      hasReceived: !!received.id,
      lastDate,
      threadId: received.threadId ?? sent.threadId,
    });
  }
  return out;
};

const extractTemplate = (md: string): { subject: string; body: string } => {
  const section = md.match(/## Šablonas\s*\n([\s\S]+?)(?=\n---|\n##|$)/)?.[1] ?? md;
  const subjectMatch = section.match(/^Tema:\s*(.+)$/m);
  const subject = (subjectMatch?.[1] ?? "LT Big Brother 2026").trim();
  const body = section.replace(/^Tema:.*\n/m, "").trim();
  return { subject, body };
};

const fillPlaceholders = (
  text: string,
  fills: Record<string, string>,
): string => text.replace(/\[([A-ZĄČĘĖĮŠŲŪŽ ]+)\]/g, (full, key) => fills[key] ?? full);

const buildMime = (to: string, subject: string, body: string): string => {
  const utf8Subject = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
  const headers = [
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
  ];
  return headers.join("\r\n") + "\r\n\r\n" + body;
};

export const createDraft = async (
  client: OAuth2Client,
  partner: Partner,
  templateMd: string,
  senderName = "Aurimas",
  programLead = "Neda",
): Promise<{ draftId: string; threadId?: string; subject: string; bodyPreview: string }> => {
  if (!partner.email) throw new Error("partner has no email");
  const { gmail } = getServices(client);
  const { subject, body } = extractTemplate(templateMd);
  const filledBody = fillPlaceholders(body, {
    VARDAS: senderName,
    "ĮMONĖ": partner.company,
    "VADOVĖ": programLead,
  });
  const filledSubject = fillPlaceholders(subject, { "ĮMONĖ": partner.company });
  const mime = buildMime(partner.email, filledSubject, filledBody);
  const raw = Buffer.from(mime, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const r = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } },
  });
  return {
    draftId: r.data.id ?? "",
    threadId: r.data.message?.threadId ?? undefined,
    subject: filledSubject,
    bodyPreview: filledBody.slice(0, 280),
  };
};

export const sendDraft = async (
  client: OAuth2Client,
  draftId: string,
): Promise<{ messageId: string; threadId: string }> => {
  const { gmail } = getServices(client);
  const r = await gmail.users.drafts.send({
    userId: "me",
    requestBody: { id: draftId },
  });
  return {
    messageId: r.data.id ?? "",
    threadId: r.data.threadId ?? "",
  };
};
