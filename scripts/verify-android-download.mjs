import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export function verifyAndroidDownload(metadata, bytes, version) {
  const certificate = "04:13:1A:F1:74:4A:0B:0D:D0:1A:DB:F1:F3:75:16:DE:3E:0F:FD:5A:8A:98:66:67:75:4C:F0:2D:B5:EB:5C:C4";
  if (metadata.package !== "com.tripboogie.app" || metadata.version !== version ||
      !Number.isInteger(metadata.build) || metadata.build < 1 ||
      metadata.download !== `/downloads/TripBoogie_${version}.apk` ||
      metadata.certificateSha256 !== certificate ||
      metadata.bytes !== bytes.length ||
      metadata.sha256 !== createHash("sha256").update(bytes).digest("hex"))
    throw new Error("Release APK metadata or checksum does not match this version");
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const root = new URL("../", import.meta.url);
  const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const metadata = JSON.parse(await readFile(new URL("public/downloads/release.json", root), "utf8"));
  const bytes = await readFile(new URL(`public/downloads/TripBoogie_${version}.apk`, root));
  verifyAndroidDownload(metadata, bytes, version);
  await writeFile(new URL("public/downloads/tripboogie.apk", root), bytes);
  console.log(`Verified release download: ${version}, build ${metadata.build}, ${bytes.length} bytes`);
}
