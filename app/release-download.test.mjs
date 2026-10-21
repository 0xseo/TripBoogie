import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyAndroidDownload } from "../scripts/verify-android-download.mjs";

test("automatic deployments reject stale, altered, or differently signed APK metadata", () => {
  const bytes = Buffer.from("test signed release bytes");
  const metadata = {
    package: "com.tripboogie.app", version: "0.2.3", build: 30,
    download: "/downloads/TripBoogie_0.2.3.apk", bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    certificateSha256: "04:13:1A:F1:74:4A:0B:0D:D0:1A:DB:F1:F3:75:16:DE:3E:0F:FD:5A:8A:98:66:67:75:4C:F0:2D:B5:EB:5C:C4",
  };
  assert.doesNotThrow(() => verifyAndroidDownload(metadata, bytes, "0.2.3"));
  assert.throws(() => verifyAndroidDownload(metadata, Buffer.from("altered"), "0.2.3"));
  for (const patch of [{ version: "0.2.2" }, { build: 0 }, { bytes: 0 }, { sha256: "bad" }, { certificateSha256: "other" }, { package: "other.app" }, { download: "/downloads/../../private" }])
    assert.throws(() => verifyAndroidDownload({ ...metadata, ...patch }, bytes, "0.2.3"));
});
