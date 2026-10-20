import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const directory = await mkdtemp(path.join(tmpdir(), "tripboogie-seo-"));
test.after(() => rm(directory, { recursive: true, force: true }));
await mkdir(path.join(directory, "seo"));
await writeFile(path.join(directory, "package.json"), '{"type":"commonjs"}');
for (const name of ["seo/site", "seo/guides", "robots", "sitemap"]) {
  const source = await readFile(new URL(`../${name}.ts`, import.meta.url), "utf8");
  await writeFile(path.join(directory, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(path.join(directory, "package.json"));
const { isIndexingEnabled, absoluteUrl, privateMetadata, publicMetadata, serializeJsonLd, site } = require("./seo/site.js");
const { guides, findGuide } = require("./seo/guides.js");
const sitemap = require("./sitemap.js").default;
const robots = require("./robots.js").default;
const production = { NODE_ENV: "production", VERCEL_ENV: "production" };

function withEnvironment(environment, run) {
  const keys = ["NODE_ENV", "VERCEL_ENV", "SEO_INDEXING_ENABLED"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) { if (environment[key] === undefined) delete process.env[key]; else process.env[key] = environment[key]; }
    return run();
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
}

test("only production public pages can opt into indexing; preview and manual kill switch stay excluded", () => {
  assert.equal(isIndexingEnabled(production), true);
  assert.equal(isIndexingEnabled({ NODE_ENV: "production" }), true);
  for (const environment of [{}, { NODE_ENV: "development" }, { ...production, VERCEL_ENV: "preview" }, { ...production, VERCEL_ENV: "development" }, { ...production, SEO_INDEXING_ENABLED: "false" }]) {
    assert.equal(isIndexingEnabled(environment), false);
    assert.equal(publicMetadata("title", "description", "/guide", environment).robots.index, false);
  }
  assert.deepEqual(privateMetadata.robots, { index: false, follow: false });
  assert.equal(privateMetadata.alternates, undefined, "private routes must not inherit a public canonical");
});

test("all public guides have unique canonical URLs and complete sharing metadata", () => {
  assert.equal(new Set(guides.map(guide => guide.slug)).size, guides.length);
  for (const guide of guides) {
    const metadata = publicMetadata(guide.title, guide.description, `/guide/${guide.slug}`, production);
    assert.equal(metadata.alternates.canonical, `${site.origin}/guide/${guide.slug}`);
    assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
    assert.equal(metadata.openGraph.description, guide.description);
    assert.equal(metadata.openGraph.images[0].width, 1200);
    assert.equal(metadata.twitter.card, "summary_large_image");
    assert.deepEqual(metadata.robots, { index: true, follow: true });
    assert.ok(guide.sections.length >= 3 && guide.questions.length >= 2);
    assert.equal(findGuide(guide.slug), guide);
  }
  for (const slug of ["constructor", "__proto__", "missing", "../auth"]) assert.equal(findGuide(slug), undefined);
  for (const value of ["https://evil.test", "//evil.test", "/guide?token=secret", "/guide#private", "/\\evil.test"]) assert.throws(() => absoluteUrl(value));
});

test("sitemap contains only public static content and never private routes or credentials", () => {
  withEnvironment(production, () => {
    assert.deepEqual(sitemap().map(entry => entry.url), [`${site.origin}/guide`, ...guides.map(guide => `${site.origin}/guide/${guide.slug}`)]);
    assert.doesNotMatch(JSON.stringify(sitemap()), /invite|callback|preview|token|api|userId|tripId/);
    assert.equal(robots().sitemap, `${site.origin}/sitemap.xml`);
    assert.deepEqual(robots().rules, { userAgent: "*", allow: "/", disallow: ["/api/"] });
  });
  for (const environment of [{ ...production, VERCEL_ENV: "preview" }, { ...production, SEO_INDEXING_ENABLED: "false" }]) {
    withEnvironment(environment, () => { assert.deepEqual(sitemap(), []); assert.equal(robots().sitemap, undefined); });
  }
});

test("JSON-LD cannot break out of its script element and still round-trips", () => {
  const payload = { headline: '</script><script>alert("x")</script>', name: "여행 & 준비" };
  const serialized = serializeJsonLd(payload);
  assert.equal(serialized.includes("<"), false);
  assert.deepEqual(JSON.parse(serialized), payload);
});
