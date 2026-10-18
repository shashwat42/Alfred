# Reliability, account lifecycle, quotas and development previews

Implementation and local validation report — updated 18 October 2026. Nothing was deployed.

## Production startup and direct state selection follow-up

Production mode excluded the native WebView origins from default CORS configuration, preventing packaged apps from restoring sessions or creating guests. The backend now always recognizes the two exact Tauri origins (`http://tauri.localhost` and `https://tauri.localhost`) alongside the configured web origin. Arbitrary origins remain rejected. The backend package also now starts the actual `server.ts` entry point with `npm start`, instead of referencing a nonexistent `server.js`.

A real production-mode child backend was cold-started against an isolated replica-set database. Health, native-origin preflight, guest creation and authenticated account access all passed. The user's running desktop app was also checked with the real production-mode backend and reached its normal guest dashboard. No production deployment or release installer was created.

The floating developer button and preview dialog were removed. Development builds now use a dropdown beside the Alfred logo. Its blank value is labeled **Normal** and uses the live application. Selecting a state displays it directly in the application area. Selecting Normal restores the mounted live app and its drafts. The selected state resets on reload, never changes sessions or API configuration, and never writes fake account data. The dropdown and fixture module remain excluded from production artifacts. Both the frontend development build and authoritative backend development mode are required to show it.

Current validation totals are **85 backend tests, 44 frontend tests, and 18 direct state renders**, plus TypeScript checks and production artifact exclusion. Existing lint findings remain unchanged.

## Guest-access recovery follow-up

The running desktop app previously restored an unchecked stale credential and then repeatedly sent it on requests that returned 401. Startup now validates saved sessions through `GET /auth/session`. Guest-only `POST /auth/guest/renew` verifies the signed credential, issuer/audience, seven-day token lifetime, account identity, session version and active/non-migrated account. It allows a 30-day expiry grace only for renewal, and preserves the same account ID, data, onboarding and quotas. Ordinary API middleware still rejects expired tokens. Google-user credentials cannot use guest renewal, and validating a Google session returns its existing token without refreshing its recent-login timestamp.

The authenticated client shares concurrent guest renewals and retries a 401 once under the same owner. It never retries network failures as mutations, silently changes accounts or loops on rejected renewals. Invalid credentials produce one recovery UI, with **Continue as guest** as the primary action and Google sign-in explicitly optional. Explicit continuation archives the old credential in `alfred_recoverable_sessions` before selecting the new guest. Failed guest creation leaves it untouched. This preserves credentials for possible recovery; it does not make expired/invalid credentials authorized or transfer old content without verified ownership. A backend outage also leaves credentials intact.

The actual desktop app was brought out of the broken-session screen using guest continuation, then its welcome screen was completed. The normal guest dashboard is now visible without errors or Google sign-in. No prior account documents were deleted. New regression cases cover same-account renewal, shared concurrent renewal, revoked/migrated/deleted/forged/stale credentials, account-switch races, explicit preservation, outage behavior and user-token timestamp preservation. Updated totals: **83 backend tests and 44 frontend tests pass**, with TypeScript and production simulator exclusion also passing.

## Baseline audit and environment repair

The initial Git working tree was clean. The application is React 19/TypeScript/Vite with a **Tauri 2 desktop wrapper**, not Electron. Android shares the React application and includes the native assistant service. Existing navigation uses component state, with separate desktop overlay and Android assistant entry surfaces. The implementation preserves these surfaces and the existing PKCE Google OAuth, canonical guest accounts, notification system, tenant repository and AI action events.

Before edits: frontend tests passed **36/36**, frontend production build passed, and backend TypeScript check passed. The backend suite failed: temporary MongoDB processes crashed within the sandbox and several authentication API tests failed in that environment. The original production build already had large-chunk and ineffective-dynamic-import warnings.

MongoDB was reachable outside the sandbox but ran as a standalone Windows service. Alfred already required a replica set for guest writes and migration. With administrator consent, its configuration was backed up at `C:\Program Files\MongoDB\Server\9.0\bin\mongod.cfg.alfred-before-replication.bak`, replication was enabled and the existing service restarted. The replica set is `alfred-local`, with `localhost:27017` as its single member and loopback binding retained. No database files were removed, moved or recreated. A driver check confirmed **PRIMARY and a successful read-only transaction**. The existing application URI works without modification. `scripts/enable-local-mongo-transactions.ps1` records the repeatable local repair procedure; it refuses unexpected configuration and requires Windows administrator rights.

All original backend tests subsequently passed outside the sandbox using the installed MongoDB binary and isolated temporary databases. Existing fixture tests were updated to account for the transaction boundary; runtime transaction enforcement has no test bypass.

Repository lint remains at **10 existing errors and 2 existing warnings**. The errors were reproduced against the original `HEAD` contents of auth.controller, guestMigration, isolation.test, tenantRepository, SafeMarkdown and WheelPicker. They concern unused declarations, existing `any` types, an unused assignment and an existing effect state update. The two Chat warnings concern existing unused eslint-disable comments. No new lint findings remain.

## Runtime configuration

Backend `.env` and frontend root `.env` are independent. Their examples both document `MODE=development`; local ignored files were given that non-secret setting. Missing backend mode defaults to production unless `NODE_ENV=development`. Explicit values other than exactly `development` or `production` fail startup. Production mode also selects strict default origins, secure OAuth cookies and the existing strong-JWT-secret requirement.

Backend defaults live in `Alfred_Backend/src/config/policy.ts`:

| Variable | Default |
| --- | ---: |
| `STORAGE_QUOTA_BYTES` | 10,000,000 |
| `AI_DAILY_REQUESTS` | 50 |
| `AI_MONTHLY_REQUESTS` | 1,000 |

Overrides must be positive safe integers. No frontend-supplied configuration can change enforcement. `.env` and `.env.*` remain ignored, with `.env.example` explicitly allowed. Provider, database, Google and JWT secrets remain backend-only.

Vite emits a non-secret compile-time `__DEV_PREVIEW__` boolean. Development requires `MODE=development` and either the dev server or the explicit `build:development` command. Ordinary `npm run build` always excludes the simulator, even with a local development `.env`. Tauri dev uses Vite; release Tauri uses the normal production build. Android's existing normal build remains production and excludes previews. A deliberately prepared development frontend can be packaged through the existing native toolchain, but no device packaging or installation was performed here.

## Direct app states and reliability UI

Use the **App state** dropdown beside the Alfred logo in the browser, Tauri or supported Android development frontend. **Normal** is its default empty value. Selecting Server down, Loading, Quota full, Onboarding or another state renders the shared screen directly, with no preview dialog or separate simulator navigation. Error-state Retry returns to Normal. Normal restores the mounted live app and its drafts. Selection is local React state and resets on reload.

The dropdown requires a development-capable frontend and the backend `/health` reporting authoritative development mode. Its options and fixture module are lazy loaded and excluded from production JavaScript. No backend mock routes, query flags, authentication overrides, API interceptors, fake MongoDB records or credential changes are installed. Existing production authorization and quotas continue to apply. Real dialogs are hidden while an overridden state is selected, then return when Normal is selected.

Selectable states cover authentication/session switching, routes/404, availability/offline/timeouts/API errors, loading/refresh/empty sections, storage and AI quota cases, onboarding/returning users, legal pages, deletion and operation feedback. The full storage fixture is exactly **10,000,000 / 10,000,000 bytes**. Fixture reset dates are deliberately fixed; the header identifies the selected development state. Shared status components announce loading/errors and respect reduced motion.

Initial failed loads cannot render as successful empty collections. Refresh failures preserve loaded data, while new account IDs remount account-owned dashboard/chat state. The schedule request cache includes account ID. Task/schedule submission locks prevent duplicate creates; note save errors remain visible with the draft. Network and timeout messages differ from authentication, forbidden, validation and quota errors. Database failures during authentication lookup return 503 rather than an expired-token message.

Unknown frontend pathnames use the branded 404; root, index.html, legal paths and existing OAuth query/deep-link surfaces are preserved. Legal pages are also accessible as `/#/privacy` and `/#/terms`. Unknown backend endpoints remain JSON 404 responses.

## Account API and cleanup

All `/api/account` routes use existing bearer authentication:

| Route | Behavior |
| --- | --- |
| `GET /api/account` | Reconciles and returns storage, AI windows and onboarding status |
| `PUT /api/account/onboarding` | Accepts only `{ completed: true }` |
| `DELETE /api/account` | Accepts only `{ confirmation: "DELETE" }` |

Ownership comes exclusively from the authenticated principal. Google-user deletion requires a valid token issued within ten minutes; the UI provides Google reauthentication. Guests prove ownership through their authenticated canonical guest session and explicit typed confirmation. No client account ID is accepted. Deletion runs as one transaction, sharing the account write fence with mutations, AI admissions, OAuth-state creation, ticket issuance and migration.

Cleanup removes the Account and migrated guest tombstones/archives, tasks, notes, schedules, notification settings, installation registrations, delivery claims, OAuth states, issued auth tickets, AI counters and admission records. Removing the Account invalidates every Alfred bearer session. Client session clearing uses the established auth-change synchronization. Other accounts remain untouched. A failed transaction rolls back all cleanup; repeated use of the deleted account's token returns 401. There are no persisted provider refresh tokens to revoke. This does not delete the Google account or remove Google's independent OAuth grant.

Onboarding is per canonical account, skippable, and has a Settings revisit action. Guest completion and usage transfer to the verified Google account; existing completion remains intact. Permissions are deferred until voice/notifications/native setup is used.

## Storage definition and accounting

The quota measures **serialized BSON document bytes**, not MongoDB disk allocation. It counts whole canonical user-owned Task, Note, Schedule and ScheduleNotificationSettings documents, including IDs, ownership fields and timestamps. AI tools create/update those same records through the existing services, so their output counts once.

Excluded: Account identity/onboarding and write-fence metadata, OAuth/auth tickets, AI count/idempotency ledgers, notification device capabilities and delivery leases, quarantined legacy ownership, indexes, logs, database overhead and client-memory chat/audio. Chat content/audio and standalone AI action histories were not persisted by the audited backend; no new content-history store was introduced. This scope is explicit and should be reviewed if new persisted user-content collections are added.

Every tenant mutation now runs in a MongoDB transaction. It first writes the Account fence, measures in-scope BSON before the mutation, performs the mutation, measures after, then checks the quota and updates cached `storageBytes`. Competing mutations, migration and deletion conflict on the same account document and retry against a fresh snapshot. The content mutation and accounting commit or roll back together. No quota trust is placed in cached/client values.

An existing over-quota account retains all data. Writes with no increase or a decrease remain allowed; increasing writes are rejected with HTTP 413 and `STORAGE_QUOTA_EXCEEDED`. Deletions free bytes. Migration deliberately retains all source content, even if the destination becomes over quota. Initial usage is established lazily on first write/usage read; `GET /api/account` reconciles cached drift from actual BSON. There is no destructive quota backfill.

Full per-account measurement favors correctness and reconciliation over throughput for the 10 MB policy. It scans the owned data on writes; substantially larger quotas or higher write volumes would warrant measured incremental accounting. Standalone MongoDB is unsupported, consistent with the repository's pre-existing migration requirement.

## AI admission, retry and reset policy

Both chat and validated multipart voice reach `generateChatCompletion`, which reserves one logical interaction before running any provider fallback or tool loop. Provider health probes have no user context and are operational diagnostics. No other account AI/background generation entry point was found. Direct AI tools do not independently call the provider and use the quota-checked content repository.

`AiUsageWindow` has a unique `(accountId, window, key)` index, counters and TTL cleanup. `AiLogicalRequest` has a unique `(accountId, key)` index, a request fingerprint, status, timestamps and a 40-day TTL. It stores no message/audio content or cached response. Daily and monthly increments plus the durable admission record commit in a single transaction under the Account fence. When either allowance is exhausted, the transaction rejects before provider dispatch and neither counter increments.

Chat, overlay and Android clients send an `Idempotency-Key`; retries reuse the existing message ID where the UI supports retry. Absent keys are assigned by the server for compatibility. Duplicate accepted IDs return 409 without another charge or execution; results are not replayed. A conflicting payload also returns 409. The original 15-second tool deduplication remains an additional existing safeguard, not the authoritative logical-request counter.

Invalid payloads, invalid IDs and missing provider configuration are rejected before admission. **Every accepted dispatch remains charged**, including provider failures, uncertain network failures, client disconnects and later storage rejection. Internal fallback calls and tool iterations do not add charges. This conservative policy avoids refunding work the provider may already have performed. A same-ID retry cannot repeatedly charge or execute actions. A deliberate fresh interaction uses a fresh ID.

Final status is diagnostic: completion-ledger failure does not discard a successful response or confirmed action events. Startup reconciles dispatches older than an hour to `interrupted`; they remain charged and cannot be replayed. This handles an uncertain outcome without duplicating side effects. TTL cleanup is asynchronous MongoDB maintenance. Guest migration adds both windows, preserves admission records (renaming colliding migrated IDs), and never resets quota. Deletion removes both models.

Windows use server UTC calendar days and months, with keys `YYYY-MM-DD` and `YYYY-MM`. The backend returns the next UTC midnight and next month's first UTC midnight as reset timestamps. Rollover selects a new key, independent of device clocks, reinstall, account switching or logout. HTTP 429 `AI_QUOTA_EXCEEDED` returns `window`, `limit`, `used`, `remaining` and `resetAt`. The frontend preserves that explanation rather than replacing it with a short rate-limit message. Normal tasks, notes, schedules, reads and deletions remain available when AI is exhausted. Provider token diagnostics remain separate in the existing response usage fields.

## Validation and remaining review

Validated locally:

- Frontend tests: **44 passed** (36 existing plus 8 reliability/error/idempotency/guest-recovery cases).
- Backend suite: **85 passed** (65 existing plus 20 quota/account/mode/guest-recovery/production-startup cases), using isolated temporary replica sets and the installed MongoDB binary outside the sandbox.
- Backend `npm run check` and frontend TypeScript/project production build: passed.
- `npm run build:development`: passed, with a separate development-state lazy chunk present.
- `npm run test:production-simulator`: passed; production bundle excludes fixtures, controls and entry point despite local development MODE.
- `npm run test:reliability-ui`: passed; 18 shared-component preview renders, backend-provided usage values and preview auth/persistence boundary checks.
- Native/Firefox visual checks: the real desktop guest dashboard worked against the production-mode backend. In a separate local development test instance, the logo dropdown switched directly to Server down, and choosing Normal restored the dashboard and the exact unsent draft. No Google sign-in, deletion or AI request was performed.
- Existing account-isolation, OAuth handoff, guest migration, AI tool action, Android assistant and notification regression tests passed. `git diff --check` passed.

No native desktop/Android binary build, hardware permission/delivery test, real Google sign-in or real-provider request was performed. Those require the corresponding native/device/provider environment. The existing large-bundle/dynamic-import build warnings and original lint findings remain; no new check/test failures are known.

Privacy Policy and Terms are expressly marked **drafts for local development**. Operator identity/contact, jurisdiction, eligibility/age, lawful bases, provider contracts/transfer arrangements, dispute/liability provisions, backup retention and legally required retention still need operator/legal review before public use. No backup-erasure or third-party-erasure guarantee is asserted. Existing expired guest credentials are not silently replaced; the simulator never repairs or invalidates the developer's real session.

## Changed files and purposes

- `.env.example`, `Alfred_Backend/.env.example`, `.gitignore`: non-secret runtime/quota examples and local-environment exclusions.
- `vite.config.ts`, `src/vite-env.d.ts`, `package.json`: compile-time preview gating, explicit development build and UI/artifact checks.
- `Alfred_Backend/server.ts`, `src/config/{env,policy}.ts`: authoritative mode/policy validation, health mode, account routes, structured errors, JSON 404 and interrupted-request reconciliation.
- `Alfred_Backend/src/models/account.model.ts`: cached storage and onboarding state.
- `Alfred_Backend/src/security/{storage,tenantWrite,errors,aiUsage,accountLifecycle}.ts`: BSON measurement, transactional fencing, quota errors/admission, lifecycle operations and reconciliation.
- `Alfred_Backend/src/security/{guestMigration,indexes}.ts`: quota/completion transfer, collision handling and additive uniqueness/TTL index initialization.
- `Alfred_Backend/src/modules/auth/{account.routes,auth.service,auth.controller}.ts`, `src/middleware/auth.middleware.ts`: protected account API, OAuth/deletion fencing, authoritative cookie mode and accurate database-failure classification.
- `Alfred_Backend/src/modules/{tasks,notes,schedule}/controller.ts`, `schedule-notifications/route.ts`: preserve structured quota errors through existing controllers.
- `Alfred_Backend/src/modules/ai/{service,controller,audio,tools}.ts`: shared logical-request admission, ID propagation and actionable tool storage errors.
- `src/components/reliability/{States,Usage,Legal,AccountDialogs,AccountPanel,ApplicationBoundary}.tsx`, `appStateContext.ts`, `StateControl.tsx`, `reliability.css`: shared accessible states, quotas, legal/account/onboarding dialogs and route boundary.
- `src/dev/AppStates.tsx`: isolated, lazy app-state dropdown and directly rendered states.
- `src/main.tsx`, `src/App.tsx`: shared boundary/styles and per-account content lifecycle.
- `src/hooks/{useLoadState,useTasks,useSchedule,useNotes}.ts`: explicit load/failure state, safe refresh, submission locking and account-scoped cache.
- `src/components/Dashboard.tsx`, `dashboard/{SettingsView,TodoView,UpcomingView,TaskDialog,ScheduleDialog,NotesView}.tsx`: account controls, successful-empty presentation, loading/errors, pending submissions and visible note-save errors.
- `src/lib/{api,requestError,aiChat}.ts`, `src/auth/auth.ts`: request timeouts/classification, account usage API handling, stable AI IDs and quota messages.
- `src/components/Chat.tsx`, `src/overlay/OverlayApp.tsx`, `src/android/AndroidAssistantApp.tsx`: logical IDs shared by native/browser AI entry points and retries.
- `Alfred_Backend/src/security/{reliability.test,testEnvironment,architecture.test}.ts`, `modules/ai/audio.test.ts`, `modules/schedule-notifications/{mongo,notifications}.test.ts`: real quota/account integration coverage and transaction-aware existing fixtures.
- `scripts/tests/reliability.test.ts`, `scripts/verify-{production-simulator,reliability-ui}.ts`: frontend quota/error behavior, emitted-artifact and presentation/isolation checks.
- `scripts/enable-local-mongo-transactions.ps1`, this report: repeatable local environment repair and accounting/policy/validation documentation.

Paths abbreviated after the first backend prefix above remain inside `Alfred_Backend` where the surrounding bullet says backend. Local result logs and MongoDB configuration backups are ignored, not application assets or deployment configuration.


## First-launch welcome and guided tour (18 October)

The main app now restores an existing session but waits for an explicit guest or Google choice on a fresh installation. Overlay and Android assistant session initialization retain their existing behavior. The welcome screen uses Alfred’s charcoal, white and red palette, with no email/password account form. Terms and Privacy are available for review; no new legal acceptance requirement was invented. Guest content continues to use the existing backend account rather than claiming offline-only storage.

A five-step, skippable tour introduces the real tasks, notes, schedule and assistant controls. Highlighted controls remain interactive. Back, Next, close/Escape and Skip tour are supported. Completion uses the existing per-account onboarding endpoint; Settings can reopen the tour. No sample records, AI calls, microphone or notification permission prompts are triggered by the tour. The development Signed out and New account onboarding states use the same presentation with fixture callbacks.

Validation: 45 frontend tests passed, including fresh-install initialization without guest provisioning and saved-guest recovery with deferred creation. All 18 state-render checks passed; the welcome fixture contains only guest and Google choices. Production build and simulator exclusion checks passed. Targeted lint on the changed authentication, welcome, tour and boundary components passed. Browser checks against an isolated local test database verified the welcome, guest entry, all four control highlights, skipping and returning-launch behavior. Real Google authentication was not performed. No native binary rebuild or deployment was performed for this follow-up.


## Toast simulation controls (18 October follow-up)

The development dropdown now contains Normal plus only Preview Loading Animation, Session Expired, Sync Error, Body Fetch Error, Simulate Timeout UI, Database Error and Simulate Background Task. Offline Mode and all previous fixture choices were removed. This replaces the earlier full-screen simulation presentation described above. Selected errors appear as dismissible red/charcoal toasts over the mounted live app; loading uses a spinner toast, and the background-task toast completes after 3.5 seconds. Dismiss or select Normal to clear the simulation. Session Expired does not invalidate real credentials; Database Error does not alter the database. No simulated operation sends requests or edits records. Actual account recovery, legal pages and onboarding remain normal app features. The user requested to perform checking themselves; no browser/device checks were run for this follow-up.


## Development quotas and Settings styling (18 October)

MODE=development now bypasses account storage and daily/monthly AI quota admission, while keeping storage measurements, usage accounting, tenant isolation and request-id deduplication. Usage endpoints return null limits/remaining values in development, and Settings displays a development badge with no cap or exhausted-state warnings. Production retains configured quotas. The existing backend watch process reloads these changes. Rate throttles, request-body limits and provider-side restrictions remain separate from account quotas.

The usage panel now shares Settings card/header styles, uses compact storage/daily/monthly metrics, muted supporting text, an icon refresh action, and thin red progress indicators for capped accounts. Native green progress bars and raw BSON-size explanations were removed from this UI. Narrow layouts stack the metrics. AGENTS.md records the user's development-only testing preference; server startup tests now use development, and quota enforcement tests enable the policy only as a fixture inside a development process.


## Blank development window repair (18 October)

The blank window coincided with two Vite processes listening on port 5173: a stale localhost/IPv6 server and the Tauri-managed IPv4 server. They shared the dependency cache while serving different optimized dependency versions; requesting the other server's version returned HTTP 504 Outdated Optimize Dep. The verified stale standalone process was stopped, leaving the Tauri-managed server and backend intact. The desktop window recovered after reload without clearing its saved account.

Vite now defaults to a dual-stack listener and scans only index.html, avoiding generated Android reports/assets. The SSR UI verification script has its own cache directory and disables dependency discovery, so it does not overwrite the live frontend's optimized dependencies. Development UI checks passed, the backend health reported development, and startup dependency requests succeeded through localhost and IPv4 after the check. The actual Alfred desktop dashboard was visually confirmed after recovery. No production testing was performed.


## Real error toasts and stable loading layouts (18 October)

Real error presenters now use a shared notification host, positioned at the upper right below the window controls. Duplicate messages share a dismissible toast and retain an available Retry action. The host can render inside an open native dialog so failures remain visible above its backdrop. Authentication, dashboard loading/operations, notes/tasks/schedules, Settings, account deletion/onboarding, microphone/chat/sign-in, voice-note playback and native assistant/overlay errors no longer insert error text/cards into content flow. Missing-session recovery keeps its necessary account-choice controls, with its error message in a toast. Existing content stays mounted during authenticated-session recovery.

Dashboard loaders now render only for an initial load of the active empty section; refreshes use the existing header spinner while retaining content. Usage loaders appear only before usage data exists. Chat replaces its send icon with a spinner rather than appending a loading bubble; native overlay/assistant loading bubbles appear only when there are no messages. Shared loaders also support an overlay variant for an existing positioned content region. The user requested to handle testing, so no tests, typecheck or browser/device checks were run for this follow-up.


## Bulk schedule clearing (18 October)

Schedule now has Clear day for the selected date and Clear all dates, with scope-specific confirmation and a pending-action lock. DELETE /api/schedule?date=YYYY-MM-DD requires a real date; DELETE /api/schedule/clear-all explicitly clears all dates and rejects date query filters. Both authenticate the caller and use the shared tenant repository/transactional storage reconciliation, so only the current account's schedule can be removed. Responses include deletedCount. Reminder claiming already rechecks the current schedule records, so removed records are no longer eligible.

The assistant has clearScheduleForDate and clearAllSchedules tools, with strict arguments, account scoping, idempotency and confirmed schedule_cleared action events. Instructions require asking for the scope when ambiguous and reporting the actual deletion count. Chat and voice use the shared tool dispatcher. The frontend invalidates schedule caches and refreshes today/timeline after assistant clears; stale pending loads cannot restore deleted records after UI clears. Testing is left to the user; no tests, typecheck, real deletions or provider calls were run for this change.


## Public Privacy Policy and Terms (18 October)

The in-app legal pages now use public product wording, effective 18 October 2026, identifying Shashwat Singh (India) as operator and singhshashwat.dev@gmail.com as the support/privacy/grievance contact, as provided by the user. Development/draft notices and unresolved-placeholder sections were removed. The Privacy Policy distinguishes server account content, transient chat/audio processing, provider processing, local credentials/preferences, notification records and AI metadata. It documents guest-account limitations, Google identity-only scopes, provider data-use differences, retention/erasure boundaries and available controls. The Terms cover adults 18+, authorized assistant actions including bulk schedule deletion, usage limits, reminders, ownership, acceptable use, account closure, statutory rights and Indian governing law without inventing a court venue.

Source review: account/auth/AI/notification schemas, storage and account deletion/migration code, local storage/native preference use; Google Gemini API terms (https://ai.google.dev/gemini-api/terms), Google OpenID Connect scope documentation (https://developers.google.com/identity/openid-connect/openid-connect#scope-param), India Code DPDP Act (https://www.indiacode.nic.in/indiacode/handle/123456789/22037) and MeitY rules publication (https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa). The policy makes no certification, fixed hosting region, end-to-end encryption or universal no-training/zero-retention promise. Billing configuration, actual hosting/backup retention and future provider changes remain operational facts to keep consistent with the published policy. No tests or runtime checks were run, per the user's testing preference.
