import { isNativeApp } from "./runtime";
export async function saveDownload(blob: Blob, name: string) {
  if (isNativeApp()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("파일을 준비하지 못했어북"));
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
      reader.readAsDataURL(blob);
    });
    const path =
      "exports/" +
      crypto.randomUUID() +
      "/" +
      (name.replace(/[\/\\\x00-\x1f]/g, "_").slice(0, 160) ||
        "tripboogie-file");
    const file = await Filesystem.writeFile({
      path,
      data,
      directory: Directory.Cache,
      recursive: true,
    });
    try {
      await Share.share({ title: name, files: [file.uri] });
    } finally {
      await Filesystem.deleteFile({ path, directory: Directory.Cache });
    }
    return;
  }
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
