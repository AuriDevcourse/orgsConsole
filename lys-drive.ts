import type { OAuth2Client } from "google-auth-library";
import { getServices } from "./google";

export const MEETINGS_FOLDER_ID = "1rfkXnsQ4Y7bpa2IuvzOl2vPOLKya8xeu";

export type MeetingRef = {
  id: string;
  name: string;
  date: string | null;
  modifiedTime: string;
  url: string;
};

export type MeetingContent = {
  ref: MeetingRef;
  attendees: string[];
  pastTasks: string[];
  discussion: { topic: string; notes: string[] }[];
  newTasks: string[];
};

const parseDateFromName = (name: string): string | null => {
  const m = name.match(/^([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const mm = months[m[1]];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[2].padStart(2, "0")}`;
};

export async function listMeetings(
  auth: OAuth2Client,
  limit = 12,
): Promise<MeetingRef[]> {
  const { drive } = getServices(auth);
  const res = await drive.files.list({
    q: `'${MEETINGS_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: limit,
  });
  return (res.data.files ?? [])
    .filter((f) => !/sablonas|template|tik kopijuoti/i.test(f.name ?? ""))
    .map((f) => ({
      id: f.id!,
      name: f.name!,
      date: parseDateFromName(f.name ?? ""),
      modifiedTime: f.modifiedTime!,
      url: `https://docs.google.com/document/d/${f.id}/edit`,
    }));
}

type Para = { style: string; bullet: boolean; text: string };

const flattenDoc = (body: unknown[]): Para[] => {
  const out: Para[] = [];
  for (const el of body as { paragraph?: { elements?: { textRun?: { content?: string } }[]; paragraphStyle?: { namedStyleType?: string }; bullet?: unknown } }[]) {
    const p = el.paragraph;
    if (!p) continue;
    const text = (p.elements ?? [])
      .map((e) => e.textRun?.content ?? "")
      .join("")
      .replace(/\r/g, "")
      .trim();
    if (!text) continue;
    out.push({
      style: p.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT",
      bullet: !!p.bullet,
      text,
    });
  }
  return out;
};

const isHeading = (p: Para) => p.style?.startsWith("HEADING");

const matchSection = (heading: string): string | null => {
  const h = heading.toLowerCase();
  if (h.includes("praeit") && h.includes("užduo")) return "past";
  if (h.includes("praneš") || h.includes("aptarim")) return "discussion";
  if (h.includes("naujos") && h.includes("užduo")) return "new";
  if (h.includes("dalyviai")) return "attendees";
  return null;
};

export async function parseMeeting(
  auth: OAuth2Client,
  ref: MeetingRef,
): Promise<MeetingContent> {
  const { docs } = getServices(auth);
  const doc = await docs.documents.get({ documentId: ref.id });
  const paras = flattenDoc(doc.data.body?.content ?? []);

  const result: MeetingContent = {
    ref,
    attendees: [],
    pastTasks: [],
    discussion: [],
    newTasks: [],
  };

  let section: string | null = null;
  const discussionRaw: string[] = [];

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];

    if (isHeading(p)) {
      section = matchSection(p.text);
      continue;
    }
    if (!section && /^dalyviai/i.test(p.text)) {
      section = "attendees";
      const rest = p.text.replace(/^dalyviai:?/i, "").trim();
      if (rest) result.attendees.push(...splitNames(rest));
      continue;
    }

    if (section === "attendees") {
      result.attendees.push(...splitNames(p.text));
    } else if (section === "past") {
      if (p.text.length > 2) result.pastTasks.push(p.text);
    } else if (section === "new") {
      if (p.text.length > 2 && !/^\d+-?(ma|tra|ta|čia|ia)\s+užduotis$/i.test(p.text))
        result.newTasks.push(p.text);
    } else if (section === "discussion") {
      discussionRaw.push(p.text);
    }
  }

  result.discussion = parseDiscussion(discussionRaw);
  result.attendees = [...new Set(result.attendees.filter(Boolean))];
  return result;
}

const parseDiscussion = (raw: string[]): { topic: string; notes: string[] }[] => {
  const joined = raw.join("\n").replace(//g, "\n").replace(/\r/g, "");
  const stripped = joined
    .replace(/pranešimas\s*čia/gi, "")
    .replace(/komentarai\s*čia/gi, "")
    .replace(/komentarai:?\s*/gi, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/^[ \t]+|[ \t]+$/gm, "");

  const out: { topic: string; notes: string[] }[] = [];
  const re = /(^|\n)(\d+(?:\.\d+)?)[\.\)]\s*([^\n]+)/g;
  const indices: { idx: number; num: string; title: string }[] = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    indices.push({
      idx: m.index + m[1].length,
      num: m[2],
      title: m[3].trim(),
    });
  }
  for (let i = 0; i < indices.length; i++) {
    const cur = indices[i];
    const nextIdx = i + 1 < indices.length ? indices[i + 1].idx : stripped.length;
    const topicStart = cur.idx + cur.num.length + 1;
    const body = stripped
      .slice(topicStart, nextIdx)
      .replace(/^[^\n]*\n/, "")
      .trim();
    const notes = body
      .split(/\n+/)
      .map((l) => l.replace(/^[•\-\s]+/, "").trim())
      .filter((l) => l.length > 1);
    out.push({ topic: cur.title, notes });
  }
  return out;
};

const splitNames = (s: string): string[] =>
  s.split(/[,;·•\n]+/).map((x) => x.trim()).filter((x) => x && x.length < 40);

export async function getLatestMeeting(
  auth: OAuth2Client,
): Promise<MeetingContent | null> {
  const list = await listMeetings(auth, 1);
  if (list.length === 0) return null;
  return parseMeeting(auth, list[0]);
}
