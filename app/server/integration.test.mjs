// Real in-memory Postgres, actual migrations, API and HTTP repository adapter.
// Auth verification and the PostgREST HTTP transport are substituted; this does
// not establish hosted JWT verification or multi-connection lock behavior.
import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const directory = await mkdtemp(path.join(tmpdir(), "tripboogie-postgres-test-"));
test.after(() => rm(directory, { recursive: true, force: true }));
const modules = new Set(["./api", "./repository", "./validation"]);
function moduleExtensions(context) {
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && modules.has(node.moduleSpecifier.text))
      return context.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
        context.factory.createStringLiteral(`${node.moduleSpecifier.text}.mjs`), node.attributes);
    return ts.visitEachChild(node, visit, context);
  };
  return (source) => ts.visitNode(source, visit);
}
for (const name of ["api", "repository", "validation"]) {
  const source = await readFile(new URL(`./${name}.ts`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    transformers: { before: [moduleExtensions] },
  }).outputText;
  await writeFile(path.join(directory, `${name}.mjs`), output);
}
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

const users = Object.fromEntries(["owner", "editor", "viewer", "outsider"].map((name, index) => [name, {
  id: `10000000-0000-4000-8000-00000000000${index + 1}`, name, email: `${name}@example.test`,
}]));
const details = { title: "Private Tokyo", destination: "Tokyo", startDate: "2026-11-01", endDate: "2026-11-05", currency: "JPY", timezone: "Asia/Tokyo" };
const checklist = { title: "Passport", done: false, category: "before" };

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL(file, migrations), "utf8"));
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
      headers: { ...(user ? { authorization: `Bearer test_${user}` } : {}), ...(method !== "GET" ? { Origin: requestOrigin, "Content-Type": "application/json" } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), route.split("/"));
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  return { db, asUser, rpc, request };
}

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
    assert.equal(grants.length, 5);
    assert.ok(grants.every((r) => !r.ins && !r.upd && !r.del));
  } finally { await db.close(); }
});
