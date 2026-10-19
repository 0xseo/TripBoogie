import type { Metadata, Viewport } from "next";
import "./styles.css";
import {startupNavigationScript} from "./startup";

export const metadata: Metadata = {
  title: "트립부기",
  description:
    "느긋하게, 함께. 여행 일정과 장소, 경비와 준비물을 친구와 함께 계획하는 트립부기.",
  manifest: "/manifest.webmanifest",
  referrer: "same-origin",
  robots: { index: false, follow: false },
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
