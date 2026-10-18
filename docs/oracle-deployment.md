# Oracle deployment with MongoDB Atlas

The Oracle VM runs one Alfred API container. MongoDB stays on Atlas Free (M0).
No MongoDB image, replica-set initializer, named database volume or database admin
password is required on Oracle. The optional `compose.local-mongo.yaml` is only
for explicitly requested local development.

## First-time server setup

1. Use your existing **Always Free** Ubuntu 24.04 instance. Confirm the console
   marks the shape Always Free; do not create a paid load balancer, database or VM.
2. Connect using the private key matching the public key chosen during provisioning:
   `ssh -i PATH_TO_KEY ubuntu@PUBLIC_IP`.
3. Install Docker Engine and its Compose plugin using Docker's official Ubuntu
   repository. Compose must be at least 2.30. Install Python 3 and curl too.
4. Add the Oracle VM's outbound public IP to Atlas Network Access. Keep the local
   development computer's IP entry if it still needs access. Use an Atlas database
   user with `readWrite` on `alfred`; Atlas password authentication uses `admin`.
5. Configure a public HTTPS API hostname and reverse proxy to `127.0.0.1:8000`.
   Allow inbound 80/443 in OCI security rules and the instance firewall. Keep port
   8000 private. Restrict SSH to the sources you actually use; GitHub deployment
   runners also need SSH connectivity. HTTPS setup requires a chosen hostname.
6. Register `https://YOUR_API_HOST/auth/google/callback` in Google Cloud. Set the
   production frontend API URL to `https://YOUR_API_HOST` and rebuild installed apps.

## GitHub Actions configuration

The workflow is `.github/workflows/deploy-oracle.yml`. Configure its GitHub
repository Actions secrets and variables before deploying. See the
[exact GitHub setup checklist](GITHUB-ORACLE-SETUP.md). Backend changes pushed/merged
to `main` run isolated backend tests in development mode and validate deployment
configuration, then deploy if validation passes. Manual dispatch on `main` is also
supported.

Repository Actions secrets:

| Name | Value |
| --- | --- |
| `OCI_HOST` | Oracle public IP or DNS hostname |
| `OCI_SSH_PRIVATE_KEY` | SSH private key matching the VM's authorized public key |
| `OCI_SSH_KNOWN_HOSTS` | Verified SSH host-key entry for that server |
| `JWT_SECRET` | Stable random signing secret, at least 32 characters |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `LLM_API_KEY` | Assistant provider API key |
| `MONGODB_URI` | Private Atlas SRV URI using `/alfred` and `authSource=admin` |

Repository Actions variables:

| Name | Value |
| --- | --- |
| `OCI_SSH_USER` | `ubuntu` for the Ubuntu image |
| `OCI_SSH_PORT` | `22` unless intentionally changed |
| `OCI_PLATFORM` | `linux/amd64` for AMD E2; `linux/arm64` for Ampere |
| `OCI_BUILD_RUNNER` | Native runner matching that architecture; default `ubuntu-24.04` |
| `FRONTEND_URL` | HTTPS web frontend origin; native-only deployment can use `https://tauri.localhost` |
| `ALLOWED_ORIGINS` | Comma-separated exact frontend origins, including packaged app origins |
| `GOOGLE_CALLBACK_URL` | Public API URL ending `/auth/google/callback` |
| `PUBLIC_HEALTH_URL` | Same public API origin ending `/ready` |
| `ALFRED_SETTINGS_JSON` | Optional backend settings JSON; defaults `{}` |

Do not configure the obsolete `MONGO_ROOT_*`, `MONGO_APP_*`, `MONGO_REPLICA_KEY`,
`OCI_MONGO_VOLUME`, or `OCI_ALLOW_EMPTY_DATABASE` settings. If Atlas SRV lookups fail
on the server network, optional settings can include
`{"MONGODB_DNS_SERVERS":"1.1.1.1,8.8.8.8"}`.

## What deployment does

CI builds the API image on GitHub's runner, checks its architecture, compresses it,
and transfers it to the VM over SSH with strict host-key checking. Configuration
travels separately on SSH stdin; it is not baked into the image. Docker does not
build on the small VM. No registry subscription is required.

The root-owned `/opt/alfred/releases/RELEASE/` directory stores the image metadata,
Compose files and runtime files. Runtime directories use mode 700 and secret files
600. Root and Docker administrators can still inspect container environments.
Deployment starts the API, verifies local database readiness and public HTTPS
readiness, then updates `/opt/alfred/current`. This is a real production deployment;
automated tests remain in development mode and use isolated fixture databases.

The API binds to localhost:8000, drains requests on shutdown and bounds container
logs. Atlas manages the database separately. An existing self-hosted MongoDB
installation causes deployment to stop for an explicit migration instead of
silently replacing or deleting its data. Failed deployments do not automatically
roll back a running container; inspect readiness and restore a known release if
needed. Previous release directories/images need periodic operator cleanup.

## Current setup status

The initial API deployment is live on the existing Always Free Ubuntu AMD micro VM.

| Setting | Current value |
| --- | --- |
| Oracle public IP | `137.23.49.88` |
| Public API origin | `https://alfred-137-23-49-88.sslip.io` |
| Readiness URL | `https://alfred-137-23-49-88.sslip.io/ready` |
| Google callback to register | `https://alfred-137-23-49-88.sslip.io/auth/google/callback` |
| VM architecture | `linux/amd64` |
| SSH user | `ubuntu` |
| Frontend origin | `https://tauri.localhost` |
| Allowed origins | `http://tauri.localhost,https://tauri.localhost` |

Docker Engine and Compose are installed; Caddy runs as a system service and
proxies HTTPS to the container's loopback port. Both start on boot. The backend
uses Atlas; no MongoDB container or volume exists on Oracle. The free sslip.io
hostname points directly at the VM and requires no ngrok process or DNS account.
Changing the VM's public IP requires a matching hostname/configuration update.

The current release was deployed manually from the working tree. GitHub repository
secrets/variables still need to be configured before merge-to-main deployment can
run. Backend pull requests run checks only; frontend-only changes skip deployment. Google sign-in requires saving the callback above on the existing Google
Web application OAuth client. Keep development redirect URIs if still used.

Installed apps need to be built with `VITE_API_BASE_URL` set to the public API
origin above. Tauri's CSP allows this exact origin. Local `dev:backend` continues
to use the local container and ngrok; its URL-sync helper selects that local tunnel.

Sources: [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/),
[Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
