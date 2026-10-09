import crypto from "node:crypto";
import { connectDatabase } from "./src/config/database.ts";
import { Account } from "./src/models/account.model.ts";
import { AuthTicket } from "./src/models/authTicket.model.ts";
import { OAuthState } from "./src/models/oauthState.model.ts";
import {
    atomicConsumeTicket,
    consumePendingOAuthState,
    createIssuedTicket,
    createPendingOAuthState,
} from "./src/modules/auth/auth.service.ts";

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string): void {
    total++;
    if (!condition) {
        console.error(`❌ FAILED: ${msg}`);
        throw new Error(`Assertion failed: ${msg}`);
    }
    passed++;
    console.log(`  ✓ ${msg}`);
}

export async function runDesktopOAuthSecurityTests(options: { exitOnComplete?: boolean } = {}): Promise<{ total: number; passed: number }> {
    console.log("==========================================");
    console.log(" Alfred Desktop OAuth & PKCE Security Tests");
    console.log("==========================================");

    await connectDatabase();

    // Setup a mock account
    const testAccount = await Account.create({
        type: "user",
        googleId: `test-google-${Date.now()}`,
        email: `desktop-oauth-${Date.now()}@example.com`,
        name: "Desktop Tester",
    });

    console.log("\n--- 1. OAuthState Lifecycle & Single-Use ---");
    const testState = crypto.randomBytes(24).toString("hex");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    // 1.1 Create pending desktop OAuth state
    await createPendingOAuthState({
        state: testState,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        flow: "desktop",
    });

    const pendingInDb = await OAuthState.findOne({ state: testState });
    assert(!!pendingInDb, "Pending state persisted in MongoDB");
    assert(pendingInDb?.codeChallenge === challenge, "Stored challenge matches S256 digest");
    assert(pendingInDb?.flow === "desktop", "Flow is desktop");

    // 1.2 First consumption succeeds and DELETES the state document
    const consumedState = await consumePendingOAuthState(testState);
    assert(consumedState?.state === testState, "Atomic consumption retrieves state");
    const postConsumeState = await OAuthState.findOne({ state: testState });
    assert(postConsumeState === null, "State document is deleted immediately upon consumption (single-use)");

    // 1.3 Second consumption fails (preventing state replay)
    const replayState = await consumePendingOAuthState(testState);
    assert(replayState === null, "Replaying same OAuth state fails");

    // 1.4 Expired state is not consumable
    const expiredState = crypto.randomBytes(24).toString("hex");
    await OAuthState.create({
        state: expiredState,
        flow: "desktop",
        expiresAt: new Date(Date.now() - 5000), // in the past
    });
    const tryExpiredState = await consumePendingOAuthState(expiredState);
    assert(tryExpiredState === null, "Expired OAuth state is rejected");

    console.log("\n--- 2. PKCE-Verified Ticket Consumption & Non-Destructive Failures ---");
    // 2.1 Issue desktop ticket
    const ticket = await createIssuedTicket({
        accountId: testAccount._id,
        codeChallenge: challenge,
        flow: "desktop",
    });
    assert(typeof ticket === "string" && ticket.length === 64, "Issued ticket is 64-char hex string");

    // 2.2 Verify ticket at rest contains NO token or JWT
    const rawTicketDoc = await AuthTicket.findOne({ ticket });
    assert(!!rawTicketDoc, "Ticket document exists in AuthTicket collection");
    assert((rawTicketDoc as unknown as Record<string, unknown>).token === undefined, "Zero token stored at rest in AuthTicket");
    assert((rawTicketDoc as unknown as Record<string, unknown>).jwt === undefined, "Zero JWT stored at rest in AuthTicket");

    // 2.3 Attempt exchange without code_verifier -> REJECTED
    const noVerifierResult = await atomicConsumeTicket({ ticket });
    assert(noVerifierResult === null, "Exchange without code_verifier fails for desktop ticket");

    // Check that ticket was NOT burned by missing verifier
    const ticketAfterNoVerifier = await AuthTicket.findOne({ ticket });
    assert(ticketAfterNoVerifier?.status === "issued", "Ticket remains 'issued' after missing verifier attempt (non-destructive)");

    // 2.4 Attempt exchange with wrong code_verifier -> REJECTED
    const wrongVerifier = crypto.randomBytes(32).toString("base64url");
    const wrongVerifierResult = await atomicConsumeTicket({
        ticket,
        codeVerifier: wrongVerifier,
    });
    assert(wrongVerifierResult === null, "Exchange with invalid code_verifier fails");

    // Crucial requirement: Check that ticket was NOT burned by invalid verifier attempt!
    const ticketAfterWrongVerifier = await AuthTicket.findOne({ ticket });
    assert(ticketAfterWrongVerifier?.status === "issued", "Ticket remains 'issued' after invalid verifier attempt (prevents DoS on legitimate user)");

    // 2.5 Exchange with valid code_verifier -> SUCCEEDS
    const validSession = await atomicConsumeTicket({
        ticket,
        codeVerifier: verifier,
    });
    assert(!!validSession, "Exchange with valid code_verifier succeeds");
    assert(!!validSession?.token, "Session contains minted JWT");
    assert(validSession?.account.id === testAccount._id.toString(), "Session account matches target account");

    // Status is now consumed
    const ticketAfterSuccess = await AuthTicket.findOne({ ticket });
    assert(ticketAfterSuccess?.status === "consumed", "Ticket status transitioned to 'consumed'");

    // 2.6 Replay of consumed ticket -> REJECTED
    const replayTicketResult = await atomicConsumeTicket({
        ticket,
        codeVerifier: verifier,
    });
    assert(replayTicketResult === null, "Replaying already-consumed ticket fails");

    console.log("\n--- 3. Concurrency & Atomic Single-Use Verification ---");
    const concurrentTicket = await createIssuedTicket({
        accountId: testAccount._id,
        codeChallenge: challenge,
        flow: "desktop",
    });

    // Fire 5 simultaneous exchanges with the same valid credentials
    const results = await Promise.all([
        atomicConsumeTicket({ ticket: concurrentTicket, codeVerifier: verifier }),
        atomicConsumeTicket({ ticket: concurrentTicket, codeVerifier: verifier }),
        atomicConsumeTicket({ ticket: concurrentTicket, codeVerifier: verifier }),
        atomicConsumeTicket({ ticket: concurrentTicket, codeVerifier: verifier }),
        atomicConsumeTicket({ ticket: concurrentTicket, codeVerifier: verifier }),
    ]);

    const successes = results.filter((r) => r !== null);
    const failures = results.filter((r) => r === null);

    assert(successes.length === 1, `Exactly 1 concurrent request succeeded (actual: ${successes.length})`);
    assert(failures.length === 4, `Exactly 4 concurrent requests failed (actual: ${failures.length})`);

    console.log("\n--- 4. Expiration & Browser Flow Compatibility ---");
    // 4.1 Expired ticket is rejected
    const expiredTicket = await createIssuedTicket({
        accountId: testAccount._id,
        codeChallenge: challenge,
        flow: "desktop",
    });
    await AuthTicket.updateOne({ ticket: expiredTicket }, { expiresAt: new Date(Date.now() - 1000) });
    const expiredResult = await atomicConsumeTicket({ ticket: expiredTicket, codeVerifier: verifier });
    assert(expiredResult === null, "Expired ticket cannot be consumed");

    // 4.2 Browser flow ticket without PKCE works seamlessly
    const browserTicket = await createIssuedTicket({
        accountId: testAccount._id,
        flow: "browser",
    });
    const browserSession = await atomicConsumeTicket({ ticket: browserTicket });
    assert(!!browserSession, "Browser ticket without PKCE consumed successfully");
    assert(browserSession?.account.id === testAccount._id.toString(), "Browser session account matches");

    console.log("\n==========================================");
    console.log(`✅ All Desktop OAuth Security Tests Passed! (${passed}/${total} assertions)`);
    console.log("==========================================");

    if (options.exitOnComplete ?? true) {
        process.exit(0);
    }
    return { total, passed };
}

if (process.argv[1]?.includes("test_desktop_oauth_security")) {
    runDesktopOAuthSecurityTests({ exitOnComplete: true }).catch((err) => {
        console.error("Test execution failed:", err);
        process.exit(1);
    });
}
