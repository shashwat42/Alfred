import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const releaseApiOrigin = "https://alfred-137-23-49-88.sslip.io";

export function checkReleaseVersions(root = projectRoot) {
  const read = name => fs.readFileSync(path.join(root, name), "utf8");
  const json = name => JSON.parse(read(name));
  const version = json("package.json").version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Invalid release version.");
  const versions = {};
  for (const name of ["package-lock.json", "Alfred_Backend/package.json", "Alfred_Backend/package-lock.json", "wrapper/tauri.conf.json", "wrapper/tauri.android.conf.json"]) {
    const data = json(name);
    versions[name] = data.version;
    if (data.packages) versions[`${name} root package`] = data.packages[""].version;
  }
  versions["wrapper/Cargo.toml"] = read("wrapper/Cargo.toml").match(/^version = "([^"]+)"/m)?.[1];
  versions["wrapper/Cargo.lock"] = read("wrapper/Cargo.lock").match(/\[\[package\]\]\s+name = "app"\s+version = "([^"]+)"/)?.[1];
  for (const platform of ["linux", "windows"]) {
    const filename = `wrapper/tauri.${platform}.conf.json`;
    if (fs.existsSync(path.join(root, filename))) versions[filename] = json(filename).version ?? version;
  }
  const mismatches = Object.entries(versions).filter(([, value]) => value !== version);
  if (mismatches.length) throw new Error(`Release versions must match ${version}: ${mismatches.map(([name, value]) => `${name}=${value}`).join(", ")}`);
  const android = json("wrapper/tauri.android.conf.json");
  if (android.identifier !== json("wrapper/tauri.conf.json").identifier) throw new Error("Android and desktop application identities must match.");
  const code = android.bundle?.android?.versionCode;
  if (!Number.isSafeInteger(code) || code < 1 || code > 2_100_000_000) throw new Error("Invalid Android version code.");
  return version;
}
