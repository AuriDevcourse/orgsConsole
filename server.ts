import { serve, file } from "bun";

process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", (err as { message?: string })?.message ?? err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err.message);
});

import { getLYS, getLTBB, getAIWorkshop } from "./data";
import {
  ACCOUNTS,
  ACCOUNT_LABELS,
  credentialsExist,
  getAuthUrl,
  getAuthedClient,
  getServices,
  loadToken,
  makeOAuthClient,
  resetClientCache,
  saveToken,
  type Account,
} from "./google";
import { getLatestMeeting, listMeetings, parseMeeting } from "./lys-drive";
import { syncPartners, createDraft } from "./ltbb-gmail";
import { readFile } from "node:fs/promises";

const PORT = Number(process.env.PORT) || 8000;
const PUBLIC_HOST = process.env.PUBLIC_HOST || `http://localhost:${PORT}`;
const REDIRECT_URI = `${PUBLIC_HOST}/oauth/callback`;

const json = (data: unknown, status = 200) =>
  Response.json(data, { status });

const isAccount = (s: string): s is Account => ACCOUNTS.includes(s as Account);

const needsAuth = async (a: Account) => {
  const client = await getAuthedClient(a, REDIRECT_URI);
  return client ?? null;
};

const handle = async (req: Request): Promise<Response> => {
  try {
    return await route(req);
  } catch (e) {
    const msg = (e as { message?: string }).message ?? String(e);
    const code = (e as { code?: number }).code;
    console.error("[route error]", code ?? "", msg);
    return Response.json({ error: msg, code }, { status: typeof code === "number" && code >= 400 && code < 600 ? code : 500 });
  }
};

const server = serve({
  port: PORT,
  hostname: "0.0.0.0",
  error(e) {
    console.error("[server error]", e);
    return Response.json({ error: (e as Error).message ?? "server error" }, { status: 500 });
  },
  fetch(req) {
    return handle(req);
  },
});

const route = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === "/") return new Response(file("./public/index.html"));
    if (url.pathname.startsWith("/static/")) {
      return new Response(file("./public" + url.pathname.replace("/static", "")));
    }

    if (url.pathname === "/api/lys") return json(await getLYS());
    if (url.pathname === "/api/ltbb") return json(await getLTBB());
    if (url.pathname === "/api/aiworkshop") return json(await getAIWorkshop());
    if (url.pathname === "/api/aiworkshop/qr") {
      return new Response(file("./data/whatsapp-qr.png"));
    }
    if (url.pathname === "/api/aiworkshop/whatsapp/send" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { text?: string } | null;
      const text = body?.text?.trim();
      if (!text) return json({ error: "missing text" }, 400);
      try {
        const r = await fetch("http://127.0.0.1:8787/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        return json(await r.json(), r.status);
      } catch (e) {
        return json({ error: `whatsapp daemon unreachable: ${(e as Error).message}` }, 502);
      }
    }

    if (url.pathname === "/api/ltbb/gmail-sync") {
      const client = await needsAuth("auri");
      if (!client) return json({ error: "Auri not authorized" }, 401);
      const { getLTBB } = await import("./data");
      const ltbb = await getLTBB();
      const results = await syncPartners(client, ltbb.partners);
      return json({ syncedAt: new Date().toISOString(), results });
    }

    if (url.pathname === "/api/ltbb/drafts/create" && req.method === "POST") {
      const client = await needsAuth("auri");
      if (!client) return json({ error: "Auri not authorized" }, 401);
      const body = await req.json() as { email?: string };
      if (!body.email) return json({ error: "missing email" }, 400);
      const { getLTBB } = await import("./data");
      const ltbb = await getLTBB();
      const partner = ltbb.partners.find((p) => p.email === body.email);
      if (!partner) return json({ error: "partner not found" }, 404);
      const templateMd = await readFile(
        "/home/auri/vault/Personal/LT Big Brother/Partnerysčių email šablonas 2026.md",
        "utf-8",
      );
      const draft = await createDraft(client, partner, templateMd);
      return json(draft);
    }
    if (url.pathname === "/api/summary") {
      const [lys, ltbb] = await Promise.all([getLYS(), getLTBB()]);
      return json({
        lys: {
          board: lys.boardMembers.length,
          upcoming: lys.upcomingEvents.length,
          funding: lys.fundingAmount,
        },
        ltbb: {
          partners: ltbb.totalCount,
          pending: ltbb.pendingCount,
          contacted: ltbb.contactedCount,
        },
      });
    }

    // ---- OAuth (multi-account) ----
    const startMatch = url.pathname.match(/^\/oauth\/start\/([a-z]+)$/);
    if (startMatch && isAccount(startMatch[1])) {
      const a = startMatch[1];
      if (!(await credentialsExist(a))) {
        return new Response(`No client_secret.json for account "${a}"`, { status: 400 });
      }
      const client = await makeOAuthClient(a, REDIRECT_URI);
      return Response.redirect(getAuthUrl(client, a), 302);
    }

    if (url.pathname === "/oauth/callback") {
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      const state = url.searchParams.get("state") ?? "";
      if (err) return new Response(`OAuth error: ${err}`, { status: 400 });
      if (!code) return new Response("Missing ?code", { status: 400 });
      if (!isAccount(state)) {
        return new Response(`Invalid or missing state: "${state}"`, { status: 400 });
      }
      const client = await makeOAuthClient(state, REDIRECT_URI);
      const { tokens } = await client.getToken(code);
      await saveToken(state, tokens);
      resetClientCache(state);
      return new Response(
        `Authorized ${ACCOUNT_LABELS[state]} (${state}). Token saved. You can close this tab.`,
        { headers: { "content-type": "text/plain" } },
      );
    }

    // ---- Google status ----
    if (url.pathname === "/api/google/status") {
      const out: Record<string, unknown> = {};
      for (const a of ACCOUNTS) {
        const hasCred = await credentialsExist(a);
        const token = hasCred ? await loadToken(a) : null;
        if (!hasCred) {
          out[a] = { label: ACCOUNT_LABELS[a], authorized: false, hasCredentials: false };
          continue;
        }
        if (!token) {
          out[a] = {
            label: ACCOUNT_LABELS[a],
            authorized: false,
            hasCredentials: true,
            authUrl: `/oauth/start/${a}`,
          };
          continue;
        }
        try {
          const client = await getAuthedClient(a, REDIRECT_URI);
          if (!client) throw new Error("no client");
          const { oauth2 } = getServices(client);
          const me = await oauth2.userinfo.get();
          out[a] = {
            label: ACCOUNT_LABELS[a],
            authorized: true,
            hasCredentials: true,
            email: me.data.email,
            scopes: (token as { scope?: string }).scope?.split(" ") ?? [],
          };
        } catch (e) {
          out[a] = {
            label: ACCOUNT_LABELS[a],
            authorized: false,
            hasCredentials: true,
            error: String(e),
            authUrl: `/oauth/start/${a}`,
          };
        }
      }
      return json(out);
    }

    // ---- Gmail profile (per account) ----
    const gmailMatch = url.pathname.match(/^\/api\/google\/([a-z]+)\/gmail\/profile$/);
    if (gmailMatch && isAccount(gmailMatch[1])) {
      const client = await needsAuth(gmailMatch[1]);
      if (!client) return json({ error: "not authorized" }, 401);
      const { gmail } = getServices(client);
      const p = await gmail.users.getProfile({ userId: "me" });
      return json(p.data);
    }

    // ---- Calendar upcoming (per account) ----
    const calMatch = url.pathname.match(/^\/api\/google\/([a-z]+)\/calendar\/upcoming$/);
    if (calMatch && isAccount(calMatch[1])) {
      const client = await needsAuth(calMatch[1]);
      if (!client) return json({ error: "not authorized" }, 401);
      const { calendar } = getServices(client);
      const events = await calendar.events.list({
        calendarId: "primary",
        timeMin: new Date().toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: "startTime",
      });
      return json(events.data.items ?? []);
    }

    // ---- LYS calendar upcoming ----
    if (url.pathname === "/api/lys/calendar") {
      const client = await needsAuth("lys");
      if (!client) return json({ error: "LYS not authorized" }, 401);
      const { calendar } = getServices(client);
      const events = await calendar.events.list({
        calendarId: "primary",
        timeMin: new Date().toISOString(),
        maxResults: 15,
        singleEvents: true,
        orderBy: "startTime",
      });
      const items = (events.data.items ?? []).map((e) => ({
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime ?? e.start?.date ?? null,
        end: e.end?.dateTime ?? e.end?.date ?? null,
        location: e.location ?? null,
        htmlLink: e.htmlLink ?? null,
      }));
      return json(items);
    }

    // ---- LYS meetings from LYS Drive ----
    if (url.pathname === "/api/lys/meetings") {
      const client = await needsAuth("lys");
      if (!client) return json({ error: "LYS not authorized" }, 401);
      return json(await listMeetings(client, 12));
    }

    if (url.pathname === "/api/lys/meetings/latest") {
      const client = await needsAuth("lys");
      if (!client) return json({ error: "LYS not authorized" }, 401);
      const m = await getLatestMeeting(client);
      if (!m) return json({ error: "no meetings found" }, 404);
      return json(m);
    }

    const meetingMatch = url.pathname.match(/^\/api\/lys\/meetings\/([\w-]+)$/);
    if (meetingMatch) {
      const client = await needsAuth("lys");
      if (!client) return json({ error: "LYS not authorized" }, 401);
      const list = await listMeetings(client, 30);
      const ref = list.find((m) => m.id === meetingMatch[1]);
      if (!ref) return json({ error: "not in recent meetings" }, 404);
      return json(await parseMeeting(client, ref));
    }

    return new Response("Not found", { status: 404 });
};

console.log(`Orgs dashboard listening on http://0.0.0.0:${server.port}`);
console.log(`OAuth redirect URI: ${REDIRECT_URI}`);
console.log(`Accounts: ${ACCOUNTS.map((a) => `${a} -> ${PUBLIC_HOST}/oauth/start/${a}`).join(", ")}`);
