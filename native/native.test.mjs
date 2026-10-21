import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";
const dir = await mkdtemp(path.join(tmpdir(), "tripboogie-native-test-"));
test.after(() => rm(dir, { recursive: true, force: true }));
for (const name of ["native-contract", "server/origin-policy", "server/validation"]) {
  const source = (await readFile(new URL(`../app/${name}.ts`, import.meta.url), "utf8")).replace('"./origin-policy"', '"./origin-policy.mjs"');
  await writeFile(path.join(dir, path.basename(name) + ".mjs"), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const { nativeLinkPath, nativeLoginErrorMessage } = await import(pathToFileURL(path.join(dir, "native-contract.mjs")));
const { nativeCorsHeaders } = await import(pathToFileURL(path.join(dir, "origin-policy.mjs")));
const { readJson } = await import(pathToFileURL(path.join(dir, "validation.mjs")));
test("native callback accepts code and invitation next, without accepting an external redirect", () => {
  const invite = "/invite/" + "ab".repeat(32);
  assert.equal(nativeLinkPath("tripboogie://auth/callback?code=valid_code&next=" + encodeURIComponent(invite)), "/auth/callback?code=valid_code&next=" + encodeURIComponent(invite));
  for (const url of ["https://evil.test/auth/callback?code=a", "tripboogie://evil/callback?code=a", "tripboogie://auth/callback?access_token=x", "tripboogie://auth/callback?code=a&next=https://evil.test", "tripboogie://auth/callback?code=a#access_token=x", "tripboogie://user@auth/callback?code=a", "tripboogie://auth:123/callback?code=a", "tripboogie://auth/callback"]) assert.equal(nativeLinkPath(url), null, url);
});
test("only canonical app invitation links are routed", () => {
  const token = "ab".repeat(32);
  assert.equal(nativeLinkPath("https://tripboogie.0xseo94.com/invite/" + token), "/invite/" + token);
  assert.equal(nativeLinkPath("tripboogie://invite/" + token), "/invite/" + token);
  for (const url of ["https://tripboogie.0xseo94.com.evil.test/invite/" + token, "tripboogie://invite/../auth", "tripboogie://invite/" + token + "?next=evil"]) assert.equal(nativeLinkPath(url), null);
});
test("CORS permits only exact native origins and never cookies", () => {
  for (const origin of ["capacitor://localhost", "https://localhost"]) {
    const headers = nativeCorsHeaders(origin);
    assert.equal(headers["Access-Control-Allow-Origin"], origin);
    assert.equal(headers["Access-Control-Allow-Credentials"], undefined);
  }
  for (const origin of [null, "null", "http://localhost", "https://localhost:443", "https://localhost.evil.test", "capacitor://other"]) assert.deepEqual(nativeCorsHeaders(origin), {});
});
test("native JSON transport requires an Authorization bearer; external origins stay denied", async () => {
  const request = (origin, authorization) => new Request("https://tripboogie.0xseo94.com/api/trips", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify({title:"Trip"}) });
  for (const origin of ["capacitor://localhost", "https://localhost"]) {
    assert.deepEqual(await readJson(request(origin, "Bearer valid.test.jwt")), {title:"Trip"});
    await assert.rejects(readJson(request(origin)), e => e.status === 403);
  }
  await assert.rejects(readJson(request("https://evil.test", "Bearer valid.test.jwt")), e => e.status === 403);
});

test("native login explains missing Kakao ID tokens without misreporting a network failure", () => {
  const message = nativeLoginErrorMessage("kakao", {code: "ID_TOKEN_MISSING"});
  assert.match(message, /OpenID Connect.*ON/);
  assert.doesNotMatch(message, /네트워크/);
  assert.doesNotMatch(nativeLoginErrorMessage("google", {code: "ID_TOKEN_MISSING"}), /카카오|OpenID/);
  assert.match(nativeLoginErrorMessage("kakao", new Error("NATIVE_TOKEN_VERIFICATION_FAILED")), /서버 검증/);
  assert.match(nativeLoginErrorMessage("kakao", {code: "CANCELLED"}), /취소/);
});
test("native login never displays raw SDK or server payloads", () => {
  for (const failure of [null, "access_token=private", new Error("private-token"), {code: "unexpected-private-token", message: "private-token"}, {code: "ID_TOKEN_MISSING", message: "private-token"}]) {
    assert.doesNotMatch(nativeLoginErrorMessage("kakao", failure), /private|access_token/);
  }
});


test("native conditional polling permits its validator header and exposes response validators", () => {
  const headers=nativeCorsHeaders("capacitor://localhost");
  assert.match(headers["Access-Control-Allow-Headers"],/If-None-Match/);
  assert.equal(headers["Access-Control-Expose-Headers"],"ETag");
  assert.deepEqual(nativeCorsHeaders("https://evil.test"),{});
});
