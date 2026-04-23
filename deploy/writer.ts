import { readFile } from "node:fs/promises";
import { getAuthedClient } from "../google";
import { createDraft } from "../ltbb-gmail";
import { enqueueAction, listActions } from "../ltbb-actions";
import { getLTBB } from "../data";

type Args = {
  mode: "first-touch";
  limit: number;
  dryRun: boolean;
};

const parseArgs = (): Args => {
  const raw = process.argv.slice(2);
  const a: Args = { mode: "first-touch", limit: 3, dryRun: false };
  for (const arg of raw) {
    if (arg === "--dry-run") a.dryRun = true;
    else if (arg.startsWith("--limit=")) a.limit = Math.max(1, Number(arg.split("=")[1]) || 3);
    else if (arg.startsWith("--mode=")) {
      const m = arg.split("=")[1];
      if (m !== "first-touch") throw new Error(`unknown mode: ${m} (only "first-touch" supported in v1)`);
      a.mode = m;
    }
  }
  return a;
};

const TEMPLATE_PATH = "/home/auri/vault/Personal/LT Big Brother/Partnerysčių email šablonas 2026.md";

const main = async () => {
  const { mode, limit, dryRun } = parseArgs();
  const host = process.env.PUBLIC_HOST || "http://localhost:8000";
  console.log(`[writer] mode=${mode} limit=${limit} dryRun=${dryRun}`);

  const ltbb = await getLTBB();
  const actions = await listActions();
  const blockedEmails = new Set(
    actions
      .filter((x) => ["pending", "sent", "sent_simulated"].includes(x.status))
      .map((x) => x.partnerEmail.toLowerCase()),
  );

  const eligible = ltbb.partners.filter(
    (p) =>
      p.email &&
      p.email.includes("@") &&
      (p.status === "Nesusisiekta" || !p.status) &&
      !blockedEmails.has(p.email.toLowerCase()),
  );

  if (!eligible.length) {
    console.log("[writer] no eligible first-touch candidates (all contacted, queued, or sent).");
    return;
  }

  const picks = eligible.slice(0, limit);
  console.log(`[writer] ${eligible.length} eligible, processing ${picks.length}:`);
  for (const p of picks) {
    console.log(`  · ${p.company} <${p.email}>  [${p.category || "uncategorized"}]`);
  }

  if (dryRun) {
    console.log("[writer] dry-run: no drafts, no proposals.");
    return;
  }

  const client = await getAuthedClient("auri", `${host}/oauth/callback`);
  if (!client) {
    console.error("[writer] Auri Google account not authorized. Run OAuth first.");
    process.exit(1);
  }

  const templateMd = await readFile(TEMPLATE_PATH, "utf-8");

  let ok = 0;
  let failed = 0;
  for (const p of picks) {
    try {
      const draft = await createDraft(client, p, templateMd);
      const action = await enqueueAction({
        kind: "send_draft",
        project: "event_2026_05_05",
        partnerEmail: p.email,
        partnerCompany: p.company,
        draftId: draft.draftId,
        subject: draft.subject,
        bodyPreview: draft.bodyPreview,
        reasoning: `First-touch outreach · category=${p.category || "n/a"} · CSV status=${p.status || "(empty)"}`,
        proposedBy: "writer-v1",
      });
      console.log(`[writer] ${p.company} → draft ${draft.draftId} → ${action.id}`);
      ok += 1;
    } catch (e) {
      console.error(`[writer] ${p.company} failed:`, (e as Error).message);
      failed += 1;
    }
  }
  console.log(`[writer] done. proposed=${ok} failed=${failed}`);
};

main().catch((e) => {
  console.error("[writer] fatal:", e);
  process.exit(1);
});
