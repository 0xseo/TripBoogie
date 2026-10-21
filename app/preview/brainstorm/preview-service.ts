import { BrainStore } from "../../brainstorm-store";
import { previewFor, type BrainDelta, type BrainDocument, type BrainMutation, type BrainSummary } from "../../brainstorm";
import type { BrainService } from "../../brainstorm-client";

const key = "tripboogie:brain-preview:v1";
const seedId = "20000000-0000-4000-8000-000000000001", boardId = "20000000-0000-4000-8000-000000000002", stamp = "30000000-0000-4000-8000-000000000001";
type PreviewDocument = BrainDocument & { mutations?: Record<string, string> };
function seed(): PreviewDocument[] {
  const base = { tripId: "preview", revision: 1, metaVersion: 1, deletedAt: null, updatedAt: "2026-10-21T09:00:00Z" };
  const sheet: BrainDocument = { ...base, id: seedId, kind: "sheet", title: "도쿄 여행 아이디어", entities: {}, preview: {} };
  [["가고 싶은 곳", "분류", "예산", "메모"], ["기치조지", "동네 산책", "3000", "공원과 카페"], ["팀랩", "전시", "4500", "예약 확인하기"], ["츠키지 시장", "먹거리", "2500", "아침 일찍 출발"]].forEach((row, r) => row.forEach((text, c) => { sheet.entities[`cell:r${r}:c${c}`] = { value: { text, ...(r === 0 ? { background: "#e5f1e8", bold: true } : {}) }, stamp, revision: 1 }; }));
  sheet.preview = previewFor("sheet", sheet.entities);
  const board: BrainDocument = { ...base, id: boardId, kind: "board", title: "우리 여행 그려 보기", entities: {}, preview: {} };
  const value = { type: "rect" as const, x: 80, y: 90, x2: 400, y2: 230, color: "#38856c", width: 3, order: "1" };
  board.entities["shape:40000000-0000-4000-8000-000000000001"] = { value, stamp, revision: 1 };
  board.entities["shape:40000000-0000-4000-8000-000000000002"] = { value: { type: "text", x: 112, y: 126, text: "천천히 걷는 여행", color: "#254c41", fontSize: 28, width: 3, order: "2" }, stamp, revision: 1 };
  board.preview = previewFor("board", board.entities); return [sheet, board];
}
function read(): PreviewDocument[] { try { const raw = localStorage.getItem(key); if (raw) return JSON.parse(raw); } catch {} const data = seed(); localStorage.setItem(key, JSON.stringify(data)); return data; }
function persist(data: PreviewDocument[]) { localStorage.setItem(key, JSON.stringify(data)); window.dispatchEvent(new Event("brain-preview-changed")); }
function delta(doc: BrainDocument): BrainDelta { return { ...doc, reset: true }; }
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
async function locked<T>(work: () => T): Promise<T> { return navigator.locks ? navigator.locks.request(key, work) : work(); }
export function previewBrainService(): BrainService {
  const stores = new Map<string, BrainStore>();
  const find = (id: string) => read().find(d => d.id === id) ?? fail("문서가 삭제됐어요.", 404);
  const write = async (id: string, mutation: BrainMutation) => locked(() => {
    const data = read(), doc = data.find(d => d.id === id); if (!doc) return fail("문서가 삭제됐어요.", 404);
    if (doc.deletedAt) return fail("휴지통에 있는 문서예요.");
    const fingerprint = JSON.stringify(mutation.changes);
    if (doc.mutations?.[mutation.mutationId]) { if (doc.mutations[mutation.mutationId] !== fingerprint) return fail("요청 내용이 달라졌어요."); return delta(doc); }
    for (const change of mutation.changes) if ((doc.entities[change.key]?.stamp ?? null) !== change.expected) return fail("동행이 같은 항목을 변경했어요. 내 변경은 임시 보관됩니다.");
    doc.revision++; doc.updatedAt = new Date().toISOString();
    for (const change of mutation.changes) doc.entities[change.key] = { value: change.value, stamp: mutation.mutationId, revision: doc.revision };
    doc.mutations = { ...doc.mutations, [mutation.mutationId]: fingerprint }; doc.preview = previewFor(doc.kind, doc.entities); persist(data); return delta(doc);
  });
  return {
    list: async () => read().map(doc => ({ id: doc.id, tripId: doc.tripId, kind: doc.kind, title: doc.title, revision: doc.revision, metaVersion: doc.metaVersion, deletedAt: doc.deletedAt, updatedAt: doc.updatedAt, preview: doc.preview }) as BrainSummary),
    create: async (kind, title, id) => locked(() => { const data = read(), existing = data.find(d => d.id === id); if (existing) return existing; const doc: BrainDocument = { id, tripId: "preview", title, kind, revision: 1, metaVersion: 1, deletedAt: null, updatedAt: new Date().toISOString(), entities: {}, preview: {} }; persist([...data, doc]); return doc; }),
    meta: async (summary, action, title) => locked(() => {
      const data = read(), doc = data.find(d => d.id === summary.id); if (!doc) return fail("문서가 삭제됐어요.", 404);
      if (doc.metaVersion !== summary.metaVersion) return fail("문서 정보가 변경됐어요.");
      if (action === "purge") { persist(data.filter(d => d.id !== doc.id)); return { ok: true as const }; }
      if (action === "rename") doc.title = title || doc.title;
      if (action === "delete") doc.deletedAt = new Date().toISOString();
      if (action === "restore") doc.deletedAt = null;
      doc.metaVersion++; doc.revision++; doc.updatedAt = new Date().toISOString(); persist(data); return delta(doc);
    }),
    open: async id => { const existing = stores.get(id); if (existing) { await existing.refresh(); return existing; } const store = new BrainStore(find(id), { read: async () => delta(find(id)), write: mutation => write(id, mutation) }); stores.set(id, store); return store; },
  };
}
