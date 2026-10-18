# Alfred backend

Oracle Cloud / GitHub Actions deployment: [production runbook](../docs/oracle-deployment.md).
The Oracle workflow now uses Atlas and deploys only the API container. Complete
server SSH, HTTPS and GitHub repository Actions settings before the first deployment.
The [GitHub setup checklist](../docs/GITHUB-ORACLE-SETUP.md) lists the exact secrets
and variables for the current Oracle server.

Local backend using MongoDB Atlas: [Atlas setup](ATLAS-SETUP.md). Use
`docker compose up -d --build`
after setting the private `MONGODB_URI` in this directory's `.env`.

This directory is the Docker and deployment root. It contains `Dockerfile`,
`compose.yaml`, `compose.production.yaml`, `docker/`, and `deploy/oracle/`.
The GitHub Actions workflow stays at the repository's `.github/workflows` location
and runs its commands from this directory.

## Docker Compose

For the container plus an ngrok HTTPS tunnel, run from the **repository root**:

```powershell
npm run dev:backend
```

Start Docker Desktop first and install/authenticate ngrok on your PATH. The command
checks the Atlas URI in `Alfred_Backend/.env`, starts or reuses a tunnel to port 8000,
updates the frontend API URL and backend Google callback, then rebuilds/recreates
the backend container and waits for database readiness. It forces development mode
and never starts a local MongoDB container. Register the printed callback URL in
Google Cloud's authorized redirect URIs. Restart an already running frontend after
its API URL changes.

Ctrl+C stops the ngrok process started by this command; a reused tunnel and the
backend container remain running. To stop the container from the repository root:
`docker compose -f Alfred_Backend/compose.yaml stop backend`.
The old `npm run dev:ngrok` command remains an alias for `npm run dev:backend`.

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
3. Set `MONGODB_URI` to your Atlas URI with database `/alfred` and `authSource=admin`.
   Allow this computer's public IP in Atlas Network Access. Start the backend:

   ```powershell
   docker compose up -d --build
   ```

The API is available at `http://localhost:8000`; `/health` reports HTTP availability
and `/ready` verifies that the database has a writable transaction topology.
Compose explicitly sets `MODE=development`, so development quota bypasses apply.
The image installs only runtime dependencies and runs `node server.ts` as a non-root
user using Node 24's built-in TypeScript support.

The default Compose file runs only the API. It reads `MONGODB_URI` from `.env`
and uses Atlas for transactions and storage. Startup creates the required collections
and additive indexes; it does not migrate local data. Saved sessions from the old
local database require a fresh guest session or Google sign-in.

For networks where Atlas SRV lookups fail, set
`MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8` in the backend `.env`. This changes DNS only
inside the backend process and leaves the operating system DNS unchanged.

An optional local development replica set remains available explicitly:

```powershell
docker compose -f compose.yaml -f compose.local-mongo.yaml up -d --build
```

This optional override creates a separate disposable database and overrides the
Atlas URI. Normal `docker compose up` does not start MongoDB.

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
docker compose logs -f backend
docker compose ps -a
docker compose down
```

The optional local MongoDB override has no authentication and is intended only
for development on its private Docker network. Removing Docker containers does
not delete data hosted in Atlas.

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
