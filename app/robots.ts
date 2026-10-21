import type { MetadataRoute } from "next";
import { absoluteUrl, isIndexingEnabled } from "./seo/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Private HTML routes must remain crawlable so their noindex tag can be read.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    ...(isIndexingEnabled() ? { sitemap: absoluteUrl("/sitemap.xml") } : {}),
  };
}
