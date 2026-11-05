import "./testEnvironment.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import cors from "cors";
import { parseAllowedOrigins } from "../config/env.ts";

test("packaged Linux requests pass CORS with default and explicitly configured production origins", () => {
    for (const configured of [undefined, "https://web.example"]) {
        const origins = parseAllowedOrigins(configured, "https://web.example", true);
        const middleware = cors({ origin: origins });
        for (const origin of ["tauri://localhost", "http://tauri.localhost", "https://web.example", "tauri://evil", "tauri://localhost.evil", "null"]) {
            const headers = new Map<string, string>();
            let continued = false;
            middleware({ method: "GET", headers: { origin } } as never, {
                getHeader: (name: string) => headers.get(name),
                setHeader: (name: string, value: string) => headers.set(name, value),
            } as never, () => { continued = true; });
            assert.equal(continued, true);
            assert.equal(headers.get("Access-Control-Allow-Origin"), origins.includes(origin) ? origin : undefined);
        }
    }
});
