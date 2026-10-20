export interface TravelImage {
  url: string;
  sourceUrl: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
}
export interface PlaceDetails {
  photos: TravelImage[];
  openingHours: string;
  sourceUrl: string;
  checkedAt: string;
}
export function mediaImage(value: unknown): TravelImage | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!["url", "sourceUrl", "title", "author", "license", "licenseUrl"].every((k) => typeof v[k] === "string" && (v[k] as string).length <= 2048)) return null;
  try {
    const url = new URL(v.url as string), source = new URL(v.sourceUrl as string), license = new URL(v.licenseUrl as string);
    if (url.protocol !== "https:" || !["upload.wikimedia.org", "thumb.wikimedia.org"].includes(url.hostname) || url.username || url.password || url.port || !url.pathname.startsWith("/wikipedia/commons/")) return null;
    if (source.protocol !== "https:" || source.hostname !== "commons.wikimedia.org" || !source.pathname.startsWith("/wiki/File:") || source.username || source.password || source.port) return null;
    if (license.protocol !== "https:" || !["creativecommons.org", "commons.wikimedia.org", "www.gnu.org"].includes(license.hostname) || license.username || license.password || license.port) return null;
    return v as unknown as TravelImage;
  } catch { return null; }
}
