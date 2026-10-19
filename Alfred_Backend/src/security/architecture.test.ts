import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

test("application persistence uses the scoped repository; global access has explicit entrypoints", async () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const violations: string[] = [];
    const allowed = new Set([
        "security/tenantRepository.ts", "security/tenantWrite.ts", "security/guestMigration.ts", "security/indexes.ts",
        "middleware/auth.middleware.ts", "modules/auth/auth.service.ts", "modules/auth/auth.controller.ts",
        "security/storage.ts", "security/aiUsage.ts", "security/accountLifecycle.ts",
        "security/cloudStorage.ts",
        // Admin-only aggregate metrics and a separate pinned-owner credential.
        "modules/monitor/metrics.ts", "modules/monitor/auth.ts",
    ]);
    async function inspect(directory: string) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) { await inspect(full); continue; }
            const relative = path.relative(root, full).replaceAll("\\", "/");
            if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts") || allowed.has(relative)) continue;
            const text = await readFile(full, "utf8");
            // Review guard, not a runtime sandbox: deliberate aliasing/new driver
            // imports still require code review. The runtime boundary is the repository.
            for (const match of text.matchAll(/\b(CloudProfile|Task|Note|Schedule|NotificationSettings|NotificationDevice|NotificationDelivery|Account|AuthTicket|OAuthState)\s*\.\s*(\w+)\s*\(/g)) {
                const [, receiver, method] = match;
                if (["createIndexes", "init"].includes(method!)) continue;
                // Background push enumerates installation metadata, checks current
                // account/session fences, and prunes an exact invalid FCM token.
                // Schedule content/claims still go through the scoped repository.
                if (relative === "modules/schedule-notifications/pushService.ts" &&
                    ((receiver === "NotificationDevice" && ["find", "exists", "updateOne"].includes(method!)) ||
                     (receiver === "Account" && method === "exists"))) continue;
                if (!(relative === "modules/schedule-notifications/service.ts" && receiver === "NotificationDevice" && method === "findOneAndUpdate")) violations.push(`${relative}: ${receiver}.${method}`);
            }
            if (/\.(aggregate|bulkWrite|insertMany|replaceOne|findOneAndReplace|save|populate)\s*\(/.test(text)) violations.push(`${relative}: unsupported persistence method`);
            if (/mongoose\.(connection|connections)|\.collection\s*\(/.test(text) && relative !== "config/database.ts") violations.push(`${relative}: direct driver access`);
        }
    }
    await inspect(root);
    assert.deepEqual(violations, []);
});
