import assert from "node:assert/strict";
import { act, createElement } from "react";
import { Window } from "happy-dom";
import { createServer } from "vite";

const dom = new Window({ url: "http://localhost:5173/" });
const names = ["window", "document", "navigator", "Event", "CustomEvent", "HTMLElement", "Node", "IS_REACT_ACT_ENVIRONMENT"] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const originalFetch = globalThis.fetch;
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom[name as keyof Window] });
Object.defineProperty(document, "queryCommandState", { value: () => false });
let copied = "";
Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { copied = text; } } });
const server = await createServer({ mode: "development", cacheDir: "node_modules/.vite-workspace-ui", optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
const { createRoot } = await import("react-dom/client");
document.body.innerHTML = '<div id="root"></div>'; const root = createRoot(document.getElementById("root")!);
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
try {
  const { NotesView } = await server.ssrLoadModule("/src/components/dashboard/NotesView.tsx");
  const note = { _id: "one", title: "Test", content: "<p>Today I wanted</p><p>Hello</p><p>Third line</p><p>Hidden line</p>" };
  let left = 0, saves = 0, fail = true;
  const props = { notes: [note], activeNote: note, onSelectNote() {}, onDeleteNote: async () => true, onBackToList: () => { left++; }, onSaveNote: async (value: { content: string }) => { saves++; return fail ? null : { ...note, ...value }; } };
  await act(async () => root.render(createElement(NotesView, props))); await settle();
  const formatting = () => document.querySelector<HTMLElement>("#note-formatting")!;
  assert.equal(formatting().hidden, true);
  await act(async () => document.querySelector<HTMLButtonElement>(".note-format-toggle")!.click());
  assert.equal(formatting().hidden, false);
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Copy content"]')!.click());
  assert.equal(copied, "Today I wanted\nHello\nThird line\nHidden line");
  const editor = document.querySelector<HTMLElement>(".note-editor-rich-canvas")!;
  await act(async () => { editor.innerHTML = "<p>Unsaved edit</p>"; editor.dispatchEvent(new dom.Event("input", { bubbles: true })); });
  await act(async () => window.dispatchEvent(new Event("alfred:back", { cancelable: true }))); await settle();
  assert.equal(saves, 1); assert.equal(left, 0, "A failed save keeps the editor open");
  fail = false;
  await act(async () => window.dispatchEvent(new Event("alfred:back", { cancelable: true }))); await settle();
  assert.equal(left, 1, "Back waits for a successful save");
  await act(async () => root.render(createElement(NotesView, { ...props, activeNote: null }))); await settle();
  const lines = [...document.querySelectorAll(".note-preview-line")].map(line => line.textContent);
  assert.deepEqual(lines, ["Today I wanted", "Hello", "Third line"]);
  const { Onboarding } = await server.ssrLoadModule("/src/components/reliability/OnboardingTour.tsx");
  let destination = "", completed = 0;
  const navigate = (event: Event) => { destination = (event as CustomEvent<string>).detail; };
  window.addEventListener("alfred:tour-navigate", navigate);
  await act(async () => root.render(createElement(Onboarding, { complete: async () => { completed++; }, legal() {} })));
  await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent === "Skip tour")!.click());
  assert.equal(completed, 1); assert.equal(destination, "home");
  window.removeEventListener("alfred:tour-navigate", navigate);
  const { ConnectionStatus } = await server.ssrLoadModule("/src/components/reliability/ConnectionStatus.tsx");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await act(async () => root.render(createElement("div", null, createElement("input", { defaultValue: "Preserved draft" }), createElement(ConnectionStatus)))); await settle();
  assert.ok(document.querySelector("dialog[open]")); assert.match(document.body.textContent!, /offline/);
  await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent === "Continue with saved content")!.click());
  assert.equal(document.querySelector("dialog[open]"), null); assert.equal(document.querySelector("input")!.value, "Preserved draft");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await act(async () => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new CustomEvent("alfred:server-unavailable", { detail: true })); }); await settle();
  assert.match(document.body.textContent!, /temporarily unavailable/);
  globalThis.fetch = async () => new Response(null, { status: 200 });
  await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent === "Try again")!.click()); await settle();
  assert.equal(document.querySelector("dialog[open]"), null); assert.equal(document.querySelector("input")!.value, "Preserved draft");
  const { NotFound } = await server.ssrLoadModule("/src/components/reliability/States.tsx");
  await act(async () => root.render(createElement(NotFound))); assert.match(document.body.textContent!, /404/);
  const { UpcomingView } = await server.ssrLoadModule("/src/components/dashboard/UpcomingView.tsx");
  await act(async () => root.render(createElement(UpcomingView)));
  assert.equal(document.querySelectorAll(".empty-text-art").length, 1, "One shared face when all sections are empty");
  assert.match(document.body.textContent!, /Nothing to show here :\)/);
  assert.ok(document.querySelector("#upcoming-quick-note"), "Quick Note stays available on an empty dashboard");
  await act(async () => root.render(createElement(UpcomingView, { hasNotes: true })));
  assert.equal(document.querySelector(".upcoming-all-empty"), null, "Unopened notes still count as content");
  const faces = [...document.querySelectorAll(".empty-text-art")].map(element => element.textContent);
  assert.equal(faces.length, 3); assert.equal(new Set(faces).size, 3, "Individual empty faces are related but distinct");
  await act(async () => root.render(createElement(UpcomingView, { recentNotes: [note], scheduleItems: [{ time: "23:59", topic: "Late event", date: "2026-10-20" }], priorityTasks: [{ _id: "task", task: "Priority task", priority: "high" }] })));
  assert.equal(document.querySelectorAll(".empty-text-art").length, 0);
  assert.match(document.body.textContent!, /Late event/); assert.match(document.body.textContent!, /Priority task/);
  const { MobileBottomNav } = await server.ssrLoadModule("/src/components/MobileBottomNav.tsx");
  let selected = "";
  await act(async () => root.render(createElement(MobileBottomNav, { activeDestination: "workspace", onNavigate: (value: string) => { selected = value; } })));
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  assert.deepEqual(tabs.map(tab => tab.textContent), ["Assistant", "Dashboard", "Workspace", "Settings"]);
  assert.equal(tabs[2].getAttribute("aria-selected"), "true");
  for (const [index, destination] of ["assistant", "dashboard", "workspace", "settings"].entries()) {
    await act(async () => tabs[index].click()); assert.equal(selected, destination);
  }
  const { WorkspaceView } = await server.ssrLoadModule("/src/components/dashboard/WorkspaceView.tsx");
  await act(async () => root.render(createElement(WorkspaceView, { onNavigate: (value: string) => { selected = value; } })));
  const sections = [...document.querySelectorAll<HTMLButtonElement>(".workspace-hub-card")];
  assert.equal(sections.length, 3);
  for (const [index, destination] of ["schedule", "tasks", "notes"].entries()) {
    await act(async () => sections[index].click()); assert.equal(selected, destination);
  }
  const { DashboardNav } = await server.ssrLoadModule("/src/components/dashboard/DashboardNav.tsx");
  await act(async () => root.render(createElement(DashboardNav, { activeView: "schedule", handleViewChange: (value: string) => { selected = value; } })));
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Home"]')!.click());
  assert.equal(selected, "home");
  const { AndroidAppHeader } = await server.ssrLoadModule("/src/components/AndroidAppHeader.tsx");
  let homeVisits = 0;
  const headerProps = { assistantActive: true, voice: null, onGoHome: () => { homeVisits++; } };
  await act(async () => root.render(createElement(AndroidAppHeader, headerProps)));
  await act(async () => document.querySelector<HTMLButtonElement>(".android-header-home")!.click());
  assert.equal(homeVisits, 1);
  const voice = { voiceModeState: "listening", modelLoadingText: "", voiceModeError: null, voiceModeAudioLevel: .5, isVoiceMuted: false, isLogoCentered: false, onRetry() {} };
  await act(async () => root.render(createElement(AndroidAppHeader, { ...headerProps, voice })));
  assert.match(document.querySelector(".android-app-header")!.textContent!, /Listening/);
  await act(async () => root.render(createElement(AndroidAppHeader, { ...headerProps, voice: { ...voice, isVoiceMuted: true } })));
  assert.match(document.querySelector(".android-app-header")!.textContent!, /Microphone Muted/);
  await act(async () => root.render(createElement(AndroidAppHeader, { ...headerProps, voice: { ...voice, voiceModeState: "thinking" } })));
  assert.match(document.querySelector(".android-app-header")!.textContent!, /Alfred is thinking/);
  await act(async () => root.render(createElement(AndroidAppHeader, { ...headerProps, voice, assistantActive: false })));
  assert.equal(document.querySelector(".chat-voice-header-indicator"), null, "Dashboard header does not show assistant state");
  await act(async () => root.render(createElement(AndroidAppHeader, { ...headerProps, voice: { ...voice, voiceModeState: "off" } })));
  assert.ok(document.querySelector(".android-header-home"), "Brand returns when voice mode ends");
  await act(async () => root.render(createElement("div")));
  const previousBridge = window.AlfredAndroid;
  let viewportRequests = 0;
  window.AlfredAndroid = { onmessage: null, postMessage(raw: string) {
    const request = JSON.parse(raw);
    assert.equal(request.type, "viewport"); viewportRequests++;
    this.onmessage?.({ data: JSON.stringify({ id: request.id, updated: true }) });
  } };
  try {
    await act(async () => root.render(createElement(AndroidAppHeader, headerProps)));
    assert.equal(viewportRequests, 1, "Header requests native insets after the document mounts");
  } finally { window.AlfredAndroid = previousBridge; }
  const { RefreshButton } = await server.ssrLoadModule("/src/components/RefreshButton.tsx");
  const originalAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  try {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Android" });
    await act(async () => root.render(createElement(RefreshButton)));
    assert.equal(document.querySelector(".mobile-account-refresh"), null, "No sync button on Android assistant");
    const { DashboardHeader } = await server.ssrLoadModule("/src/components/dashboard/DashboardHeader.tsx");
    await act(async () => root.render(createElement(DashboardHeader, { activeView: "home", handleViewChange() {}, onRefresh() {} })));
    assert.equal(document.querySelector('button[aria-label="Settings"]'), null, "Android settings live in the navbar");
    assert.ok(document.querySelector(".dashboard-refresh-btn"));
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Windows NT 10.0" });
    await act(async () => root.render(createElement(RefreshButton)));
    assert.ok(document.querySelector(".mobile-account-refresh"), "PC refresh remains available");
  } finally {
    if (originalAgent) Object.defineProperty(navigator, "userAgent", originalAgent); else Reflect.deleteProperty(navigator, "userAgent");
  }
  console.log("PASS: Android header/voice states and button visibility, shared/individual empty states, four mobile destinations, workspace links, Home, collapsed formatting, multiline copy/previews, save-before-back, tutorial return, offline/server recovery, preserved drafts and 404.");
} finally {
  await act(async () => root.unmount()); await server.close(); await dom.happyDOM.abort();
  globalThis.fetch = originalFetch;
  for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
}
