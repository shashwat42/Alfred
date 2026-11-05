const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?)?$/;
export function createLinuxUpdateManifest({ version, architecture, rpm, signature, sha256, size, notes = "" }) {
  if (!versionPattern.test(version)) throw new Error("Expected a canonical stable or beta release version.");
  if (!["x86_64", "aarch64"].includes(architecture)) throw new Error("Unsupported RPM architecture.");
  if (rpm !== `Alfred-${version}-1.${architecture}.rpm`) throw new Error("RPM name must match the version and architecture.");
  if (!signature?.trim()) throw new Error("A signed RPM is required.");
  if (!/^[a-f0-9]{64}$/i.test(sha256) || !Number.isSafeInteger(size) || size <= 0 || size > 128 * 1024 * 1024) throw new Error("Invalid RPM checksum or size.");
  return { version, notes, platforms: { [`linux-${architecture}`]: {
    url: `https://github.com/shashwat42/Alfred/releases/download/v${version}/${rpm}`,
    signature: signature.trim(), sha256: sha256.toLowerCase(), size,
  } } };
}
