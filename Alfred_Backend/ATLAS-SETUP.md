# Connect the local Alfred backend to Atlas

This connects the backend running on your computer to Atlas. It does not move the
backend to Oracle or migrate any existing database contents. The previous local MongoDB test containers and volume have been removed; their
test data is not migrated or backed up.

## 1. Atlas settings

- Use the **Free (M0)** cluster, not a paid Flex or Dedicated cluster.
- Use a database user with `readWrite` on database `alfred`.
- Allow your computer's current **public IP** under Network Access. Programs on
  localhost connect through that public IP; adding `127.0.0.1` will not allow them.
- Later, add the Oracle instance's outbound public IP as a separate entry.
- Any password previously shared in a screenshot should be reset before use.

## 2. Save the connection string privately

In Atlas, select **Connect → Drivers and Client Libraries → Node.js Driver**.
Compression and Legacy URI String can remain off.

Copy the URI and edit `MONGODB_URI` in `Alfred_Backend/.env`. Preserve the actual
cluster hostname shown by Atlas and use your application user's new password.
Set the database path to `/alfred` before the query string. A template is:

```dotenv
MONGODB_URI=mongodb+srv://YOUR_APP_USERNAME:YOUR_URL_ENCODED_PASSWORD@YOUR_CLUSTER_HOST/alfred?retryWrites=true&w=majority&authSource=admin
```

Replace all three placeholders. URL-encode special characters in the username or
password; do not encode the entire connection string. The authentication database
for Atlas password users is `admin`, even though the application data is in `alfred`.
Keep any additional Atlas connection options you need. Do not put this value in a
frontend `VITE_` variable, commit it, or paste the completed URI into chat.

The cluster name and database name are different. You do not need to manually make
collections first: Alfred's normal startup creates its additive indexes and the
application creates records when used.

## 3. Run the local backend

From PowerShell:

```powershell
cd D:\Projects\Alfred\Alfred\Alfred_Backend
docker compose up -d --build backend
```

The default Compose file runs only the backend and uses `MONGODB_URI` from
`.env`. It defaults to development mode. The older `compose.atlas.yaml` override
is retained as a compatibility alias and is no longer needed.

If this network blocks Atlas SRV lookups, set
`MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8` in `.env`. This override applies only to the
backend process. Leave it unset on networks where normal DNS works.

If you run the backend directly with `npm run dev`, it already reads `.env`; no
Compose override is needed. Run only one backend on port 8000 at a time.

After editing `.env` again, apply it with:

```powershell
docker compose up -d --no-deps --force-recreate backend
```

The frontend remains on your computer and can keep
`VITE_API_BASE_URL=http://localhost:8000`. Google OAuth stays configured for this
local backend until the backend itself is deployed elsewhere.

## 4. Check connection without sharing secrets

```powershell
docker compose ps -a
docker compose logs --tail 50 backend
```

A healthy backend means its readiness check can reach a writable database. The
backend must authenticate successfully and support transactions; it does not need
an Atlas admin user. Do not dump expanded Compose configuration into logs, because
it contains resolved runtime credentials.

Normal startup creates the application's collections and indexes. It creates
no sample accounts or content. The old local test data is discarded at your request.
Saved sessions belong to a specific database, so use a new guest session or Google
sign-in when switching from the old local database.

The optional `compose.local-mongo.yaml` file can explicitly create a separate local
development database. It is not part of normal Atlas startup.

## Oracle deployment later

The Oracle production workflow now deploys only the API and reads its Atlas URI
from the GitHub `MONGODB_URI` environment secret. Add Oracle's outbound public IP
to Atlas Network Access before deploying. See the
[Oracle runbook](../docs/oracle-deployment.md) for SSH, HTTPS and environment setup.
No production deployment is performed by local Atlas setup.

References:
[Create a Free cluster](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/),
[Database user authentication](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/),
[IP access list](https://www.mongodb.com/docs/atlas/security/ip-access-list/).
