import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { syncNgrokUrl } from "./sync-ngrok-url.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = path.join(root, "wrapper");
const target = path.join(wrapper, "target");

function run(executable, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} exited with ${code ?? "an interruption"}.`));
    });
  });
}

function isInstalled(productName) {
  // Read registration only. Let Alfred's own installer handle the existing path,
  // running process, shortcuts and data; never kill every process named app.exe.
  const command = `
    $ErrorActionPreference = 'Stop'
    $roots = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
    $found = @($roots | ForEach-Object {
      Get-ChildItem -LiteralPath $_ -ErrorAction SilentlyContinue |
        Get-ItemProperty -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq $env:ALFRED_PC_PRODUCT_NAME }
    })
    if ($found.Count -gt 0) { 'installed' } else { 'new' }
  `;
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, ALFRED_PC_PRODUCT_NAME: productName },
  }).trim() === "installed";
}

async function main() {
  if (process.platform !== "win32") throw new Error("dev:pc installs the Windows app. Run this command on Windows.");
  const config = JSON.parse(fs.readFileSync(path.join(wrapper, "tauri.conf.json"), "utf8"));
  const installed = isInstalled(config.productName);
  console.log("[pc] Detecting the backend endpoint...");
  const apiUrl = await syncNgrokUrl();
  console.log(`[pc] Building the installed app in development mode. API: ${apiUrl}`);
  const started = Date.now();
  await run(process.execPath, [
    path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
    "build", "--debug", "--bundles", "nsis",
    "--config", path.join(wrapper, "tauri.pc-dev.conf.json"),
  ], { ...process.env, NODE_ENV: "development", CARGO_TARGET_DIR: target });

  const bundleDir = path.join(target, "debug", "bundle", "nsis");
  const installers = fs.readdirSync(bundleDir)
    .filter((name) => name.toLowerCase().endsWith("-setup.exe"))
    .map((name) => ({ file: path.join(bundleDir, name), time: fs.statSync(path.join(bundleDir, name)).mtimeMs }))
    // Do not install a stale artifact if bundling failed to produce a new one.
    .filter(({ time }) => time >= started - 2000)
    .sort((a, b) => b.time - a.time);
  if (installers.length !== 1) throw new Error("Expected one freshly built Windows installer in wrapper/target/debug/bundle/nsis.");
  console.log(installed ? "[pc] Updating Alfred and relaunching the installed app..." : "[pc] Installing Alfred and launching it...");
  // Tauri NSIS: passive progress + launch. Update mode keeps the previous install
  // path/data and shortcuts; first installs create their normal shortcuts.
  await run(installers[0].file, installed ? ["/P", "/R", "/UPDATE"] : ["/P", "/R"]);
  console.log("[pc] Installer completed. Alfred was requested to launch from its installed location.");
}

main().catch((error) => {
  console.error(`[pc] Build/install failed: ${error.message}`);
  process.exitCode = 1;
});
