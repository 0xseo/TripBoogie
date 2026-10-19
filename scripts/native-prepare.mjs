import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";
const env = parseEnv(await readFile(new URL("../.env.native.local", import.meta.url), "utf8"));
const expectedId = "com.tripboogie.app";
for (const key of ["ANDROID_APPLICATION_ID", "IOS_BUNDLE_ID"]) if (env[key] !== expectedId) throw new Error(`${key} must be ${expectedId}`);
if (!/^[a-f0-9]{32}$/.test(env.KAKAO_NATIVE_APP_KEY ?? "")) throw new Error("Missing Kakao native app key");
for (const key of ["GOOGLE_ANDROID_CLIENT_ID", "GOOGLE_IOS_CLIENT_ID", "GOOGLE_WEB_CLIENT_ID"]) if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(env[key] ?? "")) throw new Error(`Missing ${key}`);
const resources = new URL("../android/app/src/main/res/values/", import.meta.url);
const ios = new URL("../ios/App/Config/", import.meta.url);
await mkdir(resources, { recursive: true }); await mkdir(ios, { recursive: true });
await writeFile(new URL("native_config.xml", resources), `<resources>
<string name="kakao_native_app_key">${env.KAKAO_NATIVE_APP_KEY}</string>
<string name="kakao_scheme">kakao${env.KAKAO_NATIVE_APP_KEY}</string>
<string name="google_web_client_id">${env.GOOGLE_WEB_CLIENT_ID}</string>
</resources>
`);
await writeFile(new URL("Native.local.xcconfig", ios), `// Generated from .env.native.local; contains public native identifiers only.
KAKAO_NATIVE_APP_KEY = ${env.KAKAO_NATIVE_APP_KEY}
GOOGLE_IOS_CLIENT_ID = ${env.GOOGLE_IOS_CLIENT_ID}
GOOGLE_WEB_CLIENT_ID = ${env.GOOGLE_WEB_CLIENT_ID}
GOOGLE_IOS_REVERSED_CLIENT_ID = ${env.GOOGLE_IOS_CLIENT_ID.split(".").reverse().join(".")}
`);
console.log("Native provider configuration generated (values omitted).");
