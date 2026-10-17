import { env } from "../src/config/env.ts";

// Explicit live smoke check: synthetic tone only, no user audio or account mutations.
const bytes = Buffer.alloc(44 + 16000);
bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32);
bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(16000, 40);
for (let i = 0; i < 8000; i++) bytes.writeInt16LE(Math.round(6000 * Math.sin(i * 2 * Math.PI * 440 / 16000)), 44 + 2 * i);
let failed = false;
for (const model of [env.llm.model, ...env.llm.fallbackModels]) {
    try {
        const response = await fetch(`${env.llm.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.llm.apiKey}` },
            body: JSON.stringify({ model, max_tokens: 32, messages: [{ role: "user", content: [
                { type: "text", text: "Briefly describe this sound. Do not use tools." },
                { type: "input_audio", input_audio: { data: bytes.toString("base64"), format: "wav" } },
            ] }] }), signal: AbortSignal.timeout(env.llm.timeoutMs),
        });
        let parsed = false;
        if (response.ok) {
            const data = await response.json() as { choices?: { message?: { content?: string } }[] };
            parsed = typeof data.choices?.[0]?.message?.content === "string" && Boolean(data.choices[0].message.content.trim());
        }
        console.log(JSON.stringify({ model, status: response.status, assistantResponse: parsed }));
        if (!response.ok || !parsed) failed = true;
    } catch (err) { failed = true; console.log(JSON.stringify({ model, error: err instanceof Error ? err.name : "Network failure" })); }
}
if (failed) process.exitCode = 1;
