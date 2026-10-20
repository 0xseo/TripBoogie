import type { MetadataRoute } from "next";
import { guides } from "./seo/guides";
import { absoluteUrl, isIndexingEnabled } from "./seo/site";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!isIndexingEnabled()) return [];
  // An explicit list prevents invitation tokens, profiles or travel records leaking.
  return ["/guide", ...guides.map(guide => `/guide/${guide.slug}`)].map(path => ({ url: absoluteUrl(path) }));
}
