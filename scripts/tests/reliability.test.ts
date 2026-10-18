import assert from "node:assert/strict";
import { test } from "node:test";
import { httpMessage } from "../../src/lib/requestError.ts";
import { sendChatMessage } from "../../src/lib/aiChat.ts";
import { AUTH_STORAGE_KEY } from "../../src/auth/auth.ts";

test("authentication, forbidden, validation, storage, timeout and server errors remain distinct", () => {
  assert.match(httpMessage(401), /continue as a guest/); assert.match(httpMessage(403), /not allowed/);
  assert.match(httpMessage(400), /input/); assert.match(httpMessage(413), /storage/);
  assert.match(httpMessage(504), /timed out/); assert.match(httpMessage(503), /server is unavailable/);
  assert.notEqual(httpMessage(401), httpMessage(503));
});
test("AI quota errors preserve backend window and reset message, with stable retry IDs", async () => {
  const saved = globalThis.fetch;
  const storage = new Map([[AUTH_STORAGE_KEY, JSON.stringify({ token: "fixture", account: { id: "account", type: "guest" } })]]);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { search: "", hash: "", pathname: "/" }, localStorage: { getItem: (key: string) => storage.get(key) ?? null } } });
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null } });
  const keys: string[] = [];
  globalThis.fetch = async (_input, init) => { keys.push(new Headers(init?.headers).get("Idempotency-Key")!); return Response.json({ code: "AI_QUOTA_EXCEEDED", window: "daily", resetAt: "2026-10-18T00:00:00Z", error: "Daily limit reached. Resets 18 October at 00:00 UTC." }, { status: 429 }); };
  try {
    for (let i = 0; i < 2; i++) await assert.rejects(sendChatMessage([{ role: "user", content: "hello" }], undefined, { requestId: "logical-request-1" }), /Daily limit reached.*00:00 UTC/);
    assert.deepEqual(keys, ["logical-request-1", "logical-request-1"]);
  } finally {
    globalThis.fetch = saved;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage); else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
