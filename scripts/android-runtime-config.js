import fs from "node:fs";
import path from "node:path";

// Platform configuration follows Tauri's JSON merge-patch semantics: arrays replace.
export function mergeConfig(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const result = { ...(base && typeof base === "object" && !Array.isArray(base) ? base : {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergeConfig(result[key], value);
  }
  return result;
}

export function readAndroidRuntimeConfig(wrapperDirectory) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(wrapperDirectory, name), "utf8"));
  const config = mergeConfig(read("tauri.conf.json"), read("tauri.android.conf.json"));
  config.build = { ...config.build, devUrl: null };
  const windows = config.app?.windows;
  if (windows?.length !== 1 || windows[0].label !== "main" || windows[0].url !== "index.html") {
    throw new Error("Android must launch only the main app at index.html; desktop overlay windows must not be packaged as Android app windows.");
  }
  return config;
}
