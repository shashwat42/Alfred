import assert from "node:assert/strict";
import { test } from "node:test";

// Import configuration only after supplying isolated non-secret test settings.
for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL", "MONGODB_URI", "JWT_SECRET"]) process.env[key] = "unit-test";
process.env.LLM_API_KEY = "unit-test";
process.env.LLM_MODEL = "gemini-3.5-flash-lite";
process.env.LLM_FALLBACK_MODELS = "gemini-3.1-flash-lite";
const { env } = await import("../../config/env.ts");
const { generateChatCompletion, initializeAiService } = await import("./service.ts");
const { validateWav, MAX_AUDIO_BYTES } = await import("./audio.ts");
const { pcmToWav } = await import("../../../../src/lib/audio.ts");

const primary = "gemini-3.5-flash-lite", fallback = "gemini-3.1-flash-lite";
const messages = [{ role: "user" as const, content: "hello" }];
const audio = { data: "original-audio-base64", format: "wav" as const };
const success = () => Response.json({ choices: [{ message: { content: "answer" }, finish_reason: "stop" }], usage: { total_tokens: 9 } });

for (const mode of ["text", "audio"]) {
  test(`${mode}: primary success makes one request with the existing endpoint/response contract`, async () => {
    const saved = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++; assert.equal(String(url), `${env.llm.baseUrl.replace(/\/+$/, "")}/chat/completions`);
      const payload = JSON.parse(String(init?.body)); assert.equal(payload.model, primary);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer unit-test");
      if (mode === "audio") assert.deepEqual(payload.messages.at(-1).content[1], { type: "input_audio", input_audio: audio });
      else assert.equal(payload.messages.at(-1).content, "hello");
      return success();
    };
    try {
      const result = await generateChatCompletion(messages, undefined, mode === "audio" ? audio : undefined);
      assert.equal(calls, 1); assert.equal(result.message.content, "answer"); assert.equal(result.model, primary); assert.equal(result.usage?.totalTokens, 9);
    } finally { globalThis.fetch = saved; }
  });

  for (const status of [400, 401, 402, 404, 429, 500, 503]) test(`${mode}: HTTP ${status} retains existing mapped-error fallback eligibility`, async () => {
    const saved = globalThis.fetch; const models: string[] = []; const contents: unknown[] = [];
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body)); models.push(payload.model); contents.push(payload.messages);
      return models.length === 1 ? new Response("", { status }) : success();
    };
    try {
      await generateChatCompletion(messages, undefined, mode === "audio" ? audio : undefined);
      assert.deepEqual(models, [primary, fallback]); assert.deepEqual(contents[0], contents[1]);
      await generateChatCompletion(messages); assert.equal(models[2], primary);
    } finally { globalThis.fetch = saved; }
  });
}

test("timeouts/network errors fall back once; missing config and missing-message responses do not", async () => {
  const saved = globalThis.fetch;
  try {
    for (const failure of [new DOMException("deadline", "TimeoutError"), new TypeError("offline")]) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw failure; };
      await assert.rejects(generateChatCompletion(messages, undefined, audio)); assert.equal(calls, 2);
    }
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ choices: [{}] }); };
    await assert.rejects(generateChatCompletion(messages), /Missing message/); assert.equal(calls, 1);
    const key = env.llm.apiKey; env.llm.apiKey = "";
    try { await assert.rejects(generateChatCompletion(messages), /not configured/); assert.equal(calls, 1); } finally { env.llm.apiKey = key; }
  } finally { globalThis.fetch = saved; }
});

test("startup health probing cannot promote fallback ahead of configured primary", async () => {
  const saved = globalThis.fetch; const models: string[] = [];
  globalThis.fetch = async (_url, init) => { const model = JSON.parse(String(init?.body)).model; models.push(model); return models.length === 1 ? new Response("", { status: 503 }) : success(); };
  try { await initializeAiService(); await generateChatCompletion(messages); assert.deepEqual(models, [primary, fallback, primary]); }
  finally { globalThis.fetch = saved; }
});

test("audio validation rejects spoofing, malformed, empty, silent, oversized and over-duration recordings", async () => {
  const pcm = new Uint8Array(16000); pcm[1] = 127;
  const wav = Buffer.from(await pcmToWav(pcm, 16000).arrayBuffer());
  validateWav(wav, "audio/wav");
  assert.throws(() => validateWav(wav, "audio/webm"), /Unsupported/);
  assert.throws(() => validateWav(Buffer.from("not audio"), "audio/wav"), /Invalid/);
  assert.throws(() => validateWav(Buffer.alloc(44), "audio/wav"), /Invalid/);
  assert.throws(() => validateWav(Buffer.alloc(MAX_AUDIO_BYTES + 1), "audio/wav"), /large/);
  const silent = Buffer.from(wav); silent.fill(0, 44); assert.throws(() => validateWav(silent, "audio/wav"), /audible/);
  const broken = Buffer.from(wav); broken.writeUInt32LE(1, 24); assert.throws(() => validateWav(broken, "audio/wav"), /encoding/);
});

test("authenticated multipart route validates uploads, preserves account scope and never forwards client account fields", async () => {
  const { default: express } = await import("express");
  const { default: router } = await import("./route.ts");
  const { default: jwt } = await import("jsonwebtoken");
  const { Account } = await import("../../models/account.model.ts");
  const saved = globalThis.fetch, lookup = Account.findById;
  const accountId = "507f1f77bcf86cd799439011";
  const lookedUp: unknown[] = [];
  Account.findById = ((id: unknown) => { lookedUp.push(id); return Promise.resolve({ _id: accountId, type: "user", googleId: "test-google" }); }) as unknown as typeof lookup;
  let upstream = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("http://127.0.0.1:")) return saved(url, init);
    upstream++;
    const payload = JSON.parse(String(init?.body)); assert.ok(payload.tools?.length);
    assert.ok(payload.messages.some((message: { content: unknown }) => Array.isArray(message.content) && message.content[1]?.input_audio?.format === "wav"));
    return success();
  };
  const app = express(); app.use("/api/ai", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/ai/chat/audio`;
  const token = jwt.sign({ sub: accountId, type: "user" }, env.jwt.secret, { expiresIn: "1h", issuer: "alfred", audience: "alfred-api" });
  const pcm = new Uint8Array(16000); pcm[1] = 127;
  const upload = (context: unknown = { messages }, blob = pcmToWav(pcm, 16000)) => { const form = new FormData(); form.set("audio", blob, "voice.wav"); form.set("context", JSON.stringify(context)); return form; };
  try {
    assert.equal((await fetch(url, { method: "POST", body: upload() })).status, 401);
    assert.equal(upstream, 0); assert.equal(lookedUp.length, 0);
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(url, { method: "POST", headers, body: upload() })).status, 200);
    assert.deepEqual(lookedUp, [accountId]); assert.equal(upstream, 1);
    const followUp = new FormData();
    followUp.set("context", JSON.stringify({ messages: [...messages, { role: "assistant", content: "answer" }, { role: "user", content: "What did I ask?" }] }));
    followUp.set("audio-0", pcmToWav(pcm, 16000), "voice.wav");
    assert.equal((await fetch(url, { method: "POST", headers, body: followUp })).status, 200);
    assert.equal((await fetch(url, { method: "POST", headers, body: upload({ messages, accountId: "other-account" }) })).status, 400);
    assert.equal((await fetch(url, { method: "POST", headers, body: upload({ messages }, new Blob(["fake"], { type: "audio/wav" })) })).status, 400);
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "multipart/form-data; boundary=bad" }, body: "broken" })).status, 400);
    assert.equal(upstream, 2);
  } finally {
    globalThis.fetch = saved; Account.findById = lookup;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
