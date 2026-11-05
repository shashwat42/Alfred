import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createUpdateManifest } from "./update-manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const pkg = readJson("package.json");
const config = readJson("wrapper/tauri.conf.json");
const version = pkg.version;
const api = new URL(process.env.ALFRED_RELEASE_API_URL || "https://alfred-137-23-49-88.sslip.io");
const target = "x86_64-pc-windows-msvc";

async function main() {
  if (process.platform !== "win32") throw new Error("Build the Windows release on Windows with the Rust MSVC toolchain.");
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error("Set TAURI_SIGNING_PRIVATE_KEY from the protected updater signing secret before packaging. Unsigned updates cannot be released.");
  if (!/^\d+\.\d+\.\d+(?:-beta\.\d+(?:\.\d+)?)?$/.test(version)) throw new Error("Expected a stable or numbered beta version in package.json.");
  const cargo = fs.readFileSync(path.join(root, "wrapper/Cargo.toml"), "utf8");
  const cargoVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
  const lock = readJson("package-lock.json");
  if ([config.version, cargoVersion, lock.version, lock.packages[""].version].some((value) => value !== version)) {
    throw new Error("Frontend, npm lockfile, Tauri and Cargo versions must match.");
  }
  if (api.protocol !== "https:" || api.username || api.password || api.search || api.hash || api.pathname !== "/") {
    throw new Error("The release API must be a public HTTPS origin without credentials, path or query.");
  }
  const notes = path.join(root, "docs/releases", `v${version}.md`);
  if (!fs.existsSync(notes)) throw new Error("Write the version's release notes before packaging.");
  const policy = `default-src 'self'; connect-src 'self' ${api.origin}; img-src 'self' data: https:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self'; worker-src 'self' blob:; child-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com;`;
  const releaseConfig = {
    build: { beforeBuildCommand: "npm run build", devUrl: null },
    app: { security: { csp: policy } },
    bundle: { targets: ["nsis"], createUpdaterArtifacts: true },
  };
  const started = Date.now();
  const output = path.join(root, ".deployment/releases", `v${version}`);
  if (fs.existsSync(output)) throw new Error(`Release output already exists: ${output}. Move it aside before rebuilding.`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, "node_modules/@tauri-apps/cli/tauri.js"),
      "build", "--ci", "--target", target, "--bundles", "nsis", "--config", JSON.stringify(releaseConfig), "--", "--locked",
    ], {
      cwd: root, stdio: "inherit", windowsHide: true,
      env: { ...process.env, MODE: "production", NODE_ENV: "production", VITE_API_BASE_URL: api.origin, CARGO_TARGET_DIR: path.join(root, "wrapper/target") },
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Tauri packaging exited with ${code}.`)));
  });
  const bundle = path.join(root, "wrapper/target", target, "release/bundle/nsis");
  const installers = fs.readdirSync(bundle).filter((name) => name.endsWith("-setup.exe") && name.includes(version))
    .filter((name) => fs.statSync(path.join(bundle, name)).mtimeMs >= started - 2000);
  if (installers.length !== 1) throw new Error("Expected exactly one newly built installer for this release.");
  const signature = fs.readFileSync(path.join(bundle, `${installers[0]}.sig`), "utf8").trim();
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  const sourceChanges = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  fs.mkdirSync(output, { recursive: true });
  const name = `Alfred_${version}_windows_x64-setup.exe`;
  const destination = path.join(output, name);
  fs.copyFileSync(path.join(bundle, installers[0]), destination);
  const sha256 = createHash("sha256").update(fs.readFileSync(destination)).digest("hex");
  fs.writeFileSync(path.join(output, "SHA256SUMS.txt"), `${sha256}  ${name}\n`);
  fs.copyFileSync(notes, path.join(output, "RELEASE_NOTES.md"));
  fs.writeFileSync(path.join(output, `${name}.sig`), signature + "\n");
  const updateManifest = createUpdateManifest({ version, installer: name, signature, notes: fs.readFileSync(notes, "utf8"), publishedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(output, "latest.json"), JSON.stringify(updateManifest, null, 2) + "\n");
  fs.writeFileSync(path.join(output, "release-manifest.json"), JSON.stringify({
    version, target, apiOrigin: api.origin, sourceCommit, hasTrackedChanges: Boolean(sourceChanges),
    builtAt: new Date().toISOString(), installer: name, sha256,
  }, null, 2) + "\n");
  console.log(`Release packaged at ${output}\nSHA-256: ${sha256}`);
  if (sourceChanges) console.log("This local candidate includes uncommitted changes. Rebuild from committed release source before publishing.");
}

main().catch((error) => { console.error(`[release] ${error.message}`); process.exitCode = 1; });
