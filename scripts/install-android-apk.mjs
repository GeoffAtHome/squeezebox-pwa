import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const findAdbExecutable = () => {
  const candidates = [];

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    const userProfile = process.env.USERPROFILE;
    const sdkRoots = [
      localAppData &&
        path.join(localAppData, "Android", "Sdk", "platform-tools", "adb.exe"),
      userProfile &&
        path.join(
          userProfile,
          "AppData",
          "Local",
          "Android",
          "Sdk",
          "platform-tools",
          "adb.exe",
        ),
      "C:\\Android\\Sdk\\platform-tools\\adb.exe",
    ].filter(Boolean);

    candidates.push(...sdkRoots);
  } else {
    const home = process.env.HOME;
    const sdkRoots = [
      home && path.join(home, "Android", "Sdk", "platform-tools", "adb"),
      home &&
        path.join(home, "Library", "Android", "sdk", "platform-tools", "adb"),
      "/opt/android-sdk/platform-tools/adb",
    ].filter(Boolean);

    candidates.push(...sdkRoots);
  }

  candidates.push(process.platform === "win32" ? "adb.exe" : "adb");

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (existsSync(candidate)) return candidate;
  }

  return process.platform === "win32" ? "adb.exe" : "adb";
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const apkPath = path.join(
  rootDir,
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);

if (!existsSync(apkPath)) {
  console.error(`APK not found at ${apkPath}`);
  process.exit(1);
}

const adbCommand = findAdbExecutable();
const devicesResult = spawnSync(adbCommand, ["devices"], {
  cwd: rootDir,
  encoding: "utf8",
});

if (devicesResult.error) {
  console.error(`Unable to run ${adbCommand}: ${devicesResult.error.message}`);
  process.exit(1);
}

const deviceList = (devicesResult.stdout || "") + (devicesResult.stderr || "");
if (
  !/\bdevice\b/i.test(deviceList) ||
  (/List of devices attached/.test(deviceList) &&
    !/\tdevice\s*$/.test(deviceList))
) {
  console.error("No connected Android devices or emulators were detected.");
  process.exit(1);
}

const installResult = spawnSync(adbCommand, ["install", "-r", apkPath], {
  cwd: rootDir,
  stdio: "inherit",
});

if (installResult.error) {
  console.error(`Install failed: ${installResult.error.message}`);
  process.exit(1);
}

process.exit(installResult.status ?? 1);
