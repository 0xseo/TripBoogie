import { searchAirports } from "../../airports";
import { resolveRequestUser } from "../../server/auth-provider";
import { readJson, ApiError } from "../../server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Authorization",
  };
  try {
    const input = await readJson(request);
    if (!(await resolveRequestUser(request)))
      throw new ApiError(401, "로그인이 필요합니다.");
    if (
      typeof input.query !== "string" ||
      input.query.trim().length < 2 ||
      input.query.length > 100
    )
      throw new ApiError(400, "공항 코드·이름을 2~100자로 입력하세요.");
    return Response.json(
      { airports: searchAirports(input.query) },
      { headers }
    );
  } catch (e) {
    return Response.json(
      {
        error: e instanceof ApiError ? e.message : "공항을 검색하지 못했어북",
      },
      { status: e instanceof ApiError ? e.status : 503, headers }
    );
  }
}
