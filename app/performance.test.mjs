import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const directory = await mkdtemp(path.join(tmpdir(), "tripboogie-performance-"));
test.after(() => rm(directory, { recursive: true, force: true }));
await writeFile(path.join(directory, "package.json"), '{"type":"commonjs"}');
await symlink(new URL("../node_modules", import.meta.url), path.join(directory, "node_modules"), "dir");
for (const name of ["airports", "workspace-cache", "planning", "countries", "server/city-search", "server/http", "server/validation"]) {
  await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
  await writeFile(path.join(directory, name + ".js"), ts.transpileModule(await readFile(new URL(`./${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText);
}
await mkdir(path.join(directory, "data"));
await copyFile(new URL("./data/airports.json", import.meta.url), path.join(directory, "data/airports.json"));
const require = createRequire(path.join(directory, "package.json"));
const { searchAirports } = require("./airports.js");
const { cityQuery } = require("./server/city-search.js");
const { distanceOrder, comparePlans, placePoint } = require("./planning.js");
const { WorkspaceCache, sameWorkspace, reconcileWorkspace } = require("./workspace-cache.js");
const airports = require("./data/airports.json");
const { countryCodes } = require("./countries.js");
const normalize = value => value.toLowerCase().replace(/국제|international|airport|공항/g, "").normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
const index = airports.map(airport => ({ airport, search: normalize([airport.icao, airport.iata, airport.name, airport.city, ...airport.aliases].join(" ")) }));
function originalAirports(query) {
  const q = normalize(query);
  if (q.length < 2 || q.length > 100) return [];
  return index.flatMap(({ airport, search }) => {
    const code = q === airport.iata.toLowerCase() || q === airport.icao.toLowerCase();
    const exact = [airport.name, ...airport.aliases].some(name => normalize(name) === q);
    return search.includes(q) ? [{ airport, rank: code ? 0 : exact ? 1 : airport.iata ? 2 : 3 }] : [];
  }).sort((a, b) => a.rank - b.rank || a.airport.name.localeCompare(b.airport.name)).slice(0, 8).map(item => item.airport);
}
test("bounded airport ranking preserves exact codes, aliases, accents, broad matches and stable ties", () => {
  const queries = ["", "x", "international", "공항", "x".repeat(101), "ICN", "rksi", "인천국제공항", "오클랜드", "JFK", "London", "São", "München", "au", "aa", "New", "san", "00", "도쿄", "羽田", "xxxxxxxxx"];
  queries.push(...airports.filter((_, i) => i % 1100 === 0).map(airport => airport.name.slice(0, 4)));
  for (const query of queries) assert.deepEqual(searchAirports(query), originalAirports(query), query);
});
function originalCity(query, language) {
  const raw = query.trim(), names = [...new Set([language, "ko", "en"])].map(locale => new Intl.DisplayNames([locale], { type: "region" }));
  const prefixes = countryCodes.flatMap(code => names.map(display => ({ code, name: display.of(code) || code }))).sort((a, b) => b.name.length - a.name.length);
  const country = prefixes.find(({ name }) => raw.toLocaleLowerCase().startsWith(name.toLocaleLowerCase() + " "));
  return { query: country ? raw.slice(country.name.length).trim() : raw, countryCode: country?.code };
}
test("country prefix reuse preserves localized and longest-prefix matching across cache eviction", () => {
  for (const language of ["ko", "en", "ja", "es", "fr", "de", "zh", "th", "vi", "pt", "ko"])
    for (const query of ["대한민국 서울", "United States New York", "United Kingdom London", "日本 東京", "  뉴질랜드 오클랜드  ", "서울", "Japan", "", "Réunion Saint-Denis"])
      assert.deepEqual(cityQuery(query, language), originalCity(query, language));
});
const workspace = id => ({ trip: { id, role: "owner", settings: {} }, records: [{ id: "r", kind: "plan", version: 1, data: { title: "일정", note: "", checks: { a: "" } } }], members: [{ id: "u", name: "친구" }], files: [{ id: "f", state: "ready", tags: [] }], revision: 1 });
test("recent workspace cache evicts the least recently used trip, replaces entries and clears private data", () => {
  const cache = new WorkspaceCache(3);
  for (const id of ["a", "b", "c"]) cache.set(id, workspace(id));
  assert.equal(cache.get("a").trip.id, "a");
  cache.set("d", workspace("d"));
  assert.equal(cache.get("b"), undefined); assert.equal(cache.size, 3);
  const updated = { ...workspace("a"), revision: 2 }; cache.set("a", updated);
  assert.equal(cache.get("a"), updated); assert.equal(cache.size, 3);
  cache.delete("d"); assert.equal(cache.get("d"), undefined);
  cache.clear(); assert.equal(cache.size, 0); assert.equal(cache.get("a"), undefined);
  assert.throws(() => new WorkspaceCache(0), RangeError);
});
test("unchanged polls preserve identity only when records, permissions, members and files all match", () => {
  const current = workspace("a");
  assert.equal(sameWorkspace(current, structuredClone(current)), true);
  const reordered = { ...structuredClone(current), trip: { settings: {}, role: "owner", id: "a" } };
  assert.equal(sameWorkspace(current, reordered), true);
  for (const change of [w => w.revision++, w => w.trip.role = "viewer", w => w.members[0].name = "변경", w => w.members.push({ id: "v", name: "참여" }), w => w.files[0].state = "deleting", w => w.files[0].tags.push("tag"), w => w.records[0].data.note = "새 메모", w => delete w.records[0].data.note, w => w.records.reverse().push({ id: "new" }), w => w.records[0].data.checks = []]) {
    const next = structuredClone(current); change(next); assert.equal(sameWorkspace(current, next), false);
  }
});
test("cached distance sort preserves the first anchor, unknown locations, ties and source records", () => {
  const places = Array.from({ length: 60 }, (_, i) => ({ id: `place-${i}`, data: { lat: i % 6, lng: (i * 17) % 25 } }));
  const plans = Array.from({ length: 70 }, (_, i) => ({ id: `plan-${i}`, data: { placeId: i % 9 === 0 ? "missing" : `place-${i % 60}`, position: i, time: "" } }));
  const before = JSON.stringify({ plans, places });
  const lookup = new Map(places.map(p => [p.id, p]));
  const located = plans.filter(p => placePoint(lookup.get(p.data.placeId)));
  const origin = placePoint(lookup.get(located[0].data.placeId)), radians = Math.PI / 180;
  const distance = plan => { const p = placePoint(lookup.get(plan.data.placeId)); const a = Math.sin((p.lat-origin.lat)*radians/2)**2+Math.cos(origin.lat*radians)*Math.cos(p.lat*radians)*Math.sin((p.lng-origin.lng)*radians/2)**2; return 2*Math.asin(Math.min(1,Math.sqrt(a))); };
  const ordered = [located[0], ...located.slice(1).sort((a, b) => distance(a) - distance(b) || comparePlans(a, b))];
  let cursor = 0;
  const expected = plans.map(p => placePoint(lookup.get(p.data.placeId)) ? ordered[cursor++].id : p.id);
  assert.deepEqual(distanceOrder(plans, places), expected);
  assert.equal(JSON.stringify({ plans, places }), before);
});


test("summary-only synchronization preserves itinerary, files and member references, while all changes remain visible", () => {
  const current = { ...workspace("a"), overview: [{ date: "2026-11-01", text: "내용", sourceIds: [], version: 1 }] };
  assert.equal(reconcileWorkspace(current, structuredClone(current)), current);
  const next = structuredClone(current); next.revision++; next.trip.revision = next.revision; next.overview[0].text = "동행의 편집"; next.overview[0].version++;
  const result = reconcileWorkspace(current, next);
  assert.equal(result.records, current.records); assert.equal(result.files, current.files); assert.equal(result.members, current.members);
  assert.notEqual(result.overview, current.overview); assert.deepEqual(result, next);
  const edit = structuredClone(current); edit.records[0].data.title = "새 일정";
  assert.notEqual(reconcileWorkspace(current, edit).records, current.records);
  const removed = structuredClone(current); delete removed.overview;
  assert.equal(Object.hasOwn(reconcileWorkspace(current, removed), "overview"), false);
  const other = workspace("other"); assert.equal(reconcileWorkspace(current, other), other);
  assert.equal(reconcileWorkspace(null, other), other);
});
