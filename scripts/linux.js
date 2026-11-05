import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "check";
if (process.platform !== "linux" || !["check", "dev", "build"].includes(mode)) {
  console.error("Use linux:check, dev:linux or build:linux on a Linux host.");
  process.exit(1);
}
const checks = [
  ["cargo", ["--version"]], ["rustc", ["--version"]], ["cc", ["--version"]],
  ["pkg-config", ["--exists", "gtk+-3.0", "webkit2gtk-4.1", "javascriptcoregtk-4.1", "libsoup-3.0", "openssl"]],
  ["pkg-config", ["--exists", "ayatana-appindicator3-0.1"]],
  ["xdg-mime", ["--version"]], ["update-desktop-database", ["--version"]],
];
const missing = checks.filter(([command, args]) => {
  const result = spawnSync(command, args, { cwd: root, stdio: "ignore" });
  // Fedora ships the original AppIndicator library rather than Ayatana.
  if (command === "pkg-config" && args.includes("ayatana-appindicator3-0.1") && result.status !== 0) {
    return spawnSync(command, ["--exists", "appindicator3-0.1"], { stdio: "ignore" }).status !== 0;
  }
  return result.error || result.status !== 0;
});
if (missing.length) {
  console.error("Missing Linux build prerequisites:");
  missing.forEach(([command, args]) => console.error(`  ${command} ${args.join(" ")}`));
  console.error("See docs/linux-fedora.md for Fedora packages and the Rust toolchain.");
  process.exit(1);
}
console.log("Linux build prerequisites found. Rust 1.90+ and Node 24+ are required.");
if (mode !== "check") {
  const args = mode === "dev" ? ["dev"] : ["build", "--bundles", "rpm"];
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/@tauri-apps/cli/tauri.js"), ...args], {
    cwd: root, stdio: "inherit", env: process.env,
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
