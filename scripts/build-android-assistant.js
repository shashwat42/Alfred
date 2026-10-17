import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readAndroidRuntimeConfig } from "./android-runtime-config.js";

// Explicit copy-based fallback for Windows hosts where Tauri's JNI symlink step is unavailable.
// Does not install an APK, alter a device, or select an assistant.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] || "arm64";
const targets = {
  arm64: { rust: "aarch64-linux-android", abi: "arm64-v8a", variant: "Arm64" },
  x86_64: { rust: "x86_64-linux-android", abi: "x86_64", variant: "X86_64" },
};
if (!(target in targets)) throw new Error("Choose arm64 or x86_64.");
const config = targets[target];
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
run("node", ["scripts/sync-android-assistant.js"]);
run("npm", ["run", "build"]);
run("cargo", ["build", "--target", config.rust, "--features", "custom-protocol"], path.join(root, "wrapper"));
const source = path.join(root, "wrapper/target", config.rust, "debug/libapp_lib.so");
const destination = path.join(root, "wrapper/gen/android/app/src/main/jniLibs", config.abi);
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(source, path.join(destination, "libapp_lib.so"));
const nativeConfig = readAndroidRuntimeConfig(path.join(root, "wrapper"));
const assets = path.join(root, "wrapper/gen/android/app/src/main/assets");
fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, "tauri.conf.json"), JSON.stringify(nativeConfig, null, 2));
run(process.platform === "win32" ? "gradlew.bat" : "./gradlew", [
  `:app:assemble${config.variant}Debug`, "-x", `rustBuild${config.variant}Debug`, "-x", "rustBuildUniversalDebug",
], path.join(root, "wrapper/gen/android"));
