import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      {source:"/downloads/tripboogie.apk",headers:[{key:"Content-Type",value:"application/vnd.android.package-archive"},{key:"Content-Disposition",value:'attachment; filename="tripboogie.apk"'},{key:"Cache-Control",value:"public, max-age=0, must-revalidate"},{key:"X-Content-Type-Options",value:"nosniff"}]},
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
