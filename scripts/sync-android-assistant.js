import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const android = path.join(root, "wrapper/gen/android");
function patch(relative, update) {
  const filename = path.join(android, relative);
  if (!fs.existsSync(filename)) throw new Error(`Missing ${filename}; run tauri android init first.`);
  const before = fs.readFileSync(filename, "utf8");
  const after = update(before);
  if (after !== before) fs.writeFileSync(filename, after);
}
patch("settings.gradle", (text) => text.includes("include ':alfred-assistant'") ? text : `${text}\n// Alfred's source-controlled assistant module (not generated Tauri bindings).\ninclude ':alfred-assistant'\nproject(':alfred-assistant').projectDir = new File(settingsDir, '../../android/assistant')\n`);
patch("app/build.gradle.kts", (text) => text.includes('implementation(project(":alfred-assistant"))') ? text : text.replace("dependencies {", 'dependencies {\n    implementation(project(":alfred-assistant"))'));
patch("build.gradle.kts", text => text.includes('com.google.gms:google-services:') ? text : text.replace('dependencies {', 'dependencies {\n        classpath("com.google.gms:google-services:4.5.0")'));
patch("app/build.gradle.kts", text => text.includes('id("com.google.gms.google-services")') ? text : text.replace('plugins {', 'plugins {\n    id("com.google.gms.google-services")'));
fs.copyFileSync(path.join(root, "wrapper/android/google-services.json"), path.join(android, "app/google-services.json"));
patch("app/build.gradle.kts", (text) => {
  if (!text.includes('testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"')) text = text.replace("defaultConfig {", 'defaultConfig {\n        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"');
  if (!text.includes('androidTestImplementation("androidx.test:runner:1.5.0")')) text = text.replace("dependencies {", 'dependencies {\n    androidTestImplementation("androidx.test:runner:1.5.0")');
  return text;
});
patch("app/src/main/java/com/alfred/app/MainActivity.kt", (text) => {
  if (text.includes("AssistantBridge.installMain")) return text;
  if (!text.includes("class MainActivity : TauriActivity() {")) throw new Error("MainActivity changed; manually add the assistant onWebViewCreate hook.");
  return text.replace("class MainActivity : TauriActivity() {", `class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    com.alfred.assistant.AssistantBridge.installMain(this, webView)
  }
`);
});
console.log("Android assistant integration hooks are up to date.");
patch("app/src/main/java/com/alfred/app/MainActivity.kt", (text) => {
  if (!text.includes("ScheduleNotifications.openIntent(this, intent)")) {
    text = text.replace("super.onCreate(savedInstanceState)", "super.onCreate(savedInstanceState)\n    com.alfred.assistant.ScheduleNotifications.openIntent(this, intent)");
  }
  if (!text.includes("override fun onNewIntent")) {
    const end = text.lastIndexOf("}");
    text = text.slice(0, end) + `\n  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    com.alfred.assistant.ScheduleNotifications.openIntent(this, intent)
  }
` + text.slice(end);
  }
  return text;
});

patch("app/src/main/java/com/alfred/app/MainActivity.kt", text => {
  if (text.includes("onBackPressedDispatcher.addCallback")) return text;
  return text.replace("com.alfred.assistant.AssistantBridge.installMain(this, webView)", `com.alfred.assistant.AssistantBridge.installMain(this, webView)
    onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (android.os.Build.VERSION.SDK_INT >= 30 && webView.rootWindowInsets?.isVisible(android.view.WindowInsets.Type.ime()) == true) {
          webView.windowInsetsController?.hide(android.view.WindowInsets.Type.ime())
          return
        }
        webView.evaluateJavascript("window.dispatchEvent(new Event('alfred:back', {cancelable:true}))", null)
      }
    })`);
});
