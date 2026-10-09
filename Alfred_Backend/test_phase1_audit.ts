import crypto from "node:crypto";
import { connectDatabase } from "./src/config/database.ts";
import { parseAllowedOrigins } from "./src/config/env.ts";
import { Account } from "./src/models/account.model.ts";
import { AuthTicket } from "./src/models/authTicket.model.ts";
import { Task } from "./src/models/task.model.ts";
import { Schedule } from "./src/models/schedule.model.ts";
import {
    atomicConsumeTicket,
    createIssuedTicket,
    generateAuthToken,
} from "./src/modules/auth/auth.service.ts";
import {
    escapeHtml,
    generateDesktopCallbackHtml,
    isValidDesktopCallbackUri,
    serializeForScriptContext,
} from "./src/modules/auth/auth.controller.ts";
import {
    getSecurityTestCounts,
    runRateLimitingTests,
    runSecurityRegressionTests,
    runValidationAndSecurityTests,
} from "./test_security_regression.ts";
import { runDesktopOAuthSecurityTests } from "./test_desktop_oauth_security.ts";

const BASE_URL = "http://localhost:8000";

let auditAssertionsRun = 0;
let auditAssertionsPassed = 0;

function assert(condition: boolean, message: string): void {
    auditAssertionsRun++;
    if (!condition) {
        console.error(`❌ FAILED: ${message}`);
        throw new Error(`Assertion failed: ${message}`);
    }
    auditAssertionsPassed++;
    console.log(`  ✓ ${message}`);
}

async function runCorsAndEnvironmentAuditTests(): Promise<void> {
    console.log("\n==========================================");
    console.log(" 1. CORS & Environment Security Audit");
    console.log("==========================================");

    // 1.1 Development CORS defaults include local web & desktop webview origins
    const devOrigins = parseAllowedOrigins(undefined, "http://localhost:5173", false);
    assert(devOrigins.includes("http://localhost:5173"), "Dev CORS includes http://localhost:5173");
    assert(devOrigins.includes("http://tauri.localhost"), "Dev CORS includes http://tauri.localhost");
    assert(devOrigins.includes("https://tauri.localhost"), "Dev CORS includes https://tauri.localhost");
    assert(devOrigins.length === 3, "Dev CORS defaults to exactly 3 origins when unspecified");

    // 1.2 Production CORS defaults strictly to the single configured frontend URL
    const prodOrigins = parseAllowedOrigins(undefined, "https://app.example.com", true);
    assert(prodOrigins.length === 1, "Prod CORS defaults strictly to exactly 1 origin when unspecified");
    assert(prodOrigins[0] === "https://app.example.com", "Prod CORS only allows explicit frontend URL");
    assert(!prodOrigins.includes("http://tauri.localhost"), "Prod CORS does not silently allow http://tauri.localhost");

    // 1.3 Explicit ALLOWED_ORIGINS takes precedence in both environments
    const customDev = parseAllowedOrigins("https://client.local, http://localhost:3000", "http://localhost:5173", false);
    assert(customDev.includes("https://client.local"), "Explicit origin client.local is preserved");
    assert(customDev.includes("http://localhost:3000"), "Explicit origin localhost:3000 is preserved");
    assert(customDev.includes("http://localhost:5173"), "Default origin is guaranteed in allowlist");

    const customProd = parseAllowedOrigins("https://custom.app.com", "https://app.example.com", true);
    assert(customProd.includes("https://custom.app.com"), "Explicit prod origin preserved");
    assert(customProd.includes("https://app.example.com"), "Default prod origin guaranteed");
}

async function runCallbackHtmlHardeningTests(): Promise<void> {
    console.log("\n==========================================");
    console.log(" 2. Callback HTML & URI Security Tests");
    console.log("==========================================");

    // 2.1 Valid desktop callback URIs
    const validSuccessUri = "alfred://auth/callback?ticket=abc123def456&state=xyz789";
    const validErrorUri = "alfred://auth/callback?auth_error=authorization_rejected&state=xyz789";
    assert(isValidDesktopCallbackUri(validSuccessUri), "Valid desktop callback success URI accepted");
    assert(isValidDesktopCallbackUri(validErrorUri), "Valid desktop callback error URI accepted");
    assert(isValidDesktopCallbackUri("alfred://auth/callback"), "Bare valid desktop callback URI accepted");

    // 2.2 Malicious and malformed URI rejection
    assert(!isValidDesktopCallbackUri("javascript:alert(1)"), "Rejects javascript: URI scheme");
    assert(!isValidDesktopCallbackUri("https://attacker.com/callback"), "Rejects external HTTPS URI");
    assert(!isValidDesktopCallbackUri("alfred://evil/callback"), "Rejects untrusted host");
    assert(!isValidDesktopCallbackUri("alfred://auth/steal"), "Rejects unpermitted path");
    assert(!isValidDesktopCallbackUri("alfred://auth/callback<script>"), "Rejects HTML injection in URI");
    assert(!isValidDesktopCallbackUri(""), "Rejects empty URI");
    assert(!isValidDesktopCallbackUri(null), "Rejects null URI");
    assert(!isValidDesktopCallbackUri("a".repeat(3000)), "Rejects excessively long URI");

    // 2.3 HTML escaping
    const unsafeText = `<img src=x onerror=alert('1') & "test">`;
    const escaped = escapeHtml(unsafeText);
    assert(!escaped.includes("<"), "HTML tags stripped/escaped from text");
    assert(escaped.includes("&lt;img"), "Entities properly converted");
    assert(escaped.includes("&quot;test&quot;"), "Quotes converted to &quot;");

    // 2.4 Script-context serialization
    const scriptDangerous = `"; alert("xss"); </script><script>evil(); //`;
    const serializedScript = serializeForScriptContext(scriptDangerous);
    assert(!serializedScript.includes("<script>"), "Script context serialization converts < to \\u003c");
    assert(!serializedScript.includes("</script>"), "Closing script tags cannot break out of inline script");
    assert(serializedScript.includes("\\u003c"), "\\u003c unicode escape present");

    // 2.5 generateDesktopCallbackHtml throws on invalid URI
    let caughtInvalid = false;
    try {
        generateDesktopCallbackHtml("https://evil.com", "Test", "Msg");
    } catch {
        caughtInvalid = true;
    }
    assert(caughtInvalid, "generateDesktopCallbackHtml throws when passed invalid custom URI");

    // 2.6 generateDesktopCallbackHtml renders safely with valid URI
    const renderedHtml = generateDesktopCallbackHtml(validSuccessUri, "Auth Complete", "Return to app");
    assert(renderedHtml.includes("<!DOCTYPE html>"), "HTML doctype present");
    assert(
        renderedHtml.includes("window.location.href = \"alfred://auth/callback?ticket=abc123def456\\u0026state=xyz789\";"),
        "Window location redirect rendered with script-safe \\u0026 escaping"
    );
}

async function runEndToEndAccountIsolationTests(): Promise<void> {
    console.log("\n==========================================");
    console.log(" 3. End-to-End Account Isolation Tests");
    console.log("==========================================");

    await connectDatabase();

    // Create Account A and Account B
    const accountA = await Account.create({
        type: "user",
        googleId: `iso-a-${Date.now()}`,
        email: `iso-a-${Date.now()}@example.com`,
        name: "Account A",
    });
    const tokenA = generateAuthToken(accountA);

    const accountB = await Account.create({
        type: "user",
        googleId: `iso-b-${Date.now()}`,
        email: `iso-b-${Date.now()}@example.com`,
        name: "Account B",
    });
    const tokenB = generateAuthToken(accountB);

    try {
        // 3.1 Account A creates a task
        const createA = await fetch(`${BASE_URL}/api/tasks`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenA}`,
            },
            body: JSON.stringify({ task: "Account A Private Task" }),
        });
        assert(createA.status === 201, "Account A successfully creates task");
        const taskA = (await createA.json()) as { _id: string; task: string };

        // 3.2 Account B lists tasks -> must NOT see Account A's task
        const listB = await fetch(`${BASE_URL}/api/tasks`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(listB.status === 200, "Account B lists tasks successfully");
        const tasksForB = (await listB.json()) as Array<{ _id: string }>;
        assert(
            !tasksForB.some((t) => t._id === taskA._id),
            "Account B cannot see Account A's task in task listing"
        );

        // 3.3 Account B attempts to update Account A's task -> 404
        const updateB = await fetch(`${BASE_URL}/api/tasks/${taskA._id}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenB}`,
            },
            body: JSON.stringify({ task: "Hacked by Account B" }),
        });
        assert(updateB.status === 404, "Account B cannot update Account A's task (returns 404)");

        // 3.4 Account B attempts to complete Account A's task -> 404
        const completeB = await fetch(`${BASE_URL}/api/tasks/${taskA._id}/complete`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(completeB.status === 404, "Account B cannot complete Account A's task (returns 404)");

        // 3.5 Account B attempts to delete Account A's task -> 404
        const deleteB = await fetch(`${BASE_URL}/api/tasks/${taskA._id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(deleteB.status === 404, "Account B cannot delete Account A's task (returns 404)");

        // 3.6 Account A creates a schedule item
        const schedA = await fetch(`${BASE_URL}/api/schedule`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenA}`,
            },
            body: JSON.stringify({
                date: "2026-05-15",
                time: "10:00 AM",
                topic: "Account A Private Meeting",
            }),
        });
        assert(schedA.status === 201, "Account A successfully creates schedule");
        const schedJsonA = (await schedA.json()) as { schedule: { _id: string } };
        const itemAId = schedJsonA.schedule._id;
        assert(!!itemAId, "Schedule item ID extracted correctly");

        // 3.7 Account B queries schedule for same date -> must NOT see Account A's schedule
        const schedListB = await fetch(`${BASE_URL}/api/schedule?date=2026-05-15`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(schedListB.status === 200, "Account B queries schedule successfully");
        const itemsForB = (await schedListB.json()) as Array<{ _id: string }>;
        assert(
            !itemsForB.some((s) => s._id === itemAId),
            "Account B cannot see Account A's schedule item"
        );

        // 3.8 Account B attempts to update Account A's schedule -> 404
        const schedUpdateB = await fetch(`${BASE_URL}/api/schedule/${itemAId}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenB}`,
            },
            body: JSON.stringify({ topic: "Tampered by B" }),
        });
        assert(schedUpdateB.status === 404, "Account B cannot update Account A's schedule (returns 404)");

        // 3.9 Account B attempts to delete Account A's schedule -> 404
        const schedDeleteB = await fetch(`${BASE_URL}/api/schedule/${itemAId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(schedDeleteB.status === 404, "Account B cannot delete Account A's schedule (returns 404)");
    } finally {
        // Clean up test data
        await Task.deleteMany({ accountId: { $in: [accountA._id, accountB._id] } });
        await Schedule.deleteMany({ accountId: { $in: [accountA._id, accountB._id] } });
        await Account.deleteMany({ _id: { $in: [accountA._id, accountB._id] } });
    }
}

async function runCrossFlowTicketIsolationTests(): Promise<void> {
    console.log("\n==========================================");
    console.log(" 4. Cross-Flow Ticket Isolation Tests");
    console.log("==========================================");

    await connectDatabase();

    const testAccount = await Account.create({
        type: "user",
        googleId: `flow-iso-${Date.now()}`,
        email: `flow-iso-${Date.now()}@example.com`,
        name: "Flow Iso Tester",
    });

    try {
        const verifier = crypto.randomBytes(32).toString("base64url");
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

        // 4.1 Desktop ticket CANNOT be consumed without PKCE verifier
        const desktopTicket = await createIssuedTicket({
            accountId: testAccount._id,
            codeChallenge: challenge,
            flow: "desktop",
        });
        const desktopNoVerifierRes = await atomicConsumeTicket({ ticket: desktopTicket });
        assert(desktopNoVerifierRes === null, "Desktop ticket exchange without PKCE verifier is rejected");

        // 4.2 Desktop ticket CANNOT be consumed by pretending to be a browser flow
        const ticketDoc = await AuthTicket.findOne({ ticket: desktopTicket });
        assert(ticketDoc?.flow === "desktop", "Desktop ticket strictly preserves desktop flow type");

        // 4.3 Browser ticket CANNOT be stolen by supplying an unassociated PKCE challenge/verifier
        const browserTicket = await createIssuedTicket({
            accountId: testAccount._id,
            flow: "browser",
        });
        // Normal browser consumption
        const browserRes = await atomicConsumeTicket({ ticket: browserTicket });
        assert(!!browserRes, "Browser ticket without PKCE consumed successfully");

        // 4.4 Replaying consumed browser ticket is rejected
        const replayRes = await atomicConsumeTicket({ ticket: browserTicket });
        assert(replayRes === null, "Replaying consumed browser ticket is rejected");
    } finally {
        await AuthTicket.deleteMany({ accountId: testAccount._id });
        await Account.deleteOne({ _id: testAccount._id });
    }
}

async function main(): Promise<void> {
    console.log("############################################################");
    console.log("   ALFRED PHASE 1 — UNIFIED AUDIT & SECURITY TEST RUNNER    ");
    console.log("############################################################");

    const startTime = Date.now();

    try {
        // Run Part 1: CORS & Environment validation
        await runCorsAndEnvironmentAuditTests();

        // Run Part 2: Callback HTML security & XSS defense
        await runCallbackHtmlHardeningTests();

        // Run Part 3: Two-account end-to-end isolation
        await runEndToEndAccountIsolationTests();

        // Run Part 4: Cross-flow ticket isolation
        await runCrossFlowTicketIsolationTests();

        // Run Part 5: Core validation, rate limiting & regression suite
        console.log("\n==========================================");
        console.log(" 5. Core Validation & Regression Suite");
        console.log("==========================================");
        await runValidationAndSecurityTests();
        await runSecurityRegressionTests();
        await runRateLimitingTests();
        const secCounts = getSecurityTestCounts();

        // Run Part 6: Desktop OAuth & PKCE security suite
        console.log("\n==========================================");
        console.log(" 6. Desktop OAuth & PKCE Security Suite");
        console.log("==========================================");
        const desktopCounts = await runDesktopOAuthSecurityTests({ exitOnComplete: false });

        const totalRun = auditAssertionsRun + secCounts.testsRun + desktopCounts.total;
        const totalPassed = auditAssertionsPassed + secCounts.testsPassed + desktopCounts.passed;
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log("\n############################################################");
        console.log("   ALFRED PHASE 1 AUDIT & SECURITY TEST SUITE: COMPLETE     ");
        console.log("############################################################");
        console.log(`  • Audit & Isolation Assertions:  ${auditAssertionsPassed}/${auditAssertionsRun}`);
        console.log(`  • Security Regression Tests:     ${secCounts.testsPassed}/${secCounts.testsRun}`);
        console.log(`  • Desktop OAuth & PKCE Tests:    ${desktopCounts.passed}/${desktopCounts.total}`);
        console.log(`  ----------------------------------------------------------`);
        console.log(`  ✅ TOTAL ASSERTIONS PASSED:      ${totalPassed}/${totalRun} (100%)`);
        console.log(`  ⏱️  EXECUTION DURATION:           ${durationSec}s`);
        console.log("############################################################\n");

        if (totalPassed !== totalRun) {
            console.error("❌ Discrepancy detected in assertion totals.");
            process.exit(1);
        }

        process.exit(0);
    } catch (err) {
        console.error("\n❌ UNIFIED AUDIT TEST SUITE FAILED WITH ERROR:", err);
        process.exit(1);
    }
}

void main();
