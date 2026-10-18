# Oracle deployment runbook

This prepares the existing API, MongoDB and one-shot replica initializer for a
single Oracle VM. Docker/Compose commands run from `Alfred_Backend`; both Compose
files, the `docker` directory and `deploy/oracle` scripts live in that backend root.
The workflow remains in the repository-level `.github/workflows` directory and runs
its commands from `Alfred_Backend`. It does not provision a VM, configure DNS/TLS, copy development
data, enable authentication on an existing unauthenticated database, or deploy by
itself. Read the [pre-change audit](oracle-deployment-audit.md) first.

## What changes in production

From the backend root, the workflow merges `compose.yaml` with `compose.production.yaml`; development
continues to use `docker compose up -d --build` and its existing `.env` unchanged.
The production override uses the same service names, replica name `alfred`,
database `alfred`, member `mongo:27017`, and explicit existing Mongo volume.
There is one API process. No Redis, second database, or proxy container is added.

The API is bound to host `127.0.0.1:8000`. Mongo has no published ports and joins
only an internal Docker network. It uses authentication and a keyfile regenerated
into tmpfs at every container start. The API gets `readWrite` only on `alfred`;
root bootstrap credentials are supplied only to Mongo and the replica initializer.
Application schemas, JWT checks, account isolation and API routes remain intact.
Startup indexes are additive; no destructive migration or index synchronization is
run. `/health` retains its response. `/ready` checks a writable MongoDB topology;
Docker health uses `/ready`. SIGTERM drains HTTP connections and disconnects Mongo,
with a 35-second deadline inside the 45-second API Compose stop grace period.
Requests exceeding that shutdown deadline can be interrupted; AI request metadata
is reconciled at the next ordinary startup.

## GitHub configuration

Create a GitHub Environment named **production** and restrict it to **main**.
Protect `main` and review workflow/deployment-script changes. The workflow runs
automatically on pushes to `main`, including merge commits, squash merges and
rebases, and also accepts manual `workflow_dispatch` runs on `main`. It never
deploys pull requests or other branches. Require pull requests in branch protection
if all main updates must come through reviewed merges; direct pushes to main also
trigger deployment. Environment required reviewers, if configured, pause deployment
for approval; leave that requirement off if you want fully automatic deployment
after validation succeeds.
Commit the deployment files and all backend modules they depend on before running
it; local untracked files do not appear in a GitHub checkout.

Set these production Environment secrets (names only are shown):

| GitHub secret | Runtime destination |
| --- | --- |
| `JWT_SECRET` | API `JWT_SECRET` (stable, random, at least 32 characters) |
| `GOOGLE_CLIENT_ID` | API `GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | API `GOOGLE_CLIENT_SECRET` |
| `LLM_API_KEY` | API `LLM_API_KEY` |
| `MONGO_ROOT_USERNAME` | Mongo/initializer `MONGO_ROOT_USERNAME` |
| `MONGO_ROOT_PASSWORD` | Mongo/initializer `MONGO_ROOT_PASSWORD` |
| `MONGO_APP_USERNAME` | Mongo bootstrap `MONGO_APP_USERNAME`; API URI username |
| `MONGO_APP_PASSWORD` | Mongo bootstrap `MONGO_APP_PASSWORD`; API URI password |
| `MONGO_REPLICA_KEY` | Mongo/initializer `MONGO_REPLICA_KEY`, copied to Mongo keyfile |
| `OCI_HOST` | SSH destination only |
| `OCI_SSH_PRIVATE_KEY` | Dedicated SSH key, restricted temporary runner file |
| `OCI_SSH_KNOWN_HOSTS` | Verified SSH host-key entries, including custom port if used |

Mongo root and API users must be different. Use independently generated passwords
of at least 20 characters (32+ recommended). The replica key must be a single-line
base64 value of 6–1024 characters; generate a random base64 key, not a word or the
example/test fixture. Do not reuse development credentials. URI credentials are
percent-encoded by the generator; do not pre-encode the supplied password.

Set these production Environment variables:

Exception: set `OCI_BUILD_RUNNER` and `OCI_PLATFORM` as **repository variables**,
because runner selection/job initialization happens before Environment variables
are available. The other variables below belong in the production Environment.

| GitHub variable | Requirement |
| --- | --- |
| `OCI_SSH_USER` | Dedicated deployment login with the required sudo access |
| `OCI_SSH_PORT` | Optional, defaults to 22 |
| `OCI_PLATFORM` | `linux/amd64` for E2.1.Micro; optional default is amd64 |
| `OCI_BUILD_RUNNER` | Optional default `ubuntu-24.04`; use a native arm64 runner such as `ubuntu-24.04-arm` with an arm64 VM, subject to runner availability |
| `OCI_MONGO_VOLUME` | Required exact existing named volume; normal original project uses `alfred_mongo-data` |
| `OCI_ALLOW_EMPTY_DATABASE` | Default false. Set true only for the explicitly approved first initialization of an empty volume, then return to false |
| `FRONTEND_URL` | Required public HTTPS web origin for browser handoff |
| `ALLOWED_ORIGINS` | Required comma-separated exact HTTPS web origins; no wildcard. Native Tauri origins are also supported |
| `GOOGLE_CALLBACK_URL` | Required public HTTPS API URL ending `/auth/google/callback` |
| `PUBLIC_HEALTH_URL` | Required same API origin ending `/ready`; real TLS ingress must route it to this backend |
| `ALFRED_SETTINGS_JSON` | Optional JSON object of supported non-secret overrides below; all values must be strings |

For public/native clients, configure their **public** `VITE_API_BASE_URL` separately
to the HTTPS API origin. Never put any backend secret in a `VITE_` variable. Register
the exact production callback in the Google OAuth Web client and configure its
consent screen/audience. Do not use localhost or a development tunnel in production.
The current production OAuth cookie requires HTTPS. HTTP behind the TLS terminator
on host loopback is intentional; the browser-facing URL must remain HTTPS.

### All other API settings

The generator sets `MODE=production`, `NODE_ENV=production`, `PORT=8000`, and
constructs `MONGODB_URI` from the API-only Mongo credentials with
`authSource=alfred&replicaSet=alfred`. These are not separate GitHub secrets.
There is no cloud-provider API credential needed: deployment uses SSH.

These actual code variables can be supplied by matching key names inside
`ALFRED_SETTINGS_JSON`; missing keys use existing application defaults:

| Keys | Defaults / role |
| --- | --- |
| `STORAGE_QUOTA_BYTES`, `AI_DAILY_REQUESTS`, `AI_MONTHLY_REQUESTS` | 10000000, 50, 1000 |
| `RATE_LIMIT_GUEST_WINDOW_MS`, `RATE_LIMIT_GUEST_MAX` | 900000, 10 |
| `RATE_LIMIT_AUTH_WINDOW_MS`, `RATE_LIMIT_AUTH_MAX` | 900000, 30 |
| `RATE_LIMIT_API_WINDOW_MS`, `RATE_LIMIT_API_MAX` | 60000, 120 |
| `RATE_LIMIT_AI_WINDOW_MS`, `RATE_LIMIT_AI_MAX` | 60000, 20 |
| `LLM_BASE_URL` | Existing Google Gemini OpenAI-compatible HTTPS endpoint |
| `LLM_MODEL`, `LLM_FALLBACK_MODELS` | Existing primary/fallback model configuration; verify availability in the production Google project |
| `LLM_MAX_OUTPUT_TOKENS`, `LLM_TIMEOUT_MS` | 1024, 60000 |
| `LLM_SITE_URL`, `LLM_SITE_NAME` | Frontend URL, Alfred |
| `JWT_LEGACY_ACCEPT_UNTIL` | Unset; optional bounded UTC rollout deadline, never extend automatically |

Unknown keys, newlines in values, weak signing keys, wildcard origins, invalid URLs,
wrong platforms and unsafe volume names are rejected without printing values.
The inventory in the audit includes every variable read by runtime backend code.
Desktop-poll throttling remains the existing fixed limit, not a new environment setting.

## VM prerequisites and explicit blockers

Use a supported Linux VM with Docker Engine enabled at boot, Docker Compose
**2.30 or later**, Python 3, OpenSSH, Bash, `curl`, `gzip`, `sha256sum`, `flock`,
and sufficient disk space for Mongo data, two image generations and transfer archives.
Install Docker using its [official installation instructions](https://docs.docker.com/engine/install/ubuntu/).
This script uses Linux local Docker volumes, not a remote Docker context or network
volume driver. Docker/sudo access is effectively root access: dedicate and protect
the deployment identity. The workflow invokes its reviewed script using
`sudo -n bash`; configure that capability deliberately. This is not a restricted
sudo sandbox. A production operator should review that trust boundary.

Before the first workflow run:

1. Confirm `uname -m`: x86_64/amd64 for E2.1.Micro, aarch64/arm64 for a compatible
   larger ARM instance. Mongo 8 requires AVX on amd64 or ARMv8.2-A or newer on ARM.
   The remote script checks those CPU features. Official Node 24 Bookworm slim and
   Mongo 8 image metadata support both platforms; builds and remote image IDs are
   checked against the VM. ARM runtime verification is still required on real hardware.
2. Allow the chosen GitHub runner to reach SSH through OCI security lists/NSGs and
   the host firewall. A private-only VM needs an appropriate reachable runner or
   separately arranged connectivity. Do not open Mongo or port 8000 to the internet.
   The workflow verifies SSH and architecture before transfer; connectivity has not
   been established merely by adding this workflow.
3. Install the dedicated deployment public key. Verify the SSH host fingerprint
   through a trusted OCI console/session and set `OCI_SSH_KNOWN_HOSTS`; do not blindly
   accept a live `ssh-keyscan` result. Never disable host-key checking.
4. Provide working public HTTPS ingress/TLS termination forwarding to host
   `127.0.0.1:8000` with one trusted proxy hop, matching the API's existing
   `trust proxy=1`. Strip/replace incoming forwarded headers at that trusted hop.
   No proxy has been installed here. Missing TLS/domain configuration remains a
   deployment blocker, not an automatic HTTP fallback.
5. Verify the **exact** persistent volume identity. For a deliberately fresh VM
   with no existing database, the operator may explicitly create the chosen empty
   named volume and opt into first initialization. The script will not create a
   differently named replacement if inspection fails. If the selected volume already
   contains data and has no managed identity record, deployment stops before
   changing containers. Back up and separately plan authentication enablement or
   adoption; do not delete the volume, fake the identity record, or clear the data.
6. Ensure the Docker daemon restarts at VM boot. Verify that binding port 8000 does
   not conflict with another service and that no different project uses this volume.
   This deployment keeps Compose project name `alfred` to avoid duplicating services.

No Oracle host, access key, domain, production secret, or existing production volume
was provided for this implementation. No production connection or deployment was run.

## Deployment sequence and secret lifecycle

After configuring the Environment, merge a branch into main to run **Deploy backend
to Oracle** automatically. You can also run it manually on main to redeploy. Every
deployment waits for the validation job to pass, and deployments are serialized so
an active deployment is never canceled by a newer merge.

1. The validation job runs backend TypeScript checks, all backend tests using
   development mode/temporary replica sets/stub providers, generator security tests,
   shell syntax validation, and merged production Compose validation with fixtures.
   Production secrets are available only in the separate protected deploy job.
2. The deploy job checks native CI architecture, establishes pinned-host-key SSH,
   verifies the VM architecture, and builds the existing backend Dockerfile in CI.
   Mongo 8 is pulled for that same platform. Release-specific local image tags,
   image IDs, architecture metadata and an archive checksum accompany the images.
   No registry credentials or VM-side source build is required. Actions have minimal
   `contents: read` permission and immutable action SHA pins.
3. GitHub secrets are read by Python from environment variables, never interpolated
   into shell program text. Runtime files have 0600 permissions under a 0700 runner
   directory. Raw Compose env files preserve quotes, dollar signs and hashes.
   CI never runs expanded `docker compose config` in logs: production uses `--quiet`.
4. Non-secret artifacts transfer over SSH/SCP. Secret JSON travels over encrypted
   SSH **stdin** directly to the root deployment process, not through scp artifacts
   or command arguments. Root temporary input is removed on ordinary success,
   failure, or signal; runner temporary keys/configuration are removed in an
   `always()` step. A hard kill/VM power loss can prevent traps; any leftover root
   incoming directory remains protected and must be cleaned by the operator.
5. The VM generates root-owned 0600 files under `/opt/alfred/releases/<release>/runtime`
   and validates Compose **before** changing services. It verifies archive integrity
   and loaded image IDs/platform, then checks the explicit existing volume and its
   credential identity. It never deletes volumes, runs `down`, reconfigures a replica
   set, migrates application data, or rotates existing Mongo credentials.
6. The first explicitly approved empty initialization creates root and API users.
   The official Mongo image starts a temporary loopback-only standalone instance;
   the init script reads credentials in-process to avoid password command arguments.
   Authenticated replica initialization then waits for an elected primary. Mongo
   users are not recreated on subsequent starts. A root-only database identity file
   is written atomically before first initialization to support safe retry.
7. Compose starts Mongo, runs the existing idempotent replica initialization via an
   authenticated wrapper, then starts the API and waits for Docker health. Local
   `/ready` must report production mode; the public HTTPS readiness URL must succeed.
   `/opt/alfred/current` moves to the release only after those gates pass.

Secrets do **not** exist only in GitHub. The root-only runtime files and database
identity baseline persist on the VM, and Docker stores container environment values
in its metadata; root/Docker administrators can inspect them. Mongo stores its own
user credential verifiers. No secrets enter image layers, build args, source labels,
frontend bundles, action artifacts or normal deployment output. Restrict root/Docker
access, encrypt/back up the VM appropriately, and protect configuration backups too.

Old root-only release directories retain their prior configuration as deployment
backups; deployments never overwrite their secrets. Keep the current and previous
release files available: Docker bind mounts must still exist after daemon/VM reboot.
Apply an operator-reviewed retention policy to older releases and image archives.
GitHub and the SSH session are not required to remain running: restart policies,
Docker metadata, persistent storage, and retained files support independent restarts.

## Failure recovery, rotation and backups

Any changed Mongo volume, username, password, or key is refused against
`/opt/alfred/database-config.json`. Updating a GitHub secret alone does not change
an existing Mongo user. Plan database credential rotation separately with a tested
backup and coordinated user/key update; never overwrite the identity file to bypass
the gate. Changing JWT_SECRET invalidates existing sessions; keep it stable unless
performing an intentional signing-key rotation. Keep old configuration snapshots
restricted until the planned retention period expires.

On a failed deployment, configuration backups and data remain, but containers may
already be running some of the new release. There is no claim of atomic multi-service
rollback. Inspect status/health without dumping environments. Do not run `down -v`,
delete volumes, downgrade Mongo, or remove the identity file. An operator can reapply
the prior release's Compose files and runtime configuration after reviewing database
version compatibility. Keep SSH access available independently of API availability.

Configuration backups are **not database backups**. Before launch, implement and
restore-test consistent Mongo backups (replica-aware logical backup or a properly
quiesced volume snapshot) and retain them off the VM. This task does not silently
introduce a backup sidecar or claim data is protected merely by a named volume.

## Memory, capacity and remaining verification

The requested E2.1.Micro has very limited RAM. Measured local idle snapshot before
changes: API 321.1 MiB and Mongo 120.6 MiB. This excludes Oracle OS overhead, init
shells, request/audio buffers, index builds, and load; it is not a capacity test.
No arbitrary Docker hard memory cap, Node heap cap, Mongo cache override, worker pool
or swap requirement has been introduced. Mongo's default WiredTiger cache has a
minimum and is not the database process's total memory use. CI builds avoid loading
the VM with npm/build processes, and logs rotate at 3 x 10 MB per service.

Monitor RSS, available RAM, OOM events, disk space and request latency during realistic
text/audio workloads. A 1 GB host may be insufficient and require a larger VM. Swap
does not establish adequate physical capacity. One Mongo replica member provides
transaction support, not high availability. Rate-limit and tool idempotency caches
are still process-local and reset on restart; do not scale API replicas without a
separately designed shared-state change.

Before calling this a verified production deployment, check on the actual Oracle VM:
SSH/network/TLS/OAuth settings, authenticated transactions, health after deployment,
notes/tasks/schedules and account isolation, real provider availability, persistence
after API/Mongo recreation and a deliberate VM reboot, backup restore, repeated
deployments, production quotas, and memory under realistic concurrency. Local test
results and untested remote requirements are recorded in the implementation report.

References:
[Compose raw env files](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/),
[Compose merge requirements](https://docs.docker.com/reference/compose-file/merge/),
[Mongo image bootstrap implementation](https://github.com/docker-library/mongo/blob/master/8.0/docker-entrypoint.sh),
[MongoDB WiredTiger memory behavior](https://www.mongodb.com/docs/manual/core/wiredtiger/),
[Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
