import express from "express";
import type { Request, Response, NextFunction } from "express";
import { chatRequestSchema } from "./ai.schema.ts";
import { requireAccountId } from "../../utils/requireAccountId.ts";
import { generateChatCompletion, AiServiceError } from "./service.ts";

export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
export const audioBodyParser = express.raw({ type: "multipart/form-data", limit: MAX_AUDIO_BYTES + 65536 });

/** Accept only our bounded PCM16 WAV encoding, validating actual bytes rather than filename. */
export function validateWav(bytes: Buffer, mime: string): void {
    if (mime !== "audio/wav") throw new AiServiceError(415, "Unsupported audio format. Use WAV audio.");
    if (bytes.length > MAX_AUDIO_BYTES) throw new AiServiceError(413, "Recording is too large.");
    if (bytes.length <= 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 16) !== "WAVEfmt " ||
        bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1 ||
        bytes.readUInt16LE(34) !== 16 || bytes.toString("ascii", 36, 40) !== "data" || bytes.readUInt32LE(40) !== bytes.length - 44) {
        throw new AiServiceError(400, "Invalid or empty WAV recording.");
    }
    const channels = bytes.readUInt16LE(22), rate = bytes.readUInt32LE(24), align = channels * 2;
    if (channels < 1 || channels > 2 || rate < 8000 || rate > 96000 || bytes.readUInt16LE(32) !== align ||
        bytes.readUInt32LE(28) !== rate * align || (bytes.length - 44) % align ||
        (bytes.length - 44) / (rate * align) < .25 || (bytes.length - 44) / (rate * align) > 60.5) {
        throw new AiServiceError(400, "Invalid recording duration or encoding.");
    }
    let audible = false;
    for (let i = 44; i < bytes.length; i += 2) if (Math.abs(bytes.readInt16LE(i)) > 98) { audible = true; break; }
    if (!audible) throw new AiServiceError(400, "Recording contains no audible speech.");
}

export async function audioCompletionHandler(req: Request, res: Response): Promise<void> {
    const accountId = requireAccountId(req, res);
    if (!accountId) return;
    try {
        if (!Buffer.isBuffer(req.body)) throw new AiServiceError(415, "Expected a multipart audio request.");
        let form: FormData;
        try {
            form = await new Request("http://localhost/audio", { method: "POST", headers: { "Content-Type": req.headers["content-type"] ?? "" }, body: new Uint8Array(req.body) }).formData();
        } catch { throw new AiServiceError(400, "Malformed audio upload."); }
        if ([...form.keys()].some((key) => key !== "audio" && key !== "context" && !/^audio-\d+$/.test(key)) || form.getAll("audio").length > 1 || form.getAll("context").length !== 1) throw new AiServiceError(400, "Invalid audio fields.");
        const audio = form.get("audio"), context = form.get("context");
        if ((audio !== null && !(audio instanceof Blob)) || typeof context !== "string" || context.length > 60000) throw new AiServiceError(400, "Missing audio or conversation context.");
        let parsed: unknown;
        try { parsed = JSON.parse(context); } catch { throw new AiServiceError(400, "Invalid conversation context."); }
        const validated = chatRequestSchema.safeParse(parsed);
        if (!validated.success || !validated.data.messages) throw new AiServiceError(400, "Invalid conversation context.");
        const attachments: Array<{ index: number; bytes: Buffer }> = [];
        let totalBytes = 0;
        for (const [key, value] of form.entries()) {
            if (key === "context") continue;
            const index = key === "audio" ? validated.data.messages.length - 1 : Number(key.slice(6));
            if (!(value instanceof Blob) || !validated.data.messages[index] || validated.data.messages[index]?.role !== "user" || attachments.some((entry) => entry.index === index)) throw new AiServiceError(400, "Invalid audio message association.");
            const bytes = Buffer.from(await value.arrayBuffer());
            totalBytes += bytes.length;
            if (totalBytes > MAX_AUDIO_BYTES) throw new AiServiceError(413, "Recording is too large.");
            validateWav(bytes, value.type);
            attachments.push({ index, bytes });
        }
        if (!attachments.length) throw new AiServiceError(400, "Missing audio recording.");
        const result = await generateChatCompletion(validated.data.messages, accountId, undefined, attachments.map(({ index, bytes }) => ({ index, data: bytes.toString("base64"), format: "wav" })));
        res.json(result);
    } catch (err) {
        if (err instanceof AiServiceError) { res.status(err.statusCode).json({ error: err.publicMessage }); return; }
        res.status(500).json({ error: "An unexpected error occurred processing audio." });
    }
}

export function audioBodyError(err: { type?: string }, _req: Request, res: Response, next: NextFunction): void {
    if (err.type === "entity.too.large") { res.status(413).json({ error: "Recording is too large." }); return; }
    next(err);
}
