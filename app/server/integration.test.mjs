// Real in-memory Postgres, actual migrations, API and HTTP repository adapter.
// Auth verification and the PostgREST HTTP transport are substituted; this does
// not establish hosted JWT verification or multi-connection lock behavior.
import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, readFile, readdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createServer } from "node:http";
import { once } from "node:events";
import { NodeNextRequest } from "next/dist/server/base-http/node.js";
import { NextRequestAdapter } from "next/dist/server/web/spec-extension/adapters/next-request.js";

const directory = await mkdtemp(path.join(tmpdir(), "tripboogie-postgres-test-"));
test.after(() => rm(directory, { recursive: true, force: true }));
await symlink(new URL("../../node_modules", import.meta.url), path.join(directory, "node_modules"), "dir");
const modules = new Set(["../route-graph", "./route-graph", "../media", "./media", "./origin-policy", "./runtime", "./native-runtime", "./native-contract", "./client-api", "./api", "./repository", "./validation", "./planning", "./http", "../countries", "./countries", "./place-alias", "./city-search", "../search-language"]);
function moduleExtensions(context) {
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && modules.has(node.moduleSpecifier.text))
      return context.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
        context.factory.createStringLiteral(`${["../countries","../search-language","../route-graph","../media"].includes(node.moduleSpecifier.text) ? node.moduleSpecifier.text.replace("../","./") : node.moduleSpecifier.text}.mjs`), node.attributes);
    return ts.visitEachChild(node, visit, context);
  };
  return (source) => ts.visitNode(source, visit);
}
for (const [name, relative] of [["city-search","./city-search.ts"], ["media", "../media.ts"], ["place-details", "./place-details.ts"], ["origin-policy", "./origin-policy.ts"], ["runtime", "../runtime.ts"], ["native-runtime", "../native-runtime.ts"], ["native-contract", "../native-contract.ts"], ["api", "./api.ts"], ["repository", "./repository.ts"], ["validation", "./validation.ts"], ["client-api", "../client-api.ts"], ["maps", "./maps.ts"], ["planning", "../planning.ts"], ["route-graph","../route-graph.ts"], ["money","../money.ts"], ["http","./http.ts"], ["tools","./tools.ts"], ["countries","../countries.ts"], ["travel-context","../travel-context.ts"], ["airports","../airports.ts"], ["place-alias","./place-alias.ts"], ["search-language","../search-language.ts"], ["auth-navigation","../auth-navigation.ts"], ["auth-provider","./auth-provider.ts"]]) {
  const source = (await readFile(new URL(relative, import.meta.url), "utf8")).replace('from "./data/airports.json";', 'from "./airports.json" with { type: "json" };');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    transformers: { before: [moduleExtensions] },
  }).outputText;
  await writeFile(path.join(directory, `${name}.mjs`), output);
}
await writeFile(path.join(directory, "airports.json"), await readFile(new URL("../data/airports.json", import.meta.url)));
const { jsonRequest } = await import(pathToFileURL(path.join(directory, "client-api.mjs")));
const { createApiHandler } = await import(pathToFileURL(path.join(directory, "api.mjs")));
const { TripRepository, invitationUrl } = await import(pathToFileURL(path.join(directory, "repository.mjs")));

test("invitation URLs require a bare HTTP(S) app origin and a canonical token", () => {
  const token = "ab".repeat(32);
  for (const origin of ["https://tripboogie.example.test", "http://127.0.0.1:5173"])
    assert.equal(invitationUrl(origin, token), `${origin}/invite/${token}`);
  for (const origin of ["https://tripboogie.example.test/path", "https://tripboogie.example.test?x=1", "https://tripboogie.example.test#x", "https://user:password@tripboogie.example.test", "javascript:alert(1)", "//evil.example", "https://tripboogie.example.test/"])
    assert.throws(() => invitationUrl(origin, token));
  for (const token of ["../escape", "ab?x=1", "%2Fescape", "ab".repeat(31)])
    assert.throws(() => invitationUrl("https://tripboogie.example.test", token));
});

test("repository refuses redirects without forwarding credentials or hiding the HTTP failure", async () => {
  let requests = 0;
  const repo = new TripRepository({url:"https://supabase.example.test",publishableKey:"public-test",authorization:"Bearer test_owner",fetch:async (url,init) => {
    requests++;
    assert.equal(init.redirect,"manual");
    return new Response(null,{status:307,headers:{Location:"https://untrusted.example.test"}});
  }});
  const original = console.error;
  const diagnostics = [];
  console.error = (...args) => diagnostics.push(args);
  try {
    await assert.rejects(repo.list(),error => error.status === 503 && error.code === "DATABASE_UNAVAILABLE");
    assert.equal(requests,1);
    assert.equal(diagnostics[0][1].status,307);
    assert.equal(JSON.stringify(diagnostics).includes("test_owner"),false);
  } finally { console.error = original; }
});

const users = Object.fromEntries(["owner", "editor", "viewer", "outsider"].map((name, index) => [name, {
  id: `10000000-0000-4000-8000-00000000000${index + 1}`, name, email: `${name}@example.test`,
}]));
const details = { title: "Private Tokyo", destination: "Tokyo", startDate: "2026-11-01", endDate: "2026-11-05", currency: "JPY", timezone: "Asia/Tokyo" };
const checklist = { title: "Passport", done: false, category: "before" };

async function fixture({beforeMigration}={}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert,delete on storage.objects to authenticated;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    if(beforeMigration && file.endsWith(beforeMigration))break;
    await db.exec(await readFile(new URL(file, migrations), "utf8"));
  }
  for (const user of Object.values(users))
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)", [user.id, user.email, JSON.stringify({ name: user.name })]);
  async function asUser(name, callback, role = "authenticated") {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [users[name]?.id ?? ""]);
      return callback(tx);
    });
  }
  async function rpc(name, operation, tripId = null, payload = {}) {
    return asUser(name, async (tx) => (await tx.query("select public.tripboogie_api($1,$2,$3::jsonb) as result", [operation, tripId, JSON.stringify(payload)])).rows[0].result);
  }
  async function transport(url, init) {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/tripboogie_api");
    assert.equal(init.headers.apikey, "publishable-test-key");
    assert.equal(init.redirect, "manual");
    const name = init.headers.authorization.replace("Bearer test_", "");
    const { p_operation, p_trip_id, p_payload } = JSON.parse(init.body);
    try { return Response.json(await rpc(name, p_operation, p_trip_id, p_payload)); }
    catch (error) {
      const status = /^PT\d{3}$/.test(error.code) ? Number(error.code.slice(2)) : 400;
      return Response.json({ code: error.code, message: error.message, details: error.detail }, { status });
    }
  }
  const handler = createApiHandler({
    resolveUser: async (request) => users[request.headers.get("authorization")?.replace("Bearer test_", "")] ?? null,
    repository: (request) => new TripRepository({ url: "https://supabase.example.test", publishableKey: "publishable-test-key", authorization: request.headers.get("authorization") ?? "", fetch: transport }),
  });
  const origin = "https://tripboogie.example.test";
  async function request(route, user = "owner", method = "GET", body, requestOrigin = origin) {
    const response = await handler(new Request(`${origin}/api/${route}`, {
      method,
      headers: { ...(user ? { authorization: `Bearer test_${user}` } : {}), ...(method !== "GET" ? { Origin: requestOrigin } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), route.split("/"));
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  return { db, asUser, rpc, request, handler, origin };
}

test("browser JSON command through HTTP and the real Next.js adapter accepts invitations", async () => {
  const { db, request, handler } = await fixture();
  let transportOrigin;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const adapted = new NodeNextRequest(incoming);
      // Preserve the real loopback origin: NextURL normalizes it to localhost.
      adapted.url = new URL(incoming.url, transportOrigin).href;
      const nextRequest = NextRequestAdapter.fromNodeNextRequest(adapted, new AbortController().signal);
      if (incoming.method === "POST") assert.ok(nextRequest.body, "Next exposes an empty POST as a body stream too");
      const segments = new URL(nextRequest.url).pathname.slice("/api/".length).split("/");
      const response = await handler(nextRequest, segments);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch (error) {
      outgoing.writeHead(500); outgoing.end(String(error));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const trip = (await request("trips", "owner", "POST", details)).body.trip;
    const invitation = await request(`trips/${trip.id}/invites`, "owner", "POST", { role: "editor" });
    const token = new URL(invitation.body.url).pathname.split("/").at(-1);
    transportOrigin=`http://127.0.0.1:${server.address().port}`;
    const endpoint = `${transportOrigin}/api/invites/${token}`;
    async function send(init) {
      const headers = new Headers(init.headers);
      if (!headers.has("Origin")) headers.set("Origin", transportOrigin);
      headers.set("Authorization", "Bearer test_editor");
      const response = await fetch(endpoint, { ...init, headers });
      return { status: response.status, body: await response.json() };
    }
    assert.equal((await send({ method: "POST" })).status, 415);
    assert.equal((await send({ method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" })).status, 415);
    assert.equal((await send({ method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400);
    assert.equal((await send({ method: "POST", headers: { "Content-Type": "application/json" }, body: "" })).status, 400);
    assert.equal((await send(jsonRequest(null))).status, 400);
    assert.equal((await send(jsonRequest({ extra: "x".repeat(65536) }))).status, 413);
    assert.equal((await send(jsonRequest({}, { headers: { Origin: "https://evil.example" } }))).status, 403);
    assert.equal((await db.query("select count(*)::int as count from public.trip_members where trip_id=$1", [trip.id])).rows[0].count, 1);
    assert.equal((await send(jsonRequest({}, {headers:{Origin:`http://localhost:${server.address().port}`}}))).status,403);
    assert.equal((await send(jsonRequest({}, {headers:{Origin:`http://127.0.0.1:${server.address().port+1}`}}))).status,403);
    const joined = await send(jsonRequest());
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.body.trip.role, "editor");
    assert.equal(joined.body.trip.memberCount, 2);
    assert.equal((await send(jsonRequest())).body.revision, joined.body.revision);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});

test("collaborative API through Postgres: invitations, permissions, CAS, references and validation", async () => {
  const { db, asUser, rpc, request } = await fixture();
  try {
    assert.equal((await request("trips", "")).status, 401);
    assert.equal((await request("trips", "owner", "POST", details, "https://evil.example")).status, 403);
    assert.equal((await request("trips", "owner", "POST", { ...details, startDate: "2026-02-30" })).status, 400);
    assert.equal((await request("trips", "owner", "POST", { ...details, endDate: "2028-01-01" })).status, 400);
    const created = await request("trips", "owner", "POST", { ...details, owner_id: users.outsider.id });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.match(created.headers.get("cache-control"), /no-store/);
    const tripId = created.body.trip.id, route = `trips/${tripId}`;
    assert.equal(created.body.trip.role, "owner");
    assert.equal(created.body.trip.memberCount, 1);
    assert.equal((await db.query("select owner_id from public.trips where id=$1", [tripId])).rows[0].owner_id, users.owner.id);
    assert.equal((await request(route, "outsider")).status, 404);
    assert.equal((await request("trips", "outsider")).body.trips.length, 0);

    const editorInvite = await request(`${route}/invites`, "owner", "POST", { role: "editor" });
    assert.equal(editorInvite.status, 201, JSON.stringify(editorInvite.body));
    const editorToken = new URL(editorInvite.body.url).pathname.split("/").at(-1);
    assert.match(editorToken, /^[0-9a-f]{64}$/);
    assert.equal((await request(`invites/${editorToken}`, "")).status, 401);
    assert.equal((await request(`invites/${editorToken}`, "editor")).body.tripTitle, details.title);
    const joined = await request(`invites/${editorToken}`, "editor", "POST", {});
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.body.trip.role, "editor");
    assert.equal(joined.body.trip.memberCount, 2);
    assert.equal((await request(`invites/${editorToken}`, "editor", "POST", {})).body.revision, joined.body.revision);
    const viewerInvite = await request(`${route}/invites`, "owner", "POST", { role: "viewer" });
    const viewerToken = new URL(viewerInvite.body.url).pathname.split("/").at(-1);
    assert.equal((await request(`invites/${viewerToken}`, "viewer", "POST", {})).body.trip.role, "viewer");
    assert.equal((await request(`invites/${editorToken}`, "viewer", "POST", {})).body.trip.role, "viewer");
    assert.equal((await request(`invites/${viewerToken}`, "owner", "POST", {})).body.trip.role, "owner");
    assert.equal((await request(`${route}/invites`, "editor", "POST", { role: "editor" })).status, 403);
    assert.equal((await request(route, "viewer", "POST", { action: "upsert", kind: "checklist", data: checklist })).status, 403);

    const added = await request(route, "editor", "POST", { action: "upsert", kind: "checklist", data: checklist });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    const record = added.body.records[0];
    const competing = await Promise.all([true, false].map((done) => request(route, "editor", "POST", { action: "upsert", id: record.id, kind: "checklist", version: record.version, data: { ...checklist, done } })));
    assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
    const latest = (await request(route)).body.records.find((r) => r.id === record.id);
    assert.equal(typeof latest.data.done, "boolean");
    assert.equal(latest.version, 2);
    const distinct = await Promise.all(["Booking", "Insurance"].map((title) => request(route, "editor", "POST", { action: "upsert", kind: "checklist", data: { ...checklist, title } })));
    assert.deepEqual(distinct.map((r) => r.status), [200, 200]);
    assert.equal((await request(route, "owner", "POST", { action: "delete", id: record.id, version: latest.version })).status, 200);
    for (const version of [undefined, latest.version])
      assert.equal((await request(route, "owner", "POST", { action: "upsert", id: record.id, kind: "checklist", version, data: checklist })).status, 409);
    assert.equal((await db.query("select deleted from public.trip_records where id=$1", [record.id])).rows[0].deleted, true);
    const otherTrip = (await request("trips", "owner", "POST", { ...details, title: "Other" })).body.trip.id;
    assert.equal((await request(`trips/${otherTrip}`, "owner", "POST", { action: "upsert", id: record.id, kind: "checklist", data: checklist })).status, 409);

    const placed = await request(route, "owner", "POST", { action: "upsert", kind: "place", data: { name: "Station", address: "Tokyo", lat: 35.681, lng: 139.767 } });
    const place = placed.body.records.find((r) => r.kind === "place");
    const plan = { title: "Meet friend", date: "2026-11-05", time: "10:30", note: "", placeId: place.id, duration: 60 };
    assert.equal((await request(route, "editor", "POST", { action: "upsert", kind: "plan", data: plan })).status, 200);
    assert.equal((await request(route, "editor", "POST", { action: "delete", id: place.id, kind: "place", version: place.version })).status, 409);
    assert.equal((await request(route, "editor", "POST", { action: "upsert", kind: "plan", data: { ...plan, date: "2026-11-06" } })).status, 400);
    assert.equal((await request(route, "editor", "POST", { action: "upsert", kind: "plan", data: { ...plan, placeId: crypto.randomUUID() } })).status, 409);
    assert.equal((await request(route, "owner", "POST", { action: "update-trip", version: 1, data: { ...details, endDate: "2026-11-04" } })).status, 409);
    const renamed = await request(route, "owner", "POST", { action: "update-trip", version: 1, data: { title: "Renamed" } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.trip.timezone, "Asia/Tokyo");
    assert.equal((await request(route, "owner", "POST", { action: "update-trip", version: 1, data: details })).status, 409);

    const expense = { title: "Lunch", amount: "2300.50", currency: "JPY", payer: "Me", participants: ["Me", "Friend", "Me"], date: "2026-11-02" };
    const spent = await request(route, "editor", "POST", { action: "upsert", kind: "expense", data: expense });
    assert.equal(spent.status, 200, JSON.stringify(spent.body));
    assert.deepEqual(spent.body.records.find((r) => r.kind === "expense").data.participants, ["Me", "Friend"]);
    for (const [kind, data] of [["expense", { ...expense, amount: -2 }], ["place", { name: "Bad", lat: true, lng: false }], ["plan", { ...plan, duration: [] }], ["checklist", { ...checklist, done: "true" }]])
      assert.equal((await request(route, "editor", "POST", { action: "upsert", kind, data })).status, 400);
    assert.equal((await request(route, "owner", "POST", { action: "upsert", kind: "checklist", data: { ...checklist, title: "x".repeat(70000) } })).status, 413);
    await assert.rejects(rpc("owner", "mutate", tripId, { action: "upsert", kind: "checklist", data: { ...checklist, title: "x".repeat(70000) } }), { code: "PT413" });

    // Direct Data API access still obeys RLS; direct writes cannot bypass RPC.
    assert.equal((await asUser("outsider", (tx) => tx.query("select * from public.trip_records where trip_id=$1", [tripId]))).rows.length, 0);
    assert.equal((await asUser("outsider", (tx) => tx.query("select * from public.profiles where id=$1", [users.owner.id]))).rows.length, 0);
    assert.ok((await asUser("editor", (tx) => tx.query("select * from public.trip_records where trip_id=$1", [tripId]))).rows.length > 0);
    assert.equal((await asUser("viewer", (tx) => tx.query("select * from public.trip_invites where trip_id=$1", [tripId]))).rows.length, 0);
    await assert.rejects(asUser("editor", (tx) => tx.query("update public.trip_records set data='{}' where trip_id=$1", [tripId])), { code: "42501" });
    await assert.rejects(asUser("outsider", (tx) => tx.query("select tripboogie_private.workspace($1)", [tripId])), { code: "42501" });
    await assert.rejects(asUser("", (tx) => tx.query("select public.tripboogie_api('list')"), "anon"), { code: "42501" });
    await assert.rejects(rpc("", "list"), { code: "PT401" });

    assert.equal((await request(`${route}/members/${users.owner.id}`, "owner", "DELETE")).status, 400);
    assert.equal((await request(`${route}/members/${users.editor.id}`, "owner", "DELETE")).status, 200);
    assert.equal((await request(route, "editor")).status, 404);
    assert.equal((await request(route, "editor", "POST", { action: "upsert", kind: "checklist", data: checklist })).status, 404);
    assert.equal((await asUser("editor", (tx) => tx.query("select * from public.trip_records where trip_id=$1", [tripId]))).rows.length, 0);
    assert.equal((await request(`${route}/invites`, "owner", "DELETE", { id: editorInvite.body.id })).status, 200);
    assert.equal((await request(`invites/${editorToken}`, "outsider", "POST", {})).status, 409);
    await db.query("update public.trip_invites set expires_at='2000-01-01' where id=$1", [viewerInvite.body.id]);
    assert.equal((await request(`invites/${viewerToken}`, "outsider", "POST", {})).status, 409);
    const hashes = (await db.query("select token_hash from public.trip_invites")).rows;
    assert.ok(hashes.every((row) => row.token_hash !== editorToken && row.token_hash !== viewerToken));
    const inviteList = (await request(`${route}/invites`)).body.invites;
    assert.ok(inviteList.every((row) => !("token_hash" in row) && !("token" in row)));

    // Bounded bulk setup, then exercise the production capacity guard.
    const largePlace = JSON.stringify({ name: "Budget", address: "", lat: null, lng: null, category: "", note: "x".repeat(10000) });
    await db.query("insert into public.trip_records(trip_id,kind,data,updated_by) select $1,'place',$2::jsonb,$3 from generate_series(1,207)", [otherTrip, largePlace, users.owner.id]);
    assert.equal((await request(`trips/${otherTrip}`, "owner", "POST", { action: "upsert", kind: "place", data: { name: "Too large", note: "x".repeat(10000) } })).status, 409);
    const budgetRow = (await db.query("select id,version from public.trip_records where trip_id=$1 limit 1", [otherTrip])).rows[0];
    assert.equal((await request(`trips/${otherTrip}`, "owner", "POST", { action: "upsert", id: budgetRow.id, version: Number(budgetRow.version), kind: "place", data: { name: "Smaller" } })).status, 200);
  } finally { await db.close(); }
});

test("database-owned resource limits and grants cannot be bypassed through RPC", async () => {
  const { db, rpc, asUser } = await fixture();
  try {
    const trip = (await rpc("owner", "create", null, { data: details })).trip.id;
    const valid = JSON.stringify(checklist);
    await db.query("insert into public.trip_records(trip_id,kind,data,updated_by) select $1,'checklist',$2::jsonb,$3 from generate_series(1,5000)", [trip, valid, users.owner.id]);
    await assert.rejects(rpc("owner", "mutate", trip, { action: "upsert", kind: "checklist", data: checklist }), { code: "PT409" });
    await db.query("update public.trip_records set deleted=true where trip_id=$1", [trip]);
    await db.query("insert into public.trip_records(trip_id,kind,data,updated_by,deleted) select $1,'checklist',$2::jsonb,$3,true from generate_series(1,15000)", [trip, valid, users.owner.id]);
    await assert.rejects(rpc("owner", "mutate", trip, { action: "upsert", kind: "checklist", data: checklist }), { code: "PT409" });

    await db.query("insert into public.trip_invites(trip_id,token_hash,role,expires_at,created_by) select $1,encode(sha256(convert_to(i::text,'UTF8')),'hex'),'editor',now()+interval '1 day',$2 from generate_series(1,20) i", [trip, users.owner.id]);
    await assert.rejects(rpc("owner", "create-invite", trip, { role: "editor", token: "ab".repeat(32) }), { code: "PT409" });
    await db.query("update public.trip_invites set revoked_at=now() where trip_id=$1", [trip]);
    await db.query("insert into public.trip_invites(trip_id,token_hash,role,expires_at,revoked_at,created_by) select $1,encode(sha256(convert_to(i::text,'UTF8')),'hex'),'editor',now()+interval '1 day',now(),$2 from generate_series(21,1000) i", [trip, users.owner.id]);
    await assert.rejects(rpc("owner", "create-invite", trip, { role: "editor", token: "cd".repeat(32) }), { code: "PT409" });

    await db.query("insert into public.trips(owner_id,title,destination,start_date,end_date,currency,timezone) select $1,'Quota','Tokyo','2026-11-01','2026-11-02','JPY','Asia/Tokyo' from generate_series(1,99)", [users.owner.id]);
    await db.query("insert into public.trip_members(trip_id,user_id,role) select id,$1,'owner' from public.trips where id<>$2", [users.owner.id, trip]);
    await assert.rejects(rpc("owner", "create", null, { data: details }), { code: "PT409" });
    assert.equal((await rpc("owner", "list")).length, 100);

    const grants = (await asUser("owner", (tx) => tx.query("select c.relname, has_table_privilege(current_user,c.oid,'INSERT') as ins,has_table_privilege(current_user,c.oid,'UPDATE') as upd,has_table_privilege(current_user,c.oid,'DELETE') as del from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'"))).rows;
    assert.equal(grants.length, 7);
    assert.ok(grants.every((r) => !r.ins && !r.upd && !r.del));
  } finally { await db.close(); }
});

test("server backup imports are atomic, remap references, retry safely and delete with owner revision", async () => {
  const {db,request,asUser}=await fixture();
  try {
    const placeId=crypto.randomUUID(),planId=crypto.randomUUID(),key=crypto.randomUUID();
    const payload={key,trip:details,records:[{id:planId,kind:"plan",data:{title:"First",date:details.startDate,time:"10:00",placeId}},
      {id:placeId,kind:"place",data:{name:"Tokyo Station",lat:35.6812,lng:139.7671}},
      ...Array.from({length:9},(_,i)=>({id:crypto.randomUUID(),kind:"plan",data:{title:`Note ${i}`,date:details.startDate,time:"",note:"x".repeat(9000)}}))]};
    assert.ok(JSON.stringify(payload).length>65536);
    const imported=await request("trips/import","owner","POST",payload);
    assert.equal(imported.status,201,JSON.stringify(imported.body));
    const w=imported.body,id=w.trip.id;
    assert.equal(w.records.length,11);assert.equal(w.members.length,1);
    const place=w.records.find(r=>r.kind==="place"),plan=w.records.find(r=>r.data.title==="First");
    assert.notEqual(place.id,placeId);assert.notEqual(plan.id,planId);assert.equal(plan.data.placeId,place.id);
    assert.equal(typeof plan.data.position,"number");
    assert.equal((await request("trips/import","owner","POST",payload)).body.trip.id,id);
    assert.equal((await request("trips/import","owner","POST",{...payload,trip:{...details,title:"changed"}})).status,409);
    const count=(await db.query("select count(*)::int n from public.trips")).rows[0].n;
    const invalid={...payload,key:crypto.randomUUID(),records:[...payload.records,{id:crypto.randomUUID(),kind:"plan",data:{title:"Bad",date:details.startDate,placeId:crypto.randomUUID()}}]};
    assert.equal((await request("trips/import","owner","POST",invalid)).status,400);
    assert.equal((await db.query("select count(*)::int n from public.trips")).rows[0].n,count);
    assert.equal((await request("trips/import","owner","POST",{...payload,key:crypto.randomUUID(),records:[payload.records[0],payload.records[0]]})).status,400);
    await asUser("owner",tx=>assert.rejects(tx.query("select * from tripboogie_private.import_receipts"),/permission denied/));
    const invitation=(await request(`trips/${id}/invites`,"owner","POST",{role:"editor"})).body;
    await request(`invites/${new URL(invitation.url).pathname.split("/").at(-1)}`,"editor","POST",{});
    assert.equal((await request(`trips/${id}`,"editor","DELETE",{revision:w.revision})).status,403);
    const updated=await request(`trips/${id}`,"owner","POST",{action:"upsert",kind:"checklist",data:checklist});
    assert.equal((await request(`trips/${id}`,"owner","DELETE",{revision:w.revision})).status,409);
    assert.equal((await request(`trips/${id}`,"owner","DELETE",{revision:updated.body.revision})).status,200);
    assert.equal((await request(`trips/${id}`,"editor")).status,404);
    assert.equal((await db.query("select count(*)::int n from public.trip_records where trip_id=$1",[id])).rows[0].n,0);
    assert.equal((await request("trips/import","owner","POST",payload)).status,409);
  }finally{await db.close();}
});

test("ordered itineraries persist reorder, batch copy/move, day swap, shift and reject stale or unauthorized edits",async()=>{
  const {db,request}=await fixture();
  try{
    let w=(await request("trips","owner","POST",details)).body;
    const route=`trips/${w.trip.id}`;
    const mapAdded=await request(`${route}/map-place`,"owner","POST",{place:{name:"Station",lat:35.6812,lng:139.7671},date:details.startDate});
    assert.equal(mapAdded.status,201,JSON.stringify(mapAdded.body));w=mapAdded.body;
    for(let i=0;i<3;i++)w=(await request(route,"owner","POST",{action:"upsert",kind:"plan",data:{title:`Step ${i}`,date:details.startDate,time:`0${i}:00`}})).body;
    const order=()=>w.records.filter(r=>r.kind==="plan").sort((a,b)=>a.data.position-b.data.position);
    const ids=order().map(r=>r.id),reversed=ids.toReversed();
    async function edit(operation,options={}){
      const r=await request(`${route}/schedule`,"owner","POST",{operation,revision:w.revision,sourceDate:details.startDate,ids:[],...options});
      assert.equal(r.status,200,JSON.stringify(r.body));w=r.body;return r;
    }
    const oldRevision=w.revision;
    await edit("reorder",{ids:reversed});assert.deepEqual(order().map(r=>r.id),reversed);
    assert.equal((await request(`${route}/schedule`,"owner","POST",{operation:"delete",revision:oldRevision,sourceDate:details.startDate,ids})).status,409);
    assert.equal((await request(`${route}/schedule`,"outsider","POST",{operation:"delete",revision:w.revision,sourceDate:details.startDate,ids})).status,404);
    const invitation=(await request(`${route}/invites`,"owner","POST",{role:"viewer"})).body;
    w=(await request(`invites/${new URL(invitation.url).pathname.split("/").at(-1)}`,"viewer","POST",{})).body;
    assert.equal((await request(`${route}/schedule`,"viewer","POST",{operation:"delete",revision:w.revision,sourceDate:details.startDate,ids})).status,403);
    assert.equal((await request(`${route}/map-place`,"viewer","POST",{place:{name:"X"}})).status,403);
    assert.equal((await request(`${route}/schedule`,"owner","POST",{operation:"reorder",revision:w.revision,sourceDate:details.startDate,ids:ids.slice(1)})).status,409);
    await edit("copy",{ids:[reversed[0]],targetDate:"2026-11-02"});
    const copied=w.records.find(r=>r.kind==="plan"&&!ids.includes(r.id));assert.ok(copied);
    await edit("move",{ids:[reversed[1]],targetDate:"2026-11-02"});
    assert.equal(w.records.find(r=>r.id===reversed[1]).data.date,"2026-11-02");
    await edit("swap-days",{targetDate:"2026-11-02"});
    assert.equal(w.records.find(r=>r.id===copied.id).data.date,details.startDate);
    const loaded=(await request(route)).body;assert.equal(loaded.revision,w.revision);assert.deepEqual(loaded.records,w.records);
    const shifted=await request(route,"owner","POST",{action:"update-trip",version:w.trip.version,revision:w.revision,data:{startDate:"2026-12-01",endDate:"2026-12-05",shiftDates:true}});
    assert.equal(shifted.status,200,JSON.stringify(shifted.body));w=shifted.body;
    assert.ok(w.records.filter(r=>r.kind==="plan").every(r=>r.data.date.startsWith("2026-12-")));
    const before=w.records.length;
    assert.equal((await request(`${route}/map-place`,"owner","POST",{place:{name:"Invalid atomic",lat:1,lng:1},date:"2025-01-01"})).status,400);
    assert.equal((await request(route)).body.records.length,before);
    const toDelete=w.records.filter(r=>r.kind==="plan"&&r.data.date==="2026-12-01").map(r=>r.id);
    const deleted=await request(`${route}/schedule`,"owner","POST",{operation:"delete",revision:w.revision,sourceDate:"2026-12-01",ids:toDelete});
    assert.equal(deleted.status,200,JSON.stringify(deleted.body));assert.ok(deleted.body.records.some(r=>r.kind==="place"));
  }finally{await db.close();}
});

test("map proxy validates input, hides provider keys, caches normalized data, and requires auth",async()=>{
  const {createMapHandler}=await import(pathToFileURL(path.join(directory,"maps.mjs")));
  let count=0,budgets=0;
  const handler=createMapHandler({key:"private-map-test",resolveUser:async r=>r.headers.has("authorization")?users.owner:null,budget:async()=>{budgets++;},fetch:async(url,init)=>{
    count++;assert.equal(new URL(url).hostname,"api.geoapify.com");assert.equal(new URL(url).searchParams.get("apiKey"),"private-map-test");assert.equal(init.redirect,"manual");assert.equal(init.headers,undefined);
    if(new URL(url).pathname.includes("geocode"))return Response.json({features:[{properties:{name:"Station",formatted:"Tokyo Station",lat:35.6812,lon:139.7671,secret:"discard"}}]});
    return Response.json({features:[{geometry:{type:"MultiLineString",coordinates:[[[139.7671,35.6812],[139.77,35.69]]]},properties:{distance:1234,time:900,legs:[{distance:1234,time:900}],apiKey:"must-not-return"}}]});
  }});
  async function send(op,body,auth=true){const r=await handler(new Request("https://tripboogie.example.test/api/maps/"+op,jsonRequest(body,{headers:{Origin:"https://tripboogie.example.test",...(auth?{Authorization:"Bearer test_owner"}:{})}})),op);return{status:r.status,body:await r.json()};}
  assert.equal((await send("search",{query:"Tokyo test"},false)).status,401);
  assert.equal((await send("route",{mode:"drive",points:[{lat:999,lng:1},{lat:1,lng:1}]})).status,400);
  assert.equal(count,0);
  const searched=await send("search",{query:"Tokyo test"});assert.equal(searched.status,200);assert.equal(searched.body.places.length,1);assert.equal(searched.body.places[0].lng,139.7671);
  assert.equal((await send("search",{query:"Tokyo test"})).status,200);assert.equal(count,1);assert.equal(budgets,1);
  const routed=await send("route",{mode:"walk",points:[{lat:35.6812,lng:139.7671},{lat:35.69,lng:139.77}]});
  assert.equal(routed.status,200);assert.equal(routed.body.distance,1234);assert.equal(routed.body.geometry.type,"MultiLineString");
  assert.ok(!JSON.stringify(routed).includes("must-not-return"));assert.ok(!JSON.stringify(searched).includes("private-map-test"));
});

test("distance ordering anchors the first located stop and preserves unlocated slots",async()=>{
  const {distanceOrder}=await import(pathToFileURL(path.join(directory,"planning.mjs")));
  const places=[{id:"a",data:{lat:0,lng:0}},{id:"b",data:{lat:0,lng:2}},{id:"c",data:{lat:0,lng:1}}];
  const plans=[{id:"1",data:{placeId:"a"}},{id:"2",data:{}},{id:"3",data:{placeId:"b"}},{id:"4",data:{placeId:"c"}}];
  assert.deepEqual(distanceOrder(plans,places),["1","2","4","3"]);
});

test("database map budget shares its throttle across accounts and rejects direct helper access",async()=>{
  const {db,rpc,asUser}=await fixture();
  try{
    assert.equal((await rpc("owner","map-budget")).ok,true);
    await assert.rejects(rpc("editor","map-budget"),e=>e.code==="PT429");
    await db.exec("update tripboogie_private.map_rate_limits set window_at='2000-01-01' where scope='global'");
    assert.equal((await rpc("editor","map-budget")).ok,true);
    await db.query("update tripboogie_private.map_rate_limits set requests=30,window_at=clock_timestamp() where scope=$1",[users.owner.id]);
    await db.exec("update tripboogie_private.map_rate_limits set window_at='2000-01-01' where scope='global'");
    await assert.rejects(rpc("owner","map-budget"),e=>e.code==="PT429");
    await asUser("owner",tx=>assert.rejects(tx.query("select tripboogie_private.map_budget()"),/permission denied/));
  }finally{await db.close();}
});

test("detailed workspace persists memo boundaries, per-member checks, expense snapshots, hotel ownership and private files", async()=>{
 const {db,rpc,asUser}=await fixture();try{
  let w=await rpc("owner","create",null,{data:details}),id=w.trip.id;
  for(const name of ["editor","viewer"]){await rpc("owner","create-invite",id,{role:name,token:(name==="editor"?"ab":"cd").repeat(32)});await rpc(name,"join",null,{token:(name==="editor"?"ab":"cd").repeat(32)});}
  const p=await rpc("owner","profile");assert.equal(p.baseCurrency,"KRW");
  w=await rpc("editor","save-plan",id,{data:{title:"Tokyo Station",date:details.startDate,entryType:"plan"},place:{name:"Tokyo Station",address:"Tokyo",lat:35.68,lng:139.76}});
  assert.equal(w.records.filter(r=>r.kind==="plan").length,1);assert.equal(w.records.filter(r=>r.kind==="place").length,1);
  const before=w.revision;
  await assert.rejects(rpc("editor","save-plan",id,{data:{title:"",date:details.startDate},place:{name:"Rollback",lat:1,lng:2}}),{code:"PT400"});
  assert.equal((await rpc("owner","workspace",id)).revision,before);
  w=await rpc("owner","mutate",id,{action:"upsert",kind:"plan",data:{title:"Remember",date:details.startDate,entryType:"memo",placeId:w.records.find(r=>r.kind==="place").id}});
  assert.equal(w.records.find(r=>r.data.entryType==="memo").data.placeId,"");
  w=await rpc("owner","mutate",id,{action:"upsert",kind:"checklist",data:{title:"Passport",scope:"all",done:false,checks:{[users.editor.id]:"forged"}}});
  let c=w.records.find(r=>r.kind==="checklist");assert.equal(c.createdBy,users.owner.id);assert.deepEqual(c.data.checks,{});
  w=await rpc("viewer","checklist-toggle",id,{id:c.id,done:true});c=w.records.find(r=>r.id===c.id);assert.ok(c.data.checks[users.viewer.id]);assert.equal(c.data.checks[users.editor.id],undefined);
  w=await rpc("owner","mutate",id,{action:"upsert",id:c.id,version:c.version,kind:"checklist",data:{...c.data,title:"Passport updated",checks:{[users.owner.id]:"forged"}}});
  c=w.records.find(r=>r.id===c.id);assert.ok(c.data.checks[users.viewer.id]);assert.equal(c.data.checks[users.owner.id],undefined);
  const expense={model:2,title:"Lunch",category:"food",tripCurrency:"JPY",baseCurrency:"KRW",paidCurrency:"JPY",tripAmount:"1000",baseAmount:"9500",exchangeRate:"9.5",rateDate:"2026-10-16",period:"day",date:details.startDate,payers:[{userId:users.owner.id,name:"owner",amount:"400"},{userId:users.editor.id,name:"editor",amount:"600"}],participants:[{userId:users.owner.id,name:"owner"},{userId:users.editor.id,name:"editor"}]};
  w=await rpc("editor","mutate",id,{action:"upsert",kind:"expense",data:expense});let e=w.records.find(r=>r.kind==="expense");
  assert.equal(e.data.baseAmount,"9500");assert.equal(e.data.tripAmount,"1000");
  await rpc("owner","update-profile",null,{name:"New owner",baseCurrency:"USD",version:p.version});
  assert.equal((await rpc("owner","workspace",id)).records.find(r=>r.id===e.id).data.baseCurrency,"KRW");
  await assert.rejects(rpc("editor","mutate",id,{action:"upsert",kind:"expense",data:{...expense,payers:[{userId:users.owner.id,name:"owner",amount:"999"}]}}),{code:"PT400"});
  w=await rpc("owner","mutate",id,{action:"upsert",kind:"expense",id:e.id,version:e.version,data:{...e.data,baseAmount:"9400"}});e=w.records.find(r=>r.id===e.id);assert.equal(e.data.tripAmount,"1000");assert.equal(e.data.baseAmount,"9400");
  const booking={type:"hotel",title:"Tokyo Hotel",startDate:details.startDate,endDate:"2026-11-03",startTime:"15:00",endTime:"11:00"};
  w=await rpc("owner","save-booking",id,{data:booking,place:{name:"Hotel",lat:35.69,lng:139.77}});let b=w.records.find(r=>r.kind==="booking");let autos=w.records.filter(r=>r.data.bookingId===b.id);assert.equal(autos.length,3);assert.equal(autos[0].data.bookingManaged,true);
  const manual=autos[0];w=await rpc("editor","mutate",id,{action:"upsert",kind:"plan",id:manual.id,version:manual.version,data:{...manual.data,title:"My custom check-in"}});
  b=w.records.find(r=>r.id===b.id);w=await rpc("owner","mutate",id,{action:"upsert",kind:"booking",id:b.id,version:b.version,data:{...b.data,title:"Renamed Hotel"}});assert.equal(w.records.find(r=>r.id===manual.id).data.title,"My custom check-in");
  assert.equal(w.records.filter(r=>r.data.bookingId===b.id).length,3);
  await assert.rejects(rpc("viewer","prepare-file",id,{name:"a.pdf",mime:"application/pdf",size:10,bookingId:b.id}),{code:"PT403"});
  const prepared=await rpc("editor","prepare-file",id,{name:"a.pdf",mime:"application/pdf",size:10,bookingId:b.id}),f=prepared.file;
  await assert.rejects(rpc("editor","finish-file",id,{id:f.id}),{code:"PT409"});
  await assert.rejects(asUser("outsider",tx=>tx.query("insert into storage.objects(bucket_id,name,metadata) values('tripboogie-private',$1,'{\"size\":10}')",[f.path])),{code:"42501"});
  await asUser("editor",tx=>tx.query("insert into storage.objects(bucket_id,name,metadata) values('tripboogie-private',$1,'{\"size\":10}')",[f.path]));
  assert.equal((await asUser("viewer",tx=>tx.query("select * from storage.objects"))).rows.length,0);
  w=(await rpc("editor","finish-file",id,{id:f.id})).workspace;assert.equal(w.files[0].status,"ready");
  assert.equal((await asUser("viewer",tx=>tx.query("select * from storage.objects"))).rows.length,1);assert.equal((await asUser("outsider",tx=>tx.query("select * from storage.objects"))).rows.length,0);
  await assert.rejects(rpc("owner","delete-trip",id,{revision:w.revision}),{code:"PT409"});
  await rpc("owner","mark-file-delete",id,{id:f.id});await assert.rejects(rpc("owner","finish-file-delete",id,{id:f.id}),{code:"PT409"});
  await asUser("owner",tx=>tx.query("delete from storage.objects where name=$1",[f.path]));
  w=(await rpc("owner","finish-file-delete",id,{id:f.id})).workspace;assert.equal(w.files.length,0);
  const imported=await rpc("owner","import",null,{key:crypto.randomUUID(),trip:w.trip,records:w.records.map(({id,kind,data})=>({id,kind,data}))});
  assert.ok(imported.records.some(r=>r.kind==="booking"));assert.ok(imported.records.filter(r=>r.kind==="booking").every(r=>!w.records.some(old=>old.id===r.id)));
 }finally{await db.close();}
});

test("day route graph skips memos but breaks at unlocated itineraries; fixed-point amounts preserve independent edits",async()=>{
 const {dayGraph}=await import(pathToFileURL(path.join(directory,"route-graph.mjs"))),{splitAmount,convert,units,recordedExpenseTotals}=await import(pathToFileURL(path.join(directory,"money.mjs")));
 const places=Array.from({length:4},(_,i)=>({id:`p${i}`,kind:"place",data:{name:`Place ${i}`,lat:35+i/100,lng:139+i/100}}));
 const plans=[{placeId:"p0"},{placeId:"p1"},{},{entryType:"memo"},{placeId:"p2"},{placeId:"p3"}].map((data,i)=>({id:`a${i}`,kind:"plan",data:{...data,position:i}}));
 const g=dayGraph(plans,places);assert.equal(g.points.length,4);assert.equal(g.connections.length,4);assert.equal(g.connections.filter(c=>!c.leg).length,2);assert.deepEqual(g.legs.map(l=>[l.from.id,l.to.id]),[["p0","p1"],["p2","p3"]]);assert.ok(g.legs.every(l=>l.meters>0));
 const recorded=[{data:{baseCurrency:"KRW",tripCurrency:"CNY",baseAmount:"20000",tripAmount:"100",exchangeRate:"200"}},{data:{baseCurrency:"KRW",tripCurrency:"CNY",baseAmount:"19000",tripAmount:"90",exchangeRate:"210"}}];
 assert.deepEqual(recordedExpenseTotals(recorded,"KRW"),[{currency:"KRW",amount:"39000"},{currency:"CNY",amount:"190"}]);
 assert.deepEqual(recordedExpenseTotals([{data:{baseCurrency:"KRW",tripCurrency:"KRW",baseAmount:"1234",tripAmount:"1234"}}],"KRW"),[{currency:"KRW",amount:"1234"}]);
 assert.deepEqual(splitAmount("10",3),["3.333334","3.333333","3.333333"]);assert.equal(splitAmount("10",3).reduce((a,b)=>a+units(b),BigInt(0)),units("10"));
 assert.deepEqual(splitAmount("10",3,0),["4","3","3"]);assert.deepEqual(splitAmount("10",3,2),["3.34","3.33","3.33"]);assert.equal(convert("1000","9.5"),"9500");assert.equal(convert("9500","9.5",true),"1000");
});


test("travel tools validate currencies and dates, authenticate requests and normalize live-service DTOs",async()=>{
 const {createToolsHandler}=await import(pathToFileURL(path.join(directory,"tools.mjs")));let calls=0;
 const handler=createToolsHandler({resolveUser:async r=>r.headers.get("authorization")?users.owner:null,budget:async()=>{},fetch:async url=>{calls++;return Response.json(url.hostname==="api.frankfurter.dev"?{base:"USD",quote:"CHF",rate:0.8,date:"2026-10-16"}:{timezone:"Asia/Tokyo",daily:{time:[new Date().toISOString().slice(0,10)],weather_code:[3],temperature_2m_max:[25],temperature_2m_min:[15],precipitation_probability_max:[20]}});}});
 const req=(data,auth=true)=>handler(new Request("https://trip.example/api/tools",{method:"POST",headers:{Origin:"https://trip.example","Content-Type":"application/json",...(auth?{Authorization:"Bearer test"}:{})},body:JSON.stringify(data)}));
 assert.equal((await req({operation:"rate",base:"USD",quote:"CHF"},false)).status,401);
 assert.equal((await req({operation:"rate",base:"USD/../",quote:"CHF"})).status,400);
 const rate=await(await req({operation:"rate",base:"USD",quote:"CHF"})).json();assert.deepEqual(rate,{base:"USD",quote:"CHF",rate:0.8,date:"2026-10-16"});
 await req({operation:"rate",base:"USD",quote:"CHF"});assert.equal(calls,1);
 const today=new Date().toISOString().slice(0,10),weather=await(await req({operation:"weather",lat:35,lng:139,start:today,end:today})).json();assert.equal(weather.daily[0].high,25);assert.equal(weather.timezone,"Asia/Tokyo");
 assert.equal((await req({operation:"weather",lat:999,lng:139,start:today,end:today})).status,400);
 const future=await(await req({operation:"weather",lat:35,lng:139,start:"2099-01-01",end:"2099-01-02"})).json();assert.deepEqual(future.daily,[]);assert.equal(future.timezone,"Asia/Tokyo");assert.equal(calls,3);
});

test("city periods, profile calendar country and custom expense shares persist atomically with permissions and CAS", async()=>{
 const {db,request}=await fixture();try{
 const city={id:'30000000-0000-4000-8000-000000000001',name:'항저우',address:'중국 저장성',countryCode:'CN',timezone:'Asia/Shanghai',currency:'CNY',lat:30.25,lng:120.15,startDate:details.startDate,endDate:details.endDate};
 const bad=await request('trips','owner','POST',{...details,cities:[{...city,endDate:'2026-11-06'}]});assert.equal(bad.status,400);assert.equal((await request('trips')).body.trips.length,0);
 let w=(await request('trips','owner','POST',{...details,currency:'CNY',timezone:city.timezone,cities:[city]})).body;const id=w.trip.id;
 assert.equal(w.trip.settings.cities[0].name,'항저우');assert.equal(w.trip.settings.cities[0].currency,'CNY');
 const invalidZone=await request('trips','owner','POST',{...details,cities:[{...city,timezone:'Unknown/Nowhere'}]});assert.equal(invalidZone.status,400);
 const profile=(await request('profile')).body;assert.equal(profile.holidayCountry,'KR');
 const nextProfile=await request('profile','owner','POST',{name:'테스트',baseCurrency:'EUR',holidayCountry:'FR',version:profile.version});assert.equal(nextProfile.status,200);assert.equal(nextProfile.body.holidayCountry,'FR');
 const expense={model:2,title:'친구와 저녁',category:'food',tripCurrency:'CNY',baseCurrency:'KRW',paidCurrency:'CNY',tripAmount:'100',baseAmount:'19500',exchangeRate:'195',period:'day',date:details.startDate,payers:[{userId:users.owner.id,name:'owner',amount:'70'},{userId:users.editor.id,name:'editor',amount:'30'}],participants:[{userId:users.owner.id,name:'owner',amount:'40'},{userId:users.editor.id,name:'editor',amount:'60'}]};
 let response=await request(`trips/${id}`,'owner','POST',{action:'upsert',kind:'expense',data:expense});assert.equal(response.status,200);w=response.body;assert.equal(w.records[0].data.participants[1].amount,'60');
 response=await request(`trips/${id}`,'owner','POST',{action:'upsert',kind:'expense',data:{...expense,participants:expense.participants.map((p,i)=>({...p,amount:i?'61':'40'}))}});assert.equal(response.status,400);
 response=await request(`trips/${id}`,'owner','POST',{action:'upsert',kind:'expense',data:{...expense,participants:[expense.participants[0],{userId:users.editor.id,name:'editor'}]}});assert.equal(response.status,400);
 response=await request(`trips/${id}`,'owner','POST',{action:'update-trip',version:w.trip.version,revision:1,data:{cities:[city]}});assert.equal(response.status,409);
 response=await request(`trips/${id}`,'owner','POST',{action:'update-trip',version:w.trip.version,revision:w.revision,data:{cities:[{...city,endDate:'2026-11-03'}]}});assert.equal(response.status,200);w=response.body;assert.equal(w.trip.settings.cities[0].endDate,'2026-11-03');
 const categories=[...w.trip.settings.expenseCategories].reverse();response=await request(`trips/${id}/actions/update-settings`,'owner','POST',{revision:w.revision,expenseCategories:categories});assert.equal(response.status,200);w=response.body;assert.deepEqual(w.trip.settings.expenseCategories.map(c=>c.id),categories.map(c=>c.id));
 const invite=(await request(`trips/${id}/invites`,'owner','POST',{role:'viewer'})).body;const token=new URL(invite.url).pathname.split('/').at(-1);const joined=await request(`invites/${token}`,'viewer','POST',{});assert.equal(joined.status,200);
 response=await request(`trips/${id}/actions/update-settings`,'viewer','POST',{revision:w.revision,cities:[]});assert.equal(response.status,403);
 assert.equal((await request(`trips/${id}`,'outsider')).status,404);
 const imported=await request('trips/import','owner','POST',{key:crypto.randomUUID(),trip:w.trip,records:w.records.map(({id,kind,data})=>({id,kind,data}))});assert.equal(imported.status,201);assert.equal(imported.body.trip.settings.cities[0].name,'항저우');assert.equal(imported.body.records.find(r=>r.kind==='expense').data.participants[1].amount,'60');
 }finally{await db.close();}
});

test("search retains city metadata and resolves only exact bilingual aliases when geocoding misses a Korean POI",async()=>{
 const {createMapHandler}=await import(pathToFileURL(path.join(directory,'maps.mjs')));let calls=0,budget=0;
 const handler=createMapHandler({key:'alias-test',resolveUser:async()=>users.owner,budget:async()=>{budget++;},fetch:async url=>{calls++;const u=new URL(url);if(u.hostname==='ko.wikipedia.org'){if(u.searchParams.has('titles'))return Response.json({query:{pages:{'-1':{missing:''}}}});assert.match(u.searchParams.get('srsearch'),/화항관어/);return Response.json({query:{search:[{snippet:'<span class="searchmatch">화항관어</span>(花港觀魚)'}]}});}if(u.searchParams.get('text')==='화항관어')return Response.json({features:[]});if(u.searchParams.get('text')==='花港觀魚')return Response.json({features:[{properties:{name:'花港观鱼',formatted:'杭州 西湖',lat:30.23,lon:120.13,country_code:'cn',timezone:{name:'Asia/Shanghai'}}}]});assert.equal(u.searchParams.get('type'),'city');return Response.json({features:[{properties:{name:'항저우',lat:30.25,lon:120.15,country_code:'cn',timezone:{name:'Asia/Shanghai'}}}]});}});
 const req=data=>new Request('https://tripboogie.example.test/api/maps/search',jsonRequest(data,{headers:{Origin:'https://tripboogie.example.test'}}));
 let response=await handler(req({query:'화항관어',bias:{lat:30.25,lng:120.15}}),'search');assert.equal(response.status,200);let value=await response.json();assert.equal(value.places[0].name,'花港观鱼');assert.equal(value.alternativeQuery,'花港觀魚');assert.equal(value.places[0].searchLabel,'화항관어');assert.equal(value.places[0].countryCode,'CN');assert.equal(value.places[0].currency,'CNY');assert.equal(calls,4);assert.equal(budget,2);
 response=await handler(req({query:'항저우',type:'city'}),'autocomplete');value=await response.json();assert.equal(value.places[0].timezone,'Asia/Shanghai');
});

test("holiday and extended outlook DTOs distinguish nationwide public days from regional and non-public dates",async()=>{
 const {createToolsHandler}=await import(pathToFileURL(path.join(directory,'tools.mjs')));let calls=0;
 const today=new Date().toISOString().slice(0,10),future=new Date(Date.now()+20*86400000).toISOString().slice(0,10);
 const handler=createToolsHandler({resolveUser:async()=>users.owner,budget:async()=>{},fetch:async url=>{calls++;const u=new URL(url);if(u.hostname==='date.nager.at')return Response.json([{date:'2026-10-09',localName:'한글날',global:true,types:['Public']},{date:'2026-10-10',localName:'관측일',global:true,types:['Observance']},{date:'2026-10-11',localName:'지역',global:false,types:['Public']}]);assert.equal(u.searchParams.get('models'),'ecmwf_ec46_ensemble_mean');assert.equal(u.searchParams.get('forecast_days'),'46');return Response.json({timezone:'Asia/Shanghai',daily:{time:[today,future],temperature_2m_mean:[15,17],precipitation_sum:[0,1.5]}});}});
 const req=data=>new Request('https://tripboogie.example.test/api/tools',jsonRequest(data,{headers:{Origin:'https://tripboogie.example.test'}}));
 let r=await handler(req({operation:'holidays',country:'KR',year:2026}));assert.equal(r.status,200);assert.deepEqual((await r.json()).holidays,[{date:'2026-10-09',name:'한글날'}]);
 r=await handler(req({operation:'holidays',country:'ZZ',year:2026}));assert.equal(r.status,400);
 r=await handler(req({operation:'outlook',lat:30.25,lng:120.15,start:future,end:future}));assert.equal(r.status,200);const value=await r.json();assert.equal(value.kind,'outlook');assert.equal(value.daily.length,1);assert.equal(value.daily[0].date,future);assert.equal(value.daily[0].mean,17);assert.equal(value.daily[0].rainMm,1.5);assert.equal(value.daily[0].code,null);
 assert.equal(calls,2);
});


test("booking payments commit once, retain snapshots, guard stale edits and unlink without deleting actual spending", async () => {
  const {db, rpc} = await fixture();
  try {
    let w = await rpc("owner", "create", null, {data: details}); const id=w.trip.id;
    await rpc("owner","create-invite",id,{role:"viewer",token:"ef".repeat(32)});await rpc("viewer","join",null,{token:"ef".repeat(32)});
    const quote={type:"hotel", title:"Booked hotel", startDate:details.startDate, endDate:"2026-11-03", platform:"Hotel platform", reference:"ABC123", moneyCurrency:"JPY", moneyAmount:"1000",isPaid:false};
    w=await rpc("owner","save-booking",id,{data:quote});let b=w.records.find(r=>r.kind==="booking");
    assert.equal(b.data.platform,quote.platform);assert.equal(b.data.isPaid,false);assert.equal(w.records.filter(r=>r.kind==="expense").length,0);
    const pay={model:2,title:"Hotel payment", category:"stay", tripCurrency:"JPY",baseCurrency:"KRW",paidCurrency:"JPY",tripAmount:"1000",baseAmount:"9100",exchangeRate:"9.1",rateDate:"2026-10-19",period:"before",date:"2026-10-19",payers:[{userId:users.owner.id,name:"owner",amount:"1000"}],participants:[{userId:users.owner.id,name:"owner",amount:"1000"}]};
    const before=w.revision;
    await assert.rejects(rpc("owner","save-booking",id,{id:b.id,version:b.version,data:{...b.data,isPaid:true}}),{code:"PT400"});
    assert.equal((await rpc("owner","workspace",id)).revision,before);
    await assert.rejects(rpc("viewer","save-booking",id,{id:b.id,version:b.version,data:{...b.data,isPaid:true},expense:{data:pay}}),{code:"PT403"});
    w=await rpc("owner","save-booking",id,{id:b.id,version:b.version,data:{...b.data,isPaid:true},expense:{data:pay}});
    b=w.records.find(r=>r.id===b.id);let e=w.records.find(r=>r.kind==="expense");
    assert.equal(b.data.expenseId,e.id);assert.equal(e.data.bookingId,b.id);assert.equal(e.data.exchangeRate,"9.1");
    w=await rpc("owner","save-booking",id,{id:b.id,version:b.version,data:{...b.data,title:"Renamed hotel"}});b=w.records.find(r=>r.id===b.id);
    assert.equal(w.records.filter(r=>r.kind==="expense").length,1);assert.equal(w.records.find(r=>r.id===e.id).version,e.version);
    // A direct record write cannot fabricate payment ownership or desynchronize the paid quote.
    w=await rpc("owner","mutate",id,{action:"upsert",kind:"booking",id:b.id,version:b.version,data:{...b.data,moneyAmount:"999",expenseId:crypto.randomUUID(),isPaid:false}});b=w.records.find(r=>r.id===b.id);
    assert.equal(b.data.moneyAmount,"1000");assert.equal(b.data.expenseId,e.id);assert.equal(b.data.isPaid,true);
    await assert.rejects(rpc("owner","mutate",id,{action:"upsert",kind:"expense",id:e.id,version:e.version,data:{title:"legacy downgrade",amount:1,currency:"JPY",category:"stay",date:details.startDate,payer:"owner",participants:["owner"]}}),error=>error.code==="PT400" && /예약 연결 경비/.test(error.message));
    const staleE=e;
    w=await rpc("owner","mutate",id,{action:"upsert",kind:"expense",id:e.id,version:e.version,data:{...e.data,baseAmount:"9000"}});e=w.records.find(r=>r.id===e.id);b=w.records.find(r=>r.id===b.id);
    const unchanged=w.revision;
    await assert.rejects(rpc("owner","save-booking",id,{id:b.id,version:b.version,data:{...b.data,platform:"rolled back"},expense:{id:e.id,version:staleE.version,data:e.data}}),{code:"PT409"});
    assert.equal((await rpc("owner","workspace",id)).revision,unchanged);
    w=await rpc("owner","mutate",id,{action:"upsert",kind:"expense",id:e.id,version:e.version,data:{...e.data,tripAmount:"1200",payers:[{userId:users.owner.id,name:"owner",amount:"1200"}],participants:[{userId:users.owner.id,name:"owner",amount:"1200"}]}});e=w.records.find(r=>r.id===e.id);b=w.records.find(r=>r.id===b.id);
    assert.equal(b.data.moneyAmount,"1200");assert.equal(e.data.baseAmount,"9000");assert.equal(e.data.exchangeRate,"9.1");
    const imported=await rpc("owner","import",null,{key:crypto.randomUUID(),trip:w.trip,records:w.records.map(({id,kind,data})=>({id,kind,data}))});
    const ib=imported.records.find(r=>r.kind==="booking"),ie=imported.records.find(r=>r.kind==="expense");assert.notEqual(ib.id,b.id);assert.equal(ib.data.expenseId,ie.id);assert.equal(ie.data.bookingId,ib.id);
    const copied=await rpc("owner","import",null,{key:crypto.randomUUID(),trip:w.trip,records:w.records.filter(r=>r.kind!=="expense").map(({id,kind,data})=>({id,kind,data}))});
    assert.ok(!copied.records.find(r=>r.kind==="booking").data.expenseId);assert.notEqual(copied.records.find(r=>r.kind==="booking").data.isPaid,true);
    await assert.rejects(rpc("owner","save-booking",id,{id:b.id,version:b.version,data:{...b.data,isPaid:false}}),{code:"PT409"});
    w=await rpc("owner","save-booking",id,{id:b.id,version:b.version,data:{...b.data,isPaid:false},expense:null,expenseVersion:e.version});b=w.records.find(r=>r.id===b.id);
    assert.equal(b.data.isPaid,false);assert.equal(w.records.filter(r=>r.kind==="expense").length,0);
    w=await rpc("owner","save-booking",id,{id:b.id,version:b.version,data:{...b.data,isPaid:true},expense:{data:{...pay,tripAmount:"1200",payers:[{userId:users.owner.id,name:"owner",amount:"1200"}],participants:[{userId:users.owner.id,name:"owner",amount:"1200"}]}}});b=w.records.find(r=>r.id===b.id);e=w.records.find(r=>r.kind==="expense");
    w=await rpc("owner","mutate",id,{action:"delete",kind:"booking",id:b.id,version:b.version});assert.ok(w.records.find(r=>r.id===e.id));assert.equal(w.records.find(r=>r.id===e.id).data.bookingId,undefined);
    const tombstone=await db.query("select deleted from public.trip_records where id=$1",[staleE.id]);assert.equal(tombstone.rows[0].deleted,true);
    await assert.rejects(rpc("owner","save-booking",id,{data:{...quote,startDate:"2026-10-31"}}),{code:"PT400"});
  } finally { await db.close(); }
});

test("airport names and codes autocomplete with shared saved-city context and valid date-line flights",async()=>{
 const {searchAirports}=await import(pathToFileURL(path.join(directory,"airports.mjs")));
 for (const q of ["ICN","RKSI","인천","인천공항","Incheon"]) assert.equal(searchAirports(q)[0]?.icao,"RKSI",q);
 assert.equal(searchAirports("JFK")[0]?.icao,"KJFK");assert.equal(searchAirports("x").length,0);assert.ok(searchAirports("international").length===0);assert.ok(searchAirports("London").length<=8);
 const {travelContext,hasCoordinates}=await import(pathToFileURL(path.join(directory,"travel-context.mjs")));
 const city={id:"tokyo",name:"Tokyo",lat:0,lng:0,startDate:details.startDate,endDate:details.endDate,timezone:"Asia/Tokyo"};
 assert.equal(hasCoordinates(city),true);assert.equal(hasCoordinates({lat:NaN,lng:0}),false);assert.equal(hasCoordinates({lat:0,lng:181}),false);
 const trip={...details,settings:{cities:[city],location:{name:"old",lat:10,lng:10}}};assert.equal(travelContext(trip).location.name,"Tokyo");assert.equal(travelContext({...trip,settings:{cities:[],location:trip.settings.location}}).location.name,"old");
 const {db,rpc}=await fixture();try {
 let w=await rpc("owner","create",null,{data:details});const id=w.trip.id;
 w=await rpc("owner","mutate",id,{action:"update-trip",version:w.trip.version,revision:w.revision,data:{...details,cities:[{...city,id:crypto.randomUUID(),lat:35.68,lng:139.76,countryCode:"JP",currency:"JPY",address:"Tokyo"}]}});
 const reloaded=await rpc("owner","workspace",id);assert.equal(travelContext(reloaded.trip).location.name,"Tokyo");
 const flight={type:"flight",title:"Pacific flight",flightRole:"transfer",flightNumber:"KE11",startDate:"2026-11-02",endDate:"2026-11-01",startTime:"00:30",endTime:"18:00",departureAirport:{icao:"RKSI",iata:"ICN",name:"Incheon",timezone:"Asia/Seoul"},arrivalAirport:{icao:"KLAX",iata:"LAX",name:"Los Angeles",timezone:"America/Los_Angeles"}};
 w=await rpc("owner","save-booking",id,{data:flight});assert.equal(w.records.find(r=>r.kind==="booking").data.arrivalZone,"America/Los_Angeles");
 await assert.rejects(rpc("owner","save-booking",id,{data:{...flight,endTime:"01:00"}}),{code:"PT400"});
 await assert.rejects(rpc("owner","save-booking",id,{data:{...flight,departureAirport:{...flight.departureAirport,timezone:"not-a-zone"}}}),{code:"PT400"});
 } finally{await db.close();}
});


test("profile language resolves native linked names in additional searches without replacing unrelated results",async()=>{
 const {createMapHandler}=await import(pathToFileURL(path.join(directory,"maps.mjs")));
 const {profileSearchLanguage}=await import(pathToFileURL(path.join(directory,"search-language.mjs")));
 assert.equal(profileSearchLanguage({baseCurrency:"KRW",holidayCountry:"KR"}),"ko");assert.equal(profileSearchLanguage({baseCurrency:"JPY",holidayCountry:"JP"}),"ja");assert.equal(profileSearchLanguage({baseCurrency:"KRW",searchLanguage:"en"}),"en");
 let calls=0,budget=0;
 const handler=createMapHandler({key:"language-test",resolveUser:async()=>users.owner,budget:async()=>{budget++;},fetch:async(url)=>{
  calls++;const u=new URL(url);
  if(u.hostname==="ko.wikipedia.org"){
    if(u.searchParams.get("list")==="search")return Response.json({query:{search:[{title:"에펠탑",snippet:"파리의 건축물"}]}});
    assert.equal(u.searchParams.get("lllang"),"fr");return Response.json({query:{pages:{"123":{title:"에펠탑",langlinks:[{lang:"fr","*":"Tour Eiffel"}]}}}});
  }
  assert.equal(u.searchParams.get("lang"),"ko");
  return Response.json({features:[{properties:{name:u.searchParams.get("text")==="Tour Eiffel"?"Tour Eiffel":"에펠탑",lat:48.8584,lon:2.2945,country_code:"fr"}}]});
 }});
 const req=data=>new Request("https://tripboogie.example.test/api/maps/search",jsonRequest(data,{headers:{Origin:"https://tripboogie.example.test"}}));
 let response=await handler(req({query:"에펠탑",language:"ko",countryCode:"FR"}),"search"),result=await response.json();
 assert.equal(response.status,200);assert.equal(result.alternativeQuery,"Tour Eiffel");assert.equal(result.places.length,1);assert.equal(calls,3);assert.equal(budget,2);
 response=await handler(req({query:"에펠탑",language:"ko",countryCode:"FR"}),"search");assert.equal(response.status,200);assert.equal(calls,3);
 assert.equal((await handler(req({query:"에펠탑",language:"../../evil"}),"search")).status,400);
 const {resolvePlaceAlias}=await import(pathToFileURL(path.join(directory,"place-alias.mjs")));
 assert.equal(await resolvePlaceAlias("Some place","en","FR",async()=>Response.json({query:{search:[{title:"Similar place",snippet:"Some place"}]}})),null);
 const {db,rpc}=await fixture();try{const p=await rpc("owner","profile");const updated=await rpc("owner","update-profile",null,{...p,searchLanguage:"ja"});assert.equal(updated.searchLanguage,"ja");assert.equal((await rpc("owner","profile")).searchLanguage,"ja");await assert.rejects(rpc("owner","update-profile",null,{...updated,searchLanguage:"xx"}),{code:"PT400"});}finally{await db.close();}
});

test("official Supabase SDK owns PKCE OAuth exchange once and mobile return paths remain on-site",async()=>{
 const {createClient}=await import("@supabase/supabase-js");
 const {callbackUrl,safeReturnPath,embeddedBrowser,callbackFailure}=await import(pathToFileURL(path.join(directory,"auth-navigation.mjs")));
 const {exchangeCallbackCode}=await import(pathToFileURL(path.join(directory,"client-api.mjs")));
 const invite="/invite/"+"ab".repeat(32);assert.equal(safeReturnPath(invite),invite);
 for(const p of ["//evil.example", "https://evil.example", "/auth/callback?code=x", "/invite/../evil"])assert.equal(safeReturnPath(p),"/");
 assert.equal(new URL(callbackUrl("https://tripboogie.example.test",invite)).searchParams.get("next"),invite);assert.throws(()=>callbackUrl("http://example.test"));
 assert.equal(embeddedBrowser("Mozilla KAKAOTALK"),true);assert.equal(embeddedBrowser("Mozilla Safari/605.1"),false);assert.match(callbackFailure(new URLSearchParams("error=access_denied")),/취소/);
 const storageMap=new Map(),storage={getItem:key=>storageMap.get(key)??null,setItem:(key,value)=>storageMap.set(key,value),removeItem:key=>storageMap.delete(key)};
 let tokenRequests=0;const token=[{alg:"HS256",typ:"JWT"},{sub:users.owner.id,exp:Math.floor(Date.now()/1000)+3600,aud:"authenticated"}].map(v=>Buffer.from(JSON.stringify(v)).toString("base64url")).join(".")+".signature";
 const client=createClient("https://auth.example.test","publishable-test",{auth:{flowType:"pkce",detectSessionInUrl:false,persistSession:true,autoRefreshToken:false,storage,storageKey:"test-mobile"},global:{fetch:async(url,init)=>{const u=new URL(url);assert.equal(u.pathname,"/auth/v1/token");assert.equal(u.searchParams.get("grant_type"),"pkce");const body=JSON.parse(init.body);assert.equal(body.auth_code,"test-code");assert.ok(body.code_verifier.length>=43);tokenRequests++;return Response.json({access_token:token,refresh_token:"test-refresh",expires_in:3600,token_type:"bearer",user:{...users.owner,aud:"authenticated"}});}}});
 for(const provider of ["google","kakao"]){const {data,error}=await client.auth.signInWithOAuth({provider,options:{redirectTo:callbackUrl("https://tripboogie.example.test",invite),skipBrowserRedirect:true}});assert.equal(error,null);const u=new URL(data.url);assert.equal(u.searchParams.get("provider"),provider);assert.equal(new URL(u.searchParams.get("redirect_to")).origin,"https://tripboogie.example.test");assert.ok(u.searchParams.get("code_challenge"));}
 const [a,b]=await Promise.all([exchangeCallbackCode(client,"test-code"),exchangeCallbackCode(client,"test-code")]);assert.equal(a.error,null);assert.equal(b.data.session.user.id,users.owner.id);assert.equal(tokenRequests,1);assert.equal((await client.auth.getSession()).data.session.user.id,users.owner.id);client.auth.stopAutoRefresh();
});

const { createPlaceDetailsHandler } = await import(pathToFileURL(path.join(directory, "place-details.mjs")));
const { previousPlanPlace } = await import(pathToFileURL(path.join(directory, "planning.mjs")));
test("licensed city/place media survives authoritative saves and rejects unsafe image URLs", async () => {
 const {db,request}=await fixture();
 try {
  const image={url:"https://upload.wikimedia.org/wikipedia/commons/a/ab/City.jpg",sourceUrl:"https://commons.wikimedia.org/wiki/File:City.jpg",title:"City",author:"Photographer",license:"CC BY-SA 4.0",licenseUrl:"https://creativecommons.org/licenses/by-sa/4.0/"};
  const city={id:crypto.randomUUID(),name:"Tokyo",address:"Tokyo",countryCode:"JP",timezone:"Asia/Tokyo",lat:35.68,lng:139.76,currency:"JPY",startDate:details.startDate,endDate:details.endDate,providerId:"ab".repeat(20),image};
  const created=await request("trips","owner","POST",{...details,cities:[city]});
  assert.equal(created.status,201,JSON.stringify(created.body));
  const id=created.body.trip.id;
  assert.deepEqual(created.body.trip.settings.cities[0].image,image);
  const result=await request(`trips/${id}/actions/save-plan`,"owner","POST",{data:{title:"Museum",date:details.startDate,entryType:"plan"},place:{name:"Museum",address:"Tokyo",lat:35.68,lng:139.76,providerId:"cd".repeat(20),image,details:{openingHours:"Mo-Fr 09:00-18:00",sourceUrl:"https://www.openstreetmap.org/node/123",checkedAt:"2026-10-19T00:00:00.000Z",photos:[image]}}});
  assert.equal(result.status,200,JSON.stringify(result.body));
  const saved=result.body.records.find(r=>r.kind==="place");
  assert.deepEqual(saved.data.image,image);
  assert.equal(saved.data.details.openingHours,"Mo-Fr 09:00-18:00");
  assert.deepEqual(saved.data.details.photos,[]);
  const denied=await request(`trips/${id}`,"owner","POST",{action:"upsert",id:saved.id,kind:"place",version:saved.version,data:{...saved.data,image:{...image,url:"https://evil.test/track.png"}}});
  assert.equal(denied.status,400);
  const copy=await request("trips/import","owner","POST",{format:"tripboogie-v1",key:crypto.randomUUID(),trip:result.body.trip,records:result.body.records.map(({id,kind,data})=>({id,kind,data}))});
  assert.equal(copy.status,201,JSON.stringify(copy.body));
  assert.deepEqual(copy.body.trip.settings.cities[0].image,image);
  assert.deepEqual(copy.body.records.find(r=>r.kind==="place").data.image,image);
 }finally{await db.close();}
});
test("place details authenticate, preserve hours, validate photo provenance and cache provider calls",async()=>{
 let requests=0;
 const provider=async(url)=>{requests++;const u=new URL(url);
 if(u.hostname==="api.geoapify.com")return Response.json({features:[{properties:{feature_type:"details",name:"Museum",opening_hours:"Mo-Fr 09:00-18:00",wiki_and_media:{wikidata:"Q123"},datasource:{raw:{osm_type:"n",osm_id:123}}}}]});
 if(u.hostname==="www.wikidata.org")return Response.json({entities:{Q123:{claims:{P18:[{mainsnak:{datavalue:{value:"Museum.jpg"}}}]}}}});
 return Response.json({query:{pages:[{title:"File:Museum.jpg",imageinfo:[{thumburl:"https://upload.wikimedia.org/wikipedia/commons/a/ab/Museum.jpg",descriptionurl:"https://commons.wikimedia.org/wiki/File:Museum.jpg",extmetadata:{Artist:{value:"<b>Author</b>"},LicenseShortName:{value:"CC BY-SA 4.0"},LicenseUrl:{value:"https://creativecommons.org/licenses/by-sa/4.0/"}}}]}]}});
 };
 const handler=createPlaceDetailsHandler({key:"fake",resolveUser:async()=>users.owner,budget:async()=>{},fetch:provider});
 const make=()=>new Request("https://tripboogie.example.test/api/maps/details",{method:"POST",headers:{Origin:"https://tripboogie.example.test","Content-Type":"application/json"},body:JSON.stringify({name:"Museum",lat:35,lng:139,providerId:"de".repeat(20),kind:"place"})});
 const first=await handler(make());assert.equal(first.status,200);const body=await first.json();assert.equal(body.photos[0].author,"Author");assert.equal(body.openingHours,"Mo-Fr 09:00-18:00");assert.equal(body.sourceUrl,"https://www.openstreetmap.org/node/123");
 assert.equal((await handler(make())).status,200);assert.equal(requests,3);
 const denied=createPlaceDetailsHandler({key:"fake",resolveUser:async()=>null,budget:async()=>{throw Error("No quota should be consumed");},fetch:provider});assert.equal((await denied(make())).status,401);
});
test("previous itinerary distance ignores memos and stops at an unlocated plan",()=>{
 const records=[{id:"a",kind:"place",data:{name:"A",lat:35,lng:139}},{id:"1",kind:"plan",data:{date:"2026-10-19",position:1,placeId:"a"}},{id:"2",kind:"plan",data:{date:"2026-10-19",position:2,entryType:"memo"}},{id:"3",kind:"plan",data:{date:"2026-10-19",position:3}}];
 assert.deepEqual(previousPlanPlace(records,"2026-10-19","3"),{name:"A",lat:35,lng:139});
 assert.equal(previousPlanPlace(records,"2026-10-19"),undefined);
 assert.equal(previousPlanPlace(records,"2026-10-19","1"),undefined);
});

test("startup bootstrap verifies identity once, never exposes private data anonymously and returns only member trips",async()=>{
 const {db,request}=await fixture();
 try{
  const anonymous=await request('bootstrap',null);assert.equal(anonymous.status,200);assert.deepEqual(anonymous.body,{user:null,profile:null,trips:[]});assert.match(anonymous.headers.get('Cache-Control'),/no-store/);
  const created=await request('trips','owner','POST',details);assert.equal(created.status,201);
  const owner=await request('bootstrap','owner');assert.equal(owner.status,200);assert.equal(owner.body.user.id,users.owner.id);assert.equal(owner.body.profile.id,users.owner.id);assert.deepEqual(owner.body.trips.map(t=>t.id),[created.body.trip.id]);
  const outsider=await request('bootstrap','outsider');assert.equal(outsider.status,200);assert.deepEqual(outsider.body.trips,[]);assert.equal(outsider.body.user.id,users.outsider.id);
  let identities=0;const handle=createApiHandler({resolveUser:async()=>{identities++;return null;},repository:()=>{throw new Error('Anonymous startup must not construct a private repository');}});
  assert.equal((await handle(new Request('https://tripboogie.example.test/api/bootstrap'),['bootstrap'])).status,200);assert.equal(identities,1);
 }finally{await db.close();}
});

test("account preferences persist with CAS, bounded photos and member-only social avatar previews",async()=>{
 const {db,rpc}=await fixture();
 try{
  await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data||$1::jsonb where id=$2",[JSON.stringify({avatar_url:'https://lh3.googleusercontent.com/a/public-avatar'}),users.owner.id]);
  let p=await rpc('owner','profile');assert.equal(p.theme,'system');assert.match(p.avatar,/googleusercontent/);
  const avatar='data:image/webp;base64,UklGRg==';
  p=await rpc('owner','update-profile',null,{...p,name:'부기',avatar,theme:'dark'});assert.equal(p.avatar,avatar);assert.equal(p.theme,'dark');
  await assert.rejects(rpc('owner','update-profile',null,{...p,version:p.version-1,theme:'light'}),e=>e.code==='PT409');
  for(const invalid of ['https://evil.test/avatar','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,'+'a'.repeat(17000)])await assert.rejects(rpc('owner','update-profile',null,{...p,avatar:invalid}),e=>e.code==='PT400');
  await assert.rejects(rpc('owner','update-profile',null,{...p,theme:'invalid'}),e=>e.code==='PT400');
  const w=await rpc('owner','create',null,{data:details});
  const listed=await rpc('owner','list');assert.equal(listed[0].memberPreview[0].avatar,avatar);assert.equal('email' in listed[0].memberPreview[0],false);
  assert.deepEqual(await rpc('outsider','list'),[]);await assert.rejects(rpc('outsider','workspace',w.trip.id),e=>e.code==='PT404');
  await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data||$1::jsonb where id=$2",[JSON.stringify({avatar_url:'https://evil.test/photo'}),users.outsider.id]);
  assert.equal((await rpc('outsider','profile')).avatar,'');
 }finally{await db.close();}
});
test("custom booking categories preserve booking semantics, reject removal while used and survive backup import",async()=>{
 const {db,rpc}=await fixture();
 try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  const categories=[{id:'hotel',label:'숙소',kind:'hotel'},{id:'flight',label:'항공',kind:'flight'},{id:'tour',label:'투어·티켓',kind:'tour'},{id:'other',label:'기타',kind:'other'},{id:'parking',label:'주차',kind:'other'}];
  w=await rpc('owner','update-settings',id,{revision:w.revision,bookingCategories:categories});
  w=await rpc('owner','mutate',id,{action:'upsert',kind:'booking',data:{type:'other',category:'parking',title:'주차장',startDate:details.startDate,endDate:details.startDate}});
  assert.equal(w.records.find(r=>r.kind==='booking').data.category,'parking');
  await assert.rejects(rpc('owner','update-settings',id,{revision:w.revision,bookingCategories:categories.filter(c=>c.id!=='parking')}),e=>e.code==='PT409');
  await assert.rejects(rpc('owner','update-settings',id,{revision:w.revision,bookingCategories:categories.map(c=>c.id==='parking'?{...c,kind:'hotel'}:c)}),e=>e.code==='PT409');
  await assert.rejects(rpc('owner','mutate',id,{action:'upsert',kind:'booking',data:{type:'other',category:'unknown',title:'bad',startDate:details.startDate,endDate:details.startDate}}),e=>e.code==='PT400');
  await assert.rejects(rpc('owner','update-settings',id,{revision:w.revision,bookingCategories:[]}),e=>e.code==='PT400');
  w=await rpc('owner','mutate',id,{action:'upsert',kind:'booking',data:{type:'hotel',title:'Old-compatible hotel',startDate:details.startDate,endDate:details.endDate}});
  assert.equal(w.records.filter(r=>r.kind==='plan').length,5);
  const imported=await rpc('owner','import',null,{key:crypto.randomUUID(),trip:w.trip,records:w.records});
  assert.equal(imported.records.find(r=>r.data.title==='주차장').data.category,'parking');
 }finally{await db.close();}
});
test("retired city cover searches never consume provider quota and legacy settings remain compatible",async()=>{
 let providerCalls=0,budgetCalls=0;
 const handler=createPlaceDetailsHandler({key:'unused',resolveUser:async()=>users.owner,budget:async()=>{budgetCalls++;},fetch:async()=>{providerCalls++;throw new Error('Retired city searches must not call providers');}});
 for(const input of [{kind:'city'},{kind:'city',query:'Tokyo'},{kind:'place',query:'Tokyo'}]){
  const response=await handler(new Request('https://tripboogie.example.test/api/maps/details',jsonRequest({...input,name:'시험 도시',lat:33,lng:130,providerId:'ab'.repeat(20)},{headers:{Origin:'https://tripboogie.example.test'}})));
  assert.equal(response.status,400);assert.match((await response.json()).error,/장소/);
 }
 assert.equal(providerCalls,0);assert.equal(budgetCalls,0);
 const {db,rpc}=await fixture();try{let w=await rpc('owner','create',null,{data:details});const city={id:crypto.randomUUID(),name:'Tokyo',address:'Japan',lat:35.68,lng:139.76,countryCode:'JP',timezone:'Asia/Tokyo',currency:'JPY',startDate:details.startDate,endDate:details.endDate,image:null,imageDisabled:false};w=await rpc('owner','update-settings',w.trip.id,{revision:w.revision,cities:[city]});assert.equal(w.trip.settings.cities[0].imageDisabled,false);w=await rpc('owner','update-settings',w.trip.id,{revision:w.revision,cities:[{...city,imageDisabled:true}]});assert.equal(w.trip.settings.cities[0].imageDisabled,true);}finally{await db.close();}
});

test("flight nights are derived once per night and unchanged departure dates preserve hotel plan ownership",async()=>{
 const {db,rpc}=await fixture();try{
  let w=await rpc('owner','create',null,{data:{...details,endDate:'2026-11-12'}});const id=w.trip.id;
  w=await rpc('owner','mutate',id,{action:'upsert',kind:'booking',data:{type:'hotel',title:'Hotel',startDate:'2026-11-02',endDate:'2026-11-11'}});
  const hotelPlan=w.records.find(r=>r.kind==='plan');
  w=await rpc('owner','mutate',id,{action:'update-trip',version:w.trip.version,revision:w.revision,data:{title:'Renamed',shiftDates:true}});
  assert.equal(w.records.find(r=>r.id===hotelPlan.id).version,hotelPlan.version);assert.equal(w.records.find(r=>r.id===hotelPlan.id).data.bookingManaged,true);
  for(let i=0;i<2;i++)w=await rpc('owner','mutate',id,{action:'upsert',kind:'booking',data:{type:'flight',title:'Flight',startDate:'2026-11-01',endDate:'2026-11-02',startTime:'23:00',endTime:'06:00',departureZone:'Asia/Tokyo',arrivalZone:'Asia/Tokyo'}});
  assert.equal(w.trip.flightNights,1);assert.equal((await rpc('owner','list'))[0].flightNights,1);
  w=await rpc('owner','mutate',id,{action:'upsert',kind:'booking',data:{type:'flight',title:'Date line flight',startDate:'2026-11-03',endDate:'2026-11-03',startTime:'22:00',endTime:'14:00',departureZone:'Asia/Tokyo',arrivalZone:'America/Los_Angeles'}});assert.equal(w.trip.flightNights,2);
 }finally{await db.close();}
});

test("profile patches save themes without echoing display-only social photos and keep old clients compatible",async()=>{
 const {db,rpc}=await fixture();try{
  await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data||$1::jsonb where id=$2",[JSON.stringify({avatar_url:'http://k.kakaocdn.net/dn/social-profile/photo.jpg'}),users.owner.id]);
  let profile=await rpc('owner','profile');assert.equal(profile.avatar,'https://k.kakaocdn.net/dn/social-profile/photo.jpg');
  const name=profile.name,currency=profile.baseCurrency;
  profile=await rpc('owner','update-profile',null,{version:profile.version,theme:'dark'});assert.equal(profile.theme,'dark');assert.equal(profile.name,name);assert.equal(profile.baseCurrency,currency);
  profile=await rpc('owner','update-profile',null,{...profile,theme:'light'});assert.equal(profile.theme,'light');
  assert.equal((await db.query('select avatar from public.profiles where id=$1',[users.owner.id])).rows[0].avatar,'');
  await assert.rejects(rpc('owner','update-profile',null,{version:profile.version,theme:'dark',avatar:'https://evil.test/photo'}),e=>e.code==='PT400');
  await assert.rejects(rpc('owner','update-profile',null,{version:profile.version-1,theme:'dark'}),e=>e.code==='PT409');
  profile=await rpc('owner','update-profile',null,{version:profile.version,name:'거북이'});assert.equal(profile.name,'거북이');assert.equal(profile.theme,'light');
 }finally{await db.close();}
});

test("map height preferences persist per account with validation, revision checks and old-client compatibility",async()=>{
 const {db,rpc,asUser}=await fixture();try{
  let profile=await rpc('owner','profile');assert.equal(profile.mapHeightScale,1);
  profile=await rpc('owner','update-profile',null,{version:profile.version,mapHeightScale:1.375});
  assert.equal(profile.mapHeightScale,1.375);assert.equal((await rpc('owner','profile')).mapHeightScale,1.375);
  assert.equal((await rpc('editor','profile')).mapHeightScale,1);
  profile=await rpc('owner','update-profile',null,{version:profile.version,theme:'dark'});
  assert.equal(profile.mapHeightScale,1.375);assert.equal(profile.theme,'dark');
  for(const value of [null,'1.2',false,{},[],0,1.501,2])await assert.rejects(rpc('owner','update-profile',null,{version:profile.version,mapHeightScale:value}),e=>e.code==='PT400');
  await assert.rejects(rpc('owner','update-profile',null,{version:profile.version-1,mapHeightScale:1.1}),e=>e.code==='PT409');
  await asUser('editor',tx=>assert.rejects(tx.query('update public.profiles set map_height_scale=1.5 where id=$1',[users.owner.id]),/permission denied/));
  assert.equal((await rpc('owner','profile')).mapHeightScale,1.375);
 }finally{await db.close();}
});

test("built-in reservation categories only reorder, legacy labels survive import, and midnight stays midnight",async()=>{
 const {db,rpc}=await fixture();
 try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  const categories=[{id:'hotel',label:'숙소',kind:'hotel'},{id:'flight',label:'항공',kind:'flight'},{id:'tour',label:'투어·티켓',kind:'tour'},{id:'other',label:'기타',kind:'other'}];
  for(const changed of [categories.filter(c=>c.id!=='tour'),categories.map(c=>c.id==='hotel'?{...c,label:'다른 이름'}:c),categories.map(c=>c.id==='flight'?{...c,kind:'other'}:c)])await assert.rejects(rpc('owner','update-settings',id,{revision:w.revision,bookingCategories:changed}),e=>e.code==='PT400');
  w=await rpc('owner','update-settings',id,{revision:w.revision,bookingCategories:[...categories].reverse()});assert.deepEqual(w.trip.settings.bookingCategories.map(c=>c.id),['other','tour','flight','hotel']);
  w=await rpc('owner','save-plan',id,{data:{title:'자정 출발',date:details.startDate,time:'00:00'}});assert.equal(w.records.find(r=>r.data.title==='자정 출발').data.time,'00:00');assert.equal((await rpc('owner','workspace',id)).records.find(r=>r.data.title==='자정 출발').data.time,'00:00');
  const legacyCategories=categories.map(c=>c.id==='hotel'?{...c,label:'머무는 곳'}:c);
  const legacy=await rpc('owner','import',null,{key:crypto.randomUUID(),trip:{...w.trip,settings:{...w.trip.settings,bookingCategories:legacyCategories}},records:[]});assert.equal(legacy.trip.settings.bookingCategories.find(c=>c.id==='hotel').label,'머무는 곳');
  await assert.rejects(rpc('owner','update-settings',legacy.trip.id,{revision:legacy.revision,bookingCategories:categories}),e=>e.code==='PT400');
  const missing=await db.query("select tripboogie_private.booking_categories($1::jsonb) as items",[JSON.stringify({bookingCategories:[{id:'parking',label:'주차',kind:'other'}]})]);assert.deepEqual(missing.rows[0].items.map(c=>c.id),['parking','hotel','flight','tour']);
 }finally{await db.close();}
});


test("unlocated adjacent plans can save and remove transport without creating map lines",async()=>{
 const {db,rpc}=await fixture();try{let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
 w=await rpc('owner','save-plan',id,{data:{title:'장소 없는 출발',date:details.startDate}});const from=w.records.find(r=>r.data.title==='장소 없는 출발');
 w=await rpc('owner','save-plan',id,{data:{title:'장소 없는 도착',date:details.startDate,travelFromId:from.id,transportMode:'train',travelMinutes:35}});let to=w.records.find(r=>r.data.title==='장소 없는 도착');assert.equal(to.data.travelMinutes,35);assert.equal(to.data.travelFromId,from.id);
 const {dayGraph}=await import(pathToFileURL(path.join(directory,'route-graph.mjs')));const graph=dayGraph(w.records.filter(r=>r.kind==='plan'),[]);assert.equal(graph.legs.length,0);assert.equal(graph.connections.length,1);
 const data={...to.data};delete data.travelFromId;delete data.travelMinutes;w=await rpc('owner','save-plan',id,{id:to.id,version:to.version,data});to=w.records.find(r=>r.id===to.id);assert.equal(to.data.travelFromId,undefined);assert.equal(to.data.travelMinutes,undefined);
 }finally{await db.close();}
});
test("verified auth account provider is display data and never taken from editable user metadata",async()=>{
 const {resolveRequestUser}=await import(pathToFileURL(path.join(directory,'auth-provider.mjs'))),originalFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_PUBLISHABLE_KEY;
 try{process.env.SUPABASE_URL='https://auth.example.test';process.env.SUPABASE_PUBLISHABLE_KEY='public-test';globalThis.fetch=async()=>Response.json({id:users.owner.id,app_metadata:{provider:'kakao'},user_metadata:{provider:'google',nickname:'부기'}});const user=await resolveRequestUser(new Request('https://app.example.test',{headers:{Authorization:'Bearer test_owner'}}));assert.equal(user.provider,'kakao');assert.equal(user.id,users.owner.id);}
 finally{globalThis.fetch=originalFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_PUBLISHABLE_KEY;else process.env.SUPABASE_PUBLISHABLE_KEY=oldKey;}
});
test("background synchronization never increments visible request activity, foreground work does",async()=>{
 const client=await import(pathToFileURL(path.join(directory,'client-api.mjs'))),originalFetch=globalThis.fetch;const replies=[];
 try{globalThis.fetch=async url=>String(url).includes('auth-config')?Response.json({url:'',publishableKey:'',providers:{email:false,google:true,kakao:true}}):new Promise(resolve=>replies.push(resolve));
 const background=client.apiFetch('/api/trips',{}, {background:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(client.getApiPending(),0);
 const foreground=client.apiFetch('/api/trips');await new Promise(resolve=>setImmediate(resolve));assert.equal(client.getApiPending(),1);replies.forEach(resolve=>resolve(Response.json({trips:[]})));await Promise.all([background,foreground]);assert.equal(client.getApiPending(),0);
 }finally{globalThis.fetch=originalFetch;}
});


test("Korean city queries strip country display names and use GeoNames city results when Geoapify has none",async()=>{
 const {createMapHandler}=await import(pathToFileURL(path.join(directory,"maps.mjs")));
 const seen=[];const handler=createMapHandler({key:"city-test",resolveUser:async()=>users.owner,budget:async()=>{},fetch:async url=>{
  const u=new URL(url);seen.push(u);
  if(u.hostname==="api.geoapify.com")return Response.json({features:[]});
  assert.equal(u.hostname,"geocoding-api.open-meteo.com");
  return Response.json({results:[{name:u.searchParams.get("name"),latitude:30,longitude:120,country_code:u.searchParams.get("countryCode")||"JP",timezone:"Asia/Tokyo",feature_code:"PPLC"},{name:"airport",latitude:30,longitude:120,country_code:"JP",timezone:"Asia/Tokyo",feature_code:"AIRP"}]});
 }});
 const send=async query=>{const r=await handler(new Request("https://tripboogie.example.test/api/maps/autocomplete",jsonRequest({query,type:"city",language:"ko"},{headers:{Origin:"https://tripboogie.example.test"}})),"autocomplete");assert.equal(r.status,200);return r.json();};
 const a=await send("중국 항저우");assert.equal(a.places.length,1);assert.equal(a.places[0].name,"항저우");assert.equal(a.places[0].currency,"CNY");assert.equal(seen[0].searchParams.get("text"),"항저우");assert.equal(seen[1].searchParams.get("countryCode"),"CN");
 const b=await send("도쿄");assert.equal(b.places[0].name,"도쿄");assert.equal(b.places[0].currency,"JPY");
});

test("soft withdrawal retains trips, blocks existing JWT RPC and Storage reads, and restores only the caller",async()=>{
 const {db,rpc,request,asUser}=await fixture();try{
  const w=await rpc("owner","create",null,{data:{title:"Keep this trip",destination:"Seoul",startDate:"2026-11-01",endDate:"2026-11-03",currency:"KRW",timezone:"Asia/Seoul"}});
  const id=w.trip.id;
  const invite=await rpc("owner","create-invite",id,{token:"ae".repeat(32),role:"editor"});assert.ok(invite);
  await rpc("editor","join",null,{token:"ae".repeat(32)});
  const prepared=await rpc("owner","prepare-file",id,{name:"keep.txt",mime:"text/plain",size:10}),file=prepared.file;
  await asUser("owner",tx=>tx.query("insert into storage.objects(bucket_id,name,metadata) values('tripboogie-private',$1,'{\"size\":10}')",[file.path]));
  await rpc("owner","finish-file",id,{id:file.id});
  assert.equal((await request("account","owner","DELETE",{confirmation:"wrong"})).status,400);
  assert.equal((await request("account",null,"DELETE",{confirmation:"탈퇴"})).status,401);
  assert.equal((await request("account","owner","DELETE",{confirmation:"탈퇴",id:users.editor.id})).status,200);
  assert.ok((await rpc("owner","profile")).withdrawnAt);assert.equal((await rpc("editor","profile")).withdrawnAt,null);
  assert.deepEqual(await rpc("owner","list"),[]);
  await assert.rejects(rpc("owner","workspace",id),{code:"PT403"});await assert.rejects(rpc("owner","update-profile",null,{name:"blocked",version:1}),{code:"PT403"});
  assert.equal((await asUser("owner",tx=>tx.query("select * from storage.objects"))).rows.length,0);
  assert.equal((await rpc("editor","workspace",id)).files.length,1);
  await request("account","editor","POST",{confirmation:"복구",id:users.owner.id});assert.ok((await rpc("owner","profile")).withdrawnAt);
  assert.equal((await request("account","owner","POST",{confirmation:"복구"})).status,200);
  assert.equal((await rpc("owner","profile")).withdrawnAt,null);assert.equal((await rpc("owner","workspace",id)).files.length,1);
 }finally{await db.close();}
});


test("Korean station names follow exact redirects with an identified API client, excluding ambiguous pages",async()=>{
 const {resolvePlaceAlias}=await import(pathToFileURL(path.join(directory,"place-alias.mjs")));
 let calls=0;
 const alias=await resolvePlaceAlias("상하이역","ko","CN",async(url,init)=>{
  calls++;const u=new URL(url);assert.equal(u.searchParams.get("titles"),"상하이역");assert.equal(u.searchParams.get("redirects"),"1");assert.equal(u.searchParams.get("lllang"),"zh");assert.match(init.headers["User-Agent"],/TripBoogie.*https:\/\/tripboogie/);
  return Response.json({query:{redirects:[{from:"상하이역",to:"상하이 철도역"}],pages:{"198666":{title:"상하이 철도역",langlinks:[{lang:"zh","*":"上海站"}]}}}});
 });
 assert.equal(alias.query,"上海站");assert.equal(calls,1);
 for(const flag of ["missing","invalid","disambiguation"]){
  assert.equal(await resolvePlaceAlias("같은 이름","ko","CN",async()=>Response.json({query:{pages:{"1":{...(flag==="disambiguation"?{pageprops:{disambiguation:""}}:{[flag]:""}),langlinks:[{lang:"zh","*":"别的地方"}]}}}})),null);
 }
});


test("autocomplete resolves native station names despite fuzzy shops, restricts travel country and preserves exact local matches",async()=>{
 const {createMapHandler}=await import(pathToFileURL(path.join(directory,"maps.mjs")));let calls=0,budget=0;
 const feature=(name,country_code,lat,lon)=>({properties:{name,country_code,lat,lon,formatted:name+" "+country_code}});
 const handler=createMapHandler({key:"station-country",resolveUser:async()=>users.owner,budget:async()=>{budget++;},fetch:async url=>{
  calls++;const u=new URL(url);
  if(u.hostname==="ko.wikipedia.org")return Response.json({query:{pages:{"198666":{title:"상하이역",langlinks:[{lang:"zh","*":"上海站"}]}}}});
  assert.equal(u.searchParams.get("filter"),"countrycode:cn");assert.equal(u.searchParams.get("bias"),"proximity:121.45,31.25");
  if(u.searchParams.get("text")==="上海站"){assert.equal(u.pathname,"/v1/geocode/search");return Response.json({features:[feature("上海站","cn",31.2515439,121.4511111),feature("Station Hotel","cn",31.26,121.46),feature("상하이","kr",37.5,127)]});}
  return Response.json({features:[feature("상하이","kr",37.5,127),feature("상하이 식당","cn",31.26,121.46)]});
 }});
 const send=()=>handler(new Request("https://tripboogie.example.test/api/maps/autocomplete",jsonRequest({query:"상하이역",countryCode:"CN",language:"ko",bias:{lat:31.25,lng:121.45}},{headers:{Origin:"https://tripboogie.example.test"}})),"autocomplete");
 const r=await send(),data=await r.json();assert.equal(r.status,200);assert.equal(data.places[0].name,"上海站");assert.equal(data.places[0].searchLabel,"상하이역");assert.ok(data.places.every(p=>p.countryCode==="CN"));assert.equal(data.places.find(p=>p.name==="Station Hotel").searchLabel,undefined);assert.equal(calls,3);assert.equal(budget,2);await send();assert.equal(calls,3);
 let exactCalls=0;const local=createMapHandler({key:"exact-local",resolveUser:async()=>users.owner,budget:async()=>{},fetch:async url=>{exactCalls++;assert.equal(new URL(url).hostname,"api.geoapify.com");return Response.json({features:[feature("현지 카페","cn",31.25,121.45)]});}});
 const localResult=await local(new Request("https://tripboogie.example.test/api/maps/autocomplete",jsonRequest({query:"현지 카페",countryCode:"CN",bias:{lat:31.25,lng:121.45}},{headers:{Origin:"https://tripboogie.example.test"}})),"autocomplete");assert.equal(localResult.status,200);assert.equal(exactCalls,1);
});


test("account themes persist across web and native bootstraps and remain isolated by signed-in user",async()=>{
 const {db,request}=await fixture();try{
  const owner=(await request("profile","owner")).body,editor=(await request("profile","editor")).body;
  assert.equal((await request("profile","owner","POST",{version:owner.version,theme:"dark"})).status,200);
  assert.equal((await request("profile","editor","POST",{version:editor.version,theme:"light",id:users.owner.id})).status,200);
  for(let i=0;i<2;i++)assert.equal((await request("bootstrap","owner")).body.profile.theme,"dark");
  assert.equal((await request("bootstrap","editor")).body.profile.theme,"light");
  assert.equal((await request("bootstrap",null)).body.profile,null);
 }finally{await db.close();}
});

test("file tags persist with reservation defaults, editable taxonomy, CAS, member authorization and JSON backup",async()=>{
 const {db,rpc,request,asUser}=await fixture();try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  for(const name of ['editor','viewer']){const token=(name==='editor'?'ab':'cd').repeat(32);await rpc('owner','create-invite',id,{role:name,token});await rpc(name,'join',null,{token});}
  w=await rpc('owner','save-booking',id,{data:{type:'hotel',title:'Hotel',startDate:details.startDate,endDate:'2026-11-03'}});
  const booking=w.records.find(r=>r.kind==='booking');
  const prepared=await request(`trips/${id}/actions/prepare-file`,'editor','POST',{name:'hotel.pdf',mime:'application/pdf',size:10,bookingId:booking.id});assert.equal(prepared.status,200);
  let file=prepared.body.file;assert.deepEqual(file.tags,['hotel']);assert.equal(file.version,1);assert.ok(file.created_at);
  w=(await rpc('owner','workspace',id));
  const tags=[{id:'hotel',label:'숙소 예약'},{id:'flight',label:'항공'},{id:'tour',label:'투어·티켓'},{id:'other',label:'기타'},{id:'important',label:'중요'}];
  w=await rpc('editor','update-settings',id,{revision:w.revision,fileTags:tags});assert.deepEqual(w.files[0].tags,['hotel']);assert.equal(w.trip.settings.fileTags[0].label,'숙소 예약');
  const updated=await request(`trips/${id}/actions/set-file-tags`,'editor','POST',{id:file.id,version:file.version,tags:['hotel','important','important']});assert.equal(updated.status,200);file=updated.body.file;assert.equal(file.version,2);assert.deepEqual(file.tags,['hotel','important']);
  await assert.rejects(rpc('editor','set-file-tags',id,{id:file.id,version:1,tags:[]}),{code:'PT409'});
  await assert.rejects(rpc('viewer','set-file-tags',id,{id:file.id,version:2,tags:[]}),{code:'PT403'});
  await assert.rejects(rpc('outsider','set-file-tags',id,{id:file.id,version:2,tags:[]}),{code:'PT404'});
  await assert.rejects(rpc('editor','set-file-tags',id,{id:file.id,version:2,tags:['unknown']}),{code:'PT400'});
  await assert.rejects(asUser('viewer',tx=>tx.query('update public.trip_files set tags=$1 where id=$2',[[],file.id])),{code:'42501'});
  w=updated.body.workspace;
  await assert.rejects(rpc('editor','update-settings',id,{revision:w.revision,fileTags:tags.filter(t=>t.id!=='important')}),{code:'PT409'});
  const unchanged=await rpc('editor','set-file-tags',id,{id:file.id,version:2,tags:['hotel','important']});assert.equal(unchanged.workspace.revision,w.revision);
  w=(await rpc('editor','set-file-tags',id,{id:file.id,version:2,tags:['hotel']})).workspace;
  w=await rpc('editor','update-settings',id,{revision:w.revision,fileTags:tags.filter(t=>t.id!=='important')});
  const imported=await rpc('owner','import',null,{key:crypto.randomUUID(),trip:w.trip,records:w.records.map(({id,kind,data})=>({id,kind,data}))});assert.deepEqual(imported.trip.settings.fileTags,w.trip.settings.fileTags);assert.equal(imported.files.length,0);
  await asUser('editor',tx=>tx.query("insert into storage.objects(bucket_id,name,metadata) values('tripboogie-private',$1,'{\"size\":10}')",[file.path]));
  const complete=await rpc('editor','finish-file',id,{id:file.id});assert.equal(complete.file.status,'ready');assert.deepEqual(complete.file.tags,['hotel']);
 }finally{await db.close();}
});

test("built-in file tags cannot be deleted and malformed file tags fail atomically",async()=>{
 const {db,rpc}=await fixture();try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  await assert.rejects(rpc('owner','update-settings',id,{revision:w.revision,fileTags:[]}),{code:'PT400'});
  w=await rpc('owner','update-settings',id,{revision:w.revision,fileTags:[{id:'hotel',label:'숙소'},{id:'flight',label:'항공'},{id:'tour',label:'투어·티켓'}]});
  w=await rpc('owner','save-booking',id,{data:{type:'other',title:'Museum',startDate:details.startDate,endDate:details.startDate}});const booking=w.records.find(r=>r.kind==='booking');
  const p=await rpc('owner','prepare-file',id,{name:'entry.txt',mime:'text/plain',size:4,bookingId:booking.id});assert.deepEqual(p.file.tags,['other']);assert.deepEqual(p.workspace.trip.settings.fileTags.map(t=>t.id),['hotel','flight','tour','other']);
  for(const tags of [null,'other',[12],['invalid'],Array.from({length:51},()=> 'other')])await assert.rejects(rpc('owner','prepare-file',id,{name:'bad.txt',mime:'text/plain',size:4,tags}),{code:'PT400'});
  assert.equal((await rpc('owner','workspace',id)).files.length,1);
 }finally{await db.close();}
});


test("existing reservation files gain tags while storage paths, dates and ready status remain unchanged",async()=>{
 const {db,rpc}=await fixture({beforeMigration:"_file_library_tags.sql"});try{
  let w=await rpc("owner","create",null,{data:details});const id=w.trip.id;
  w=await rpc("owner","save-booking",id,{data:{type:"hotel",title:"Hotel",startDate:details.startDate,endDate:"2026-11-03"}});
  const booking=w.records.find(r=>r.kind==="booking"),before=(await rpc("owner","prepare-file",id,{bookingId:booking.id,name:"saved.pdf",mime:"application/pdf",size:10})).file;
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('tripboogie-private',$1,'{\"size\":10}')",[before.path]);
  await rpc("owner","finish-file",id,{id:before.id});
  const folder=new URL("../../supabase/migrations/",import.meta.url),names=(await readdir(folder)).filter(name=>name.endsWith("_file_library_tags.sql"));assert.equal(names.length,1);
  await db.exec(await readFile(new URL(names[0],folder),"utf8"));
  const after=(await rpc("owner","workspace",id)).files[0];assert.deepEqual(after.tags,["hotel"]);assert.equal(after.version,1);
  for(const key of ["id","path","name","size","mime","created_at"])assert.equal(after[key],before[key]);assert.equal(after.status,"ready");assert.equal((await db.query("select count(*)::int as n from storage.objects where name=$1",[before.path])).rows[0].n,1);
 }finally{await db.close();}
});

test('flight, hotel and tour reservations synchronize event dates both ways with atomic validation',async()=>{
 const {db,rpc}=await fixture();try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  for(const name of ['editor','viewer']){const token=(name==='editor'?'ab':'cd').repeat(32);await rpc('owner','create-invite',id,{role:name,token});await rpc(name,'join',null,{token});}
  const base={title:'ICN → NRT',startDate:'2026-11-01',endDate:'2026-11-01',startTime:'09:00',endTime:'11:00',type:'flight',departureAirport:{icao:'RKSI',iata:'ICN',name:'Incheon',timezone:'Asia/Seoul'},arrivalAirport:{icao:'RJAA',iata:'NRT',name:'Narita',timezone:'Asia/Tokyo'}};
  w=await rpc('owner','save-booking',id,{data:base});let booking=w.records.find(r=>r.kind==='booking');
  let events=w.records.filter(r=>r.kind==='plan'&&r.data.bookingId===booking.id);
  assert.deepEqual(events.map(r=>r.data.bookingEvent).sort(),['arrival','departure']);
  const departure=events.find(r=>r.data.bookingEvent==='departure');
  w=await rpc('editor','save-plan',id,{id:departure.id,version:departure.version,data:{...departure.data,time:'10:00'}});
  booking=w.records.find(r=>r.id===booking.id);assert.equal(booking.data.startTime,'09:00');
  const arrival=w.records.find(r=>r.data.bookingEvent==='arrival');
  w=await rpc('owner','save-plan',id,{id:arrival.id,version:arrival.version,data:{...arrival.data,time:'08:00'}});
  assert.equal((await rpc('owner','workspace',id)).records.find(r=>r.id===booking.id).data.endTime,'11:00');
  w=await rpc('owner','save-booking',id,{id:booking.id,version:booking.version,data:{...booking.data,startTime:'09:30',endTime:'12:00'}});
  assert.equal(w.records.find(r=>r.id===departure.id).data.time,'10:00');assert.equal(w.records.find(r=>r.id===arrival.id).data.time,'08:00');
  w=await rpc('owner','schedule',id,{revision:w.revision,operation:'move',ids:[departure.id,arrival.id],sourceDate:'2026-11-01',targetDate:'2026-11-02'});
  booking=w.records.find(r=>r.id===booking.id);assert.equal(booking.data.startDate,'2026-11-02');assert.equal(booking.data.endDate,'2026-11-02');
  w=await rpc('owner','save-booking',id,{data:{type:'tour',title:'City tour',startDate:'2026-11-02',endDate:'2026-11-03',startTime:'13:00',endTime:'17:00'}});
  let tour=w.records.find(r=>r.kind==='booking'&&r.data.type==='tour');let tourPlan=w.records.find(r=>r.kind==='plan'&&r.data.bookingId===tour.id);
  assert.equal(tourPlan.data.bookingEvent,'tour');
  w=await rpc('owner','save-plan',id,{id:tourPlan.id,version:tourPlan.version,data:{...tourPlan.data,date:'2026-11-03',time:'14:00'}});
  tour=w.records.find(r=>r.id===tour.id);assert.equal(tour.data.startDate,'2026-11-03');assert.equal(tour.data.endDate,'2026-11-04');assert.equal(tour.data.startTime,'13:00');
  w=await rpc('owner','save-booking',id,{data:{type:'hotel',title:'Hotel',startDate:'2026-11-01',endDate:'2026-11-04',startTime:'15:00',endTime:'11:00'}});
  const hotel=w.records.find(r=>r.kind==='booking'&&r.data.type==='hotel');const checkin=w.records.find(r=>r.data.bookingId===hotel.id&&r.data.bookingEvent==='checkin');
  w=await rpc('owner','save-plan',id,{id:checkin.id,version:checkin.version,data:{...checkin.data,date:'2026-11-02',time:'16:00',title:'Custom check-in'}});
  assert.equal(w.records.find(r=>r.id===hotel.id).data.startDate,'2026-11-02');assert.equal(w.records.find(r=>r.id===hotel.id).data.startTime,'15:00');
  let current=w.records.find(r=>r.id===hotel.id);w=await rpc('owner','save-booking',id,{id:current.id,version:current.version,data:{...current.data,startTime:'17:00'}});
  assert.equal(w.records.find(r=>r.id===checkin.id).data.time,'16:00');assert.equal(w.records.find(r=>r.id===checkin.id).data.title,'Custom check-in');
  // Saving the reservation restores its mandatory event.
  tourPlan=w.records.find(r=>r.id===tourPlan.id);w=await rpc('owner','mutate',id,{action:'delete',kind:'plan',id:tourPlan.id,version:tourPlan.version});
  tour=w.records.find(r=>r.id===tour.id);w=await rpc('owner','save-booking',id,{id:tour.id,version:tour.version,data:{...tour.data,title:'Renamed tour'}});
  assert.equal(w.records.filter(r=>r.kind==='plan'&&r.data.bookingId===tour.id).length,1);
  // Viewers cannot alter shared reservation dates, or invoke synchronization helpers.
  await assert.rejects(rpc('viewer','save-plan',id,{id:checkin.id,version:w.records.find(r=>r.id===checkin.id).version,data:{...checkin.data,time:'18:00'}}),{code:'PT403'});
  const guards=await db.query("select has_function_privilege('authenticated','tripboogie_private.sync_plan_booking(public.trips,public.trip_records,public.trip_records)','execute') as allowed");assert.equal(guards.rows[0].allowed,false);
 }finally{await db.close();}
});

test('flight airport events always exist outside trip dates and repair legacy missing events with airport coordinates',async()=>{
 const {db,rpc}=await fixture({beforeMigration:'_flight_airports_and_checklist_order.sql'});try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  w=await rpc('owner','save-booking',id,{data:{type:'flight',title:'ICN → NRT',startDate:'2026-10-31',endDate:'2026-11-06',startTime:'23:30',endTime:'00:45',departureAirport:{icao:'RKSI',iata:'ICN',name:'Incheon',timezone:'Asia/Seoul'},arrivalAirport:{icao:'RJAA',iata:'NRT',name:'Narita',timezone:'Asia/Tokyo'}}});
  const old=w.records.find(r=>r.kind==='booking');assert.equal(w.records.filter(r=>r.kind==='plan').length,0);
  const migration=(await readdir(new URL('../../supabase/migrations/',import.meta.url))).find(n=>n.endsWith('_flight_airports_and_checklist_order.sql'));
  await db.exec(await readFile(new URL('../../supabase/migrations/'+migration,import.meta.url),'utf8'));
  const airports={departureAirport:{...old.data.departureAirport,lat:37.46,lng:126.44},arrivalAirport:{...old.data.arrivalAirport,lat:35.76,lng:140.39}};
  const result=await db.query('select tripboogie_private.repair_existing_flight($1,$2,$3::jsonb) as repaired',[old.id,old.version,JSON.stringify(airports)]);assert.equal(result.rows[0].repaired.events,2);
  w=await rpc('owner','workspace',id);let booking=w.records.find(r=>r.id===old.id);
  let events=w.records.filter(r=>r.kind==='plan'&&r.data.bookingId===booking.id);assert.equal(events.length,2);
  for(const [event,date,time,lat] of [['departure','2026-10-31','23:30',37.46],['arrival','2026-11-06','00:45',35.76]]){
   const p=events.find(r=>r.data.bookingEvent===event),place=w.records.find(r=>r.id===p.data.placeId);assert.equal(p.data.date,date);assert.equal(p.data.time,time);assert.equal(place.data.lat,lat);assert.ok(place.data.name);
  }
  const placeIds=events.map(r=>r.data.placeId).sort();
  // Old clients may omit the added coordinates on subsequent reservation edits.
  w=await rpc('owner','save-booking',id,{id:booking.id,version:booking.version,data:{...booking.data,departureAirport:old.data.departureAirport,startTime:'22:00'}});
  booking=w.records.find(r=>r.id===booking.id);assert.equal(booking.data.departureAirport.lat,37.46);
  assert.deepEqual(w.records.filter(r=>r.kind==='plan').map(r=>r.data.placeId).sort(),placeIds);assert.equal(w.records.find(r=>r.data.bookingEvent==='departure').data.time,'22:00');
  const departure=w.records.find(r=>r.data.bookingEvent==='departure');w=await rpc('owner','mutate',id,{action:'delete',kind:'plan',id:departure.id,version:departure.version});
  booking=w.records.find(r=>r.id===booking.id);w=await rpc('owner','save-booking',id,{id:booking.id,version:booking.version,data:booking.data});assert.equal(w.records.filter(r=>r.kind==='plan').length,2);
  await assert.rejects(rpc('owner','save-booking',id,{data:{...booking.data,departureAirport:{...airports.departureAirport,lat:91}}}),{code:'PT400'});
  const latest=w.records.find(r=>r.id===booking.id);w=await rpc('owner','mutate',id,{action:'delete',kind:'booking',id:latest.id,version:latest.version});assert.equal(w.records.filter(r=>r.kind==='plan').length,0);
  const guards=await db.query("select has_function_privilege('authenticated','tripboogie_private.repair_existing_flight(uuid,bigint,jsonb)','execute') as allowed");assert.equal(guards.rows[0].allowed,false);
 }finally{await db.close();}
});
test('checklist ordering persists per category, preserves checks and survives edits and additions',async()=>{
 const {db,rpc}=await fixture();try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  await rpc('owner','create-invite',id,{role:'viewer',token:'cd'.repeat(32)});await rpc('viewer','join',null,{token:'cd'.repeat(32)});
  for(const title of ['Passport','Charger','Tickets'])w=await rpc('owner','mutate',id,{action:'upsert',kind:'checklist',data:{title,category:'documents',scope:'all',done:false}});
  let tasks=w.records.filter(r=>r.kind==='checklist').sort((a,b)=>a.data.position-b.data.position);assert.deepEqual(tasks.map(r=>r.data.title),['Passport','Charger','Tickets']);
  w=await rpc('viewer','checklist-toggle',id,{id:tasks[0].id,done:true});const checks=w.records.find(r=>r.id===tasks[0].id).data.checks;
  const ids=[tasks[2].id,tasks[0].id,tasks[1].id],revision=w.revision;
  await assert.rejects(rpc('viewer','reorder-checklist',id,{revision,category:'documents',ids}),{code:'PT403'});
  await assert.rejects(rpc('owner','reorder-checklist',id,{revision,category:'documents',ids:[ids[0],ids[0],ids[1]]}),{code:'PT409'});
  await assert.rejects(rpc('owner','reorder-checklist',id,{revision,category:'other',ids}),{code:'PT409'});
  w=await rpc('owner','reorder-checklist',id,{revision,category:'documents',ids});assert.deepEqual(w.records.find(r=>r.id===tasks[0].id).data.checks,checks);
  await assert.rejects(rpc('owner','reorder-checklist',id,{revision,category:'documents',ids}),{code:'PT409'});
  const edited=w.records.find(r=>r.id===tasks[0].id);w=await rpc('owner','mutate',id,{action:'upsert',kind:'checklist',id:edited.id,version:edited.version,data:{title:'Passport changed',category:'documents',scope:'all',done:false}});assert.equal(w.records.find(r=>r.id===edited.id).data.position,1);
  w=await rpc('owner','mutate',id,{action:'upsert',kind:'checklist',data:{title:'Wallet',category:'documents',scope:'once',done:false}});
  assert.deepEqual((await rpc('owner','workspace',id)).records.filter(r=>r.kind==='checklist').sort((a,b)=>a.data.position-b.data.position).map(r=>r.data.title),['Tickets','Passport changed','Charger','Wallet']);
 }finally{await db.close();}
});

test('daily hotel stays, manual reservation links and shared notes preserve independent schedule edits',async()=>{
 const {db,rpc,request}=await fixture();try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  await rpc('owner','create-invite',id,{role:'viewer',token:'cd'.repeat(32)});await rpc('viewer','join',null,{token:'cd'.repeat(32)});
  w=await rpc('owner','save-booking',id,{data:{type:'hotel',title:'Daily hotel',roomName:'Twin room',startDate:'2026-11-01',endDate:'2026-11-04',startTime:'15:00',endTime:'11:00',note:'Shared note'},place:{name:'Hotel location',lat:35,lng:139}});
  let hotel=w.records.find(r=>r.kind==='booking');const linked=()=>w.records.filter(r=>r.kind==='plan'&&r.data.bookingId===hotel.id);
  assert.equal(hotel.data.roomName,'Twin room');assert.deepEqual(linked().map(r=>r.data.date).sort(),['2026-11-01','2026-11-02','2026-11-03','2026-11-04']);assert.equal(linked().filter(r=>r.data.bookingEvent==='stay').length,2);
  let stay=linked().find(r=>r.data.date==='2026-11-02');const stayId=stay.id;
  w=await rpc('owner','save-plan',id,{id:stay.id,version:stay.version,data:{...stay.data,title:'My hotel stop',time:'20:30',duration:90,note:'Memo from itinerary'},place:{name:'Independent meeting spot',lat:36,lng:140}});
  hotel=w.records.find(r=>r.id===hotel.id);stay=w.records.find(r=>r.id===stayId);const ownPlace=stay.data.placeId;
  assert.equal(hotel.data.note,'Memo from itinerary');assert.equal(hotel.data.startTime,'15:00');assert.notEqual(hotel.data.placeId,ownPlace);assert.ok(linked().every(r=>r.data.note===hotel.data.note));
  w=await rpc('owner','save-plan',id,{id:stay.id,version:stay.version,data:{...stay.data,date:'2026-11-03'}});
  hotel=w.records.find(r=>r.id===hotel.id);stay=w.records.find(r=>r.id===stayId);assert.equal(hotel.data.startDate,'2026-11-02');assert.equal(hotel.data.endDate,'2026-11-05');assert.equal(stay.data.date,'2026-11-03');assert.equal(stay.data.title,'My hotel stop');assert.equal(stay.data.time,'20:30');assert.equal(stay.data.placeId,ownPlace);assert.equal(stay.data.duration,90);assert.deepEqual(linked().map(r=>r.data.date).sort(),['2026-11-02','2026-11-03','2026-11-04','2026-11-05']);
  w=await rpc('owner','save-booking',id,{id:hotel.id,version:hotel.version,data:{...hotel.data,startDate:'2026-11-01',endDate:'2026-11-04',note:'Memo from booking',startTime:'16:00'}});
  hotel=w.records.find(r=>r.id===hotel.id);stay=w.records.find(r=>r.id===stayId);assert.equal(stay.data.date,'2026-11-02');assert.equal(stay.data.time,'20:30');assert.equal(stay.data.placeId,ownPlace);assert.ok(linked().every(r=>r.data.note==='Memo from booking'));
  const gone=linked().find(r=>r.data.date==='2026-11-03');w=await rpc('owner','mutate',id,{action:'delete',kind:'plan',id:gone.id,version:gone.version});
  assert.equal((await request(`trips/${id}/actions/ensure-hotel-plan`,'owner','POST',{bookingId:hotel.id,date:'2026-11-03'})).status,200);
  w=await rpc('owner','workspace',id);assert.equal(linked().length,4);const snapshot=linked().map(r=>[r.id,r.version]).sort();w=await rpc('owner','ensure-hotel-plan',id,{bookingId:hotel.id,date:'2026-11-03'});assert.deepEqual(linked().map(r=>[r.id,r.version]).sort(),snapshot);
  await assert.rejects(rpc('viewer','ensure-hotel-plan',id,{bookingId:hotel.id,date:'2026-11-03'}),{code:'PT403'});await assert.rejects(rpc('owner','ensure-hotel-plan',id,{bookingId:hotel.id,date:'2026-11-05'}),{code:'PT400'});
  w=await rpc('owner','save-booking',id,{data:{type:'other',category:'other',title:'No location reservation',startDate:'2026-11-02',endDate:'2026-11-02',startTime:'09:00',note:'Other memo'}});let other=w.records.find(r=>r.kind==='booking'&&r.data.type==='other');
  w=await rpc('owner','save-plan',id,{data:{title:'Meeting place',entryType:'plan',date:'2026-11-02',bookingId:other.id},place:{name:'Station',lat:35,lng:139}});let manual=w.records.find(r=>r.kind==='plan'&&r.data.bookingId===other.id);assert.equal(manual.data.bookingEvent,'manual');assert.equal(manual.data.time,'09:00');assert.equal(manual.data.note,'Other memo');assert.equal(other.data.placeId,'');
  w=await rpc('owner','save-plan',id,{id:manual.id,version:manual.version,data:{...manual.data,date:'2026-11-03',time:'12:00',note:''}});other=w.records.find(r=>r.id===other.id);manual=w.records.find(r=>r.id===manual.id);assert.equal(other.data.startDate,'2026-11-03');assert.equal(other.data.endDate,'2026-11-03');assert.equal(other.data.startTime,'09:00');assert.equal(other.data.note,'');assert.equal(manual.data.date,'2026-11-03');
  // Unlink explicitly; later reservation edits cannot change the detached plan.
  w=await rpc('owner','save-plan',id,{id:manual.id,version:manual.version,data:{...manual.data,bookingId:''}});assert.equal(w.records.find(r=>r.id===manual.id).data.bookingId,undefined);
  const copy=await rpc('owner','import',null,{key:crypto.randomUUID(),trip:w.trip,records:w.records});assert.equal(copy.records.filter(r=>r.kind==='plan'&&r.data.bookingEvent==='stay').length,2);assert.ok(copy.records.find(r=>r.data.title==='My hotel stop').data.bookingOverrides.includes('title'));assert.equal(copy.records.find(r=>r.kind==='booking'&&r.data.type==='hotel').data.roomName,'Twin room');
  const foreign=(await rpc('owner','create',null,{data:details}));let fw=await rpc('owner','save-booking',foreign.trip.id,{data:{type:'other',title:'Foreign',startDate:details.startDate,endDate:details.startDate}});const fb=fw.records.find(r=>r.kind==='booking');
  for(const data of [{title:'Bad',date:details.startDate,bookingId:fb.id},{title:'Memo',entryType:'memo',date:details.startDate,bookingId:hotel.id}])await assert.rejects(rpc('owner','save-plan',id,{data}),{code:'PT400'});
  hotel=w.records.find(r=>r.id===hotel.id);await assert.rejects(rpc('owner','save-booking',id,{id:hotel.id,version:hotel.version,data:{...hotel.data,roomName:'x'.repeat(201)}}),{code:'PT400'});
  w=await rpc('owner','mutate',id,{action:'delete',kind:'booking',id:hotel.id,version:hotel.version});assert.ok(w.records.find(r=>r.id===stayId));assert.equal(w.records.find(r=>r.id===stayId).data.bookingId,undefined);assert.equal(w.records.filter(r=>r.data.bookingId===hotel.id).length,0);
 }finally{await db.close();}
});

test('hotel migration backfills every date without changing existing customized titles or times',async()=>{
 const {db,rpc}=await fixture({beforeMigration:'_hotel_stays_and_manual_booking_links.sql'});try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  w=await rpc('owner','save-booking',id,{data:{type:'hotel',title:'Existing',startDate:'2026-11-01',endDate:'2026-11-04',startTime:'15:00',endTime:'11:00',note:'Booking memo'}});let plan=w.records.find(r=>r.data.bookingEvent==='checkin');
  w=await rpc('owner','save-plan',id,{id:plan.id,version:plan.version,data:{...plan.data,title:'Custom stay',time:'16:00'}});
  const file=(await readdir(new URL('../../supabase/migrations/',import.meta.url))).find(n=>n.endsWith('_hotel_stays_and_manual_booking_links.sql'));await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  w=await rpc('owner','workspace',id);assert.equal(w.records.filter(r=>r.kind==='plan').length,4);plan=w.records.find(r=>r.id===plan.id);assert.equal(plan.data.title,'Custom stay');assert.equal(plan.data.time,'16:00');assert.ok(w.records.filter(r=>r.kind==='plan').every(r=>r.data.note==='Booking memo'));
  const permissions=await db.query("select bool_or(has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute')) as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tripboogie_private' and p.proname in ('bind_plan_booking','sync_booking_event','shift_booking_anchors')");assert.equal(permissions.rows[0].allowed,false);
 }finally{await db.close();}
});

test('route estimates persist independently, reject stale geometry and never overwrite manual times',async()=>{
 const {db,rpc,request}=await fixture();try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  await rpc('owner','create-invite',id,{role:'viewer',token:'ab'.repeat(32)});await rpc('viewer','join',null,{token:'ab'.repeat(32)});
  w=await rpc('owner','save-plan',id,{data:{title:'Origin',date:details.startDate},place:{name:'Origin',lat:35,lng:139}});const from=w.records.find(r=>r.kind==='plan');
  w=await rpc('owner','save-plan',id,{data:{title:'Destination',date:details.startDate},place:{name:'Destination',lat:35.1,lng:139.2}});let target=w.records.find(r=>r.kind==='plan'&&r.id!==from.id);
  const key=JSON.stringify(['walk',from.id,target.id,35,139,35.1,139.2]);const payload=()=>({id:target.id,version:target.version,fromId:from.id,key,mode:'walk',minutes:25});
  const response=await request(`trips/${id}/actions/save-travel-time`,'owner','POST',payload());assert.equal(response.status,200);w=response.body;target=w.records.find(r=>r.id===target.id);assert.equal(target.data.travelMinutes,25);assert.equal(target.data.travelTimeSource,'estimate');assert.equal(target.data.travelEstimateKey,key);
  assert.equal((await rpc('owner','workspace',id)).records.find(r=>r.id===target.id).data.travelMinutes,25);
  const version=target.version,revision=w.revision;w=await rpc('owner','save-travel-time',id,payload());assert.equal(w.revision,revision);assert.equal(w.records.find(r=>r.id===target.id).version,version);
  await assert.rejects(rpc('viewer','save-travel-time',id,payload()),{code:'PT403'});
  await assert.rejects(rpc('owner','save-travel-time',id,{...payload(),minutes:100001}),{code:'PT400'});
  w=await rpc('owner','save-plan',id,{id:target.id,version:target.version,data:{...target.data,title:'Newer name',travelMinutes:7,travelTimeSource:'manual',travelEstimateKey:undefined}});target=w.records.find(r=>r.id===target.id);
  w=await rpc('owner','save-travel-time',id,{...payload(),version,minutes:99});assert.equal(w.records.find(r=>r.id===target.id).data.title,'Newer name');assert.equal(w.records.find(r=>r.id===target.id).data.travelMinutes,7);
  w=await rpc('owner','save-travel-time',id,{...payload(),minutes:99});assert.equal(w.records.find(r=>r.id===target.id).data.travelMinutes,7);
  w=await rpc('owner','save-plan',id,{id:target.id,version:target.version,data:{...target.data,transportMode:'drive',travelMinutes:undefined,travelTimeSource:undefined,travelEstimateKey:undefined}});target=w.records.find(r=>r.id===target.id);
  w=await rpc('owner','save-travel-time',id,payload());assert.equal(w.records.find(r=>r.id===target.id).data.travelMinutes,undefined);
  let location=w.records.find(r=>r.id===target.data.placeId);w=await rpc('owner','mutate',id,{kind:'place',action:'upsert',id:location.id,version:location.version,data:{...location.data,lat:36}});
  w=await rpc('owner','save-travel-time',id,{...payload(),mode:'drive',key:JSON.stringify(['drive',from.id,target.id,35,139,35.1,139.2])});assert.equal(w.records.find(r=>r.id===target.id).data.travelMinutes,undefined);
  const driveKey=JSON.stringify(['drive',from.id,target.id,35,139,36,139.2]);w=await rpc('owner','save-travel-time',id,{...payload(),mode:'drive',key:driveKey,minutes:18});target=w.records.find(r=>r.id===target.id);assert.equal(target.data.travelMinutes,18);
  // Booking memo synchronization preserves the schedule's route choice and estimate.
  w=await rpc('owner','save-booking',id,{data:{type:'hotel',title:'Hotel',startDate:details.startDate,endDate:'2026-11-02'},place:{name:'Hotel',lat:35.3,lng:139.5}});let hotel=w.records.find(r=>r.kind==='booking'),checkin=w.records.find(r=>r.data.bookingId===hotel.id&&r.data.bookingEvent==='checkin');
  const stayKey=JSON.stringify(['walk',from.id,checkin.id,35,139,35.3,139.5]);w=await rpc('owner','save-travel-time',id,{id:checkin.id,version:checkin.version,fromId:from.id,mode:'walk',key:stayKey,minutes:32});checkin=w.records.find(r=>r.id===checkin.id);
  w=await rpc('owner','save-booking',id,{id:hotel.id,version:hotel.version,data:{...hotel.data,note:'Shared later memo'}});checkin=w.records.find(r=>r.id===checkin.id);assert.equal(checkin.data.travelMinutes,32);assert.equal(checkin.data.travelTimeSource,'estimate');assert.equal(checkin.data.travelEstimateKey,stayKey);assert.equal(checkin.data.note,'Shared later memo');
  assert.equal((await db.query("select has_function_privilege('authenticated','tripboogie_private.save_travel_time(public.trips,jsonb)','execute') as allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});


test('memo-only itinerary edits and clearing sync every booking type through HTTP and survive reload',async()=>{
 const {db,rpc,request}=await fixture();try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  for(const type of ['flight','hotel','tour','other']){
   w=await rpc('owner','save-booking',id,{data:{type,title:'Memo sync '+type,startDate:'2026-11-01',endDate:'2026-11-03',startTime:'09:00',endTime:'11:00',note:'Original memo',departure:'ICN',arrival:'NRT'}});
   const booking=w.records.find(r=>r.kind==='booking'&&r.data.type===type);
   if(type==='other')w=await rpc('owner','save-plan',id,{data:{title:'Manual link',date:'2026-11-01',bookingId:booking.id}});
   let plan=w.records.find(r=>r.kind==='plan'&&r.data.bookingId===booking.id);
   const original={startDate:booking.data.startDate,endDate:booking.data.endDate,startTime:booking.data.startTime,endTime:booking.data.endTime};
   for(const note of ['Memo from itinerary only','']){
    const response=await request(`trips/${id}/actions/save-plan`,'owner','POST',{id:plan.id,version:plan.version,data:{...plan.data,note}});
    assert.equal(response.status,200);w=await rpc('owner','workspace',id);
    const saved=w.records.find(r=>r.id===booking.id);plan=w.records.find(r=>r.id===plan.id);
    assert.equal(saved.data.note,note,type);assert.ok(w.records.filter(r=>r.kind==='plan'&&r.data.bookingId===booking.id).every(r=>r.data.note===note));
    assert.deepEqual(Object.fromEntries(Object.keys(original).map(k=>[k,saved.data[k]])),original);
   }
  }
 }finally{await db.close();}
});

test('country-only travel derives all currencies and city transit survives editing and backup',async()=>{
 const {db,rpc}=await fixture();try{
  let w=await rpc('owner','create',null,{data:{...details,countries:['NZ','JP','NZ'],currency:'NZD',cities:[]}});const id=w.trip.id;
  assert.deepEqual(w.trip.settings.countries,['NZ','JP']);assert.deepEqual(w.trip.settings.currencies,['NZD','JPY']);assert.deepEqual(w.trip.settings.cities,[]);
  const city={id:crypto.randomUUID(),name:'Auckland',address:'NZ',lat:-36.85,lng:174.76,countryCode:'NZ',timezone:'Pacific/Auckland',currency:'NZD',startDate:details.startDate,endDate:details.endDate,transit:true};
  w=await rpc('owner','update-settings',id,{revision:w.revision,cities:[city],countries:['NZ','JP','BT']});assert.equal(w.trip.settings.cities[0].transit,true);assert.deepEqual(new Set(w.trip.settings.currencies),new Set(['NZD','JPY','BTN','INR']));
  await assert.rejects(rpc('owner','update-settings',id,{revision:w.revision,countries:['INVALID']}),{code:'PT400'});
  const copy=await rpc('owner','import',null,{key:crypto.randomUUID(),trip:w.trip,records:[]});assert.equal(copy.trip.settings.cities[0].transit,true);assert.deepEqual(new Set(copy.trip.settings.currencies),new Set(w.trip.settings.currencies));assert.deepEqual(copy.trip.settings.countries,w.trip.settings.countries);
  w=await rpc('owner','mutate',id,{action:'update-trip',version:w.trip.version,revision:w.revision,data:{...w.trip,cities:[],countries:['JP'],currency:'JPY'}});assert.deepEqual(w.trip.settings.countries,['JP']);assert.deepEqual(w.trip.settings.currencies,['JPY']);
 }finally{await db.close();}
});

test('bulk file operations validate every version and membership before changing any file',async()=>{
 const {db,rpc,request}=await fixture();try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id;
  await rpc('owner','create-invite',id,{role:'viewer',token:'fa'.repeat(32)});await rpc('viewer','join',null,{token:'fa'.repeat(32)});
  for(const name of ['one.pdf','two.pdf']){const p=await rpc('owner','prepare-file',id,{name,mime:'application/pdf',size:10});await db.query("insert into storage.objects(bucket_id,name,metadata) values('tripboogie-private',$1,'{\"size\":10}')",[p.file.path]);await rpc('owner','finish-file',id,{id:p.file.id});}
  w=await rpc('owner','workspace',id);let files=w.files.map(f=>({id:f.id,version:f.version}));const original=structuredClone(w.files);
  assert.equal((await request(`trips/${id}/actions/set-files-tags`,'viewer','POST',{files,tags:['flight']})).status,403);
  await assert.rejects(rpc('outsider','set-files-tags',id,{files,tags:['hotel']}),{code:'PT404'});
  await assert.rejects(rpc('owner','set-files-tags',id,{files:[files[0],{...files[1],version:99}],tags:['hotel']}),{code:'PT409'});assert.deepEqual((await rpc('owner','workspace',id)).files,original);
  await assert.rejects(rpc('owner','set-files-tags',id,{files:[files[0],files[0]],tags:['hotel']}),{code:'PT400'});
  const result=await request(`trips/${id}/actions/set-files-tags`,'owner','POST',{files,tags:['flight','tour']});assert.equal(result.status,200);w=result.body.workspace;assert.ok(w.files.every(f=>f.tags.join(',')==='flight,tour'&&f.version===2));files=w.files.map(f=>({id:f.id,version:f.version}));
  await rpc('owner','mark-files-delete',id,{files});await assert.rejects(rpc('owner','finish-files-delete',id,{files}),{code:'PT409'});assert.equal((await rpc('owner','workspace',id)).files.length,2);
  await db.query("delete from storage.objects where bucket_id='tripboogie-private' and name=any($1::text[])",[w.files.map(f=>f.path)]);
  w=(await rpc('owner','finish-files-delete',id,{files})).workspace;assert.equal(w.files.length,0);
  const guard=await db.query("select has_function_privilege('authenticated','tripboogie_private.file_operation(text,public.trips,jsonb)','execute') as allowed");assert.equal(guard.rows[0].allowed,false);
 }finally{await db.close();}
});

test('flight seat and baggage bundles are bounded, versioned and survive backup without changing schedule overrides',async()=>{
 const {db,rpc}=await fixture();try{
  let w=await rpc('owner','create',null,{data:details});const id=w.trip.id,extras=[{id:crypto.randomUUID(),seat:'18A',baggageCount:2,baggageKg:23},{id:crypto.randomUUID(),seat:'18B',baggageCount:'',baggageKg:''}];
  const data={type:'flight',title:'ICN → NRT',startDate:details.startDate,endDate:details.startDate,startTime:'09:00',endTime:'11:00',departureZone:'Asia/Seoul',arrivalZone:'Asia/Tokyo',flightExtras:extras};
  w=await rpc('owner','save-booking',id,{data});let booking=w.records.find(r=>r.kind==='booking');assert.equal(booking.data.flightExtras.length,2);assert.equal(booking.data.flightExtras[0].baggageKg,23);assert.equal(booking.data.flightExtras[1].baggageCount,null);
  await assert.rejects(rpc('owner','save-booking',id,{id:booking.id,version:booking.version,data:{...booking.data,flightExtras:[{...extras[0],baggageCount:21}]}}),{code:'PT400'});
  w=await rpc('owner','save-booking',id,{id:booking.id,version:booking.version,data:{...booking.data,flightExtras:[{...extras[0],seat:'19A'}]}});booking=w.records.find(r=>r.id===booking.id);assert.equal(booking.data.flightExtras[0].seat,'19A');assert.equal(booking.data.flightExtras.length,1);
  const copy=await rpc('owner','import',null,{key:crypto.randomUUID(),trip:w.trip,records:w.records});assert.deepEqual(copy.records.find(r=>r.kind==='booking').data.flightExtras,booking.data.flightExtras);
 }finally{await db.close();}
});

test('paid reservations atomically create payer-labelled expenses with country and independently recorded conversion amounts',async()=>{
 const {db,rpc}=await fixture();try{
  let w=await rpc('owner','create',null,{data:{...details,countries:['JP','NZ']}});const id=w.trip.id;
  for(const type of ['flight','hotel','tour','other']){
   const bookingId=crypto.randomUUID(),price='200',payment={model:2,title:`Paid ${type}`,category:'other',tripCurrency:'NZD',baseCurrency:'KRW',paidCurrency:'NZD',tripAmount:price,baseAmount:'161234',exchangeRate:'800',rateDate:details.startDate,period:'day',date:details.startDate,countryCode:'NZ',payers:[{userId:users.owner.id,name:'owner',amount:price}],participants:[{userId:users.owner.id,name:'owner',amount:price}]};
   w=await rpc('owner','save-booking',id,{id:bookingId,data:{type,title:`Paid ${type}`,startDate:details.startDate,endDate:details.startDate,isPaid:true,moneyAmount:price,moneyCurrency:'NZD'},expense:{data:payment}});
   const booking=w.records.find(r=>r.id===bookingId),expense=w.records.find(r=>r.id===booking.data.expenseId);assert.equal(expense.data.countryCode,'NZ');assert.equal(String(expense.data.baseAmount),'161234');assert.equal(expense.data.payers[0].name,'owner');
   await assert.rejects(rpc('owner','save-booking',id,{id:bookingId,version:booking.version,data:{...booking.data,moneyAmount:'300'},expense:{id:expense.id,version:expense.version,data:{...payment,paidCurrency:'KRW'}}}),{code:'PT400'});
   assert.equal((await rpc('owner','workspace',id)).records.find(r=>r.id===bookingId).data.moneyAmount,price);
  }
  w=await rpc('owner','workspace',id);assert.equal(w.records.filter(r=>r.kind==='expense').length,4);
 }finally{await db.close();}
});

test('reverse city lookup is authenticated, coordinate-bounded and exposes city and timezone metadata',async()=>{
 const {createMapHandler}=await import(pathToFileURL(path.join(directory,'maps.mjs')));let calls=0,budgets=0;
 const handler=createMapHandler({key:'private-test-key',resolveUser:async r=>r.headers.get('authorization')?users.owner:null,budget:async()=>{budgets++;},fetch:async url=>{calls++;const u=new URL(url);assert.equal(u.pathname,'/v1/geocode/reverse');assert.equal(u.searchParams.get('type'),'city');assert.equal(u.searchParams.get('lat'),'-38.13');return Response.json({features:[{properties:{name:'Rotorua',city:'Rotorua',formatted:'Rotorua, New Zealand',lat:-38.13,lon:176.25,country_code:'nz',timezone:{name:'Pacific/Auckland'}}}]});}});
 const req=(data,auth=true)=>new Request('https://tripboogie.example.test/api/maps/reverse',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://tripboogie.example.test',...(auth?{authorization:'Bearer owner'}:{})},body:JSON.stringify(data)});
 assert.equal((await handler(req({lat:-38.13,lng:176.25},false),'reverse')).status,401);assert.equal((await handler(req({lat:91,lng:176.25}),'reverse')).status,400);assert.equal(calls,0);
 const r=await handler(req({lat:-38.13,lng:176.25}),'reverse'),body=await r.json();assert.equal(r.status,200);assert.equal(body.places[0].cityName,'Rotorua');assert.equal(body.places[0].countryCode,'NZ');assert.equal(body.places[0].currency,'NZD');assert.equal(budgets,1);assert.equal(calls,1);
});

test('expense-first booking links are atomic, reciprocal, versioned, movable and authorization checked',async()=>{
 const {db,rpc,request}=await fixture();try{
  let w=await rpc('owner','create',null,{data:details}),id=w.trip.id;
  const bookingIds=[];for(const type of ['flight','hotel','tour']){const bid=crypto.randomUUID();w=await rpc('owner','save-booking',id,{id:bid,data:{type,title:`Link ${type}`,startDate:details.startDate,endDate:details.startDate,moneyCurrency:'KRW',moneyAmount:'1000'}});bookingIds.push(bid);}
  const expenseId=crypto.randomUUID(),payment={model:2,title:'linked payment',category:'flight',tripCurrency:'KRW',baseCurrency:'KRW',paidCurrency:'KRW',tripAmount:'1000',baseAmount:'1000',exchangeRate:'1',period:'before',date:details.startDate,countryCode:'KR',payers:[{userId:users.owner.id,name:'owner',amount:'1000'}],participants:[{userId:users.owner.id,name:'owner',amount:'1000'}],bookingId:bookingIds[0]};
  let b=w.records.find(r=>r.id===bookingIds[0]);
  const response=await request(`trips/${id}/actions/save-expense`,'owner','POST',{id:expenseId,data:{...payment,bookingVersion:b.version}});assert.equal(response.status,200);w=response.body;
  let e=w.records.find(r=>r.id===expenseId);b=w.records.find(r=>r.id===bookingIds[0]);assert.equal(e.data.bookingId,b.id);assert.equal(b.data.expenseId,e.id);assert.equal(b.data.moneyAmount,'1000');assert.equal(b.data.isPaid,true);
  await assert.rejects(rpc('outsider','save-expense',id,{data:payment}),{code:'PT404'});
  await rpc('owner','create-invite',id,{role:'viewer',token:'bc'.repeat(32)});await rpc('viewer','join',null,{token:'bc'.repeat(32)});assert.equal((await request(`trips/${id}/actions/save-expense`,'viewer','POST',{data:payment})).status,403);
  await assert.rejects(rpc('owner','save-expense',id,{id:crypto.randomUUID(),data:payment}),{code:'PT409'});
  await assert.rejects(rpc('owner','save-expense',id,{id:e.id,version:e.version,data:{...payment,bookingVersion:b.version-1}}),{code:'PT409'});
  w=await rpc('owner','save-expense',id,{id:e.id,version:e.version,data:{...payment,tripAmount:'2400',baseAmount:'2400',payers:[{...payment.payers[0],amount:'2400'}],participants:[{...payment.participants[0],amount:'2400'}]}});e=w.records.find(r=>r.id===e.id);b=w.records.find(r=>r.id===b.id);assert.equal(b.data.moneyAmount,'2400');
  w=await rpc('owner','save-booking',id,{id:b.id,version:b.version,data:{...b.data,moneyAmount:'3000'},expense:{id:e.id,version:e.version,data:{...e.data,tripAmount:'3000',baseAmount:'3000',payers:[{...payment.payers[0],amount:'3000'}],participants:[{...payment.participants[0],amount:'3000'}]}}});e=w.records.find(r=>r.id===e.id);assert.equal(e.data.tripAmount,'3000');
  w=await rpc('owner','save-expense',id,{id:e.id,version:e.version,data:{...e.data,bookingId:bookingIds[1]}});e=w.records.find(r=>r.id===e.id);assert.equal(e.data.bookingId,bookingIds[1]);assert.equal(w.records.find(r=>r.id===bookingIds[0]).data.isPaid,false);assert.equal(w.records.find(r=>r.id===bookingIds[1]).data.expenseId,e.id);
  w=await rpc('owner','save-expense',id,{id:e.id,version:e.version,data:{...e.data,bookingId:''}});e=w.records.find(r=>r.id===e.id);assert.equal(e.data.bookingId,undefined);assert.equal(w.records.find(r=>r.id===bookingIds[1]).data.isPaid,false);
  const other=await rpc('owner','create',null,{data:details});await assert.rejects(rpc('owner','save-expense',other.trip.id,{data:payment}),{code:'PT404'});
  const acl=await db.query("select has_function_privilege('authenticated','tripboogie_private.save_expense(public.trips,jsonb)','execute') allowed");assert.equal(acl.rows[0].allowed,false);
 }finally{await db.close();}
});
test('five built-in expense categories cannot be deleted and one flight seat survives independent baggage and backup',async()=>{
 const {db,rpc}=await fixture();try{
  let w=await rpc('owner','create',null,{data:details});assert.deepEqual(w.trip.settings.expenseCategories.map(c=>c.label),['항공','숙소','교통','식비','관광']);
  const cats=w.trip.settings.expenseCategories;for(const c of cats)await assert.rejects(rpc('owner','update-settings',w.trip.id,{revision:w.revision,expenseCategories:cats.filter(x=>x.id!==c.id)}),{code:'PT400'});
  w=await rpc('owner','update-settings',w.trip.id,{revision:w.revision,expenseCategories:[...cats].reverse().map(c=>c.id==='flight'?{...c,label:'비행기'}:c)});assert.equal(w.trip.settings.expenseCategories.at(-1).label,'비행기');
  w=await rpc('owner','save-booking',w.trip.id,{data:{type:'flight',title:'Seat and bags',startDate:details.startDate,endDate:details.startDate,flightSeat:'18A',flightExtras:[{id:crypto.randomUUID(),baggageCount:1,baggageKg:23},{id:crypto.randomUUID(),baggageCount:2,baggageKg:10}]}});const b=w.records.find(r=>r.kind==='booking');assert.equal(b.data.flightSeat,'18A');assert.equal(b.data.flightExtras.length,2);assert.ok(b.data.flightExtras.every(e=>e.seat===''));
  const copy=await rpc('owner','import',null,{key:crypto.randomUUID(),trip:w.trip,records:w.records});assert.equal(copy.records.find(r=>r.kind==='booking').data.flightSeat,'18A');assert.equal(copy.trip.settings.expenseCategories.length,5);
 }finally{await db.close();}
});

test("shared overview: members read, editors save per-day versions, conflicts preserve independent days and sources", async () => {
  const {db,rpc,request,asUser}=await fixture();
  try {
    const created=await rpc('owner','create',null,{data:details}),id=created.trip.id;
    for(const [role,user,token] of [['editor','editor','ab'.repeat(32)],['viewer','viewer','cd'.repeat(32)]]){await rpc('owner','create-invite',id,{role,token});await rpc(user,'join',null,{token});}
    const planId=crypto.randomUUID();
    const source=await rpc('owner','mutate',id,{action:'upsert',kind:'plan',id:planId,data:{title:'원본 캐노피 투어',date:'2026-11-01',time:'08:30',duration:180,note:'원본 메모',placeId:''}});
    const route=`trips/${id}/actions/save-overview`;
    const first={date:'2026-11-01',text:'08:30 캐노피 (3시간)\n점심',sourceIds:[planId],version:0};
    const saved=await request(route,'owner','POST',{rows:[first]});
    assert.equal(saved.status,200);assert.equal(saved.body.overview[0].version,1);assert.deepEqual(saved.body.records,source.records);
    assert.equal((await request(`trips/${id}`,'viewer')).body.overview[0].text,first.text);
    assert.equal((await request(route,'viewer','POST',{rows:[{...first,text:'불가',version:1}]})).status,403);
    assert.equal((await request(route,'outsider','POST',{rows:[first]})).status,404);
    assert.equal((await request(route,null,'POST',{rows:[first]})).status,401);
    const other=await request(route,'editor','POST',{rows:[{date:'2026-11-02',text:'다른 날짜는 동시에 편집 가능',sourceIds:[],version:0}]});assert.equal(other.status,200);
    const stale=await request(route,'editor','POST',{rows:[{...first,text:'오래된 편집'}]});assert.equal(stale.status,409);assert.equal(stale.body.code,'OVERVIEW_CONFLICT');
    const retried=await request(route,'owner','POST',{rows:[first]});assert.equal(retried.status,200);assert.equal(retried.body.revision,other.body.revision);
    const emptied=await request(route,'owner','POST',{rows:[{...first,text:'',sourceIds:[],version:1}]});assert.equal(emptied.status,200);assert.equal(emptied.body.overview[0].version,2);
    assert.equal((await request(route,'editor','POST',{rows:[{...first,text:'빈 칸 부활 방지',version:1}]})).status,409);
    assert.deepEqual((await rpc('owner','workspace',id)).records,source.records);
    assert.equal((await asUser('outsider',tx=>tx.query('select * from public.trip_overview_days'))).rows.length,0);
    assert.equal((await asUser('viewer',tx=>tx.query('select * from public.trip_overview_days'))).rows.length,2);
    await assert.rejects(asUser('editor',tx=>tx.query('update public.trip_overview_days set text=$1 where trip_id=$2',['bypass',id])),/permission denied/);
    const priv=await asUser('editor',tx=>tx.query("select has_function_privilege('authenticated','tripboogie_private.save_overview(public.trips,jsonb)','EXECUTE') allowed"));assert.equal(priv.rows[0].allowed,false);
  } finally {await db.close();}
});

test("shared overview: bulk writes are atomic, validate references and whitespace, and accept bounded long requests",async()=>{
  const {db,rpc,request}=await fixture();
  try{
    const created=await rpc('owner','create',null,{data:details}),id=created.trip.id;
    const route=`trips/${id}/actions/save-overview`;
    const first={date:'2026-11-01',text:'  여백 보존\n\n',sourceIds:[],version:0};
    const initial=(await request(route,'owner','POST',{rows:[first]})).body;assert.equal(initial.overview[0].text,first.text);
    const failed=await request(route,'owner','POST',{rows:[{...first,date:'2026-11-02',text:'롤백되어야 함'},{...first,text:'충돌'}]});assert.equal(failed.status,409);
    const after=await rpc('owner','workspace',id);assert.equal(after.overview.length,1);assert.equal(after.revision,initial.revision);
    for(const row of [{...first,date:'2026-12-01'},{...first,date:'2026-11-40'},{...first,version:-1},{...first,version:'1'},{...first,text:'가'.repeat(10001)},{...first,sourceIds:[crypto.randomUUID()]}])assert.equal((await request(route,'owner','POST',{rows:[row]})).status,400);
    assert.equal((await request(route,'owner','POST',{rows:[{...first,version:1},{...first,version:1}]})).status,400);
    const foreign=await rpc('owner','create',null,{data:{...details,title:'다른 여행'}}), foreignPlan=crypto.randomUUID();
    await rpc('owner','mutate',foreign.trip.id,{action:'upsert',id:foreignPlan,kind:'plan',data:{date:'2026-11-01',title:'타 여행 일정',placeId:''}});
    assert.equal((await request(route,'owner','POST',{rows:[{...first,version:1,sourceIds:[foreignPlan]}]})).status,400);
    const long=await request(route,'owner','POST',{rows:['02','03','04'].map(day=>({date:`2026-11-${day}`,text:'가'.repeat(9000),sourceIds:[],version:0}))});assert.equal(long.status,200);assert.equal(long.body.overview.length,4);
    assert.equal((await request(route,'owner','POST',{rows:[{...first,version:1,text:'가'.repeat(90000)}]})).status,413);
  }finally{await db.close();}
});

test("shared overview: backup and trip copy remap plan links, retain deleted-source text and cascade on deletion",async()=>{
  const {db,rpc}=await fixture();
  try{
    const id=(await rpc('owner','create',null,{data:details})).trip.id,planId=crypto.randomUUID();
    await rpc('owner','mutate',id,{action:'upsert',id:planId,kind:'plan',data:{title:'캐노피',date:'2026-11-01',placeId:''}});
    const original=await rpc('owner','save-overview',id,{rows:[{date:'2026-11-01',text:'요약 이름\n자유 입력',sourceIds:[planId],version:0}]});
    const copy=await rpc('owner','import',null,{key:crypto.randomUUID(),trip:original.trip,records:original.records,overview:original.overview});
    assert.equal(copy.overview[0].text,original.overview[0].text);assert.equal(copy.overview[0].version,1);assert.notEqual(copy.overview[0].sourceIds[0],planId);assert.ok(copy.records.some(r=>r.id===copy.overview[0].sourceIds[0]&&r.kind==='plan'));
    await rpc('owner','mutate',id,{action:'delete',id:planId,version:original.records.find(r=>r.id===planId).version});
    const deleted=await rpc('owner','workspace',id);
    const restored=await rpc('owner','import',null,{key:crypto.randomUUID(),trip:deleted.trip,records:deleted.records,overview:deleted.overview});
    assert.equal(restored.overview[0].text,original.overview[0].text);assert.deepEqual(restored.overview[0].sourceIds,[]);
    await rpc('owner','delete-trip',copy.trip.id,{revision:copy.revision});
    assert.equal((await db.query('select count(*)::integer n from public.trip_overview_days where trip_id=$1',[copy.trip.id])).rows[0].n,0);
    const oldBackup=await rpc('owner','import',null,{key:crypto.randomUUID(),trip:details,records:[]});assert.deepEqual(oldBackup.overview,[]);
  }finally{await db.close();}
});


test("conditional workspace reads omit unchanged bodies and still verify access and every data section", async () => {
  let value = {trip:{id:"trip",role:"owner"},revision:1,records:[],members:[{id:"owner",name:"동행"}],files:[],overview:[{date:"2026-11-01",text:"가".repeat(9000),sourceIds:[],version:1}]};
  let allowed = true, authenticated = true, reads = 0, authChecks = 0;
  const {ApiError} = await import(pathToFileURL(path.join(directory,"validation.mjs")));
  const handler = createApiHandler({resolveUser:async()=>{authChecks++;return authenticated?users.owner:null;},repository:()=>({workspace:async()=>{reads++;if(!allowed)throw new ApiError(403,"권한 없음");return value;}})});
  const send = etag => handler(new Request("https://tripboogie.example.test/api/trips/trip", {headers:etag?{"If-None-Match":etag}:{}}),["trips","trip"]);
  const first = await send(); assert.equal(first.status,200); const etag=first.headers.get("ETag"); assert.match(etag,/^W\/"[a-f0-9]{64}"$/);
  assert.ok((await first.text()).length>9000); assert.match(first.headers.get("cache-control"),/private.*no-store/);
  const cached = await send(etag); assert.equal(cached.status,304); assert.equal(await cached.text(),""); assert.equal(reads,2); assert.equal(authChecks,2);
  for (const change of [w=>w.overview[0].text="새 내용",w=>w.members[0].name="새 이름",w=>w.trip.role="viewer",w=>w.files.push({id:"file",state:"ready"}),w=>w.records.push({id:"plan"})]) {
    value=structuredClone(value);change(value);const changed=await send(etag);assert.equal(changed.status,200);assert.notEqual(changed.headers.get("ETag"),etag);
  }
  allowed=false; assert.equal((await send(etag)).status,403);
  authenticated=false; assert.equal((await send(etag)).status,401);
});

test("conditional API clients accept empty 304 bodies without hiding failures or changing ordinary JSON requests", async () => {
  const client=await import(pathToFileURL(path.join(directory,"client-api.mjs"))),originalFetch=globalThis.fetch;
  const etags=[];let response=()=>Response.json({revision:1},{headers:{ETag:'W/"first"'}});
  try {
    globalThis.fetch=async(url,init)=>{
      if(String(url).includes('auth-config'))return Response.json({url:'',publishableKey:'',providers:{email:false,google:true,kakao:true}});
      assert.equal(init.cache,"no-store");assert.equal(init.headers.get("If-None-Match"),'W/"first"');return response();
    };
    const activity={background:true,conditional:{etag:'W/"first"',receiveEtag:value=>etags.push(value)}};
    assert.deepEqual(await client.apiFetch('/api/trips/trip',{},activity),{revision:1});
    response=()=>new Response(null,{status:304,headers:{ETag:'W/"first"'}});
    assert.equal(await client.apiFetch('/api/trips/trip',{},activity),undefined);
    assert.deepEqual(etags,['W/"first"','W/"first"']);assert.equal(client.getApiPending(),0);
    response=()=>Response.json({error:"권한 없음"},{status:403});
    await assert.rejects(client.apiFetch('/api/trips/trip',{},activity),error=>error.status===403);
    assert.equal(etags.length,2);
    globalThis.fetch=async()=>new Response(null,{status:304});
    await assert.rejects(client.apiFetch('/api/trips/trip'),error=>error.status===304);
    assert.equal(client.getApiPending(),0);
  } finally {globalThis.fetch=originalFetch;}
});
