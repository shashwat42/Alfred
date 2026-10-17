import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** A selected component/session is insufficient if Android's main service binding has died. */
export function assistantBindingHealth(voiceDump, audioDump) {
  const selected = /mComponent=com\.alfred\.app\/com\.alfred\.assistant\.AlfredVoiceService\b/.test(voiceDump);
  const binding = voiceDump.match(/mBound=(true|false)\s+mService=([^\r\n]+)/);
  const connected = selected && binding?.[1] === "true" && binding[2].trim() !== "null";
  const uid = voiceDump.match(/\buid=(\d+)\b/)?.[1];
  const assistantPolicy = audioDump.split("UID Policy:")[1]?.split("Accessibility UIDs:")[0] ?? "";
  const audioRecognizesAssistant = !!uid && new RegExp(`UID\\[\\d+\\]=${uid}\\b`).test(assistantPolicy);
  // Audio-policy UID lists vary across Android builds. A live main service is
  // required; capture must additionally be verified with actual non-silent audio.
  return { selected, connected: !!connected, audioRecognizesAssistant, ready: !!connected };
}

function main() {
  const serialIndex = process.argv.indexOf("--serial");
  const serial = serialIndex >= 0 ? process.argv[serialIndex + 1] : undefined;
  if (!serial || serial.startsWith("--")) throw new Error("Specify the device explicitly: node scripts/android-assistant-health.js --serial <serial>");
  const read = (service) => {
    const result = spawnSync("adb", ["-s", serial, "shell", "dumpsys", service], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 15000 });
    if (result.error || result.status !== 0) throw new Error(`Could not read Android ${service} state.`);
    return result.stdout;
  };
  const health = assistantBindingHealth(read("voiceinteraction"), read("media.audio_policy"));
  console.log(JSON.stringify(health, null, 2));
  if (!health.ready) {
    console.error("Assistant binding/audio policy is not ready. Android may retain Alfred as selected after instrumentation stops the app. In Android digital assistant settings, choose None, then Alfred again. Do not treat a visible overlay or zero-valued level events as proof of audio capture.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
