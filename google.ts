import { readFile, writeFile } from "node:fs/promises";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export type Account = "lys" | "auri";
export const ACCOUNTS: Account[] = ["lys", "auri"];

export const ACCOUNT_LABELS: Record<Account, string> = {
  lys: "Lithuanian Youth Society",
  auri: "Aurimas (personal)",
};

const credPath = (a: Account) => `./credentials/${a}/client_secret.json`;
const tokenPath = (a: Account) => `./credentials/${a}/token.json`;

export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
  "openid",
  "email",
  "profile",
];

type InstalledCred = {
  installed: { client_id: string; client_secret: string; redirect_uris?: string[] };
};

const clientCache = new Map<Account, OAuth2Client>();

const readCredentials = async (a: Account) => {
  const raw = await readFile(credPath(a), "utf-8");
  const cred = JSON.parse(raw) as InstalledCred;
  if (!cred.installed) throw new Error(`credentials/${a}/client_secret.json must be type 'installed'`);
  return cred.installed;
};

export const makeOAuthClient = async (a: Account, redirectUri: string): Promise<OAuth2Client> => {
  const c = await readCredentials(a);
  return new google.auth.OAuth2(c.client_id, c.client_secret, redirectUri);
};

export const getAuthUrl = (client: OAuth2Client, state: string): string =>
  client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });

export const saveToken = async (a: Account, token: unknown): Promise<void> => {
  await writeFile(tokenPath(a), JSON.stringify(token, null, 2), { mode: 0o600 });
};

export const loadToken = async (a: Account): Promise<Record<string, unknown> | null> => {
  try {
    return JSON.parse(await readFile(tokenPath(a), "utf-8"));
  } catch {
    return null;
  }
};

export const credentialsExist = async (a: Account): Promise<boolean> => {
  try {
    await readFile(credPath(a), "utf-8");
    return true;
  } catch {
    return false;
  }
};

export const getAuthedClient = async (
  a: Account,
  redirectUri: string,
): Promise<OAuth2Client | null> => {
  const cached = clientCache.get(a);
  if (cached) return cached;
  const token = await loadToken(a);
  if (!token) return null;
  const client = await makeOAuthClient(a, redirectUri);
  client.setCredentials(token);
  clientCache.set(a, client);
  return client;
};

export const resetClientCache = (a?: Account) => {
  if (a) clientCache.delete(a);
  else clientCache.clear();
};

export const getServices = (auth: OAuth2Client) => ({
  gmail: google.gmail({ version: "v1", auth }),
  drive: google.drive({ version: "v3", auth }),
  docs: google.docs({ version: "v1", auth }),
  sheets: google.sheets({ version: "v4", auth }),
  calendar: google.calendar({ version: "v3", auth }),
  oauth2: google.oauth2({ version: "v2", auth }),
});
