import { mergeDelta, projectMutation, type BrainChange, type BrainDelta, type BrainDocument, type BrainMutation, type BrainValue } from "./brainstorm";

export interface BrainTransport {
  read: (since: number) => Promise<BrainDelta>;
  write: (mutation: BrainMutation, since: number, previewDocument: BrainDocument) => Promise<BrainDelta>;
}
type History = { before: Record<string, BrainValue>; after: Record<string, BrainValue>; stamps: Record<string, string | null> };
type Pending = BrainMutation & { history?: History; reversal?: { history: History; redo: boolean } };
export interface BrainSnapshot { document: BrainDocument; pending: number; error: string; conflict: boolean; unavailable: boolean; canUndo: boolean; canRedo: boolean }

/** Per-element compare-and-swap, ordered retry, and conditional personal undo. */
export class BrainStore {
  private confirmed: BrainDocument;
  private queue: Pending[] = [];
  private undoStack: History[] = [];
  private redoStack: History[] = [];
  private listeners = new Set<() => void>();
  private sending = false;
  private error = "";
  private conflict = false;
  private active = true;
  private unavailable = false;
  private readFailed = false;
  private pauseRetries = false;
  private snapshot: BrainSnapshot;
  constructor(document: BrainDocument, private transport: BrainTransport, private persist?: (pending: BrainMutation[]) => void, recovered: BrainMutation[] = []) {
    this.confirmed = document;
    this.queue = recovered;
    this.snapshot = this.build();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  get observed() { return this.listeners.size > 0; }
  private build(): BrainSnapshot {
    return { document: this.queue.reduce(projectMutation, this.confirmed), pending: this.queue.length, error: this.error, conflict: this.conflict, unavailable: this.unavailable, canUndo: !!this.undoStack.length && !this.queue.length && !this.unavailable && !this.confirmed.deletedAt, canRedo: !!this.redoStack.length && !this.queue.length && !this.unavailable && !this.confirmed.deletedAt };
  }
  private publish() {
    this.snapshot = this.build();
    try { this.persist?.(this.queue.map(({ mutationId, changes, protect }) => ({ mutationId, changes, ...(protect ? { protect } : {}) }))); }
    catch { this.error = "기기 임시 보관 공간이 부족해요. 저장이 끝날 때까지 이 화면을 유지해 주세요."; this.snapshot = this.build(); }
    this.listeners.forEach(listener => listener());
  }
  receive(delta: BrainDelta) { if (!this.active) return; this.confirmed = mergeDelta(this.confirmed, delta); this.publish(); }
  async refresh() {
    if (!this.active) return;
    try { const delta = await this.transport.read(this.confirmed.revision); this.unavailable = false; if (this.readFailed && !this.queue.length) this.error = ""; this.readFailed = false; this.receive(delta); }
    catch (error) {
      if ([401, 403, 404].includes((error as {status?:number}).status ?? 0)) this.unavailable = true;
      this.readFailed = true; this.error = error instanceof Error ? error.message : "문서를 동기화하지 못했어요."; this.publish(); throw error;
    }
  }
  edit(values: Record<string, BrainValue>, expectations?: Record<string, string | null>) {
    if (!this.active || this.confirmed.deletedAt || this.unavailable) return;
    const current = this.snapshot.document;
    const changes: BrainChange[] = Object.entries(values).filter(([key, value]) => JSON.stringify(current.entities[key]?.value ?? null) !== JSON.stringify(value))
      .map(([key, value]) => ({ key, value, expected: expectations && key in expectations ? expectations[key] : current.entities[key]?.stamp ?? null }));
    if (!changes.length) return;
    const mutationId = crypto.randomUUID();
    const history: History = { before: {}, after: {}, stamps: {} };
    for (const change of changes) { history.before[change.key] = current.entities[change.key]?.value ?? null; history.after[change.key] = change.value; history.stamps[change.key] = mutationId; }
    this.redoStack = [];
    this.queue.push({ mutationId, changes, history });
    this.publish(); void this.flush();
  }
  async flush() {
    if (this.sending || this.conflict || !this.active || this.unavailable || this.pauseRetries) return;
    this.sending = true;
    try {
      while (this.queue.length && this.active) {
        const pending = this.queue[0];
        try {
          const delta = await this.transport.write(pending, this.confirmed.revision, projectMutation(this.confirmed, pending));
          if (!this.active) return;
          this.confirmed = mergeDelta(this.confirmed, delta);
          this.queue.shift();
          if (pending.history) { this.undoStack.push(pending.history); if (this.undoStack.length > 100) this.undoStack.shift(); }
          if (pending.reversal) {
            const { history, redo } = pending.reversal, source = redo ? this.redoStack : this.undoStack, target = redo ? this.undoStack : this.redoStack;
            if (source.at(-1) === history) source.pop();
            history.stamps = Object.fromEntries(pending.changes.map(c => [c.key, pending.mutationId])); target.push(history);
            for (const change of pending.changes) {
              const earlier = [...source].reverse().find(item => change.key in item.stamps);
              if (earlier) earlier.stamps[change.key] = pending.mutationId;
            }
          }
          this.error = "";
        } catch (error) {
          if (!this.active) return;
          this.error = error instanceof Error ? error.message : "저장하지 못했어요. 다시 시도해 주세요.";
          // Rejected writes are retained, including permission errors. Never report them as saved.
          this.conflict = (error as {status?: number}).status === 409;
          const status = (error as {status?:number}).status;
          this.pauseRetries = !!status && ![409, 502, 503, 504].includes(status);
          if (this.conflict && pending.reversal) {
            this.queue.shift(); this.conflict = false;
            this.error = "동행이 변경한 내용이 있어 이 작업을 되돌릴 수 없어요. 최신 내용은 유지됩니다.";
            await this.refresh().catch(() => {});
          }
          this.publish();
          if (this.conflict) await this.refresh().catch(() => {});
          return;
        }
        this.publish();
      }
    } finally { this.sending = false; }
  }
  retry() { this.error = ""; this.pauseRetries = false; this.publish(); void this.flush(); }
  discard() { if (this.sending) return; this.queue = []; this.conflict = false; this.pauseRetries = false; this.error = ""; this.publish(); }
  reapply() {
    if (this.sending || !this.conflict) return;
    const projected = this.snapshot.document, keys = [...new Set(this.queue.flatMap(m => m.changes.map(c => c.key)))];
    const values = Object.fromEntries(keys.map(key => [key, projected.entities[key]?.value ?? null]));
    this.queue = []; this.conflict = false; this.error = ""; this.publish(); this.edit(values);
  }
  recovery() { return JSON.stringify({ documentId: this.confirmed.id, pending: this.queue }); }
  async undo(redo = false) {
    if (this.queue.length || this.sending || !this.active || this.unavailable || this.confirmed.deletedAt) return;
    const source = redo ? this.redoStack : this.undoStack;
    const history = source.at(-1); if (!history) return;
    const mutationId = crypto.randomUUID();
    const changes = Object.entries(redo ? history.after : history.before).map(([key, value]) => ({ key, value, expected: history.stamps[key] }));
    this.queue.push({ mutationId, changes, protect: true, reversal: { history, redo } });
    this.publish(); await this.flush();
  }

  deactivate() { this.active = false; this.listeners.clear(); }
}
