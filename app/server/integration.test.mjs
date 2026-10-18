// Run: node --test app/server/integration.test.mjs
// Uses actual SQLite and generated migrations; only the D1 transport and verified
// identity adapter are substituted. This does not verify hosted Supabase/D1.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const directory = await mkdtemp(path.join(tmpdir(), "tripboogie-api-test-"));
test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});
const compiledModules = new Set(["./api", "./repository", "./validation"]);
function moduleExtensions(context) {
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      compiledModules.has(node.moduleSpecifier.text)
    ) {
      return context.factory.updateImportDeclaration(
        node,
        node.modifiers,
        node.importClause,
        context.factory.createStringLiteral(`${node.moduleSpecifier.text}.mjs`),
        node.attributes,
      );
    }
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
const { invitationUrl } = await import(pathToFileURL(path.join(directory, "repository.mjs")));

test("invitation URLs use one canonical route and a bare HTTP(S) app origin", () => {
  const token = "ab".repeat(32);
  assert.equal(
    invitationUrl("https://tripboogie.example.test", token),
    `https://tripboogie.example.test/invite/${token}`,
  );
  assert.equal(
    invitationUrl("http://127.0.0.1:5173", token),
    `http://127.0.0.1:5173/invite/${token}`,
  );
  for (const origin of [
    "https://tripboogie.example.test/path",
    "https://tripboogie.example.test?redirect=evil",
    "https://tripboogie.example.test#fragment",
    "https://user:password@tripboogie.example.test",
    "javascript:alert(1)",
    "//evil.example",
    "https://tripboogie.example.test/",
  ])
    assert.throws(() => invitationUrl(origin, token));
  for (const token of ["../escape", "ab?x=1", "%2Fescape", "ab".repeat(31)])
    assert.throws(() => invitationUrl("https://tripboogie.example.test", token));
});

class SQLiteD1 {
  sqlite = new DatabaseSync(":memory:");
  afterPermission = null;
  prepare(sql) {
    const sqlite = this.sqlite;
    const runPermissionHook = () => {
      if (sql.startsWith("SELECT t.*,m.role FROM trips") && this.afterPermission) {
        const hook = this.afterPermission;
        this.afterPermission = null;
        hook();
      }
    };
    return {
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      execute() {
        const results = sqlite.prepare(sql).all(...this.values);
        return {
          success: true,
          results,
          meta: { changes: sqlite.prepare("SELECT changes() value").get().value },
        };
      },
      async all() {
        return this.execute();
      },
      async run() {
        return this.execute();
      },
      async first() {
        const result = this.execute().results[0] ?? null;
        runPermissionHook();
        return result;
      },
    };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

test("private collaborative API: permissions, invitations, CAS, tombstones, dates and limits", async () => {
  const database = new SQLiteD1();
  database.sqlite.exec("PRAGMA foreign_keys=ON");
  const migrationDirectory = new URL("../../drizzle/", import.meta.url);
  for (const file of (await readdir(migrationDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    database.sqlite.exec(await readFile(new URL(file, migrationDirectory), "utf8"));
  const users = {
    owner: { id: "owner-id", name: "Owner", email: "owner@example.test" },
    editor: { id: "editor-id", name: "Editor", email: "editor@example.test" },
    viewer: { id: "viewer-id", name: "Viewer", email: "viewer@example.test" },
    outsider: { id: "outsider-id", name: "Outsider", email: "outsider@example.test" },
  };
  const handler = createApiHandler({
    db: database,
    resolveUser: async (request) => users[request.headers.get("test-user")] ?? null,
  });
  const origin = "https://tripboogie.example.test";
  async function request(route, user = "owner", method = "GET", body, requestOrigin = origin) {
    const response = await handler(
      new Request(`${origin}/api/${route}`, {
        method,
        headers: {
          ...(user ? { "test-user": user } : {}),
          ...(method !== "GET"
            ? { Origin: requestOrigin, "Content-Type": "application/json" }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      route.split("/"),
    );
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  const details = {
    title: "Private Tokyo",
    destination: "Tokyo",
    startDate: "2026-11-01",
    endDate: "2026-11-05",
    currency: "JPY",
    timezone: "Asia/Tokyo",
  };
  assert.equal((await request("trips", "", "GET")).status, 401);
  assert.equal(
    (await request("trips", "owner", "POST", details, "https://evil.example")).status,
    403,
  );
  assert.equal(
    (await request("trips", "owner", "POST", { ...details, startDate: "2026-02-30" })).status,
    400,
  );
  const created = await request("trips", "owner", "POST", details);
  assert.equal(created.status, 201);
  assert.match(created.headers.get("cache-control"), /no-store/);
  const tripId = created.body.trip.id;
  const tripRoute = `trips/${tripId}`;
  assert.equal(created.body.trip.role, "owner");
  assert.equal((await request(tripRoute, "outsider")).status, 404);
  assert.equal((await request("trips", "outsider")).body.trips.length, 0);

  const editorInvite = await request(`${tripRoute}/invites`, "owner", "POST", { role: "editor" });
  assert.equal(editorInvite.status, 201);
  const editorUrl = new URL(editorInvite.body.url);
  const editorToken = decodeURIComponent(editorUrl.pathname.split("/").at(-1));
  assert.equal(editorUrl.origin, origin);
  assert.match(editorUrl.pathname, /^\/invite\/[0-9a-f]{64}$/);
  assert.equal(editorUrl.search, "");
  assert.equal(editorUrl.hash, "");
  assert.equal((await request(`invites/${editorToken}`, "")).status, 401);
  assert.equal((await request(`invites/${editorToken}`, "editor")).body.tripTitle, details.title);
  const joinedEditor = await request(`invites/${editorToken}`, "editor", "POST", {});
  assert.equal(joinedEditor.status, 200);
  assert.equal(joinedEditor.body.trip.role, "editor");
  const repeatedJoin = await request(`invites/${editorToken}`, "editor", "POST", {});
  assert.equal(repeatedJoin.body.revision, joinedEditor.body.revision);
  const viewerInvite = await request(`${tripRoute}/invites`, "owner", "POST", { role: "viewer" });
  const viewerUrl = new URL(viewerInvite.body.url);
  const viewerToken = decodeURIComponent(viewerUrl.pathname.split("/").at(-1));
  assert.equal(viewerUrl.origin, origin);
  assert.match(viewerUrl.pathname, /^\/invite\/[0-9a-f]{64}$/);
  assert.equal(viewerUrl.search, "");
  assert.equal(viewerUrl.hash, "");
  assert.equal((await request(`invites/${viewerToken}`, "viewer")).body.role, "viewer");
  assert.equal(
    (await request(`invites/${viewerToken}`, "viewer", "POST", {})).body.trip.role,
    "viewer",
  );
  assert.equal(
    (await request(`invites/${viewerToken}`, "owner", "POST", {})).body.trip.role,
    "owner",
  );
  assert.equal(
    (await request(`invites/${editorToken}`, "viewer", "POST", {})).body.trip.role,
    "viewer",
  );
  assert.equal(
    (await request(`${tripRoute}/invites`, "editor", "POST", { role: "editor" })).status,
    403,
  );

  const checklist = { title: "Passport", done: false, category: "before" };
  assert.equal(
    (
      await request(tripRoute, "viewer", "POST", {
        action: "upsert",
        kind: "checklist",
        data: checklist,
      })
    ).status,
    403,
  );
  let response = await request(tripRoute, "editor", "POST", {
    action: "upsert",
    kind: "checklist",
    data: checklist,
  });
  assert.equal(response.status, 200);
  const record = response.body.records[0];
  const concurrent = await Promise.all(
    [true, false].map((done) =>
      request(tripRoute, "editor", "POST", {
        action: "upsert",
        id: record.id,
        kind: "checklist",
        version: record.version,
        data: { ...checklist, done },
      }),
    ),
  );
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
  const distinct = await Promise.all(
    ["Booking", "Insurance"].map((title) =>
      request(tripRoute, "editor", "POST", {
        action: "upsert",
        kind: "checklist",
        data: { ...checklist, title },
      }),
    ),
  );
  assert.deepEqual(
    distinct.map((result) => result.status),
    [200, 200],
  );
  const current = (await request(tripRoute)).body.records.find((item) => item.id === record.id);
  assert.equal(
    (
      await request(tripRoute, "owner", "POST", {
        action: "delete",
        id: record.id,
        version: current.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(tripRoute, "owner", "POST", {
        action: "upsert",
        id: record.id,
        kind: "checklist",
        data: checklist,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(tripRoute, "owner", "POST", {
        action: "upsert",
        id: record.id,
        kind: "checklist",
        version: current.version,
        data: checklist,
      })
    ).status,
    409,
  );
  assert.equal(
    database.sqlite.prepare("SELECT deleted FROM trip_records WHERE id=?").get(record.id).deleted,
    1,
  );
  const otherTrip = (await request("trips", "owner", "POST", { ...details, title: "Second trip" }))
    .body.trip.id;
  assert.equal(
    (
      await request(`trips/${otherTrip}`, "owner", "POST", {
        action: "upsert",
        id: current.id,
        kind: "checklist",
        data: checklist,
      })
    ).status,
    409,
  );

  const placeWorkspace = await request(tripRoute, "owner", "POST", {
    action: "upsert",
    kind: "place",
    data: { name: "Station", address: "Tokyo", lat: 35.681, lng: 139.767 },
  });
  assert.equal(placeWorkspace.status, 200);
  const place = placeWorkspace.body.records.find((item) => item.kind === "place");
  const plan = {
    title: "Meet friend",
    date: "2026-11-05",
    time: "10:30",
    note: "",
    placeId: place.id,
    duration: 60,
  };
  assert.equal(
    (await request(tripRoute, "editor", "POST", { action: "upsert", kind: "plan", data: plan }))
      .status,
    200,
  );
  assert.equal(
    (
      await request(tripRoute, "editor", "POST", {
        action: "delete",
        id: place.id,
        kind: "place",
        version: place.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(tripRoute, "owner", "POST", {
        action: "upsert",
        kind: "plan",
        data: { ...plan, date: "2026-11-06" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(tripRoute, "owner", "POST", {
        action: "upsert",
        kind: "plan",
        data: { ...plan, placeId: crypto.randomUUID() },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(tripRoute, "owner", "POST", {
        action: "update-trip",
        version: 1,
        data: { ...details, endDate: "2026-11-04" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(tripRoute, "owner", "POST", {
        action: "update-trip",
        version: 1,
        data: { ...details, title: "Renamed trip" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(tripRoute, "owner", "POST", {
        action: "update-trip",
        version: 1,
        data: details,
      })
    ).status,
    409,
  );
  const partialUpdate = await request(tripRoute, "owner", "POST", {
    action: "update-trip",
    version: 2,
    data: { title: "One field only" },
  });
  assert.equal(partialUpdate.status, 200);
  assert.equal(partialUpdate.body.trip.timezone, "Asia/Tokyo");

  assert.equal(
    (
      await request(tripRoute, "editor", "POST", {
        action: "upsert",
        kind: "expense",
        data: {
          title: "Lunch",
          amount: -2,
          currency: "JPY",
          payer: "Me",
          participants: [],
          date: "2026-11-02",
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(tripRoute, "editor", "POST", {
        action: "upsert",
        kind: "expense",
        data: {
          title: "Lunch",
          amount: "2300.50",
          currency: "JPY",
          payer: "Me",
          participants: ["Me", "Friend"],
          date: "2026-11-02",
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(tripRoute, "owner", "POST", {
        action: "upsert",
        kind: "checklist",
        data: { ...checklist, title: "x".repeat(70000) },
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await request(tripRoute, "owner", "POST", {
        action: "upsert",
        kind: "place",
        data: { name: "Bad coords", lat: true, lng: false },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(tripRoute, "owner", "POST", {
        action: "upsert",
        kind: "plan",
        data: { ...plan, duration: [] },
      })
    ).status,
    400,
  );

  // Revoke between the preliminary permission lookup and the SQL mutation.
  database.afterPermission = () =>
    database.sqlite
      .prepare("DELETE FROM trip_members WHERE trip_id=? AND user_id=?")
      .run(tripId, users.editor.id);
  assert.equal(
    (
      await request(tripRoute, "editor", "POST", {
        action: "upsert",
        kind: "checklist",
        data: { ...checklist, title: "Must not write" },
      })
    ).status,
    404,
  );
  assert.equal(
    database.sqlite
      .prepare(
        "SELECT COUNT(*) count FROM trip_records WHERE json_extract(data_json,'$.title')='Must not write'",
      )
      .get().count,
    0,
  );
  assert.equal(
    (await request(`${tripRoute}/members/${users.owner.id}`, "owner", "DELETE")).status,
    400,
  );
  assert.equal(
    (await request(`${tripRoute}/members/${users.viewer.id}`, "owner", "DELETE")).status,
    200,
  );
  assert.equal((await request(tripRoute, "viewer")).status, 404);
  assert.equal(
    (await request(`${tripRoute}/invites`, "owner", "DELETE", { id: editorInvite.body.id })).status,
    200,
  );
  assert.equal((await request(`invites/${editorToken}`, "outsider", "POST", {})).status, 409);
  database.sqlite
    .prepare("UPDATE trip_invites SET expires_at=? WHERE id=?")
    .run("2000-01-01T00:00:00.000Z", viewerInvite.body.id);
  assert.equal((await request(`invites/${viewerToken}`, "outsider", "POST", {})).status, 409);
  const tokenRows = database.sqlite.prepare("SELECT token_hash FROM trip_invites").all();
  assert.ok(
    tokenRows.every((row) => row.token_hash !== editorToken && row.token_hash !== viewerToken),
  );

  // Seed valid producer-shaped rows near the response budget, then exercise the
  // real mutation boundary. This avoids hundreds of full-workspace responses.
  const insert = database.sqlite.prepare(
    "INSERT INTO trip_records (id,trip_id,kind,data_json,version,deleted,mutation_id,updated_at,updated_by) VALUES (?,?,'place',?,1,0,?,?,?)",
  );
  const largePlace = JSON.stringify({
    name: "Budget fixture",
    address: "",
    lat: null,
    lng: null,
    category: "",
    note: "x".repeat(10000),
  });
  for (let index = 0; index < 207; index++)
    insert.run(
      crypto.randomUUID(),
      otherTrip,
      largePlace,
      crypto.randomUUID(),
      "2026-01-01T00:00:00.000Z",
      users.owner.id,
    );
  const overBudget = await request(`trips/${otherTrip}`, "owner", "POST", {
    action: "upsert",
    kind: "place",
    data: { name: "Too much data", note: "x".repeat(10000) },
  });
  assert.equal(overBudget.status, 409);
  const budgetRow = database.sqlite
    .prepare("SELECT id,version FROM trip_records WHERE trip_id=? LIMIT 1")
    .get(otherTrip);
  const shrink = await request(`trips/${otherTrip}`, "owner", "POST", {
    action: "upsert",
    id: budgetRow.id,
    version: budgetRow.version,
    kind: "place",
    data: { name: "Smaller" },
  });
  assert.equal(shrink.status, 200);
  database.sqlite.close();
});
