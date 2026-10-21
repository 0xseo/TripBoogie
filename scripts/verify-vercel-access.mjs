const token = process.env.VERCEL_TOKEN?.trim();
const team = process.env.VERCEL_ORG_ID;
const project = process.env.VERCEL_PROJECT_ID;
if (!token || !team || !project) throw new Error("Vercel deployment credentials are missing");

const identityResponse = await fetch("https://api.vercel.com/v5/user/tokens/current", {
  headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30000),
});
const identity = await identityResponse.json();
if (!identityResponse.ok) throw new Error(`Vercel token verification failed: HTTP ${identityResponse.status} (${identity.error?.code || "unknown"})`);
console.log("Vercel token scope:", JSON.stringify({
  name: identity.token?.name,
  type: identity.token?.type,
  teams: identity.token?.scopes?.filter(scope => scope.type === "team").map(scope => scope.teamId),
}));

for (const [name, path] of [
  ["Team", `/v2/teams/${team}?teamId=${team}`],
  ["Project", `/v9/projects/${project}?teamId=${team}`],
]) {
  const response = await fetch(`https://api.vercel.com${path}`, {
    headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = String(data.error?.message || "Access denied").replaceAll(token, "[redacted]");
    throw new Error(`${name} access failed: HTTP ${response.status} (${data.error?.code || "unknown"}): ${message}`);
  }
  console.log(`Vercel ${name.toLowerCase()} access verified`);
}
