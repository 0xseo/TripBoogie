import { isNativeOrigin } from "./origin-policy";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ApiError(400, "올바른 JSON 객체가 필요합니다.");
  return value as Record<string, unknown>;
}

export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApiError(400, "올바른 항목 ID가 필요합니다.");
  return value;
}

export function date(value: unknown, label = "날짜"): string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value)
  )
    throw new ApiError(400, `${label}: YYYY-MM-DD 형식이 필요합니다.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new ApiError(400, `${label}가 올바르지 않습니다.`);
  return value;
}

// NextURL canonicalizes loopback IPs to localhost. Recover only the exact
// original loopback Host and matching port; never trust forwarded hosts or Origin.
export function requestOrigin(request: Request): string {
  const url = new URL(request.url),
    host = request.headers.get("host"),
    suffix = url.port ? `:${url.port}` : "";
  if (
    url.hostname === "localhost" &&
    (host === `127.0.0.1${suffix}` || host === `[::1]${suffix}`)
  )
    return `${url.protocol}//${host}`;
  return url.origin;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (isNativeOrigin(origin) && /^Bearer [A-Za-z0-9._-]+$/.test(request.headers.get("authorization") ?? "")) return;
  if (
    !origin ||
    origin !== requestOrigin(request) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError(403, "이 앱에서 다시 시도하세요.", "CROSS_ORIGIN");
}

// The 64 KiB request budget bounds allocation; fields have tighter product limits.
export async function readJson(
  request: Request,
  maxBytes = 65536,
): Promise<Record<string, unknown>> {
  assertSameOrigin(request);
  if (
    (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase() !== "application/json"
  )
    throw new ApiError(415, "application/json 요청이 필요합니다.");
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes)
    throw new ApiError(413, "한 번에 보낼 수 있는 데이터 크기를 초과했습니다.");
  if (!request.body) throw new ApiError(400, "요청 본문이 필요합니다.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ApiError(
          413,
          "한 번에 보낼 수 있는 데이터 크기를 초과했습니다.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "JSON 형식을 확인하세요.");
  }
}
