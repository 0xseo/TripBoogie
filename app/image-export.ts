import { Capacitor, registerPlugin } from "@capacitor/core";
import { blobBase64 } from "./download";

export type ExportFile = { blob: Blob; name: string };
const ImageGallery = registerPlugin<{ saveImage(options: { name: string; data: string }): Promise<void> }>("TripBoogieImages");
const safeName = (name: string) => name.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 160) || "tripboogie.png";
export const canSaveToPhotos = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("TripBoogieImages");
export function canShareImages(files: ExportFile[]) {
  if (Capacitor.isNativePlatform()) return true;
  return typeof navigator !== "undefined" && !!navigator.canShare?.({ files: files.map(file => new File([file.blob], file.name, { type: "image/png" })) });
}
export function isExportCancelled(cause: unknown) {
  const error = cause as { name?: string; code?: string; message?: string };
  return error?.name === "AbortError" || error?.code === "CANCELLED" || /share cancel(?:led|ed)/i.test(error?.message ?? "");
}
export async function saveImagesToPhotos(files: ExportFile[]) {
  if (!canSaveToPhotos()) throw new Error("이미지를 기기에 저장하려면 앱을 최신 버전으로 업데이트해 주세요.");
  let saved = 0;
  try {
    for (const file of files) {
      await ImageGallery.saveImage({ name: safeName(file.name), data: await blobBase64(file.blob) });
      saved++;
    }
  } catch (cause) {
    const code = (cause as { code?: string })?.code;
    const message = code === "PERMISSION_DENIED" ? "사진 저장 권한을 허용해 주세요. 설정에서 변경할 수 있어요." : "이미지를 저장하지 못했어요. 기기의 저장 공간과 권한을 확인해 주세요.";
    throw new Error(saved ? `${saved}장은 저장했어요. ${message}` : message);
  }
}
export async function shareImages(files: ExportFile[], title: string) {
  if (!Capacitor.isNativePlatform()) {
    // Invoke Web Share before awaiting anything, retaining the button's activation.
    await navigator.share({ title, files: files.map(file => new File([file.blob], file.name, { type: "image/png" })) });
    return;
  }
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const root = "overview-shares";
  // Recipients may read after the chooser closes. Retain current files and
  // remove only old exports on the next share, rather than deleting too early.
  try {
    const old = await Filesystem.readdir({ path: root, directory: Directory.Cache });
    await Promise.all(old.files.filter(file => /^\d+-[a-f0-9-]+$/.test(file.name) && Number(file.name.split("-")[0]) < Date.now() - 86400000)
      .map(file => Filesystem.rmdir({ path: `${root}/${file.name}`, directory: Directory.Cache, recursive: true }).catch(() => {})));
  } catch { /* No share cache yet, or cleanup is unavailable. */ }
  const path = `${root}/${Date.now()}-${crypto.randomUUID()}`;
  const uris: string[] = [];
  try {
    for (const [index, file] of files.entries()) {
      const result = await Filesystem.writeFile({ path: `${path}/${index + 1}_${safeName(file.name)}`, directory: Directory.Cache, data: await blobBase64(file.blob), recursive: true });
      uris.push(result.uri);
    }
    await Share.share({ title, files: uris, dialogTitle: "한눈에 보기 공유" });
  } catch (cause) {
    // Preparation failures have no recipient. A chooser result may already
    // have granted access, so leave those files for the bounded cache cleanup.
    if (uris.length < files.length) await Filesystem.rmdir({ path, directory: Directory.Cache, recursive: true }).catch(() => {});
    throw cause;
  }
}
