import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TripBoogie · 친구와 함께 만드는 여행",
  description: "느긋하게, 함께. 여행 일정과 장소, 경비와 준비물을 친구와 함께 계획하는 트립부기.",
  manifest: "/manifest.webmanifest",
  referrer: "same-origin",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "TripBoogie" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
