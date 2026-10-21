import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const dir = await mkdtemp(path.join(tmpdir(), "tripboogie-travel-city-"));
test.after(() => rm(dir, { recursive: true, force: true }));
for (const file of ["travel-city", "route-graph", "planning", "countries", "search-language", "server/maps", "server/map-city", "server/http", "server/validation", "server/origin-policy", "server/city-search", "server/place-alias"]) {
  const source = await readFile(new URL(`./${file}.ts`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    transformers: { before: [context => root => ts.visitNode(root, function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
        return context.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
          context.factory.createStringLiteral(`./${path.basename(node.moduleSpecifier.text)}.mjs`), node.attributes);
      return ts.visitEachChild(node, visit, context);
    })] },
  }).outputText;
  await writeFile(path.join(dir, `${path.basename(file)}.mjs`), output);
}
const { createMapHandler } = await import(pathToFileURL(path.join(dir, "maps.mjs")));
const { createTravelCityLookup, includesTravelCity } = await import(pathToFileURL(path.join(dir, "travel-city.mjs")));
const { chineseCityBoundary } = await import(pathToFileURL(path.join(dir, "map-city.mjs")));
const boundary = (name, level, id, lat, lng, extra = {}) => ({
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: { name, country_code: "cn", formatted: `${name}, 中国`, place_id: id.repeat(10), datasource: { raw: { admin_level: String(level), name } }, ...extra },
});
const hangzhou = boundary("杭州市", 5, "a", 30.25, 120.15);
const request = point => new Request("https://tripboogie.example.test/api/maps/reverse", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://tripboogie.example.test" }, body: JSON.stringify(point),
});
function fixture({ points, boundaries, status = 200 }) {
  let calls = 0, budgets = 0;
  const handler = createMapHandler({ key: "test-map-key", resolveUser: async () => ({ id: "owner" }), budget: async () => { budgets++; }, fetch: async (value, init) => {
    calls++;
    const url = new URL(value), lat = Number(url.searchParams.get("lat")), point = points[lat];
    assert.equal(url.hostname, "api.geoapify.com");
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    if (url.pathname === "/v1/geocode/reverse") {
      assert.equal(url.searchParams.get("type"), "city");
      return Response.json({ features: [{ properties: { lat, lon: 120.15, country_code: "cn", timezone: { name: "Asia/Shanghai" }, ...point } }] });
    }
    assert.equal(url.pathname, "/v1/boundaries/part-of");
    assert.equal(url.searchParams.get("boundaries"), "administrative");
    assert.equal(url.searchParams.get("geometry"), "point");
    return Response.json({ features: boundaries[lat] }, { status });
  } });
  const resolve = async point => {
    const response = await handler(request(point), "reverse");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    const body = await response.json();
    assert.equal(JSON.stringify(body).includes("test-map-key"), false);
    return body.places[0];
  };
  return { resolve, counts: () => ({ calls, budgets }) };
}

test("different Hangzhou districts resolve to the same city and do not prompt, including legacy district destinations", async () => {
  const f = fixture({ points: { 30.24: { name: "상청구", city: "상청구" }, 30.42: { name: "위항구", city: "위항구" }, 30.34: { name: "시후구", city: "시후구" } }, boundaries: {
    30.24: [boundary("上城区", 6, "b", 30.24, 120.15), hangzhou],
    30.42: [hangzhou, boundary("余杭区", 6, "c", 30.42, 120.15)],
    30.34: [boundary("西湖区", 6, "d", 30.34, 120.15), hangzhou],
  } });
  const resolve = createTravelCityLookup(f.resolve);
  const cityA = await resolve({ lat: 30.24, lng: 120.15 }), cityB = await resolve({ lat: 30.42, lng: 120.15 });
  assert.equal(cityA.name, "杭州市");
  assert.equal(cityB.cityName, "杭州市");
  assert.equal(cityB.providerId, cityA.providerId);
  assert.equal(cityB.lat, 30.25);
  assert.equal(await includesTravelCity(cityB, [{ ...cityA, id: "city" }], resolve), true);
  assert.equal(await includesTravelCity(cityB, [{ name: "시후구", lat: 30.34, lng: 120.15, countryCode: "CN" }], resolve), true);
  await resolve({ lat: 30.34, lng: 120.15 });
  assert.deepEqual(f.counts(), { calls: 6, budgets: 6 });
  // A fresh client also reuses the server's normalized reverse cache.
  await f.resolve({ lat: 30.24, lng: 120.15 });
  assert.deepEqual(f.counts(), { calls: 6, budgets: 6 });
});

test("different cities in one province remain distinct, including identical district names and nearby city centers", async () => {
  const ningbo = boundary("宁波市", 5, "e", 29.87, 121.55);
  const f = fixture({ points: { 29.87: { name: "海曙区", city: "海曙区" } }, boundaries: { 29.87: [boundary("浙江省", 4, "f", 30, 120), ningbo] } });
  const other = await f.resolve({ lat: 29.87, lng: 121.55 });
  const saved = { name: "杭州市", countryCode: "CN", lat: 30.25, lng: 120.15, providerId: "a".repeat(10) };
  assert.equal(await includesTravelCity(other, [saved], async () => saved), false);
  assert.equal(await includesTravelCity({ ...other, name: "杭州市", lat: 30.25001, lng: 120.15 }, [saved], async () => saved), false);
});

test("Beijing and Shanghai use municipality boundaries; ordinary provinces cannot become cities", () => {
  for (const [name, code] of [["Beijing", "CN-BJ"], ["上海市", "CN-SH"]]) {
    const municipal = boundary(name, 4, "1", 31, 121, { state_code: code });
    const selected = chineseCityBoundary({ features: [boundary("朝阳区", 6, "2", 31.1, 121.1), municipal] });
    assert.equal(selected.name, name);
  }
  assert.equal(chineseCityBoundary({ features: [boundary("浙江省", 4, "3", 30, 120), boundary("西湖区", 6, "4", 30.2, 120.1)] }), undefined);
  assert.equal(chineseCityBoundary({ features: [boundary("昆山市", 6, "5", 31.3, 120.9)] }).name, "昆山市");
  assert.equal(chineseCityBoundary({ features: [{ properties: { name: "杭州市", categories: ["administrative.county_level"] } }] }).name, "杭州市");
});

test("boundary outages use an explicit parent city, discard the district ID, and otherwise skip an uncertain prompt", async () => {
  const f = fixture({ points: { 30.21: { name: "西湖区", city: "西湖区", county: "杭州市", place_id: "6".repeat(10) }, 30.22: { name: "西湖区", city: "西湖区", state: "浙江省" } }, boundaries: {}, status: 503 });
  const parent = await f.resolve({ lat: 30.21, lng: 120.15 });
  assert.equal(parent.name, "杭州市");
  assert.equal(parent.providerId, undefined);
  assert.equal(parent.timezone, "Asia/Shanghai");
  assert.equal(await includesTravelCity(parent, [{ name: "余杭区", lat: 30.42, lng: 120.15, countryCode: "CN" }], async () => ({ ...parent, lat: 30.42 })), true);
  assert.equal(await f.resolve({ lat: 30.22, lng: 120.15 }), undefined);
});

test("ordinary non-Chinese cities keep their lookup behavior and failed client lookups can retry", async () => {
  let count = 0;
  const city = { name: "Rotorua", countryCode: "NZ", lat: -38.13, lng: 176.25 };
  const resolve = createTravelCityLookup(async () => { count++; return count === 1 ? undefined : city; });
  assert.equal(await resolve(city), undefined);
  assert.deepEqual(await resolve(city), city);
  await resolve(city);
  assert.equal(count, 2);
  assert.equal(await includesTravelCity(city, [{ ...city, id: "r" }], resolve), true);
  assert.equal(await includesTravelCity(city, [], resolve), false);
});
