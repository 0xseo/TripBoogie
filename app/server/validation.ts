import type { ItemKind } from "../types";

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

function string(value: unknown, label: string, max: number, required = true): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > max || (required && !value.trim()))
    throw new ApiError(400, `${label}: ${required ? "1" : "0"}~${max}자의 문자열을 입력하세요.`);
  return value.trim();
}

export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw new ApiError(400, "올바른 항목 ID가 필요합니다.");
  return value;
}

export function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new ApiError(400, "수정할 항목의 버전이 필요합니다.");
  return value as number;
}

export function date(value: unknown, label = "날짜"): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value))
    throw new ApiError(400, `${label}: YYYY-MM-DD 형식이 필요합니다.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new ApiError(400, `${label}가 올바르지 않습니다.`);
  return value;
}

function currency(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value))
    throw new ApiError(400, "통화는 KRW, USD 같은 3자리 코드여야 합니다.");
  return value.toUpperCase();
}

function decimal(value: unknown, label: string, positive = false): number | string {
  const text = typeof value === "number" ? String(value) : value;
  if (
    typeof text !== "string" ||
    !/^\d{1,12}(?:\.\d{1,6})?$/.test(text) ||
    !Number.isFinite(Number(text)) ||
    (positive && Number(text) <= 0)
  )
    throw new ApiError(400, `${label}: 0 이상의 금액을 소수점 6자리 이내로 입력하세요.`);
  return typeof value === "number" ? value : text;
}

export function tripData(input: unknown) {
  const data = object(input);
  const startDate = date(data.startDate, "시작일");
  const endDate = date(data.endDate, "종료일");
  if (endDate < startDate) throw new ApiError(400, "종료일은 시작일 이후여야 합니다.");
  if ((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 > 364)
    throw new ApiError(400, "한 여행은 최대 365일로 설정해 주세요.");
  const timezone =
    data.timezone === undefined ? "Asia/Seoul" : string(data.timezone, "시간대", 100);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new ApiError(400, "올바른 IANA 시간대를 입력하세요.");
  }
  return {
    title: string(data.title, "여행 이름", 200),
    destination: string(data.destination, "여행지", 300),
    startDate,
    endDate,
    currency: currency(data.currency),
    timezone,
  };
}

export function itemKind(value: unknown): ItemKind {
  if (!["plan", "place", "expense", "checklist"].includes(value as string))
    throw new ApiError(400, "지원하지 않는 항목 종류입니다.");
  return value as ItemKind;
}

export function itemData(kind: ItemKind, input: unknown): Record<string, unknown> {
  const data = object(input);
  const category = string(data.category, "분류", 100, false);
  switch (kind) {
    case "plan": {
      const time = string(data.time, "시간", 5, false);
      if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
        throw new ApiError(400, "시간은 HH:mm 형식이어야 합니다.");
      if (
        data.duration !== undefined &&
        data.duration !== "" &&
        typeof data.duration !== "number" &&
        (typeof data.duration !== "string" || !/^\d{1,4}$/.test(data.duration))
      )
        throw new ApiError(400, "소요 시간은 분 단위 숫자로 입력하세요.");
      const duration =
        data.duration === undefined || data.duration === "" ? 0 : Number(data.duration);
      if (!Number.isInteger(duration) || duration < 0 || duration > 1440)
        throw new ApiError(400, "소요 시간은 0~1440분이어야 합니다.");
      return {
        date: date(data.date),
        time,
        title: string(data.title, "일정 이름", 300),
        note: string(data.note, "메모", 10000, false),
        placeId: data.placeId ? uuid(data.placeId) : "",
        category,
        duration,
      };
    }
    case "place": {
      for (const value of [data.lat, data.lng]) {
        if (
          value !== undefined &&
          value !== null &&
          value !== "" &&
          typeof value !== "number" &&
          (typeof value !== "string" || !/^-?\d{1,3}(?:\.\d{1,15})?$/.test(value))
        )
          throw new ApiError(400, "좌표는 숫자로 입력하세요.");
      }
      const lat =
        data.lat === undefined || data.lat === null || data.lat === "" ? null : Number(data.lat);
      const lng =
        data.lng === undefined || data.lng === null || data.lng === "" ? null : Number(data.lng);
      if (
        (lat === null) !== (lng === null) ||
        (lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) ||
        (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180))
      )
        throw new ApiError(400, "위도와 경도를 함께 올바르게 입력하세요.");
      return {
        name: string(data.name, "장소 이름", 300),
        address: string(data.address, "주소", 1000, false),
        lat,
        lng,
        category,
        note: string(data.note, "메모", 10000, false),
      };
    }
    case "expense": {
      if (!Array.isArray(data.participants) || data.participants.length > 100)
        throw new ApiError(400, "분담자는 최대 100명까지 입력할 수 있습니다.");
      const participants = [
        ...new Set(data.participants.map((value) => string(value, "분담자", 200))),
      ];
      return {
        title: string(data.title, "지출 이름", 300),
        amount: decimal(data.amount, "금액"),
        currency: currency(data.currency),
        category,
        payer: string(data.payer, "결제자", 200),
        participants,
        date: date(data.date),
        ...(data.exchangeRate !== undefined && data.exchangeRate !== ""
          ? { exchangeRate: decimal(data.exchangeRate, "환율", true) }
          : {}),
      };
    }
    case "checklist": {
      if (typeof data.done !== "boolean") throw new ApiError(400, "체크 상태가 필요합니다.");
      return { title: string(data.title, "체크 항목", 500), done: data.done, category };
    }
  }
}

export function inviteRole(value: unknown): "editor" | "viewer" {
  if (value !== "editor" && value !== "viewer")
    throw new ApiError(400, "초대 권한은 편집자 또는 열람자여야 합니다.");
  return value;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (
    !origin ||
    origin !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError(403, "이 앱에서 다시 시도하세요.", "CROSS_ORIGIN");
}

// The 64 KiB request budget bounds allocation; fields have tighter product limits.
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  assertSameOrigin(request);
  if (
    (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new ApiError(415, "application/json 요청이 필요합니다.");
  if (Number(request.headers.get("content-length") ?? 0) > 65536)
    throw new ApiError(413, "한 번에 보낼 수 있는 데이터는 64 KiB입니다.");
  if (!request.body) throw new ApiError(400, "요청 본문이 필요합니다.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 65536) {
        await reader.cancel();
        throw new ApiError(413, "한 번에 보낼 수 있는 데이터는 64 KiB입니다.");
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
    return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "JSON 형식을 확인하세요.");
  }
}
