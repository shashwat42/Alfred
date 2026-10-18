# Alfred Docker and CI/CD guide

## Local development

From the repository root run `npm run dev:backend`. This starts/reuses ngrok,
updates the local frontend URL and Google callback, then builds and starts the API
container in development mode. Database storage is on Atlas. Configure the private
Atlas URI in `Alfred_Backend/.env`; never put it in frontend variables.

Run `npm run dev:pc` separately to update/install and launch the Windows app.

Without ngrok, run `docker compose up -d --build` from `Alfred_Backend`.
Normal Compose starts only the backend. MongoDB containers are no longer needed.
The optional `compose.local-mongo.yaml` explicitly enables a separate disposable
local development database. Local `.env` files are excluded from Docker images.

## Oracle deployment

Follow [the current Oracle/Atlas runbook](oracle-deployment.md) for instance,
HTTPS, Atlas network access and GitHub repository Actions settings. Use the
[exact secrets and variables checklist](GITHUB-ORACLE-SETUP.md).

When a branch is merged into `main`, GitHub Actions validates the backend and
configuration, builds the API image, and transfers it to Oracle using SSH. The VM
runs that image with the Atlas URI supplied through protected runtime configuration.
GitHub requires the configured SSH key/host entry, backend secrets, Atlas URI and
public API URL. Tests do not use the real Atlas database. They run in development
mode with isolated databases and fixture credentials.

A public HTTPS reverse proxy sends requests to the API's private localhost port.
The workflow verifies both local readiness and public HTTPS readiness before it
reports success. It does not provision an Oracle VM, configure DNS or install the
reverse proxy by itself. Merging code before those prerequisites are ready will
fail deployment. No local MongoDB image or volume is deployed to Oracle.

## Useful commands

From `Alfred_Backend`:

```powershell
docker compose ps
docker compose logs --tail 50 backend
docker compose stop backend
docker compose up -d --build --wait backend
```

Changing `.env` requires recreating the container (`docker compose up -d
--force-recreate backend`). A restart keeps the old environment. Never print
expanded Compose configuration or full connection strings when sharing logs.

From the Oracle server, the protected current release is `/opt/alfred/current`.
Use sudo for server administration. Keep the SSH private key private and keep
Atlas and Oracle resources on their free eligible plans.
