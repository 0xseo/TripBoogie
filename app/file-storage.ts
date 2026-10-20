import type { TripFile, Workspace } from "./types";
import { getSupabaseClient } from "./client-api";
const bucket = "tripboogie-private";
export type FileCommand = (
  op: string,
  payload: Record<string, unknown>,
) => Promise<{ file: TripFile | null; workspace: Workspace }>;
export async function removeFile(file: TripFile, command: FileCommand) {
  const client = await getSupabaseClient();
  if (!client) throw new Error("로그인을 확인해 주세요.");
  await command("mark-file-delete", { id: file.id });
  const { error } = await client.storage.from(bucket).remove([file.path]);
  if (error)
    throw new Error(
      "파일을 지우지 못했어요. 예약에서 삭제를 다시 시도해 주세요.",
    );
  return command("finish-file-delete", { id: file.id });
}
