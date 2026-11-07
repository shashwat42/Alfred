import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

const [apk, buildTools] = process.argv.slice(2);
if (!apk || !buildTools) {
  console.error("Usage: node scripts/android-update-manifest.js <signed APK> <Android SDK build-tools directory>");
  process.exit(1);
}

try {
  const config = JSON.parse(readFileSync(new URL("../wrapper/tauri.android.conf.json", import.meta.url), "utf8"));
  const aapt = join(buildTools, process.platform === "win32" ? "aapt2.exe" : "aapt2");
  const badging = execFileSync(aapt, ["dump", "badging", apk], { encoding: "utf8" });
  const [, applicationId, code, version] = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m) ?? [];
  const minSdk = Number(badging.match(/^(?:minSdkVersion|sdkVersion):'(\d+)'$/m)?.[1]);
  const versionCode = Number(code);
  const name = basename(apk);
  if (applicationId !== config.identifier || version !== config.version || versionCode !== config.bundle.android.versionCode ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?)?$/.test(version ?? "") ||
      !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2_100_000_000 ||
      !Number.isSafeInteger(minSdk) || minSdk < 1 || name !== `Alfred_${version}_android_arm64-v8a.apk` ||
      !/^native-code: 'arm64-v8a'\s*$/m.test(badging) || /^application-debuggable\b/m.test(badging)) {
    throw new Error("APK does not match the configured Alfred ARM64 release.");
  }

  const signing = execFileSync("java", ["-jar", join(buildTools, "lib", "apksigner.jar"), "verify", "--print-certs", apk], { encoding: "utf8" });
  const certificates = new Set([...signing.matchAll(/certificate SHA-256 digest:\s*([a-f0-9]{64})\s*$/gim)].map(match => match[1].toLowerCase()));
  if (certificates.size !== 1) throw new Error("Expected exactly one APK signing certificate.");

  const sha256 = createHash("sha256").update(readFileSync(apk)).digest("hex");
  const [certificateSha256] = certificates;
  console.log(JSON.stringify({ version, versionCode, applicationId, architecture: "arm64-v8a", minSdk, apk: name, sha256, certificateSha256 }, null, 2));
} catch (error) {
  console.error(`Could not prepare Android update metadata: ${error.message}`);
  process.exitCode = 1;
}
