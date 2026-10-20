// Lossless encoding only: reject changes to decoded pixels, dimensions or alpha.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const paths = execFileSync("git", ["ls-files", "-z", "--", "*.png"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
let before = 0, after = 0, changed = 0;
for (const path of paths) {
  const file = new URL(path, new URL("../", import.meta.url));
  const original = await readFile(file);
  const compressed = await sharp(original).keepMetadata().png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
  before += original.length;
  if (compressed.length >= original.length) { after += original.length; continue; }
  const metadata = await sharp(original).metadata(), next = await sharp(compressed).metadata();
  for (const property of ["width", "height", "channels", "hasAlpha", "space"])
    if (metadata[property] !== next[property]) throw new Error(`Image metadata changed: ${path} (${property})`);
  const pixels = await sharp(original).raw().toBuffer(), encoded = await sharp(compressed).raw().toBuffer();
  if (!pixels.equals(encoded)) throw new Error(`Image pixels changed: ${path}`);
  await writeFile(file, compressed);
  after += compressed.length;
  changed++;
}
console.log(JSON.stringify({ files: paths.length, changed, before, after, saved: before - after, percent: Number(((before - after) / before * 100).toFixed(2)) }));
