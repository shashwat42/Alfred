# Implementation report — 18 October 2026

The existing Dockerized backend has been prepared for a protected GitHub Actions
deployment to an Oracle Linux VM. **No production server was contacted or deployed.**
The real Oracle deployment is not yet verified production-ready.

## Existing setup inspected

See the [audit recorded before implementation](oracle-deployment-audit.md): existing
Node 24 Dockerfile, three Compose services, environment loading, Mongo replica set
and named volume, auth/account isolation, OAuth callbacks, native CORS origins,
AI integrations, startup index/reconciliation operations, and absence of Actions.
No application database schema or existing persistent data was changed.

## Backend-root relocation

The Compose files and `deploy/oracle` directory now live inside `Alfred_Backend`.
Their relative paths below are relative to that backend root. The GitHub workflow
remains at the repository root, uses `Alfred_Backend` as its working directory, and
packages the backend deployment without an extra `Alfred_Backend` directory layer.
The project name and database volume identity are unchanged.

After relocation, the five deployment safety tests, local Compose validation,
production Compose validation with fixtures, shell syntax checks, and workflow
path checks passed from the backend root. No containers were restarted or
production deployments triggered as part of the relocation.

## Files changed for this request

| Files | Purpose |
| --- | --- |
| `.github/workflows/deploy-oracle.yml` | Automatic deployment on main updates plus manual main-only runs, protected production Environment, development tests, native architecture verification, CI builds, pinned SSH and secret delivery |
| `compose.production.yaml` | Override existing services: production runtime files, image references, authenticated/private Mongo, explicit external volume, bounded logs and stop grace periods |
| `deploy/oracle/config.py` | Validate the actual runtime settings and generate restricted raw env files; encode Mongo credentials safely |
| `deploy/oracle/database_identity.py` | Block adoption of populated unmanaged volumes and silent Mongo credential/volume changes |
| `deploy/oracle/deploy.sh` | Validate artifacts/Compose/CPU, preserve configuration snapshots and volume, apply services, require local/public readiness |
| `deploy/oracle/start-mongo.sh`, `mongod.conf`, `init-users.js` | Reuse official Mongo bootstrap with tmpfs keyfile and in-process root/API user setup for an approved empty volume |
| `deploy/oracle/init-replica-auth.js`, `mongo-health.js` | Authenticate initialization and distinguish final replica-mode Mongo from temporary bootstrap Mongo |
| `deploy/oracle/test_config.py`, `validate.sh` | Generator/identity safety tests and merged Compose checks without real secrets |
| `Alfred_Backend/Dockerfile` | Health check now uses database readiness `/ready`; retain existing image architecture and non-root runtime |
| `Alfred_Backend/server.ts`, `src/config/database.ts` | Add readiness, bounded database selection, graceful signal shutdown and sanitized startup errors |
| `Alfred_Backend/src/config/env.ts` | Omit raw invalid environment values from warnings |
| Backend auth/notes/tasks/schedule/AI controllers and AI tools | Log operation and error class rather than full driver/validation errors or user content |
| `.gitignore`, `.gitattributes` | Exclude generated configuration/key material and preserve Linux script/YAML line endings |
| `Alfred_Backend/README.md`, deployment audit/runbook/report | Link deployment instructions and document inventory, blockers, secret mapping, trust boundaries, recovery and results |

The local Compose configuration was relocated without changing its development
behavior. Real `.env` files, the database volume and running normal containers
were preserved. Existing unrelated uncommitted work was retained.

## GitHub setup and deployment

The [runbook](oracle-deployment.md#github-configuration) gives the complete names-only
secret-to-runtime mapping and variable inventory. Configure the `production`
Environment, restrict it to main, protect the branch, and supply the documented
JWT/Google/AI/Mongo credentials, dedicated SSH key/verified host-key entries, Oracle
connection settings, exact volume name and public HTTPS URLs. Runner/platform
selection variables are repository-level variables; runtime settings are
production Environment variables. No credentials or endpoints were invented.

The workflow runs automatically when a branch is merged into main (or main is
otherwise updated), and also supports manual main-only runs. It validates/tests, builds on a matching native CI runner,
verifies SSH/VM architecture, sends images and metadata, streams secret JSON via
SSH stdin, generates protected root runtime files, validates Compose, checks the
database identity, starts the same services, and checks local/public readiness.
Old restricted configuration remains as a backup. Mongo data is never deleted or
automatically migrated. The required Docker/root copy of runtime secrets is
explicitly documented; secrets do not remain exclusively inside GitHub.

## Locally verified

| Check | Actual result |
| --- | --- |
| Backend `npm run check` | Passed |
| Backend `npm test` with MODE=development | **86 passed, 0 failed**, isolated temporary replica sets/stub providers |
| Python deployment generator/identity tests | **5 passed**; reject unmanaged data/credential changes, unsafe settings and secret-bearing errors |
| Existing Dockerfile image build | Passed, `linux/amd64`, local validation tag |
| Production Compose merge/validation script | Passed with dummy settings, including production mode, raw values, private networks and external volume identity |
| Workflow YAML and guards | Parsed; main-only push trigger plus manual dispatch, main guard, production Environment, minimal permissions and immutable action references checked |
| Bash syntax | All deployment scripts and workflow run blocks passed syntax checks |
| Authenticated Mongo initialization | Passed on a separate local test volume/project with the production Mongo configuration |
| API connectivity and writes | Development-mode test API became ready, created a guest, and performed a transactional note write using the API-only Mongo user |
| Mongo security | Unauthenticated read rejected; API user has only readWrite on alfred |
| Persistence/repeated start | Saved guest session and note survived API and Mongo container recreation with the same disposable volume |
| Database outage readiness | `/ready` returned HTTP 503 while test Mongo was stopped |
| Graceful shutdown | Isolated test API stopped with exit code 0 |
| Secret exposure checks | No current local JWT/Google-secret/AI-key values found in tracked or non-ignored source; no environment files in built API image |
| Whitespace | Git diff check passed |

The Windows sandbox initially prevented temporary Mongo/socket/Git Bash operations.
The relevant checks were rerun with the needed local access and passed. The exact
Compose validation script ran through Git Bash using the installed Python
interpreter instead of the Windows Store python3 alias. This is not evidence that
the entire Linux SSH deployment workflow has executed.

The disposable validation containers, networks and newly created test volume were
removed after verification. The original `alfred` API and Mongo containers remained
healthy; their database volume was not removed or reused for testing.

## Still required on real infrastructure

No Oracle host, VM access, GitHub production secrets, domain, TLS termination,
production volume identity or OAuth project settings were provided. Therefore the
following remain **unverified**: GitHub-hosted-runner-to-VM access, root runtime
permissions on the VM, full Actions/SSH deployment execution, public HTTPS routing,
Google sign-in, production provider availability, production quota behavior under
traffic, ARM execution, VM reboot persistence, database backup restore, and capacity
under realistic load. The deployment workflow includes health gates but those are
not recorded as remotely passing.

Before deployment, provision the documented Linux/Docker/Python/SSH prerequisites,
verify the SSH fingerprint and firewall path, arrange HTTPS ingress with one trusted
proxy hop, register Google callback/origins, inspect the exact existing volume,
configure GitHub, and commit/review the needed files. Existing populated,
unauthenticated or unmanaged database adoption is intentionally blocked and needs
a separate backed-up plan. A fresh empty volume needs explicit operator creation
and one-time initialization authorization.

The 1 GB E2.1.Micro remains a capacity risk. The pre-change local idle snapshot was
about 442 MiB for API + Mongo, excluding OS, transient initialization and workload
peaks. No speculative hard memory or cache limits were applied. Test realistic
text/audio concurrency, OOM behavior and a VM reboot; use a larger VM if needed.
One replica-set member is not high availability, configuration snapshots are not
database backups, and process-local rate-limit/tool caches still require a single
API instance. Dedicated SSH deployment access is root-equivalent and must be
protected accordingly. Failure preserves data/configurations but is not an atomic
multi-service rollback; review the recovery instructions before launch.
