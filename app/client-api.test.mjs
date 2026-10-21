import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as supabase from "@supabase/supabase-js";
import * as zod from "zod";
import ts from "typescript";

const source = ts.transpileModule(await readFile(new URL("./client-api.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture({ fetch, sessionError = null, configFetch, native = false } = {}) {
  const api = {};
  const calls = [];
  const configuration = () => Response.json({ url: "https://auth.example.test", publishableKey: "public-test", providers: { email: false, google: true, kakao: true } });
  runInNewContext(source, {
    exports: api, Headers, Response, Error,
    fetch: async (url, init) => {
      if (url.endsWith("/api/auth-config")) return configFetch ? configFetch() : configuration();
      calls.push({ url, init });
      return fetch(url, init);
    },
    require: name => {
      if (name === "@supabase/supabase-js") return { ...supabase, createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "test-session" } }, error: sessionError }) } }) };
      if (name === "zod") return zod;
      if (name === "./runtime") return { apiUrl: path => native ? `https://service.example.test${path}` : path, isNativeApp: () => native };
      if (name === "./native-runtime") return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { api, calls, configuration };
}

test("a failed synchronization read is recoverable and the next unchanged response still completes", async () => {
  let online = false;
  const { api, calls } = fixture({ fetch: async () => {
    if (!online) throw new TypeError("Failed to fetch");
    return new Response(null, { status: 304, headers: { ETag: 'W/"same"' } });
  } });
  const etags = [], activity = { background: true, conditional: { etag: 'W/"same"', receiveEtag: value => etags.push(value) } };
  await assert.rejects(api.apiFetch("/api/trips/trip", {}, activity), error => error.status === 0 && error.payload.code === "NETWORK_UNAVAILABLE" && api.isTemporaryApiError(error) && !error.message.includes("Failed to fetch"));
  assert.equal(api.getApiPending(), 0);
  online = true;
  assert.equal(await api.apiFetch("/api/trips/trip", {}, activity), undefined);
  assert.deepEqual(etags, ['W/"same"']);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.get("Authorization"), "Bearer test-session");
  assert.equal(calls[1].init.headers.get("If-None-Match"), 'W/"same"');
});

test("an unavailable auth configuration can recover without reloading the application", async () => {
  let online = false;
  const { api, configuration } = fixture({ configFetch: () => {
    if (!online) throw new TypeError("Failed to fetch");
    return configuration();
  }, fetch: async () => Response.json({ revision: 2 }) });
  await assert.rejects(api.apiFetch("/api/trips/trip"), error => error.status === 0);
  online = true;
  assert.deepEqual(JSON.parse(JSON.stringify(await api.apiFetch("/api/trips/trip"))), { revision: 2 });
  assert.equal(api.getApiPending(), 0);
});

test("temporary session refresh failures do not become logout errors, while invalid sessions remain 401", async () => {
  for (const [error, expected] of [[new supabase.AuthRetryableFetchError("Network request failed", 0), 0], [new supabase.AuthApiError("Invalid refresh token", 401), 401]]) {
    const { api, calls } = fixture({ sessionError: error });
    await assert.rejects(api.apiFetch("/api/trips/trip"), result => result.status === expected && api.isTemporaryApiError(result) === (expected === 0));
    assert.equal(calls.length, 0);
    assert.equal(api.getApiPending(), 0);
  }
});

test("writes with an uncertain response are never automatically replayed", async () => {
  const { api, calls } = fixture({ fetch: async () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(api.apiFetch("/api/trips/trip/actions/save-overview", api.jsonRequest({ rows: [{ date: "2026-11-01", text: "내 입력", version: 1, sourceIds: [] }] })), error => error.status === 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].init.body, /내 입력/);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(api.getApiPending(), 0);
});

test("a truncated successful response is a recoverable failure instead of an empty workspace", async () => {
  const { api } = fixture({ fetch: async () => new Response('{"revision":', { status: 200 }) });
  await assert.rejects(api.apiFetch("/api/trips/trip"), error => error.status === 502 && api.isTemporaryApiError(error));
});

test("permission failures stay visible and cancellation does not become a connection error", async () => {
  const controller = new AbortController(), cancelled = new DOMException("Cancelled", "AbortError");
  const { api, calls } = fixture({ fetch: async (_url, init) => {
    if (init.signal?.aborted) throw cancelled;
    return Response.json({ error: "권한 없음" }, { status: 403 });
  } });
  await assert.rejects(api.apiFetch("/api/trips/trip"), error => error.status === 403 && !api.isTemporaryApiError(error));
  controller.abort();
  await assert.rejects(api.apiFetch("/api/trips/trip", { signal: controller.signal }), error => error === cancelled);
  assert.equal(calls.length, 2);
  assert.equal(api.getApiPending(), 0);
});

test("service outages remain retryable while authentication and permission responses retain their status", async () => {
  let status;
  const { api } = fixture({ fetch: async () => Response.json({ error: "요청 실패" }, { status }) });
  for (status of [502, 503, 504, 401, 403, 404])
    await assert.rejects(api.apiFetch("/api/trips/trip", {}, { background: true }), error => error.status === status && api.isTemporaryApiError(error) === (status >= 500));
});

test("cancelling the response body preserves cancellation instead of reporting a sync outage", async () => {
  const cancelled = new DOMException("Cancelled", "AbortError");
  const { api } = fixture({ fetch: async () => new Response(new ReadableStream({ start(controller) { controller.error(cancelled); } })) });
  await assert.rejects(api.apiFetch("/api/trips/trip"), error => error === cancelled);
  assert.equal(api.getApiPending(), 0);
});

test("native conditional reads preserve the session and validator across unchanged responses", async () => {
  let polls = 0, etag;
  const { api, calls } = fixture({ native: true, fetch: async () => ++polls === 1 ? Response.json({ revision: 4 }, { headers: { ETag: 'W/"current"' } }) : new Response(null, { status: 304, headers: { ETag: 'W/"current"', 'Access-Control-Allow-Origin': 'https://localhost' } }) });
  const conditional = { get etag() { return etag; }, receiveEtag: value => { etag = value; } };
  assert.deepEqual(await api.apiFetch("/api/trips/trip", {}, { background: true, conditional }), { revision: 4 });
  assert.equal(await api.apiFetch("/api/trips/trip", {}, { background: true, conditional }), undefined);
  assert.equal(calls[0].url, "https://service.example.test/api/trips/trip");
  assert.equal(calls[0].init.headers.get("If-None-Match"), null);
  assert.equal(calls[1].init.headers.get("If-None-Match"), 'W/"current"');
  assert.equal(calls[1].init.headers.get("Authorization"), "Bearer test-session");
  assert.equal(etag, 'W/"current"');
});
