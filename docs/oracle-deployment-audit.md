# Deployment audit before implementation — 18 October 2026

This audit records the original layout. Compose files and deployment scripts were
later relocated into `Alfred_Backend`; follow the current runbook for commands.

Inspected before changing deployment/application files:

- `Alfred_Backend/Dockerfile`: two stages, Node 24 Bookworm slim, native TypeScript,
  `npm ci --omit=dev`, non-root API, no build secrets. `.dockerignore` allowlists
  application sources/manifests and excludes environment files and tests.
- Root `compose.yaml`: project `alfred`, services `backend`, `mongo`, `mongo-init`;
  API port 8000 published only on host loopback; MongoDB 8.0 not published;
  persistent `mongo-data` volume (default actual name `alfred_mongo-data`).
  Replica set `alfred`, member `mongo:27017`, database `alfred`. The initializer
  initiates only an uninitialized set; it never deletes data or reconfigures it.
- `server.ts`: validates database transaction topology, creates additive indexes,
  reconciles AI request metadata, starts one Express process, and probes AI models.
  Routes include auth/account, schedule, tasks, notes, AI, and notifications.
  `/health` currently reports HTTP availability and mode, not database readiness.
- Environment is loaded by `dotenv/config`. Local Compose reads
  `Alfred_Backend/.env` at container creation and overrides MODE, PORT, MONGODB_URI.
  NODE_ENV in the image is production, but MODE controls application quotas and
  development features. Root `.env` configures Vite/Compose interpolation, not API
  secrets. Only `.env.example` files are tracked; real `.env*` files are ignored.
- Auth uses HS256 JWTs with issuer/audience/version checks, Mongo account isolation,
  persisted PKCE/nonce/one-time OAuth state/tickets, and production Secure/HttpOnly
  binding cookies. Native application origins are explicitly allowed. Google start
  URL derives from GOOGLE_CALLBACK_URL. localhost/tunnel callbacks are local-only.
- Mongo account writes and migrations use transactions. Schema/index changes are
  additive at startup; there is no destructive deployment migration runner.
- No `.github/workflows` or existing remote deployment scripts were present.
  Repository origin is GitHub and the current branch is `main`.
- Dependency manifests contain JS runtime dependencies; no application native addon
  build is configured. Official Node 24 Bookworm slim and Mongo 8 image metadata
  publish amd64 and arm64 variants. CPU instruction requirements still need checking
  on the actual VM; image metadata is not proof of target CPU compatibility.

## Blockers identified

1. Development Compose forces MODE=development and an unauthenticated Mongo URI.
   It also requires a local environment file and source bind mount unavailable on
   a newly provisioned remote host.
2. Mongo has no authentication or replica-set keyfile. An existing populated,
   unauthenticated volume cannot safely be converted automatically: deployment
   must stop and require a separately planned, backed-up authentication enablement.
3. No GitHub secret delivery, pinned Actions workflow, SSH host-key verification,
   architecture gate, protected configuration backups, or deployment health gate.
4. API health does not prove database readiness. SIGTERM is not explicitly drained.
   Some startup/controller errors print complete driver/validation objects, which
   may include connection details or user content.
5. Production requires a real public HTTPS API callback/ingress and explicit web
   origins. No domain, TLS termination, Oracle host, SSH key/host fingerprint,
   production secrets, or production volume identity has been provided.
6. Current rate-limit and assistant tool idempotency caches are process-local;
   preserve one API instance. Do not add Redis or scale horizontally in this task.
7. A 1 GB VM leaves little capacity for MongoDB, Node, OS, Docker and transient
   `mongosh` initialization. Current local Docker stats: API 321.1 MiB, MongoDB
   120.6 MiB. These are one instant, not a load profile or memory guarantee.
   Local Docker engine is linux/amd64. Do not infer ARM runtime validation.

## Runtime variable inventory

Required by API code: MONGODB_URI, JWT_SECRET, GOOGLE_CLIENT_ID,
GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL. Production JWT secret minimum: 32 chars.
Required operationally for a working assistant: LLM_API_KEY. Production deployment
also requires FRONTEND_URL and ALLOWED_ORIGINS to avoid development URL defaults.

Optional API settings with code defaults: MODE, PORT, STORAGE_QUOTA_BYTES,
AI_DAILY_REQUESTS, AI_MONTHLY_REQUESTS, RATE_LIMIT_GUEST_WINDOW_MS,
RATE_LIMIT_GUEST_MAX, RATE_LIMIT_AUTH_WINDOW_MS, RATE_LIMIT_AUTH_MAX,
RATE_LIMIT_API_WINDOW_MS, RATE_LIMIT_API_MAX, RATE_LIMIT_AI_WINDOW_MS,
RATE_LIMIT_AI_MAX, LLM_BASE_URL, LLM_MODEL, LLM_FALLBACK_MODELS, LLM_SITE_URL,
LLM_SITE_NAME, LLM_MAX_OUTPUT_TOKENS, LLM_TIMEOUT_MS, JWT_LEGACY_ACCEPT_UNTIL.
NODE_ENV affects fallback mode only when MODE is absent; production deployment
must explicitly set both. Legacy JWT acceptance is rollout-only, not a permanent
default. VITE_API_BASE_URL is public frontend build configuration, not a backend
secret and not something to inject into the API image.

Mongo currently requires no environment variables locally. The production override
needs separate root/bootstrap and API readWrite credentials plus an internal
replica-set key. These must never replace existing database credentials silently.

## Sources reviewed

- [Compose merge/reset behavior](https://docs.docker.com/reference/compose-file/merge/)
- [Official Node image architecture metadata](https://github.com/docker-library/official-images/blob/master/library/node)
- [Official Mongo image architecture metadata](https://github.com/docker-library/official-images/blob/master/library/mongo)
- [MongoDB WiredTiger memory behavior](https://www.mongodb.com/docs/manual/core/wiredtiger/)
- [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
