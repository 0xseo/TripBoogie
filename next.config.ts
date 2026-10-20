import type { NextConfig } from "next";
import { appInfo } from "./app/app-info";

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      ...["tripboogie.apk",`TripBoogie_${appInfo.version}.apk`].map(name=>({source:`/downloads/${name}`,headers:[{key:"Content-Type",value:"application/vnd.android.package-archive"},{key:"Content-Disposition",value:`attachment; filename="TripBoogie_${appInfo.version}.apk"`},{key:"Cache-Control",value:"public, max-age=0, must-revalidate"},{key:"X-Content-Type-Options",value:"nosniff"}]})),
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
