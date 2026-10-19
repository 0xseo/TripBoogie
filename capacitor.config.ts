import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "com.tripboogie.app",
  appName: "트립부기",
  loggingBehavior: "none",
  webDir: "native-dist",
  server: { androidScheme: "https" },
  ios: { contentInset: "never" },
  android: { allowMixedContent: false, adjustMarginsForEdgeToEdge: "auto" },
};
export default config;
