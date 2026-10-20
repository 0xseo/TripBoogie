import assert from "node:assert/strict";

const base = process.argv.find(argument => /^https?:/.test(argument)) || "http://127.0.0.1:5194";
const indexable = !process.argv.includes("--noindex");
const origin = "https://tripboogie.0xseo94.com";
const paths = ["/guide", "/guide/travel-itinerary", "/guide/travel-expenses", "/guide/travel-checklist"];
const get = path => fetch(new URL(path, base), { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Googlebot" } });
function attributes(tag) { return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], match[2].replaceAll("&amp;", "&")])); }
function tags(html, name) { return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "g"))].map(match => attributes(match[0])); }

for (const path of paths) {
  const response = await get(path);
  assert.equal(response.status, 200, path);
  const html = await response.text();
  const metadata = tags(html, "meta");
  const getMeta = name => metadata.find(tag => tag.name === name || tag.property === name)?.content;
  assert.equal(tags(html, "link").find(tag => tag.rel === "canonical")?.href, origin + path, path);
  assert.match(getMeta("robots"), indexable ? /(?:^|, )index(?:,|$)/ : /noindex/);
  assert.match(getMeta("description"), /여행/);
  assert.equal(getMeta("og:url"), origin + path);
  assert.equal(getMeta("og:locale"), "ko_KR");
  assert.equal(getMeta("twitter:card"), "summary_large_image");
  assert.equal([...html.matchAll(/<h1(?:\s|>)/g)].length, 1, path);
  assert.match(html, /href="\/"/);
  const structured = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  assert.equal(structured.length, 1, path);
  assert.equal(structured[0]["@context"], "https://schema.org");
  console.log(`OK ${path}: server HTML, canonical, robots, social metadata, JSON-LD`);
}

for (const path of ["/", "/invite/seo-check-placeholder", "/auth/callback", "/preview/overview"]) {
  const response = await get(path);
  const html = await response.text();
  assert.ok(response.ok || response.status === 404, path);
  assert.ok(tags(html, "meta").filter(tag => tag.name === "robots").some(tag => tag.content.includes("noindex")), path);
  assert.equal(tags(html, "link").filter(tag => tag.rel === "canonical").length, 0, path);
  console.log(`OK ${path}: private noindex, no inherited public canonical`);
}
const unknown = await get("/guide/unknown-guide");
assert.equal(unknown.status, 404);
const sitemap = await (await get("/sitemap.xml")).text();
assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]), indexable ? paths.map(path => origin + path) : []);
const robots = await (await get("/robots.txt")).text();
assert.match(robots, /Disallow: \/api\//);
assert.doesNotMatch(robots, /Disallow: \/(?:auth|invite|preview|_next)/);
assert.equal(robots.includes(`Sitemap: ${origin}/sitemap.xml`), indexable);
const image = await get("/opengraph-image");
assert.equal(image.status, 200);
assert.match(image.headers.get("content-type"), /image\/png/);
const png = Buffer.from(await image.arrayBuffer());
assert.equal(png.readUInt32BE(16), 1200);
assert.equal(png.readUInt32BE(20), 630);
console.log("OK robots.txt, public-only sitemap, unknown guide 404, 1200×630 PNG");
