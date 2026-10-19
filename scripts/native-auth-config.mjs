// Project-scoped native OAuth setup. Never import into app/.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";
const management = parseEnv(await readFile(new URL("../.env.management", import.meta.url), "utf8"));
const native = parseEnv(await readFile(new URL("../.env.native.local", import.meta.url), "utf8"));
const project = "faekdclvcieuksoxsrtw";
if (management.TRIPBOOGIE_SUPABASE_PROJECT_REF !== project) throw new Error("Wrong Supabase project");
if (process.argv.slice(2).some((v) => !["--check", "--apply"].includes(v))) throw new Error("Use --check or --apply");
const endpoint = `https://api.supabase.com/v1/projects/${project}/config/auth`;
const headers = { Authorization: `Bearer ${management.TRIPBOOGIE_SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" };
async function request(init = {}) {
  const r = await fetch(endpoint, { redirect: "error", signal: AbortSignal.timeout(20000), ...init, headers });
  const body = await r.json();
  if (!r.ok) throw new Error(`Supabase auth config HTTP ${r.status}: ${JSON.stringify(body.error?.missing_permissions ?? [])}`);
  return body;
}
const before = await request();
const list = (value) => typeof value === "string" ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
const merge = (current, additions) => [...new Set([...list(current), ...additions])].join(",");
for (const key of ["GOOGLE_WEB_CLIENT_ID", "GOOGLE_ANDROID_CLIENT_ID", "GOOGLE_IOS_CLIENT_ID", "KAKAO_NATIVE_APP_KEY"]) if (!native[key]) throw new Error(`Missing ${key}`);
// The original Web/REST ID remains first: browser OAuth still uses that client.
const patch = {
  external_google_client_id: merge(before.external_google_client_id, [native.GOOGLE_WEB_CLIENT_ID, native.GOOGLE_ANDROID_CLIENT_ID, native.GOOGLE_IOS_CLIENT_ID]),
  external_kakao_client_id: merge(before.external_kakao_client_id, [native.KAKAO_NATIVE_APP_KEY]),
  uri_allow_list: merge(before.uri_allow_list, ["tripboogie://auth/callback**"]),
};
const changed = Object.keys(patch).filter((key) => patch[key] !== before[key]);
if (process.argv.includes("--apply") && changed.length) {
  const directory = new URL("../.sites-runtime/work/native-auth-backups/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(`${Date.now()}.json`, directory), JSON.stringify(before, null, 2), { mode: 0o600 });
  // One patch; on an unknown outcome inspect current settings before retrying.
  await request({ method: "PATCH", body: JSON.stringify(patch) });
}
const after = process.argv.includes("--apply") ? await request() : before;
const verified = Object.entries(patch).every(([key, value]) => after[key] === value);
console.log(JSON.stringify({ project, apply: process.argv.includes("--apply"), changedFields: changed, nativeSettingsReady: verified, existingWebIdsPreserved: list(after.external_google_client_id)[0] === list(before.external_google_client_id)[0] && list(after.external_kakao_client_id)[0] === list(before.external_kakao_client_id)[0], nonceBypassChanged: false, providerSecretsChanged: false }));
if (process.argv.includes("--apply") && !verified) process.exitCode = 1;
