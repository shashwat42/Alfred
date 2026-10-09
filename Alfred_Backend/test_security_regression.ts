import http from "node:http";
import express from "express";
import rateLimit, { MemoryStore } from "express-rate-limit";
import {
    guestRateLimiter,
    authRateLimiter,
    apiRateLimiter,
    resetRateLimitStores,
} from "./src/middleware/rateLimit.middleware.ts";
import {
    createHandoffTicket,
    consumeHandoffTicket,
    type AuthSessionResponse,
} from "./src/modules/auth/auth.service.ts";

const BASE_URL = "http://localhost:8000";

let testsRun = 0;
let testsPassed = 0;

function assert(condition: boolean, message: string): void {
    testsRun++;
    if (!condition) {
        console.error(`❌ FAILED: ${message}`);
        throw new Error(`Assertion failed: ${message}`);
    }
    testsPassed++;
    console.log(`  ✓ ${message}`);
}

async function runValidationAndSecurityTests(): Promise<void> {
    console.log("\n--- 1. Validation & Input Hardening Tests ---");

    // 1.1 Server-generated Guest Session
    const guestRes = await fetch(`${BASE_URL}/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
    });
    assert(guestRes.status === 201, "Guest creation with empty body returns 201");
    const guestData = (await guestRes.json()) as AuthSessionResponse;
    assert(!!guestData.token, "Guest session returns JWT token");
    assert(guestData.account.type === "guest", "Account type is guest");
    assert(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            guestData.account.guestId || ""
        ),
        "Guest ID is a server-generated UUID"
    );
    const token = guestData.token;

    // 1.2 Reject client-supplied guest IDs or extra parameters
    const malformedGuestRes = await fetch(`${BASE_URL}/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: "injected-custom-id", role: "admin" }),
    });
    assert(
        malformedGuestRes.status === 400,
        "POST /auth/guest rejects client-supplied identifiers with HTTP 400"
    );
    const malformedGuestBody = (await malformedGuestRes.json()) as { error?: string; details?: unknown[] };
    assert(!!malformedGuestBody.error, "Rejection returns error message");
    assert(Array.isArray(malformedGuestBody.details), "Rejection returns details array");

    // 1.3 Reject ticket exchange with empty/missing ticket
    const malformedExchangeRes = await fetch(`${BASE_URL}/auth/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
    });
    assert(
        malformedExchangeRes.status === 400,
        "POST /auth/exchange rejects missing ticket with HTTP 400"
    );

    const extraFieldExchangeRes = await fetch(`${BASE_URL}/auth/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: "abc", extra: "forbidden" }),
    });
    assert(
        extraFieldExchangeRes.status === 400,
        "POST /auth/exchange rejects unexpected fields with HTTP 400"
    );

    // 1.4 Valid Task Creation
    const validTaskRes = await fetch(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ task: "Write regression test suite" }),
    });
    assert(validTaskRes.status === 201, "POST /api/tasks with valid input returns 201");
    const createdTask = (await validTaskRes.json()) as { _id: string; task: string; completed: boolean };
    assert(createdTask.task === "Write regression test suite", "Task payload saved correctly");
    assert(createdTask.completed === false, "Task completed defaults to false");

    // 1.5 Task Missing Required Field
    const missingTaskRes = await fetch(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
    });
    assert(
        missingTaskRes.status === 400,
        "POST /api/tasks with missing required task field returns 400"
    );

    // 1.6 Task Invalid Type
    const invalidTypeTaskRes = await fetch(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ task: 12345 }),
    });
    assert(
        invalidTypeTaskRes.status === 400,
        "POST /api/tasks with non-string task field returns 400"
    );

    // 1.7 Task Unexpected Fields
    const unexpectedFieldTaskRes = await fetch(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ task: "Clean task", malicious: true }),
    });
    assert(
        unexpectedFieldTaskRes.status === 400,
        "POST /api/tasks with unexpected fields returns 400"
    );

    // 1.8 Task Query Parameter Pollution Protection
    const taskPollutedQueryRes = await fetch(`${BASE_URL}/api/tasks?unexpectedParam=test`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    assert(
        taskPollutedQueryRes.status === 400,
        "GET /api/tasks rejects unexpected query parameters with 400"
    );

    // 1.9 Malformed Task ID Parameter
    const malformedIdRes = await fetch(`${BASE_URL}/api/tasks/not-an-objectid/complete`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ completed: true }),
    });
    assert(
        malformedIdRes.status === 400,
        "PATCH /api/tasks/:id with malformed ObjectId returns 400"
    );

    // 1.10 Valid Task Update & Completion
    const completeTaskRes = await fetch(`${BASE_URL}/api/tasks/${createdTask._id}/complete`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ completed: true }),
    });
    assert(
        completeTaskRes.status === 200,
        "PATCH /api/tasks/:id/complete with valid ID returns 200"
    );

    // 1.11 Critical Date Validation Checks (Schedule)
    // 2026-02-28: Valid regular date
    const validFeb28Res = await fetch(`${BASE_URL}/api/schedule`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            schedule: {
                time: "10:00 AM",
                topic: "Valid Feb 28 Meeting",
                date: "2026-02-28",
            },
        }),
    });
    assert(validFeb28Res.status === 201, "POST /api/schedule with valid 2026-02-28 returns 201");
    const feb28Item = (await validFeb28Res.json()) as { schedule: { _id: string } };

    // 2024-02-29: Valid leap day
    const validLeapRes = await fetch(`${BASE_URL}/api/schedule`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            schedule: {
                time: "11:00 AM",
                topic: "Valid Leap Day Meeting",
                date: "2024-02-29",
            },
        }),
    });
    assert(validLeapRes.status === 201, "POST /api/schedule with valid leap day 2024-02-29 returns 201");
    const leapItem = (await validLeapRes.json()) as { schedule: { _id: string } };

    // 2026-02-29: Invalid leap day in non-leap year 2026
    const invalidLeapRes = await fetch(`${BASE_URL}/api/schedule`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            schedule: {
                time: "11:00 AM",
                topic: "Impossible Leap Meeting",
                date: "2026-02-29",
            },
        }),
    });
    assert(invalidLeapRes.status === 400, "POST /api/schedule with impossible leap day 2026-02-29 returns 400");

    // 2026-02-30: Impossible day
    const impossibleFeb30Res = await fetch(`${BASE_URL}/api/schedule`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            schedule: {
                time: "11:00 AM",
                topic: "Impossible Feb 30",
                date: "2026-02-30",
            },
        }),
    });
    assert(impossibleFeb30Res.status === 400, "POST /api/schedule with impossible 2026-02-30 returns 400");

    // 2026-13-01: Impossible month (13)
    const impossibleMonthRes = await fetch(`${BASE_URL}/api/schedule`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            schedule: {
                time: "11:00 AM",
                topic: "Impossible Month",
                date: "2026-13-01",
            },
        }),
    });
    assert(impossibleMonthRes.status === 400, "POST /api/schedule with impossible month 2026-13-01 returns 400");

    // 2026-00-10: Impossible month (00)
    const zeroMonthRes = await fetch(`${BASE_URL}/api/schedule`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            schedule: {
                time: "11:00 AM",
                topic: "Impossible Month 00",
                date: "2026-00-10",
            },
        }),
    });
    assert(zeroMonthRes.status === 400, "POST /api/schedule with impossible month 2026-00-10 returns 400");

    // 2026-04-31: Impossible 31st April
    const april31Res = await fetch(`${BASE_URL}/api/schedule`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            schedule: {
                time: "11:00 AM",
                topic: "Impossible April 31",
                date: "2026-04-31",
            },
        }),
    });
    assert(april31Res.status === 400, "POST /api/schedule with impossible day 2026-04-31 returns 400");

    // 1.12 Unexpected fields rejection in schedule (both top-level and nested)
    const extraNestedScheduleRes = await fetch(`${BASE_URL}/api/schedule`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            schedule: {
                time: "10:00 AM",
                topic: "Meeting",
                date: "2026-02-28",
                extraInner: "forbidden",
            },
        }),
    });
    assert(extraNestedScheduleRes.status === 400, "POST /api/schedule rejects extra fields inside schedule wrapper");

    const extraTopLevelScheduleRes = await fetch(`${BASE_URL}/api/schedule`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            schedule: {
                time: "10:00 AM",
                topic: "Meeting",
                date: "2026-02-28",
            },
            extraTopLevel: "forbidden",
        }),
    });
    assert(extraTopLevelScheduleRes.status === 400, "POST /api/schedule rejects extra fields outside schedule wrapper");

    // 1.13 Schedule Query Parameter Validation
    const invalidQueryRes = await fetch(`${BASE_URL}/api/schedule?date=2026-02-30`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    assert(
        invalidQueryRes.status === 400,
        "GET /api/schedule?date=2026-02-30 (impossible date) returns 400"
    );

    const validQueryRes = await fetch(`${BASE_URL}/api/schedule?date=2026-02-28`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    assert(
        validQueryRes.status === 200,
        "GET /api/schedule?date=2026-02-28 returns 200"
    );

    // Cleanup created test items
    await fetch(`${BASE_URL}/api/tasks/${createdTask._id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    await fetch(`${BASE_URL}/api/schedule/${feb28Item.schedule._id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    await fetch(`${BASE_URL}/api/schedule/${leapItem.schedule._id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
}

async function runSecurityRegressionTests(): Promise<void> {
    console.log("\n--- 2. Security & Account Isolation Tests ---");

    // 2.1 Unauthorized Request Rejection
    const unauthRes = await fetch(`${BASE_URL}/api/tasks`);
    assert(unauthRes.status === 401, "GET /api/tasks without token returns 401");

    const invalidTokenRes = await fetch(`${BASE_URL}/api/tasks`, {
        headers: { Authorization: "Bearer invalid.jwt.token" },
    });
    assert(invalidTokenRes.status === 401, "GET /api/tasks with bogus token returns 401");

    // 2.2 Account Isolation
    // Account A creates a confidential task
    const userARes = await fetch(`${BASE_URL}/auth/guest`, { method: "POST" });
    const userA = (await userARes.json()) as AuthSessionResponse;
    const taskARes = await fetch(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ task: "Account A Confidential Item" }),
    });
    const taskA = (await taskARes.json()) as { _id: string };

    // Account B creates a separate session
    const userBRes = await fetch(`${BASE_URL}/auth/guest`, { method: "POST" });
    const userB = (await userBRes.json()) as AuthSessionResponse;

    // Account B lists tasks -> must NOT see Account A's task
    const userBTasksRes = await fetch(`${BASE_URL}/api/tasks`, {
        headers: { Authorization: `Bearer ${userB.token}` },
    });
    const userBTasks = (await userBTasksRes.json()) as Array<{ _id: string; task: string }>;
    const foundTaskA = userBTasks.some((t) => t._id === taskA._id);
    assert(!foundTaskA, "Account B cannot see Account A tasks");

    // Account B tries to update Account A's task -> returns 404
    const crossUpdateRes = await fetch(`${BASE_URL}/api/tasks/${taskA._id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userB.token}`,
        },
        body: JSON.stringify({ task: "Hacked by Account B" }),
    });
    assert(
        crossUpdateRes.status === 404,
        "Account B cannot update Account A task (returns 404)"
    );

    // Account B tries to delete Account A's task -> returns 404
    const crossDeleteRes = await fetch(`${BASE_URL}/api/tasks/${taskA._id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${userB.token}` },
    });
    assert(
        crossDeleteRes.status === 404,
        "Account B cannot delete Account A task (returns 404)"
    );

    // Cleanup Account A
    await fetch(`${BASE_URL}/api/tasks/${taskA._id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${userA.token}` },
    });

    // 2.3 OAuth Ticket Mechanics (Single-Use & In-Memory Store)
    const mockSession: AuthSessionResponse = {
        token: "mock-token",
        account: {
            id: "6ac8aad4e3939d3bc15dffcc",
            type: "user",
            email: "test@example.com",
            createdAt: new Date(),
        },
    };
    const ticket = createHandoffTicket(mockSession);
    assert(typeof ticket === "string" && ticket.length === 64, "Handoff ticket is 64-char hex string");

    // First consumption succeeds
    const consumedFirst = consumeHandoffTicket(ticket);
    assert(consumedFirst?.token === "mock-token", "First ticket consumption succeeds");

    // Duplicate consumption within grace window succeeds (tolerates StrictMode)
    const consumedSecond = consumeHandoffTicket(ticket);
    assert(consumedSecond?.token === "mock-token", "Duplicate consumption within grace period succeeds");

    // Invalid ticket consumption fails
    const invalidTicket = consumeHandoffTicket("non-existent-ticket");
    assert(invalidTicket === null, "Non-existent ticket returns null");
}

async function runRateLimitingTests(): Promise<void> {
    console.log("\n--- 3. Rate Limiting Tests ---");

    // Setup an ephemeral Express instance using the exact same rate limiter policies
    const testApp = express();
    testApp.use(express.json());

    // Health endpoint without rate limiting
    testApp.get("/health", (_req, res) => res.json({ status: "ok" }));

    // Routes with specific rate limiters
    testApp.post("/guest", guestRateLimiter, (_req, res) => res.json({ ok: true }));
    testApp.post("/auth", authRateLimiter, (_req, res) => res.json({ ok: true }));
    testApp.get("/api", apiRateLimiter, (_req, res) => res.json({ ok: true }));

    // Dedicated mini limiters to verify custom lower thresholds independently
    const dedicatedAuthStore = new MemoryStore();
    const testAuthLimiter = rateLimit({
        windowMs: 60000,
        limit: 3,
        store: dedicatedAuthStore,
        handler: (_req, res) => res.status(429).json({ error: "Auth limit exceeded", retryAfter: 60 }),
    });
    testApp.post("/custom-auth", testAuthLimiter, (_req, res) => res.json({ ok: true }));

    const dedicatedApiStore = new MemoryStore();
    const testApiLimiter = rateLimit({
        windowMs: 60000,
        limit: 5,
        store: dedicatedApiStore,
        handler: (_req, res) => res.status(429).json({ error: "API limit exceeded", retryAfter: 60 }),
    });
    testApp.get("/custom-api", testApiLimiter, (_req, res) => res.json({ ok: true }));

    const server = http.createServer(testApp);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const testUrl = `http://127.0.0.1:${port}`;

    try {
        // 3.1 Health check is never blocked
        const healthRes = await fetch(`${testUrl}/health`);
        assert(healthRes.status === 200, "Health check endpoint returns 200 without rate limit");

        // 3.2 Reset store isolation
        resetRateLimitStores();

        // 3.3 Guest Rate Limiter threshold test (limit = 10)
        console.log("  Testing guest rate limit threshold (10 reqs)...");
        for (let i = 0; i < 10; i++) {
            const res = await fetch(`${testUrl}/guest`, { method: "POST" });
            assert(res.status === 200, `Guest request #${i + 1} succeeds (below limit)`);
        }

        // 11th request must receive HTTP 429
        const blockedGuestRes = await fetch(`${testUrl}/guest`, { method: "POST" });
        assert(blockedGuestRes.status === 429, "Guest request beyond threshold returns 429");
        const blockedGuestBody = (await blockedGuestRes.json()) as { error?: string; retryAfter?: number };
        assert(
            blockedGuestBody.error === "Too many guest accounts created. Please try again later.",
            "Rate limited response includes friendly error message"
        );
        assert(
            typeof blockedGuestBody.retryAfter === "number" && blockedGuestBody.retryAfter > 0,
            "Rate limited response includes retryAfter seconds"
        );

        // Verify health check is still 200 even after guest rate limit was hit
        const healthAfter429 = await fetch(`${testUrl}/health`);
        assert(healthAfter429.status === 200, "Health check remains 200 even after rate limit triggered");

        // 3.4 Rate Limit Reset isolation
        resetRateLimitStores();
        const postResetRes = await fetch(`${testUrl}/guest`, { method: "POST" });
        assert(postResetRes.status === 200, "Resetting store permits requests again immediately");

        // 3.5 Auth Rate Limiter threshold test
        console.log("  Testing auth rate limit threshold...");
        for (let i = 0; i < 3; i++) {
            const res = await fetch(`${testUrl}/custom-auth`, { method: "POST" });
            assert(res.status === 200, `Auth request #${i + 1} succeeds below threshold`);
        }
        const blockedAuthRes = await fetch(`${testUrl}/custom-auth`, { method: "POST" });
        assert(blockedAuthRes.status === 429, "Auth request exceeding threshold returns 429");

        // 3.6 API Rate Limiter threshold test
        console.log("  Testing API rate limit threshold...");
        for (let i = 0; i < 5; i++) {
            const res = await fetch(`${testUrl}/custom-api`);
            assert(res.status === 200, `API request #${i + 1} succeeds below threshold`);
        }
        const blockedApiRes = await fetch(`${testUrl}/custom-api`);
        assert(blockedApiRes.status === 429, "API request exceeding threshold returns 429");
    } finally {
        server.close();
        resetRateLimitStores();
    }
}

async function main(): Promise<void> {
    console.log("==========================================");
    console.log(" Alfred Backend Security & Validation Test");
    console.log("==========================================");

    try {
        await runValidationAndSecurityTests();
        await runSecurityRegressionTests();
        await runRateLimitingTests();

        console.log("\n==========================================");
        console.log(`✅ All tests passed! (${testsPassed}/${testsRun} assertions)`);
        console.log("==========================================");
    } catch (err) {
        console.error("\n❌ Test suite failed:", err);
        process.exit(1);
    }
}

export function getSecurityTestCounts(): { testsRun: number; testsPassed: number } {
    return { testsRun, testsPassed };
}

export {
    runValidationAndSecurityTests,
    runSecurityRegressionTests,
    runRateLimitingTests,
};

if (process.argv[1]?.includes("test_security_regression")) {
    void main();
}
