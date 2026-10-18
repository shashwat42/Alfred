# Alfred backend

Oracle Cloud / GitHub Actions deployment: [production runbook](../docs/oracle-deployment.md).

This directory is the Docker and deployment root. It contains `Dockerfile`,
`compose.yaml`, `compose.production.yaml`, `docker/`, and `deploy/oracle/`.
The GitHub Actions workflow stays at the repository's `.github/workflows` location
and runs its commands from this directory.

## Docker Compose

Run commands from `Alfred_Backend` with Docker Desktop running Linux containers
and Docker Compose v2 installed:

```powershell
cd D:\Projects\Alfred\Alfred\Alfred_Backend
```

1. If `.env` does not exist, copy `.env.example` to
   `.env`. Keep an existing file and its credentials.
2. Set `JWT_SECRET` to a long random value and configure your Google OAuth client
   ID, secret, and callback URL. Set `LLM_API_KEY` for assistant features.
   Configuration is supplied at runtime; environment files are excluded from the image.
3. Start the backend and its database:

   ```powershell
   docker compose up -d --build
   ```

The API is available at `http://localhost:8000`; `/health` reports HTTP availability
and `/ready` verifies that the database has a writable transaction topology.
Compose explicitly sets `MODE=development`, so development quota bypasses apply.
The image installs only runtime dependencies and runs `node server.ts` as a non-root
user using Node 24's built-in TypeScript support.

MongoDB runs as a single-member replica set because account, storage, and AI usage
writes require transactions. The initializer preserves an existing replica set and
waits for a primary before the backend starts. MongoDB has no published host port.
Data persists in the Compose `mongo-data` named volume across container rebuilds
and `docker compose down`.

This is a **separate database** from MongoDB installed on your computer. Existing
accounts and content are not copied into Docker. A frontend with a saved session
from another database may need to sign in again or start a new guest session.
Compose overrides `MONGODB_URI` and `PORT` from the backend environment file to use
the container database and internal port 8000.

If another backend already uses port 8000, stop that backend yourself or choose a
different Docker port before starting:

```powershell
$env:DOCKER_API_PORT = "8001"
docker compose up -d --build
```

Point the frontend's `VITE_API_BASE_URL` to the chosen API URL and restart its dev
server. `GOOGLE_CALLBACK_URL` must use the browser-accessible API URL, for example
`http://localhost:8001/auth/google/callback`, and match an authorized redirect URI
in Google Cloud. Use your HTTPS tunnel URL there if accessing through a tunnel.
`FRONTEND_URL` and `ALLOWED_ORIGINS` must match the frontend's actual origin.
Never use the internal `mongo` hostname as a browser or OAuth callback address.

After editing `.env`, recreate the backend to load the new values:

```powershell
docker compose up -d --no-deps --force-recreate backend
```

A container restart alone keeps its previous environment. If Google sign-in opens
an old tunnel address, check `GOOGLE_CALLBACK_URL` and recreate the backend. For
local use, register `http://localhost:8000/auth/google/callback` as an authorized
redirect URI on the Google OAuth client (adjust the port if needed), then start a
fresh sign-in from Alfred; an already-open sign-in tab belongs to the old attempt.

Useful commands:

```powershell
docker compose logs -f backend mongo-init
docker compose ps -a
docker compose down
```

Do not add `--volumes` to the shutdown command unless you intend to delete the
Docker database. The local Compose MongoDB has no authentication and is intended
for development on its private Docker network.

## Deploying the API image

Build the backend independently of the local database:

```powershell
docker build -t alfred-backend .
```

Run it with a deployment environment file outside the image:

```powershell
docker run -d --name alfred-backend --init --restart unless-stopped --env-file ./backend-deployment.env -e MODE=production -p 127.0.0.1:8000:8000 alfred-backend
```

Set `PORT=8000` in that file. Supply a MongoDB URI for a reachable authenticated
replica set or managed cluster, with TLS as appropriate; `localhost` inside a
container refers to that container. Supply a stable random `JWT_SECRET` of at least
32 characters, real OAuth credentials and public HTTPS callback, the frontend
origin, and AI provider configuration. Put the API behind an HTTPS reverse proxy.
The image's health check calls `/ready`; it verifies HTTP and database readiness.
It does not verify AI provider availability.

Use one API instance with the current in-memory rate-limit and assistant tool
idempotency caches. A multi-instance deployment needs shared state for those features.
The local Compose configuration is for development; use the standalone image with
your deployment database and secrets for production.

References: [Compose startup conditions](https://docs.docker.com/compose/how-tos/startup-order/)
and [Node.js TypeScript support](https://nodejs.org/docs/latest-v24.x/api/typescript.html).
