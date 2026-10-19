import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";

const folder = new URL("../Alfred_Backend/src/modules/monitor/public/", import.meta.url);
const dom = new Window({ url: "http://localhost/monitor" });
const page = await readFile(new URL("index.html", folder), "utf8");
dom.document.write(page.replace(/<script[^>]+><\/script>/, "").replace(/<link[^>]+>/, ""));
let hidden = false, signedIn = false, unavailable = false, requests = 0;
Object.defineProperty(dom.document, "hidden", { get: () => hidden });
const scheduled = new Map<number, () => void>();
const nativeTimeout = dom.setTimeout.bind(dom);
const nativeClear = dom.clearTimeout.bind(dom);
let timer = 100_000;
dom.setTimeout = ((callback: () => void, delay: number) => {
    if (delay === 30000) { scheduled.set(++timer, callback); return timer; }
    return nativeTimeout(callback, delay);
}) as typeof dom.setTimeout;
dom.clearTimeout = ((id: number) => { scheduled.delete(id); nativeClear(id); }) as typeof dom.clearTimeout;
const fixture = {
    sampledAt: new Date().toISOString(), mode: "development", backend: { status: "healthy" },
    server: { process: { rssBytes: 80_000_000, heapUsedBytes: 20_000_000, heapTotalBytes: 30_000_000, uptimeSeconds: 900, cpuSeconds: 3 },
        host: { totalMemoryBytes: 1_000_000_000, freeMemoryBytes: 400_000_000, loadAverage: [0.1, 0.2, 0.3], logicalCpus: 1 },
        container: { memoryBytes: 90_000_000, memoryLimitBytes: null }, filesystem: { usedBytes: 1_000_000, availableBytes: 5_000_000, totalBytes: 6_000_000 } },
    traffic: { activeAccounts5m: 4, accountsMakingRequests: 1, inFlight: 2, previousMinute: { requests: 20, errors: 0, averageLatencyMs: 25 } },
    atlas: { status: "unavailable", detail: "Permission denied" },
    services: { ai: { status: "configured", detail: "No paid probes", lastRequest: null }, google: { status: "reachable", latencyMs: 10 } },
};
dom.fetch = (async (url: string) => {
    requests++;
    const path = String(url).split("/").at(-1);
    if (path === "auth-state") return new dom.Response(JSON.stringify({ verified: true }));
    if (path === "password") { signedIn = true; return new dom.Response('{"ok":true}'); }
    if (path === "logout") { signedIn = false; return new dom.Response('{"ok":true}'); }
    if (path === "metrics") return new dom.Response(JSON.stringify(signedIn ? fixture : { error: "Sign in" }), { status: unavailable ? 503 : signedIn ? 200 : 401 });
    throw new Error(`Unexpected URL ${url}`);
}) as typeof dom.fetch;
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
try {
    dom.eval(await readFile(new URL("app.js", folder), "utf8")); await settle();
    assert.equal(dom.document.querySelector<HTMLElement>("#login")!.hidden, false);
    assert.match(dom.document.querySelector("#submit")!.textContent!, /Set password/);
    assert.equal(scheduled.size, 0, "login page must not poll");
    dom.document.querySelector<HTMLInputElement>("#password")!.value = "fixture-owner-password";
    dom.document.querySelector("form")!.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true })); await settle();
    assert.equal(dom.document.querySelector<HTMLElement>("#dashboard")!.hidden, false);
    assert.equal(dom.document.querySelectorAll(".card").length, 9);
    assert.match(dom.document.body.textContent!, /Permission denied/);
    assert.equal(scheduled.size, 1);
    hidden = true; dom.document.dispatchEvent(new dom.Event("visibilitychange")); await settle();
    assert.equal(scheduled.size, 0, "hidden dashboard must stop polling");
    const previous = requests; await settle(); assert.equal(requests, previous);
    hidden = false; dom.document.dispatchEvent(new dom.Event("visibilitychange")); await settle();
    assert.equal(scheduled.size, 1); assert.ok(requests > previous);
    unavailable = true; dom.document.querySelector<HTMLButtonElement>("#refresh")!.click(); await settle();
    assert.match(dom.document.querySelector("#notice")!.textContent!, /stale/);
    unavailable = false; dom.document.querySelector<HTMLButtonElement>("#logout")!.click(); await settle();
    assert.equal(scheduled.size, 0); assert.equal(dom.document.querySelector<HTMLElement>("#dashboard")!.hidden, true);
    console.log("PASS: first-password form, metric rendering, unavailable Atlas, stale failures, foreground refresh, hidden-tab suspension and logout.");
} finally { await dom.happyDOM.close(); }
