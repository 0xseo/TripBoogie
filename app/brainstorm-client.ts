"use client";
import { ApiError, getSupabaseClient } from "./client-api";
import { apiUrl } from "./runtime";
import { previewFor, type BrainDelta, type BrainDocument, type BrainMutation, type BrainSummary } from "./brainstorm";
import { BrainStore } from "./brainstorm-store";

export async function brainRequest<T>(accountId: string, tripId: string, documentId?: string, payload?: unknown, since = 0): Promise<T> {
  const client = await getSupabaseClient();
  const session = (await client?.auth.getSession())?.data.session;
  if (!session || session.user.id !== accountId) throw new ApiError("계정이 바뀌었어요. 다시 로그인해 주세요.", 401);
  let response: Response;
  try { response = await fetch(apiUrl(`/api/trips/${tripId}/brainstorm${documentId ? `/${documentId}` : ""}${payload === undefined && documentId ? `?since=${since}` : ""}`), {
    method: payload === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${session.access_token}`, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }); } catch { throw new ApiError("서버에 연결하지 못했어요. 연결되면 미저장 변경을 다시 보냅니다.", 0); }
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new ApiError("서버 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", response.ok ? 502 : response.status); }
  if (!response.ok) throw new ApiError((result as {error?: string})?.error || "브레인스토밍을 저장하지 못했어요.", response.status, result);
  return result as T;
}

const stores = new Map<string, { store: BrainStore; stop: () => void }>();
let guardingExit = false;
export async function openBrainStore(accountId: string, tripId: string, id: string): Promise<BrainStore> {
  if (!guardingExit) {
    guardingExit = true;
    window.addEventListener("beforeunload", event => { if ([...stores.values()].some(({ store }) => store.getSnapshot().pending)) event.preventDefault(); });
  }
  const key = `${accountId}:${tripId}:${id}`;
  const found = stores.get(key); if (found) { await found.store.refresh(); return found.store; }
  const document = await brainRequest<BrainDelta>(accountId, tripId, id);
  const recoveryKey = `tripboogie:brain-pending:${key}`;
  let recovered: BrainMutation[] = [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(recoveryKey) ?? "[]");
    if (Array.isArray(raw) && raw.length <= 1000 && raw.every(m => typeof m?.mutationId === "string" && Array.isArray(m.changes) && m.changes.length <= 1000 && m.changes.every((c: {key?:unknown;expected?:unknown}) => typeof c?.key === "string" && (c.expected === null || typeof c.expected === "string")))) recovered = raw;
  } catch {}
  const store = new BrainStore(document, {
    read: since => brainRequest(accountId, tripId, id, undefined, since),
    write: (mutation, since, next) => brainRequest(accountId, tripId, id, { ...mutation, since, preview: previewFor(next.kind, next.entities) }),
  }, queue => { if (queue.length) localStorage.setItem(recoveryKey, JSON.stringify(queue)); else localStorage.removeItem(recoveryKey); }, recovered);
  const timer = window.setInterval(() => { if (store.getSnapshot().pending) void store.flush(); }, 4000);
  const client = await getSupabaseClient();
  const subscription = client?.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== accountId) { store.deactivate(); clearInterval(timer); stores.delete(key); subscription?.data.subscription.unsubscribe(); }
  });
  stores.set(key, { store, stop: () => { clearInterval(timer); store.deactivate(); subscription?.data.subscription.unsubscribe(); } });
  // Keep only idle recent documents. Unsent edits remain in the owning store.
  if (stores.size > 6) for (const [otherKey, other] of stores) {
    if (otherKey !== key && !other.store.observed && !other.store.getSnapshot().pending) { other.stop(); stores.delete(otherKey); break; }
  }
  void store.flush(); return store;
}

export type BrainService = {
  list: () => Promise<BrainSummary[]>;
  create: (kind: "sheet" | "board", title: string, id: string) => Promise<BrainDocument>;
  meta: (doc: BrainSummary, action: string, title?: string) => Promise<BrainDelta | { ok: true }>;
  open: (id: string) => Promise<BrainStore>;
};
export function brainService(accountId: string, tripId: string): BrainService {
  return {
    list: () => brainRequest(accountId, tripId),
    create: (kind, title, documentId) => brainRequest(accountId, tripId, undefined, { kind, title, documentId }),
    meta: (doc, action, title) => brainRequest(accountId, tripId, doc.id, { action, title, version: doc.metaVersion }),
    open: id => openBrainStore(accountId, tripId, id),
  };
}
