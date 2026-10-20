import type { Metadata, Viewport } from "next";
import "./styles.css";
import {startupNavigationScript} from "./startup";
import { privateMetadata } from "./seo/site";

export const metadata: Metadata = {
  ...privateMetadata,
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: { "naver-site-verification": process.env.NAVER_SITE_VERIFICATION || [] },
  },
  manifest: "/manifest.webmanifest",
  referrer: "same-origin",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "트립부기",
  },
  icons: {
    icon: [{ url: "/favicon-32.png?v=20261019b", sizes: "32x32", type: "image/png" }],
    shortcut: "/favicon-32.png?v=20261019b",
    apple: "/apple-touch-icon.png?v=20261019b",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#154d40",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html:startupNavigationScript}}/></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
