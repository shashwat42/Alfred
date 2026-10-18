# Alfred Docker and CI/CD guide

Updated: 18 October 2026

This guide explains what is implemented, how to use it locally, and what you must
configure before GitHub can deploy Alfred to Oracle Cloud.

**Current status:** the Docker setup and deployment workflow are implemented and
have passed local checks. An actual Oracle deployment has not been verified. Adding
the workflow file does not create a VM, configure GitHub secrets, or publish the API.

## 1. What each part does

| Part | Its job |
| --- | --- |
| Alfred desktop/web frontend | Displays the app and calls the backend API. It runs separately from these backend containers. |
| Docker image | A packaged copy of the backend code, Node.js and its runtime dependencies. |
| Docker container | A running instance of an image. Containers can be replaced during updates. |
| Docker Compose | Starts the backend and MongoDB together and connects them. |
| Docker volume | Holds MongoDB data independently of the containers. Replacing a container keeps this volume. |
| CI: continuous integration | Checks TypeScript, runs backend tests, and validates deployment configuration. |
| CD: continuous deployment | Builds the images, sends them to Oracle, updates the containers, and checks readiness. |
| GitHub Actions | Runs the CI/CD workflow when main changes or you manually start it. |
| Oracle VM | The Linux server that keeps running the production containers after GitHub finishes. |

The backend deployment does **not** build or publish a new desktop installer,
Android app, or hosted frontend. Those are separate release steps.

## 2. How the current system fits together

```text
Your computer                         GitHub                         Oracle VM
-------------                         ------                         ---------
Edit a feature branch
        |
Push branch and open PR
        |
Merge PR into main -----------------> Run validation
                                          |
                                    Build API image
                                    Package Mongo image
                                          |
                                    Connect through SSH ----------> Update existing services
                                    Supply production settings       |
                                                               Backend + MongoDB
                                                                     |
                                                               Check API readiness

Alfred frontend ------------------------------------------------> Public HTTPS API
                                                                     |
                                                               Private MongoDB
                                                               Persistent volume
```

The current workflow starts on **every push to main**, including ordinary merges,
squash merges, rebases and direct pushes. It has no path filter, so a documentation
change on main also triggers it. It also supports manual runs on main.

It does **not** currently run on feature-branch pushes or pull requests. Validation
runs after main is updated, before deployment. If validation fails, the deploy job
does not start. Use branch protection to require reviewed PRs if you want to prevent
direct pushes to main. An already running deployment is not canceled by a newer
merge; GitHub serializes these workflow runs.

All Compose, Docker and Oracle deployment files live under `Alfred_Backend`.
Run the local commands below there. The GitHub workflow remains at the repository
root in `.github/workflows`, with its command working directory set to `Alfred_Backend`.

## 3. The three services

| Service | Expected state | Purpose |
| --- | --- | --- |
| `backend` | Running and healthy | Express API on internal port 8000, running Node 24. |
| `mongo` | Running and healthy | MongoDB 8.0 holding accounts, notes, tasks, schedules and usage records. |
| `mongo-init` | Exited with code 0 | One-time startup task that checks/initializes the replica set and waits for a primary. |

**`mongo-init` exiting successfully is normal.** It is not supposed to stay running.

Mongo runs as a single-member replica set named `alfred` because the backend uses
database transactions. This enables transactions; it does not provide multiple
database copies or high availability. The database name is also `alfred`.

## 4. Local development on your Windows computer

Use PowerShell from the backend root:

```powershell
cd D:\Projects\Alfred\Alfred\Alfred_Backend
```

### Before starting

1. Start Docker Desktop and wait for its Linux engine to be ready.
2. Keep your existing `.env`. If it does not exist, copy
   `.env.example` to that filename and fill in your development values.
3. Make sure another backend is not already using port 8000.

Here `.env` means `Alfred_Backend/.env`. The frontend uses a separate `.env`
in the repository root. Both real environment files are ignored by Git; do not commit them.

### Start the backend and database

```powershell
docker compose up -d --build
```

The local API is at `http://localhost:8000`. Local Compose defaults to
`MODE=development`, so account storage and daily/monthly AI quota enforcement is
disabled. Authentication and account isolation still apply.

Start the frontend separately using your existing frontend/development command.
Its root `.env` should point at the local API:

```dotenv
VITE_API_BASE_URL=http://localhost:8000
```

Restart the frontend dev server after changing its environment settings.

### Everyday local commands

| What you want | PowerShell command |
| --- | --- |
| See container status | `docker compose ps -a` |
| Read backend logs | `docker compose logs --tail 100 backend` |
| Follow backend logs | `docker compose logs -f backend` |
| Read replica setup logs | `docker compose logs --tail 50 mongo-init` |
| Rebuild after changing backend code | `docker compose up -d --build backend` |
| Apply changes to `.env` | `docker compose up -d --no-deps --force-recreate backend` |
| Stop the local stack while preserving its database | `docker compose down` |

There is no source-code hot reload inside the current backend image. Rebuild it
after backend source changes. A plain container restart does not load changed
environment values; recreate the backend for those changes.

**Do not use `docker compose down --volumes` or `down -v` unless you deliberately
intend to delete the local Compose database.**

### Where local data lives

Local Compose normally uses the named volume `alfred_mongo-data`. It is managed by
Docker, not stored inside your repository. That database is separate from a MongoDB
service installed directly on Windows and separate from the Oracle database.

A saved login from another database may show session recovery after switching
backends. Signing in again or choosing a new guest uses the selected backend's
database; it does not copy your previous database into it.

## 5. Development versus production

| Setting | Local computer | Oracle deployment |
| --- | --- | --- |
| Compose configuration | `compose.yaml` | Base file plus `compose.production.yaml` |
| Application mode | Development by default | Explicit production mode |
| Configuration source | `.env` | GitHub production secrets/variables, delivered by the workflow |
| Image build | On your computer | In GitHub Actions, not on the VM |
| MongoDB authentication | Not enabled in the local setup | Root/bootstrap user, separate API user, replica-set key |
| MongoDB access | Docker network; no public host port | Private internal Docker network; no public host port |
| Database volume | Compose-managed local volume | Explicit existing external named volume on Oracle |
| API host port | Loopback 8000, configurable locally | Loopback 8000 behind separately configured public HTTPS ingress |
| Database contents | Your local development data | Independent production data |

Do not run just `docker compose up` on Oracle as a substitute for the production
workflow. That command selects the local development configuration.

## 6. What you need to do before the first Oracle deployment

### Step 1: Prepare the Oracle VM

You need a reachable Linux VM with:

- Docker Engine enabled to start at boot.
- Docker Compose **2.30 or newer**.
- Python 3, Bash, SSH, `curl`, `gzip`, `sha256sum` and `flock`.
- Sufficient storage for database data, transferred images and retained releases.
- A dedicated deployment SSH login that can run the workflow's deployment command
  using `sudo -n bash` without an interactive password prompt.

Deployment access is root-equivalent. Use a dedicated SSH key and protect it.
Installing these prerequisites and granting access are operator setup steps; the
workflow does not provision them.

For the initial AMD VM, use `linux/amd64`. A future ARM VM requires a matching
native ARM build runner and compatible CPU. The workflow verifies architecture
instead of silently running an image for the wrong platform.

The 1 GB E2.1.Micro still needs realistic load testing. The previous local idle
snapshot was about 442 MiB for API and Mongo combined, excluding the VM OS,
initialization and workload peaks. That is not proof of sufficient capacity.

### Step 2: Arrange network access and public HTTPS

There are two separate network paths:

1. **GitHub runner → Oracle SSH:** the runner must reach the configured SSH port
   through Oracle security rules and the host firewall.
2. **Alfred/browser → public HTTPS API:** a real HTTPS endpoint must forward to
   the VM's `127.0.0.1:8000` backend.

The deployment does not install a reverse proxy, issue certificates, create DNS
records or start ngrok. Those remain setup tasks. The current API assumes one
trusted proxy hop; that proxy must replace untrusted forwarded headers.

Do not expose MongoDB's port 27017 publicly. Opening port 8000 in an Oracle rule
does not by itself publish this API, because Compose binds it to host loopback.

Example public addresses used below are placeholders, not configured services:

```text
Frontend: https://app.example.com
API:      https://api.example.com
Callback: https://api.example.com/auth/google/callback
Ready:    https://api.example.com/ready
```

### Step 3: Set up the deployment SSH key and verify the host

Use a dedicated SSH key pair:

- Install the **public** key for the Oracle deployment login.
- Put the **private** key in GitHub's `OCI_SSH_PRIVATE_KEY` secret.
- The current workflow needs a key usable without an interactive passphrase prompt.
- Verify the server's host-key fingerprint through a trusted Oracle console/session,
  then save the corresponding known-hosts entry in `OCI_SSH_KNOWN_HOSTS`.

For the default SSH port, an entry usually has this shape:

```text
YOUR_ORACLE_HOST ssh-ed25519 VERIFIED_SERVER_PUBLIC_KEY
```

For a custom port, the hostname field uses `[YOUR_ORACLE_HOST]:PORT`. Use the actual
verified server key and hostname/IP that `OCI_HOST` will contain. The server host
key is different from your deployment login key. Do not disable host-key checking
or trust an unverified key merely because a network scan returned it.

### Step 4: Identify the production database volume

On the Oracle VM, inspect the available volumes:

```bash
docker volume ls
```

Set GitHub variable `OCI_MONGO_VOLUME` to the **exact** intended volume name.
The original Compose project's default name is `alfred_mongo-data`.

If this is a deliberately fresh server with no existing database, explicitly create
the chosen empty volume on that VM. For example, only if this is the name you chose:

```bash
docker volume create alfred_mongo-data
```

Then set `OCI_ALLOW_EMPTY_DATABASE=true` for the first initialization. After the
first successful deployment, set it back to `false`.

If the volume already contains unmanaged or unauthenticated MongoDB data, **stop
and plan a backed-up adoption/authentication change separately**. The deployment
intentionally refuses it. Do not clear the volume or fake the identity file to
get past the check. No local-to-Oracle data migration is included.

### Step 5: Create the GitHub production Environment

In the repository settings, create an Environment named exactly `production` and
restrict its deployment branches to `main`. Put the production secrets and runtime
variables below in that Environment.

For fully automatic deployment after a merge, do not require Environment reviewer
approval. If you enable required reviewers, the workflow will wait for that approval
before deploying. Branch protection/review rules can still require PR review.

### Step 6: Add the GitHub secrets

| Secret name | What you supply |
| --- | --- |
| `JWT_SECRET` | Stable random signing secret, at least 32 characters. Changing it invalidates existing sessions. |
| `GOOGLE_CLIENT_ID` | Production Google OAuth Web client ID. |
| `GOOGLE_CLIENT_SECRET` | Secret for that Google OAuth client. |
| `LLM_API_KEY` | Production AI provider key. |
| `MONGO_ROOT_USERNAME` | Chosen Mongo bootstrap/admin username. |
| `MONGO_ROOT_PASSWORD` | Strong independent admin password, at least 20 characters. |
| `MONGO_APP_USERNAME` | A different username for the API's database access. |
| `MONGO_APP_PASSWORD` | Strong independent API database password, at least 20 characters. |
| `MONGO_REPLICA_KEY` | Random single-line base64 key for internal replica-set authentication. |
| `OCI_HOST` | Oracle SSH hostname or IP, without `https://`. |
| `OCI_SSH_PRIVATE_KEY` | Complete private deployment key, preserving its header/footer and newlines. |
| `OCI_SSH_KNOWN_HOSTS` | Trusted known-hosts entry for that Oracle host and SSH port. |

Use separate production credentials. Do not reuse development secrets or values
from test fixtures. Mongo usernames must be different and contain only letters,
digits, underscores or hyphens, starting with a letter.

If you need to generate new random signing/password values, run this locally in a
private terminal, once per value, and paste each result into its GitHub secret:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

For a new replica key:

```powershell
python -c "import base64,secrets; print(base64.b64encode(secrets.token_bytes(384)).decode())"
```

Generate Mongo credentials only for initial setup or a planned rotation. Changing
their GitHub secrets later does not change an existing MongoDB user; deployment
will refuse a mismatch instead of silently resetting the database.

### Step 7: Add the GitHub variables

**Production Environment variables:**

| Variable | What you supply |
| --- | --- |
| `OCI_SSH_USER` | The actual deployment login on the Oracle VM. |
| `OCI_SSH_PORT` | Optional SSH port; default 22. |
| `OCI_MONGO_VOLUME` | Exact existing Oracle Docker volume name. |
| `OCI_ALLOW_EMPTY_DATABASE` | `true` only for an explicitly approved first empty initialization; otherwise `false`. |
| `FRONTEND_URL` | Public HTTPS frontend origin, such as the placeholder `https://app.example.com`. |
| `ALLOWED_ORIGINS` | Comma-separated exact permitted HTTPS web origins, without trailing slashes or wildcards. Native Tauri origins are supported too. |
| `GOOGLE_CALLBACK_URL` | Public API URL ending `/auth/google/callback`. |
| `PUBLIC_HEALTH_URL` | Same API origin ending `/ready`. |
| `ALFRED_SETTINGS_JSON` | Optional non-secret tuning; leave unset to use existing defaults. |

**Repository-level variables:** these must be available before GitHub selects the
build runner, so do not put them only in the production Environment.

| Variable | Initial AMD setup |
| --- | --- |
| `OCI_PLATFORM` | `linux/amd64`, also the default when unset. |
| `OCI_BUILD_RUNNER` | `ubuntu-24.04`, also the default when unset. |

For a future compatible ARM VM, use `linux/arm64` and an available native ARM runner
such as `ubuntu-24.04-arm`. Runner availability depends on your repository/account.

You do **not** need to add a production `MONGODB_URI` secret: the workflow constructs
it from the API user's Mongo credentials. It also sets `MODE=production`,
`NODE_ENV=production` and `PORT=8000` automatically. No Oracle API key is used by
this deployment; it connects over SSH.

For supported optional tuning keys and defaults, see the
[complete runtime inventory](oracle-deployment.md#all-other-api-settings).

### Step 8: Configure Google OAuth and the frontend

Register the exact production `GOOGLE_CALLBACK_URL` as an authorized redirect URI
on the matching Google OAuth Web client. Finish any required consent-screen and
audience setup in that Google project. A registered localhost or ngrok callback
does not automatically authorize the production URL.

Point the production frontend/desktop build at the public API, for example:

```dotenv
VITE_API_BASE_URL=https://api.example.com
```

Replace the placeholder with your real API origin. Vite embeds this setting when
building the frontend; deploying the backend does not rewrite an already installed
desktop app. Never add JWT, Google client secrets, database passwords or AI keys
to `VITE_` variables.

### Step 9: Commit the implementation and start deployment

Review and commit the Docker, workflow, `deploy/oracle` scripts and all backend
modules they depend on. Files that exist only as local untracked files are not
available to a GitHub Actions checkout. Keep real `.env` files and keys out of Git.

Once the Oracle/GitHub prerequisites are complete:

1. Push your feature branch and open a PR into main.
2. Merge the PR.
3. Open the repository's Actions runs and select **Deploy backend to Oracle**.
4. Watch the `validate` job, then the `deploy` job.
5. If validation fails, fix the failure and merge the correction before expecting
   an automatic deployment.

For a manual redeploy, select that workflow, choose **Run workflow**, and select
`main`. A manual run on another branch is skipped by the job guards.

## 7. What happens during deployment

1. GitHub checks out the main commit.
2. It runs backend TypeScript checks and tests in development mode with isolated
   databases/stubbed AI providers.
3. It runs deployment safety tests and validates the production Compose merge
   using dummy settings.
4. The deploy job verifies SSH connectivity and the VM/build architecture.
5. GitHub builds the existing backend image and packages a matching Mongo image.
   There is no image registry login or source build on the Oracle VM.
6. GitHub transfers images and deployment scripts over SSH. It sends secret
   configuration through encrypted SSH stdin, without putting secrets into images.
7. The root deployment script generates protected runtime files on Oracle, validates
   configuration, checks image identities and verifies the selected database volume.
8. It starts MongoDB, runs replica initialization, and updates the API container.
9. It checks container health, local API production readiness, and public HTTPS
   readiness before marking the release current.

GitHub can finish and the SSH session can close; Docker keeps the containers running.
Restart policies and retained files support restarts independently of GitHub.

## 8. Where production settings and data live

| Location on Oracle | Contents |
| --- | --- |
| The named volume chosen by `OCI_MONGO_VOLUME` | MongoDB data. |
| `/opt/alfred/releases/<release>/` | Retained Compose files, deployment scripts, metadata and runtime configuration for a release. |
| `/opt/alfred/releases/<release>/runtime/backend.env` | API environment generated from GitHub settings. |
| `/opt/alfred/releases/<release>/runtime/mongo.env` | Database bootstrap/internal authentication settings. |
| `/opt/alfred/database-config.json` | Protected record used to detect unsafe database/credential changes. |
| `/opt/alfred/current` | Symlink to the last release that passed deployment readiness gates. |

Runtime directories/files are intended to be root-owned with restricted permissions.
GitHub is the source of production settings, but **copies remain on Oracle** and
Docker stores container environment values in its metadata. Root/Docker administrators
can access them. Never share expanded Compose configuration, runtime files or raw
environment dumps in screenshots/issues.

Keep the current and previous release directories: bind-mounted scripts must remain
available after a Docker/VM restart. Older configuration snapshots are backups of
configuration, **not backups of the database**. Arrange and restore-test database
backups separately; a persistent volume alone does not protect against VM/disk loss.

## 9. Useful read-only checks on Oracle

These commands are for a Linux SSH session on the Oracle VM:

```bash
# Show Alfred containers and health without dumping their environments.
sudo docker ps -a --filter label=com.docker.compose.project=alfred

# Find the last release that passed all deployment gates.
sudo readlink -f /opt/alfred/current

# Test the API locally on the VM.
curl --fail http://127.0.0.1:8000/health
curl --fail http://127.0.0.1:8000/ready

# View recent API logs; the normal project/service name is alfred-backend-1.
sudo docker logs --tail 100 alfred-backend-1
```

`/health` confirms HTTP availability. `/ready` also checks writable MongoDB
availability and reports the application mode. Neither proves that Google sign-in
or the AI provider is working; check those flows separately after deployment.

## 10. Common problems

| Symptom | What it means / what to do |
| --- | --- |
| `dockerDesktopLinuxEngine` pipe is missing | Start Docker Desktop's Linux engine before local Compose commands. |
| `mongo-init` shows Exited (0) | Normal: replica initialization finished successfully. |
| Local port 8000 is already allocated | Another backend is using it. Stop that process or choose a different local Docker port and update frontend/OAuth URLs. |
| Google opens an offline ngrok page | A stale callback is still configured. Correct the callback, recreate the local backend, and start a fresh sign-in attempt. |
| Saved session cannot be restored after switching databases | The session belongs to the previous database. Use Google/new guest for the selected database; old data was not copied. |
| No Actions run after merging | Verify the workflow is committed to main and GitHub Actions is enabled. Check whether the push came from another workflow using a token that suppresses recursive workflow runs. |
| Deploy job waits for approval | The production Environment has required reviewers configured. Approve it, or remove that requirement for automatic deployment. |
| SSH connection times out | Check the Oracle host/port, public/private routing, OCI network rules and host firewall. |
| Host-key verification fails | Verify the actual server fingerprint through a trusted channel and correct the known-hosts entry. Do not bypass the check. |
| Image/VM architecture mismatch | Correct the repository-level platform and native build runner settings. |
| Missing production setting | Check the exact secret/variable name and its scope: production Environment versus repository. |
| Existing database is unmanaged | Back up and plan adoption/authentication separately; do not erase data to bypass the guard. |
| Mongo credential identity changed | GitHub settings no longer match the stored bootstrap identity. Restore the intended values or plan a coordinated rotation. |
| Public readiness fails but local readiness works | Check DNS, certificate, HTTPS forwarding and the public readiness URL. |
| Containers stop under load | Inspect VM memory/OOM/disk pressure. The 1 GB instance may require a larger replacement. |

A failed deployment can leave some services running the attempted release while
`current` still points to the last successful release. Do not assume an automatic
rollback occurred. Preserve the data and protected release files, inspect the failed
Actions step, and use the [recovery runbook](oracle-deployment.md#failure-recovery-rotation-and-backups).

## 11. What has and has not been verified

Verified locally during implementation:

- 86 backend tests and 5 deployment safety tests passed.
- Backend TypeScript checks and an amd64 Docker image build passed.
- Production Compose validation passed with dummy credentials.
- An isolated development test API connected to authenticated MongoDB and wrote data.
- Unauthenticated database access was rejected.
- A guest session and note survived API/Mongo container recreation.
- Readiness detected database loss; the API shut down with exit code 0.

Still requires your real infrastructure:

- A complete GitHub Actions deployment to Oracle over SSH.
- Actual public HTTPS and Google OAuth configuration.
- Real production AI provider availability.
- ARM execution, if you choose ARM.
- Persistence after a deliberate VM reboot and a tested database backup restore.
- Memory/capacity under realistic text/audio workloads and production traffic.

## 12. Your next actions

- [ ] Prepare the Oracle VM and enable Docker at boot.
- [ ] Set up public HTTPS forwarding to its loopback API port.
- [ ] Configure and verify the deployment SSH key and server fingerprint.
- [ ] Confirm the exact persistent volume; authorize empty initialization only if appropriate.
- [ ] Create the GitHub production Environment and add all listed secrets/variables.
- [ ] Register the production Google OAuth callback.
- [ ] Configure the production frontend's public API URL.
- [ ] Review/commit the implementation and merge into main.
- [ ] Watch validation/deployment and fix any failed prerequisite.
- [ ] Verify app flows, reboot persistence, backup restore and VM capacity before launch.

## File reference

Compose and `deploy/oracle` paths in this table are relative to `Alfred_Backend`.
The `.github` and `docs` paths are relative to the repository root.

| File | Why you would open it |
| --- | --- |
| `compose.yaml` | Local services and default development behavior. |
| `compose.production.yaml` | Overrides applied by production deployment. |
| `Dockerfile` | How the API image is built and started. |
| `.github/workflows/deploy-oracle.yml` | Triggers, tests, image build and SSH deployment. |
| `deploy/oracle/config.py` | Supported production settings and runtime file generation. |
| `deploy/oracle/deploy.sh` | What the Oracle deployment process executes. |
| `deploy/oracle/database_identity.py` | Database safety checks. |
| `docs/oracle-deployment.md` | Detailed operational/security runbook. |
| `docs/oracle-deployment-audit.md` | Audit made before the production deployment changes. |
| `docs/oracle-deployment-report.md` | Per-file changes, validation results and remaining limits. |
