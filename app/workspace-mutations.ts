import type { Workspace } from "./types";

type Change = {
  project: (workspace: Workspace) => Workspace;
  send: (workspace: Workspace) => Promise<Workspace>;
  resolve: (workspace: Workspace) => void;
  reject: (error: unknown) => void;
};

/** Replay pending edits over each server response, so a slow save cannot erase newer input. */
export class WorkspaceMutations {
  private changes: Change[] = [];
  constructor(
    private confirmed: Workspace,
    private publish: (workspace: Workspace) => void,
    private pending: (count: number) => void,
  ) {}
  get size() { return this.changes.length; }
  get tripId() { return this.confirmed.trip.id; }
  enqueue(project: Change["project"], send: Change["send"]) {
    const promise = new Promise<Workspace>((resolve, reject) => {
      this.changes.push({ project, send, resolve, reject });
    });
    this.render();
    if (this.changes.length === 1) void this.drain();
    return promise;
  }
  private render() {
    this.pending(this.changes.length);
    this.publish(this.changes.reduce((workspace, change) => change.project(workspace), this.confirmed));
  }
  private async drain() {
    while (this.changes.length) {
      const change = this.changes[0];
      let error: unknown;
      let failed = false;
      try { this.confirmed = await change.send(this.confirmed); }
      catch (reason) { error = reason; failed = true; }
      this.changes.shift();
      this.render();
      if (failed) change.reject(error);
      else change.resolve(this.confirmed);
    }
  }
}
