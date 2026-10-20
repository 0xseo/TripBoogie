// Function-level comparisons only; this does not run an application or native build.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";

const baseline = process.argv.find(arg => arg.startsWith("--baseline="))?.slice(11);
if (!baseline || baseline.startsWith("-") || !/^[a-zA-Z0-9_/.~-]+$/.test(baseline)) throw new Error("Use --baseline=<git-ref> to select the comparison commit");
const root = fileURLToPath(new URL("../", import.meta.url));
execFileSync("git", ["rev-parse", "--verify", `${baseline}^{commit}`], { cwd: root });
const temporary = await mkdtemp(path.join(tmpdir(), "tripboogie-benchmark-"));
const modules = ["airports", "planning", "countries", "memo", "booking-display", "itinerary-overview", "server/city-search", "server/http"];
async function fixture(name, ref) {
  const directory = path.join(temporary, name);
  await mkdir(directory);
  await writeFile(path.join(directory, "package.json"), '{"type":"commonjs"}');
  await symlink(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
  for (const sourceName of modules) {
    const file = `app/${sourceName}.ts`;
    const source = ref ? execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8" }) : await readFile(path.join(root, file), "utf8");
    await mkdir(path.dirname(path.join(directory, sourceName)), { recursive: true });
    await writeFile(path.join(directory, sourceName + ".js"), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText);
  }
  await mkdir(path.join(directory, "data"));
  for (const file of ["airports.json", "airport-labels.json"]) await writeFile(path.join(directory, "data", file), await readFile(path.join(root, "app/data", file)));
  const require = createRequire(path.join(directory, "package.json"));
  return { airports: require("./airports.js"), city: require("./server/city-search.js"), overview: require("./itinerary-overview.js"), planning: require("./planning.js") };
}
const round = value => Number(value.toFixed(4));
function median(samples) { return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]; }
function measure(run, calls) {
  run();
  const samples = [];
  for (let i = 0; i < 5; i++) { const started = performance.now(); for (let n = 0; n < calls; n++) run(); samples.push((performance.now() - started) / calls); }
  return median(samples);
}
try {
  const before = await fixture("before", baseline), after = await fixture("after");
  const queries = ["ICN", "인천", "London", "Tokyo", "San", "New", "York", "au", "오클랜드", "München"];
  const dates = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  const records = Array.from({ length: 5000 }, (_, i) => i < 500 ? { id: `b-${i}`, kind: "booking", data: { type: "other" } } : i < 2000 ? { id: `p-${i}`, kind: "place", data: { name: "장소" } } : { id: `r-${i}`, kind: "plan", data: { date: dates[i % dates.length], position: i, title: "여행 일정", time: "09:00" } });
  const workspace = { records };
  const places = Array.from({ length: 1000 }, (_, i) => ({ id: `p-${i}`, data: { lat: (i * 17) % 80, lng: (i * 37) % 160 } }));
  const plans = places.map((place, i) => ({ id: `r-${i}`, data: { placeId: place.id, position: i } }));
  const benchmarks = [
    { name: "airport_search_10_queries", unit: "10 queries", calls: 5, run: lib => () => queries.forEach(q => lib.airports.searchAirports(q)) },
    { name: "country_prefix_10_queries", unit: "10 queries", calls: 50, run: lib => () => queries.forEach(q => lib.city.cityQuery(`New Zealand ${q}`, "ko")) },
    { name: "overview_365_days_5000_records", unit: "whole-trip import candidates", calls: 10, run: lib => () => lib.overview.overviewCandidatesByDate ? lib.overview.overviewCandidatesByDate(workspace, dates) : dates.flatMap(date => lib.overview.overviewCandidates(workspace, date)) },
    { name: "distance_sort_1000_plans", unit: "one sort", calls: 20, run: lib => () => lib.planning.distanceOrder(plans, places) },
  ];
  const results = benchmarks.map(item => {
    const baselineMs = measure(item.run(before), item.calls), optimizedMs = measure(item.run(after), item.calls);
    return { name: item.name, unit: item.unit, baselineMs: round(baselineMs), optimizedMs: round(optimizedMs), speedup: round(baselineMs / optimizedMs) };
  });
  console.log(JSON.stringify({ baseline, node: process.version, samples: 5, statistic: "median", results }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
