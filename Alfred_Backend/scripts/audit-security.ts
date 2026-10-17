import { connectDatabase, disconnectDatabase } from "../src/config/database.ts";
import { initializeSecurityIndexes, auditTenantDatabase } from "../src/security/indexes.ts";

// Explicit operator entrypoint. Default is read-only. No legacy data is reassigned
// or deleted. --apply-indexes performs additive index creation and may fail on
// existing duplicate identities; investigate those records before proceeding.
try {
    await connectDatabase();
    if (process.argv.includes("--apply-indexes")) await initializeSecurityIndexes();
    console.log(JSON.stringify(await auditTenantDatabase(), null, 2));
} finally {
    await disconnectDatabase();
}
