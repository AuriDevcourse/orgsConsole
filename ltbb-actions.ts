import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const STORE_PATH = "./data/ltbb-actions.json";

export type ActionKind = "send_draft";
export type ActionStatus = "pending" | "sent" | "sent_simulated" | "rejected" | "failed";

export type Action = {
  id: string;
  kind: ActionKind;
  project: string;
  partnerEmail: string;
  partnerCompany: string;
  draftId: string;
  subject: string;
  bodyPreview: string;
  reasoning: string;
  proposedBy: string;
  status: ActionStatus;
  proposedAt: string;
  telegramMsgId?: number;
  decidedAt?: string;
  result?: { messageId?: string; threadId?: string; error?: string };
};

type Store = { nextId: number; actions: Action[] };

const emptyStore = (): Store => ({ nextId: 1, actions: [] });

export const loadStore = async (): Promise<Store> => {
  try {
    return JSON.parse(await readFile(STORE_PATH, "utf-8")) as Store;
  } catch {
    return emptyStore();
  }
};

export const saveStore = async (s: Store) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(s, null, 2));
};

export type ProposeInput = Omit<
  Action,
  "id" | "status" | "proposedAt" | "telegramMsgId" | "decidedAt" | "result"
>;

export const enqueueAction = async (input: ProposeInput): Promise<Action> => {
  const store = await loadStore();
  const id = `act_${store.nextId}`;
  const action: Action = {
    ...input,
    id,
    status: "pending",
    proposedAt: new Date().toISOString(),
  };
  store.actions.push(action);
  store.nextId += 1;
  await saveStore(store);
  return action;
};

export const listActions = async (filter?: { status?: ActionStatus }): Promise<Action[]> => {
  const store = await loadStore();
  if (!filter?.status) return store.actions;
  return store.actions.filter((a) => a.status === filter.status);
};

export const getAction = async (id: string): Promise<Action | null> => {
  const store = await loadStore();
  return store.actions.find((a) => a.id === id) ?? null;
};

export const updateAction = async (
  id: string,
  patch: Partial<Action>,
): Promise<Action | null> => {
  const store = await loadStore();
  const idx = store.actions.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  store.actions[idx] = { ...store.actions[idx], ...patch };
  await saveStore(store);
  return store.actions[idx];
};
