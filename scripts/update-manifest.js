export function createUpdateManifest({ version, installer, signature, notes, publishedAt }) {
  if (!/^\d+\.\d+\.\d+-beta\.\d+(?:\.\d+)?$/.test(version)) throw new Error("Expected a numbered beta version.");
  if (installer !== `Alfred_${version}_windows_x64-setup.exe`) throw new Error("Installer name must match the release version and Windows x64 platform.");
  if (!signature?.trim()) throw new Error("A signed update is required.");
  return {
    version, notes, pub_date: publishedAt,
    platforms: { "windows-x86_64": {
      signature: signature.trim(),
      url: `https://github.com/shashwat42/Alfred/releases/download/v${version}/${installer}`,
    } },
  };
}
