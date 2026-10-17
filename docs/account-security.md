# Account security implementation and deployment report

Implementation date: 17 October 2026. Production deployment and production data inspection have **not** been performed.

## Baseline audit and implementation plan

The working tree was clean before changes. No AGENTS.md was found in the repository or its immediate parent. The frontend is React/TypeScript/Vite with Tauri desktop/Android wrappers. The backend is Express 5, Mongoose 9, Zod, google-auth-library, and jsonwebtoken. One existing Mongoose connection is retained. There is no existing migration framework; notification indexes were previously initialized during startup.

Both users and guests already have a canonical `Account._id` ObjectId. Guest accounts have a server-generated UUID `guestId`; user accounts have `googleId`, which stores the verified immutable Google `sub`. Application documents already use `accountId` for both account types. Keeping this representation avoids changing identifier types, splitting guest ownership across two fields, or inventing a second identity model.

Before editing, the audit traced auth routes, state/ticket TTL models, account resolution, frontend session/login/logout, all three CRUD services and schemas, AI handlers/tools/context, notification settings/devices/plans/claims, database/environment configuration, indexes, and existing tests. AI calls use the same task/note/schedule services as the dashboard. Chat history is supplied as bounded request context, rather than stored in another backend collection. There is no autonomous backend scheduler, queue, integration store, export API, reporting API, population, user-controlled aggregation, or bulkWrite path. Notification reconciliation/claims are the delayed-action path.

Existing isolation was already good in most CRUD paths. Specific gaps were unbound browser OAuth state/tickets, no guest transfer, no server logout revocation, missing JWT type/issuer/audience checks, automatic frontend guest downgrade after 401, and a read-then-save task toggle. Native model access also remained scattered across services. The old notes list silently deleted empty legacy notes during a read; this deletion was removed so legacy remediation is explicit.

Baseline commands and inspected outcomes:

| Command | Baseline result |
| --- | --- |
| Root `npm test` | 36 passed |
| Root `npm run build` | Passed TypeScript and Vite production build; existing chunk-size and ineffective-dynamic-import warnings |
| Backend `npm test` inside sandbox | 44 passed, 5 localhost HTTP failures (`EACCES`), 1 optional MongoDB test skipped |
| Backend `npx tsc --noEmit` | Passed |

The implementation plan was: preserve canonical IDs and service contracts; resolve a mutually exclusive principal; centralize persistence; bind OAuth initiation/callback/handoff; transactionally transfer guests and revoke credentials; add indexes and a read-only legacy audit; verify against disposable databases and API servers. Work proceeded through all these phases. Backend HTTP tests were subsequently run with approved localhost access.

## Implemented identity and persistence rules

- Bearer JWTs are verified with HS256, expiration, issuer `alfred`, audience `alfred-api`, token/account type, account existence, migration state, and session version. Request identity comes only from this verified account. `req.principal` distinguishes `user` and `guest`; controllers do not read ownership from request data. Invalid credentials return 401, with no guest fallback.
- Fresh guests use the existing cryptographic UUID and signed bearer credential. Guest UUIDs are metadata, not credentials. User/guest account records with conflicting identity fields fail authentication. Google identities resolve by the immutable sub; verified email is profile data and never an account-linking key. Concurrent account creation uses upsert plus the existing unique Google identity index.
- `tenantRepository` validates the internal account context, stamps creates, adds account scope to every supported read/write/delete/count/existence operation, hides documents with conflicting document-level guest ownership, rejects reserved/nested identity and MongoDB operator fields in persisted payloads, and returns promises/plain data instead of mutable Mongoose query objects. Service allowlists and Zod schemas remain in place.
- No public repository save, insertMany, replacement, aggregation, population, raw collection, arbitrary pipeline, updateMany or bulkWrite method exists. The fixed completion toggle is the sole permitted update pipeline. Creates may call save internally on a newly constructed, server-owned document during a guest transaction; callers never receive a mutable document before persistence. Every update/delete contains ownership in the atomic database predicate.
- Each mutation checks that its account still exists and is active. Guest mutations also transactionally write an Account fence before the scoped mutation. Migration writes the same account, preventing a concurrent guest request from stranding a late insert under a revoked guest. This adds an account lookup per mutation and transaction work for guest mutations; no production performance benchmark was run.
- Sign-out increments the account session version and invalidates **all bearer sessions for that account**. New login tickets record the target version and cannot revive sessions after a subsequent sign-out. A request that completed authentication before a user sign-out may finish its already-authorized operation; guest transfer additionally fences mutations as described above.

## OAuth and migration lifecycle

1. The client creates a PKCE verifier/challenge and calls bearer-authenticated `POST /auth/prepare`. The server stores the initiating account/version, flow, challenge, fresh server state, nonce, and ten-minute expiry. Client-selected account IDs and guest IDs are not accepted.
2. The client opens the returned `/auth/google?state=...` URL. That endpoint launches a pending state once, stores a hash of a fresh callback-binding cookie, and redirects to Google with state/nonce. The cookie is HttpOnly, SameSite=Lax, and Secure in production; production uses a `__Host-` cookie with path `/`. Cookies authorize no ordinary API mutations, so the existing bearer API does not become cookie-authenticated.
3. Callback state is atomically consumed only with the matching browser binding and unexpired state. google-auth-library exchanges the code and verifies Google's ID token against the client audience; the application additionally checks the stored nonce. The verified sub resolves one internal account.
4. For a guest initiator, one MongoDB transaction checks source/target identity, fences the source, transfers owned records, increments the guest session version, records `migratedTo`, and creates the login ticket. Ticket creation failure rolls back the transfer as well. There is no standalone fallback. Failed callbacks issue no successful login session; their single-use OAuth attempt must be restarted with the still-valid guest credential after rollback.
5. Tasks, notes, schedules, devices, and delivery claims transfer with IDs preserved. Schedule timestamps are preserved so existing occurrence keys remain stable. Device session hashes are invalidated. Delivery records retain their source ID as migration metadata, allowing already-claimed notifications to remain consumed under the new owner.
6. Guest preferences transfer only when the target has none. On collision, the target's settings remain unchanged; the old guest settings remain archived under the revoked source account. Ambiguous document-level guest ownership fields are not transferred. Nothing is inferred from client-supplied entity IDs, email matches, or missing owners.
7. Browser and desktop ticket exchanges both require the originating PKCE verifier. Desktop polling uses the same challenge and atomic single-use consumption. The guest token no longer authorizes requests after commit. Transaction retries and repeated transfer calls to the same account are idempotent; a competing target cannot claim an already-transferred guest.

The state and auth-ticket collections remain trusted protocol stores with explicit TTL/unique indexes and expiry checks; they are not generic tenant CRUD endpoints. Health is intentionally public and returns only status. Guest provisioning is public, rate-limited, and accepts no ownership input. Installation registration is a deliberate exception to owner-filtered updates: possession of the existing 256-bit installation capability permits transferring that installation to the currently authenticated account. Registration does not read another account's application data; session-bound device reads/claims remain scoped.

## Collection and execution coverage

| Data / execution | Enforcement |
| --- | --- |
| Tasks: list/create/edit/complete/delete/clear-all | Scoped repository; fixed atomic toggle; guest write fence |
| Notes: list/recent/search/create/edit/open/delete | Scoped repository; whitelisted content updates; no read-time legacy deletion |
| Schedules: date list/create/edit/delete | Scoped repository; shared by dashboard and AI |
| Notification settings | Scoped reads and revision compare-and-swap writes; explicit transfer collision policy |
| Devices | Scoped/session-bound reads and removal; authenticated capability-based registration/transfer; guest write fence |
| Notification plans and claims | Scoped schedules/settings/ledger; revalidation of current occurrence and preferences; transferred claim preservation |
| AI tools and audio/text handlers | Verified request identity passed separately from model arguments; existing shared services enforce persistence |
| Account/OAuth state/tickets | Explicit identity/protocol services; unique/TTL constraints; no client account lookup endpoint |
| Administrative audit/index creation/migration | Named internal functions or operator CLI only; not mounted as tenant APIs |

The repository-wide operation search and architecture regression guard account for all present production data paths. This is a server-code boundary, not a sandbox against malicious future backend code or someone holding MongoDB credentials. Mongoose models remain available to infrastructure and controlled migration code; no claim is made that global Mongoose middleware protects arbitrary new raw-model/native-driver code. The source guard detects current direct-model patterns and unsupported methods, but deliberate aliases or new drivers still require review and tests. No unrestricted aggregation/bulk API was introduced merely to claim coverage; such methods are absent/rejected by the repository.

## Index and legacy-data strategy

Existing account Google/guest unique sparse indexes, state/ticket uniqueness and TTLs, settings ownership uniqueness, device TTL, delivery TTL and `_id` uniqueness, task ownership/sort indexes, and schedule pagination indexes are retained. New schema indexes are:

- Notes `{accountId: 1, updatedAt: -1}` and `{accountId: 1, lastOpenedAt: -1, updatedAt: -1}` for actual list/recent sorting. The older recent index is no longer declared; additive deployment intentionally does not drop an already deployed copy.
- Schedules `{accountId: 1, date: 1, time: 1}` for the existing date/time list.
- Delivery claims `{accountId: 1, deviceId: 1, scheduleId: 1}` for scoped transferred-claim checks.

Startup explicitly creates all declared identity/protocol/tenant indexes before listening, and checks for replica-set or mongos topology. Existing duplicates that prevent unique index creation block startup and require operator remediation. `createIndexes` is additive; `syncIndexes` and automatic index dropping are intentionally avoided. The audit CLI is read-only unless `--apply-indexes` is supplied and reports malformed owner counts, conflicting guest fields, orphaned owners, and live index definitions. Its administrative lookup returns counts only.

Legacy records are never assigned to an arbitrary account or deleted by this work. Missing/malformed ownership cannot match the trusted ObjectId scope. Conflicting document-level guest fields are hidden. Orphaned accounts cannot authenticate. Preserve a backup and resolve ambiguous ownership only from reliable historical evidence; retain unresolvable records for an explicit administrative remediation decision. Production records and deployed indexes were not inspected. Local tests actually created/inspected indexes, detected unowned/conflicting fixtures, and verified an `IXSCAN` for the scoped task sort with its compound index. Plans for every production workload have not been benchmarked.

## Verification

Final commands executed and inspected:

| Command | Final result |
| --- | --- |
| Root `npm test` | **36 passed**, 0 failed/skipped |
| Root `npm run build` | **Passed** TypeScript project build and Vite production build; existing warnings remain |
| Backend `npm run check` | **Passed** (`tsc --noEmit`) |
| Backend `npm test` | **65 passed**, 0 failed/skipped; includes real disposable MongoDB and HTTP API tests |
| `git diff --check` | **Passed**; Git emitted Windows line-ending conversion notices only |
| Backend `npm audit --json` | 3 high-severity development dependency findings in the pre-existing nodemon chain; no forced fix applied |

The backend has no separate production bundle/build script; its existing TypeScript runtime was checked with the configured compiler. The security tests use an automatically created disposable MongoDB replica set; the existing notification MongoDB test now also defaults to a disposable server. They never use `MONGODB_URI` for destructive tests. An explicitly supplied notification test URI must name a database ending `_test`. First run may download a MongoDB binary; offline CI can set `MONGOMS_SYSTEM_BINARY` to its approved binary.

The real-database/API scenarios include four independent principals, cross-account CRUD and foreign IDs, list/search/recent/count/existence isolation, clear-all, reserved/nested ownership payloads, concurrent completion toggles, AI ownership, notification plans/device binding/claim uniqueness, malformed/expired/revoked/wrong-context tokens, bounded legacy tokens, transaction rollback including ticket insertion, same-target/different-target migration races, legacy account versions, preference collisions, late guest writes, transferred notification idempotency, browser cookie/state/nonce binding, canonical identity concurrency, and browser/desktop PKCE replay resistance. Google provider responses are mocked in callback tests; live Google consent and real provider tokens are not part of local verification.

## Deployment and rollback

1. Back up MongoDB. Configure a replica set or compatible sharded cluster, including local development; standalone MongoDB is rejected by server startup. Transactions must be available to the application's database role.
2. Preserve the existing server-only Google credentials, JWT signing key and MongoDB URI. Production requires a random `JWT_SECRET` of at least 32 characters and HTTPS for the callback binding cookie. Keep frontend and Google callback URLs/CORS origins correctly configured. No secret is added to frontend configuration.
3. For existing sessions, optionally set validated `JWT_LEGACY_ACCEPT_UNTIL` to an absolute ISO UTC deadline no more than seven days ahead of deployment. This permits old valid, signed, expiring Alfred tokens without issuer/audience to reach migration during rollout. New tokens always use issuer/audience. Remove this setting after the deadline. Without it, old tokens receive 401; users must explicitly sign out/re-authenticate, and anonymous users cannot automatically recover an old guest account. Plan the guest transition before disabling legacy-token acceptance.
4. From `Alfred_Backend`, run `npm run security:audit` to inspect ownership/index counts. Run `npm run security:audit -- --apply-indexes` for additive creation. Investigate conflicting identities/duplicate unique keys before proceeding. These commands target configured `MONGODB_URI`; they were **not** run against the application's database during implementation.
5. Deploy backend and frontend together, drain old server instances and old OAuth attempts, and clear pending login attempts. The new prepare endpoint and browser PKCE requirement are coordinated auth-protocol changes. Old frontend login URLs and old unbound browser tickets intentionally fail closed. Existing CRUD response shapes and account identifier types are retained.
6. Run production smoke checks for guest CRUD, browser and desktop Google sign-in, transferred data/old guest rejection, account switching, sign-out, notifications and index/query plans. These remain deployment work, not completed verification.
7. Roll back both frontend/backend together only after reviewing migrated ownership. Do not reverse guest transfers automatically or remove migration/session-version markers. An older backend may ignore revocation markers; before running it, rotate the JWT key and drain requests, or backport revocation checks. Additive indexes can remain. Archived conflicting guest preferences require explicit operator handling if restoration is desired.

Remaining limitations: live Google/Tauri/Android sign-in and production topology/index/data remediation are unverified; there is no load benchmark; rate limits remain in-memory as before; sign-out revokes all account sessions rather than one device; old guest preferences may remain archived on collision. Dependency audit reports three high-severity development dependency findings through the pre-existing nodemon â†’ chokidar â†’ braces chain; the newly installed MongoDB test dependency is not the reported chain. No unrelated dependency downgrade/forced fix was applied.

## Exact files changed

Paths below are relative to `D:/Projects/Alfred/Alfred/`.

| Path | Change |
| --- | --- |
| `Alfred_Backend/.env.example` | Documents optional legacy-token deadline |
| `Alfred_Backend/package.json` | Security tests, audit CLI, disposable MongoDB test dependency |
| `Alfred_Backend/package-lock.json` | Locked test dependency tree |
| `Alfred_Backend/server.ts` | Topology/index initialization and sanitized final API error handling |
| `Alfred_Backend/scripts/audit-security.ts` | Operator audit and optional additive indexes |
| `Alfred_Backend/src/config/env.ts` | Validates rollout deadline and production JWT secret |
| `Alfred_Backend/src/middleware/auth.middleware.ts` | Verified principal, JWT context, account invariants and revocation |
| `Alfred_Backend/src/models/account.model.ts` | Session version, guest write fence, migration target |
| `Alfred_Backend/src/models/authTicket.model.ts` | Ticket-bound account session version |
| `Alfred_Backend/src/models/oauthState.model.ts` | Initiating identity/version, nonce, browser binding |
| `Alfred_Backend/src/models/note.model.ts` | Scoped sort indexes |
| `Alfred_Backend/src/models/schedule.model.ts` | Scoped date/time sort index |
| `Alfred_Backend/src/modules/auth/auth.controller.ts` | Prepare/launch/callback/transactional ticket issuance/logout |
| `Alfred_Backend/src/modules/auth/auth.routes.ts` | Authenticated prepare/logout routes |
| `Alfred_Backend/src/modules/auth/auth.schema.ts` | Prepared OAuth request validation |
| `Alfred_Backend/src/modules/auth/auth.service.ts` | PKCE, nonce, atomic account resolution, token/ticket context |
| `Alfred_Backend/src/modules/tasks/service.ts` | Repository persistence and atomic toggle |
| `Alfred_Backend/src/modules/notes/service.ts` | Repository persistence and explicit legacy retention |
| `Alfred_Backend/src/modules/schedule/service.ts` | Repository persistence |
| `Alfred_Backend/src/modules/schedule-notifications/models.ts` | Transferred-claim metadata and scoped index |
| `Alfred_Backend/src/modules/schedule-notifications/service.ts` | Scoped persistence, guarded registration, transferred claims |
| `Alfred_Backend/src/modules/schedule-notifications/route.ts` | Scoped device-removal service |
| `Alfred_Backend/src/modules/schedule-notifications/notifications.test.ts` | Updated identity/scoped persistence fixtures |
| `Alfred_Backend/src/modules/schedule-notifications/mongo.test.ts` | Automatic isolated MongoDB and topology/claim verification |
| `Alfred_Backend/src/modules/ai/audio.test.ts` | Realistic verified-account/JWT fixture |
| `Alfred_Backend/src/security/tenantRepository.ts` | Shared narrow ownership-enforcing persistence API |
| `Alfred_Backend/src/security/tenantWrite.ts` | Active-account validation and transactional guest write fence |
| `Alfred_Backend/src/security/guestMigration.ts` | Atomic, idempotent, recoverable guest transfer |
| `Alfred_Backend/src/security/indexes.ts` | Explicit topology/index initialization and legacy audit |
| `Alfred_Backend/src/security/architecture.test.ts` | Repository-wide persistence boundary guard |
| `Alfred_Backend/src/security/isolation.test.ts` | Real database/API/OAuth/migration isolation tests |
| `Alfred_Backend/src/types/express.d.ts` | Principal request type |
| `Alfred_Backend/src/utils/requireAccountId.ts` | Derives controller identity from verified principal |
| `src/auth/auth.ts` | Prepared OAuth and browser/desktop PKCE; no failed handoff guest downgrade |
| `src/auth/AuthContext.tsx` | Server-side sign-out before clearing local session |
| `src/lib/api.ts` | Removes automatic 401 guest replacement/retry |
| `scripts/tests/android-assistant.test.ts` | Verifies general requests preserve expired accounts |
| `docs/account-security.md` | Audit, implementation, verification, exact file list and rollout report |
