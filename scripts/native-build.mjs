import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const platform = process.argv[2];
if (!["android", "ios"].includes(platform)) throw new Error("Use native-build.mjs android|ios");
const env = { ...process.env };
if (platform === "android" && !env.JAVA_HOME) {
  const path = "/Library/Java/JavaVirtualMachines/openjdk-21.jdk/Contents/Home";
  if (existsSync(path)) env.JAVA_HOME = path;
}
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run("npm", ["run", "native:build"]);
run(process.execPath, ["node_modules/@capacitor/cli/bin/capacitor", "sync", platform]);
if (platform === "android") run("./gradlew", ["--no-daemon", "--max-workers=2", ":app:assembleDebug", ":app:lintDebug"], "android");
else run("xcodebuild", ["-project", "ios/App/App.xcodeproj", "-scheme", "App", "-configuration", "Debug", "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", ".sites-runtime/work/ios-derived", "CODE_SIGNING_ALLOWED=NO", "build"]);
