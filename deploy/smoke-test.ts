import { getAuthedClient, getServices } from "../google";
import { enqueueAction } from "../ltbb-actions";

const TEST_EMAIL = "baciauskas.aurimas@gmail.com";

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

const main = async () => {
  const host = process.env.PUBLIC_HOST || "http://localhost:8000";
  const client = await getAuthedClient("auri", `${host}/oauth/callback`);
  if (!client) {
    console.error("Auri not authorized. Run the OAuth flow via /oauth/start/auri first.");
    process.exit(1);
  }
  const { gmail } = getServices(client);
  const subject = "LTBB approval smoke test";
  const body = [
    "This is a test message from the LTBB approval daemon.",
    "",
    "If you Rejected it in Telegram: nothing gets sent. Expected.",
    "If you Approved it: this email arrived in your inbox. Daemon works end to end.",
  ].join("\n");

  const mime = buildMime(TEST_EMAIL, subject, body);
  const raw = Buffer.from(mime, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const draftRes = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } },
  });
  const draftId = draftRes.data.id ?? "";
  console.log(`[smoke-test] created Gmail draft: ${draftId}`);

  const action = await enqueueAction({
    kind: "send_draft",
    project: "smoke_test",
    partnerEmail: TEST_EMAIL,
    partnerCompany: "Smoke Test",
    draftId,
    subject,
    bodyPreview: body.slice(0, 280),
    reasoning: "End-to-end smoke test. Safe to approve or reject.",
    proposedBy: "smoke-test",
  });
  console.log(`[smoke-test] enqueued action: ${action.id}`);
  console.log("Watch the LTBB Approvals Telegram group — approval card should appear within ~5s.");
};

main().catch((e) => {
  console.error("[smoke-test] failed:", e);
  process.exit(1);
});
