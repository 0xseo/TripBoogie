const token = process.env.VERCEL_TOKEN?.trim();
const team = process.env.VERCEL_ORG_ID;
const project = process.env.VERCEL_PROJECT_ID;
if (!token || !team || !project) throw new Error("Vercel deployment credentials are missing");

for (const [name, path] of [
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
