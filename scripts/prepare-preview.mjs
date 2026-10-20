import { cp, mkdir, copyFile, rm } from "node:fs/promises";
const root = new URL("../", import.meta.url),
  source = new URL("node_modules/pdfjs-dist/", root),
  target = new URL("public/pdfjs/", root);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await copyFile(
  new URL("legacy/build/pdf.worker.min.mjs", source),
  new URL("pdf.worker.min.js", target),
);
for (const directory of ["cmaps", "standard_fonts", "wasm"])
  await cp(new URL(directory, source), new URL(directory, target), {
    recursive: true,
  });
await copyFile(new URL("LICENSE", source), new URL("LICENSE", target));

await copyFile(
  new URL("node_modules/fflate/LICENSE", root),
  new URL("FFLATE_LICENSE", target),
);
