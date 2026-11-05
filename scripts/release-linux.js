import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { createLinuxUpdateManifest } from "./linux-update-manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const cli = path.join(root, "node_modules/@tauri-apps/cli/tauri.js");
function run(args, env = process.env) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Release command failed (${result.status}).`);
}
function main() {
  if (process.platform !== "linux") throw new Error("Build RPM releases on Linux.");
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error("The protected updater signing key is required for Linux releases.");
  const version = readJson("package.json").version;
  const config = readJson("wrapper/tauri.conf.json"), lock = readJson("package-lock.json");
  const cargo = fs.readFileSync(path.join(root, "wrapper/Cargo.toml"), "utf8").match(/^version = "([^"]+)"/m)?.[1];
  if ([config.version, lock.version, lock.packages[""].version, cargo].some(value => value !== version)) throw new Error("Release versions must match.");
  const architecture = ({ x64: "x86_64", arm64: "aarch64" })[process.arch];
  if (!architecture) throw new Error("Unsupported Linux release architecture.");
  const rpm = `Alfred-${version}-1.${architecture}.rpm`;
  const notes = fs.readFileSync(path.join(root, "docs/releases", `v${version}.md`), "utf8");
  const api = new URL(process.env.ALFRED_RELEASE_API_URL || "https://alfred-137-23-49-88.sslip.io");
  if (api.protocol !== "https:" || api.username || api.password || api.search || api.hash || api.pathname !== "/") throw new Error("The release API must be a public HTTPS origin.");
  const changed = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim();
  if (changed) throw new Error("Commit the release source before creating signed artifacts.");
  const output = path.join(root, ".deployment/linux-releases", `v${version}`);
  if (fs.existsSync(output)) throw new Error("This Linux release output already exists. Preserve it before rebuilding.");
  const candidate = path.join(root, "wrapper/target/release/bundle/rpm", rpm);
  const started = Date.now();
  const policy = `default-src 'self'; connect-src 'self' ${api.origin}; img-src 'self' data: https:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self'; worker-src 'self' blob:; child-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com;`;
  const releaseConfig = { build: { beforeBuildCommand: "npm run build", devUrl: null }, app: { security: { csp: policy } } };
  run(["build", "--ci", "--bundles", "rpm", "--config", JSON.stringify(releaseConfig), "--", "--locked"], { ...process.env, MODE: "production", VITE_API_BASE_URL: api.origin, CARGO_TARGET_DIR: path.join(root, "wrapper/target") });
  if (fs.statSync(candidate).mtimeMs < started - 2000) throw new Error("The RPM build did not produce a fresh artifact.");
  // The key remains in the environment; never expose it in process arguments.
  run(["signer", "sign", "--app-version", version, candidate]);
  const bytes = fs.readFileSync(candidate), signature = fs.readFileSync(`${candidate}.sig`, "utf8").trim();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = createLinuxUpdateManifest({ version, architecture, rpm, signature, sha256, size: bytes.length, notes });
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(candidate, path.join(output, rpm));
  fs.writeFileSync(path.join(output, `${rpm}.sig`), signature + "\n");
  fs.writeFileSync(path.join(output, "linux-update.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(output, "SHA256SUMS-linux.txt"), `${sha256}  ${rpm}\n`);
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(output, "linux-release-manifest.json"), JSON.stringify({ version, sourceCommit, architecture, apiOrigin: api.origin, rpm, sha256, builtAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(`Signed Linux release prepared at ${output}`);
}
try { main(); } catch (error) { console.error(`[release] ${error.message}`); process.exitCode = 1; }
