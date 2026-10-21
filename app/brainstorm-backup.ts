import { apiFetch, jsonRequest } from "./client-api";
import { previewFor, type BrainChange, type BrainDelta, type BrainDocument, type BrainSummary } from "./brainstorm";

/** Keep every hosted API request/response below the function payload limit. */
export async function exportBrainDocuments(tripId: string): Promise<BrainDocument[]> {
  const summaries = await apiFetch<BrainSummary[]>(`/api/trips/${tripId}/brainstorm`);
  const documents: BrainDocument[] = [];
  for (const summary of summaries) documents.push(await apiFetch<BrainDelta>(`/api/trips/${tripId}/brainstorm/${summary.id}`));
  return documents;
}
export function brainImportBatches(document: BrainDocument): BrainChange[][] {
  if (!document || !["sheet", "board"].includes(document.kind) || typeof document.title !== "string" || !document.title.trim() || !document.entities || typeof document.entities !== "object" || Array.isArray(document.entities)) throw new Error("백업의 브레인스토밍 문서를 확인해 주세요.");
  const batches: BrainChange[][] = []; let batch: BrainChange[] = [], bytes = 0;
  for (const [key, entity] of Object.entries(document.entities)) {
    if (!entity || typeof entity !== "object" || !("value" in entity)) throw new Error("백업의 문서 항목이 올바르지 않아요.");
    const change: BrainChange = { key, value: entity.value, expected: null }, size = new TextEncoder().encode(JSON.stringify(change)).length;
    if (size > 700000) throw new Error("백업에 한 번에 복원하기 너무 큰 항목이 있어요.");
    if (batch.length && (batch.length >= 500 || bytes + size > 700000)) { batches.push(batch); batch = []; bytes = 0; }
    batch.push(change); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
async function importId(key: string, suffix: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:brain:${suffix}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const value = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
export async function importBrainDocuments(tripId: string, documents: BrainDocument[], importKey: string) {
  const prepared = documents.map(doc => ({ doc, batches: brainImportBatches(doc) }));
  for (let index = 0; index < prepared.length; index++) {
    const { doc, batches } = prepared[index], documentId = await importId(importKey, `document:${index}`);
    let current = await apiFetch<BrainDelta>(`/api/trips/${tripId}/brainstorm`, jsonRequest({ documentId, kind: doc.kind, title: doc.title }));
    const path = `/api/trips/${tripId}/brainstorm/${documentId}`;
    if (doc.deletedAt && current.deletedAt) continue;
    for (let part = 0; part < batches.length; part++) current = await apiFetch<BrainDelta>(path, jsonRequest({ mutationId: await importId(importKey, `mutation:${index}:${part}`), changes: batches[part] }));
    if (batches.length) {
      const first = batches[0][0];
      current = await apiFetch<BrainDelta>(path, jsonRequest({ mutationId: await importId(importKey, `preview:${index}`), changes: [{ ...first, expected: await importId(importKey, `mutation:${index}:0`) }], preview: previewFor(doc.kind, current.entities) }));
    }
    if (doc.deletedAt && !current.deletedAt) await apiFetch(path, jsonRequest({ action: "delete", version: current.metaVersion }));
  }
}
