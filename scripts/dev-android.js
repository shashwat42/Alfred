import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncNgrokUrl } from "./sync-ngrok-url.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const WRAPPER_DIR = path.join(ROOT_DIR, "wrapper");
const ANDROID_DIR = path.join(WRAPPER_DIR, "gen", "android");
const JNI_ARM64_DIR = path.join(ANDROID_DIR, "app", "src", "main", "jniLibs", "arm64-v8a");
const APK_PATH = path.join(ANDROID_DIR, "app", "build", "outputs", "apk", "arm64", "debug", "app-arm64-debug.apk");

function runCommand(command, args, cwd = ROOT_DIR, env = process.env) {
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "cmd.exe" : command;
  const cmdArgs = isWindows ? ["/c", command, ...args] : args;

  const result = spawnSync(cmd, cmdArgs, {
    cwd,
    stdio: "inherit",
    env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${command} ${args.join(" ")}`);
  }
}

function checkToolchain() {
  // 1. Check adb
  try {
    execSync("adb version", { stdio: "ignore" });
  } catch {
    console.error("[android-build] Error: Android Debug Bridge ('adb') was not found in your PATH.");
    console.error("Please ensure the Android SDK platform-tools directory is added to PATH.");
    process.exit(1);
  }

  // 2. Check cargo
  try {
    execSync("cargo --version", { stdio: "ignore" });
  } catch {
    console.error("[android-build] Error: Rust build tool 'cargo' was not found in your PATH.");
    process.exit(1);
  }

  // 3. Check Rust target aarch64-linux-android
  try {
    const installedTargets = execSync("rustup target list --installed", { encoding: "utf-8" });
    if (!installedTargets.includes("aarch64-linux-android")) {
      console.error("[android-build] Error: Missing Rust target 'aarch64-linux-android'.");
      console.error("Install it by running: rustup target add aarch64-linux-android");
      process.exit(1);
    }
  } catch {
    // rustup might not be directly available if installed standalone; cargo will check during build
  }

  // 4. Check Android NDK linker path configured in wrapper/.cargo/config.toml
  const cargoConfigPath = path.join(WRAPPER_DIR, ".cargo", "config.toml");
  if (fs.existsSync(cargoConfigPath)) {
    const configContent = fs.readFileSync(cargoConfigPath, "utf-8");
    const linkerMatch = configContent.match(/linker\s*=\s*"([^"]+)"/);
    if (linkerMatch && linkerMatch[1]) {
      const linkerPath = linkerMatch[1].replace(/\\\\/g, "\\");
      if (!fs.existsSync(linkerPath)) {
        console.warn(`[android-build] Warning: Configured NDK linker not found at ${linkerPath}`);
      }
    }
  }
}

function getConnectedDevice() {
  try {
    const output = execSync("adb devices", { encoding: "utf-8" });
    const lines = output.trim().split(/\r?\n/).slice(1);
    const devices = [];

    for (const line of lines) {
      const [id, status] = line.trim().split(/\s+/);
      if (id && status === "device") {
        devices.push(id);
      }
    }

    if (devices.length === 0) {
      console.error("[android-build] Error: No authorized Android device connected.");
      console.error("Please connect your phone via USB with USB Debugging enabled, and accept the authorization prompt.");
      process.exit(1);
    }

    return devices[0];
  } catch (err) {
    console.error("[android-build] Error querying connected devices:", err.message);
    process.exit(1);
  }
}

async function main() {
  console.log("\n==========================================");
  console.log("       Alfred Android Build & Deploy      ");
  console.log("==========================================\n");

  // Step 1: Toolchain and Device Verification
  console.log("[1/6] Verifying build toolchain and connected devices...");
  checkToolchain();
  const deviceId = getConnectedDevice();
  console.log(`[1/6] Target device identified: ${deviceId}`);

  // Step 2: Endpoint Selection & Reverse Proxy Configuration
  console.log("\n[2/6] Detecting active backend endpoint...");
  const activeUrl = await syncNgrokUrl();
  const isNgrok = activeUrl.includes("ngrok");

  if (isNgrok) {
    console.log(`[2/6] Using public ngrok tunnel: ${activeUrl}`);
    console.log("[2/6] Phone will communicate directly with ngrok over HTTPS.");
  } else {
    console.log(`[2/6] Using local development endpoint: ${activeUrl}`);
  }

  // Always configure ADB reverse proxy for port 8000 and 5173 as a reliable fallback
  try {
    execSync(`adb -s ${deviceId} reverse tcp:8000 tcp:8000`, { stdio: "ignore" });
    if (!isNgrok) {
      execSync(`adb -s ${deviceId} reverse tcp:5173 tcp:5173`, { stdio: "ignore" });
    }
    console.log("[2/6] ADB reverse proxy active (tcp:8000).");
  } catch (err) {
    console.warn("[2/6] Warning: Failed to set adb reverse ports:", err.message);
  }


  // Step 3: Production Frontend Build
  console.log("\n[3/6] Building production frontend with target API URL...");
  runCommand("npm", ["run", "build"], ROOT_DIR);

  // Step 4: Compile Rust Library for aarch64
  console.log("\n[4/6] Compiling Rust library in release mode for aarch64-linux-android...");
  const libRsPath = path.join(WRAPPER_DIR, "src", "lib.rs");
  const now = new Date();
  fs.utimesSync(libRsPath, now, now);
  runCommand("cargo", ["build", "--release", "--target", "aarch64-linux-android", "--features", "custom-protocol"], WRAPPER_DIR);

  // Step 5: Sync native .so library to jniLibs
  console.log("\n[5/6] Syncing native library to Android jniLibs...");
  const soSource = path.join(WRAPPER_DIR, "target", "aarch64-linux-android", "release", "libapp_lib.so");
  if (!fs.existsSync(soSource)) {
    throw new Error(`Compiled library not found at ${soSource}`);
  }
  fs.mkdirSync(JNI_ARM64_DIR, { recursive: true });
  fs.copyFileSync(soSource, path.join(JNI_ARM64_DIR, "libapp_lib.so"));

  // Step 5b: Sync Android asset tauri.conf.json with devUrl: null for standalone runtime
  const androidAssetConfigPath = path.join(ANDROID_DIR, "app", "src", "main", "assets", "tauri.conf.json");
  const baseTauriConfigPath = path.join(WRAPPER_DIR, "tauri.conf.json");
  if (fs.existsSync(baseTauriConfigPath)) {
    try {
      const baseConfig = JSON.parse(fs.readFileSync(baseTauriConfigPath, "utf-8"));
      baseConfig.build = baseConfig.build || {};
      baseConfig.build.devUrl = null;
      fs.mkdirSync(path.dirname(androidAssetConfigPath), { recursive: true });
      fs.writeFileSync(androidAssetConfigPath, JSON.stringify(baseConfig, null, 2), "utf-8");
      console.log("[5/6] Standalone Android asset configuration synced (devUrl: null).");
    } catch (err) {
      console.warn("[5/6] Warning: Failed to sync android asset configuration:", err.message);
    }
  }

  // Clear intermediate Gradle native lib caches and previous APK
  const cachedJni = path.join(ANDROID_DIR, "app", "build", "intermediates", "merged_native_libs");
  if (fs.existsSync(cachedJni)) {
    fs.rmSync(cachedJni, { recursive: true, force: true });
  }
  if (fs.existsSync(APK_PATH)) {
    fs.rmSync(APK_PATH, { force: true });
  }

  // Step 6: Assemble APK with Gradle
  console.log("\n[6/6] Assembling APK with Gradle...");
  const gradlewCmd = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  runCommand(gradlewCmd, [
    "assembleArm64Debug",
    "-x",
    "rustBuildArm64Debug",
    "-x",
    "rustBuildUniversalDebug",
  ], ANDROID_DIR);

  if (!fs.existsSync(APK_PATH)) {
    throw new Error(`Built APK was not found at expected path: ${APK_PATH}`);
  }

  // Install and Launch
  console.log(`\nInstalling APK onto ${deviceId}...`);
  runCommand("adb", ["-s", deviceId, "install", "-r", APK_PATH]);

  console.log(`Launching com.alfred.app on ${deviceId}...`);
  runCommand("adb", ["-s", deviceId, "shell", "am", "start", "-n", "com.alfred.app/.MainActivity"]);

  console.log("\n==========================================");
  console.log("       Deployment Complete!               ");
  console.log(`Device: ${deviceId}`);
  console.log(`API Target: ${activeUrl}`);
  console.log("==========================================\n");
}

main().catch((err) => {
  console.error("\n[android-build] Deployment failed:", err.message);
  process.exit(1);
});
