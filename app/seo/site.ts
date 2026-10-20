import type { Metadata } from "next";

// Keep canonical URLs independent of request headers and preview deployment hosts.
export const site = {
  origin: "https://tripboogie.0xseo94.com",
  name: "트립부기 TripBoogie",
  title: "함께 만드는 여행 일정표와 여행 경비 관리",
  description: "여행 일정과 지도, 다중 통화 경비, 예약과 준비물을 동행과 함께 정리하세요. 트립부기는 웹과 모바일에서 사용하는 여행 계획 앱입니다.",
} as const;

type IndexingEnvironment = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  SEO_INDEXING_ENABLED?: string;
};

export function isIndexingEnabled(environment: IndexingEnvironment = process.env) {
  return environment.NODE_ENV === "production"
    && (!environment.VERCEL_ENV || environment.VERCEL_ENV === "production")
    && environment.SEO_INDEXING_ENABLED !== "false";
}

export function absoluteUrl(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\]/.test(path)) {
    throw new Error("SEO URLs must be absolute paths without query strings or fragments.");
  }
  return new URL(path, site.origin).href;
}

const socialImage = { url: absoluteUrl("/opengraph-image"), width: 1200, height: 630, alt: "TripBoogie — Plan together. Travel easy." };

export const privateMetadata: Metadata = {
  metadataBase: new URL(site.origin),
  applicationName: site.name,
  title: site.name,
  description: site.description,
  robots: { index: false, follow: false },
  openGraph: {
    type: "website", locale: "ko_KR", siteName: site.name,
    title: site.name, description: site.description, images: [socialImage],
  },
  twitter: { card: "summary_large_image", title: site.name, description: site.description, images: [socialImage] },
};

export function publicMetadata(title: string, description: string, path: string, environment?: IndexingEnvironment): Metadata {
  const url = absoluteUrl(path);
  return {
    title: `${title} | 트립부기`, description,
    alternates: { canonical: url },
    robots: { index: isIndexingEnabled(environment), follow: true },
    openGraph: { type: "website", locale: "ko_KR", siteName: site.name, title, description, url, images: [socialImage] },
    twitter: { card: "summary_large_image", title, description, images: [socialImage] },
  };
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
