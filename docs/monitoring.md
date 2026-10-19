# Admin monitor

Open `/monitor` on the backend HTTPS origin. Only `singhshashwat.dev@gmail.com`
can bootstrap or recover the dashboard password. Click **Verify with Google**, use
that account, and choose a 12–128 character password. Subsequent visits can use
the password. Verifying with Google again allows a reset and invalidates previous
dashboard sessions. No account is pre-created and there is no default password.

The monitor reuses the existing `/auth/google/callback` redirect URI. A separate
OAuth state, nonce, PKCE verifier and HTTP-only browser cookie bind this flow.
The verified email and Google subject are pinned independently of Alfred user
accounts. Passwords are salted with scrypt; proof tokens are single-use and expire
after ten minutes. Sessions expire after eight hours. Production cookies require
HTTPS. Login and password writes require the configured callback origin and JSON;
password hashing is globally serialized as well as rate limited per IP.

## Resource budget and suspension

There is no extra process, monitoring agent, cron task or background sampling
timer. Opening an authenticated visible dashboard requests one snapshot every
30 seconds. Multiple tabs share one in-flight collection and a 30-second cache.
Hidden tabs abort requests and stop polling. One collection already started on
the server may finish after the browser closes; provider requests have deadlines.
Closing the dashboard leaves only one cached snapshot and bounded lightweight
request counters/presence metadata. Charts retain at most 60 samples in the browser
tab, never in Atlas. Server restart clears traffic history and observations.

The earlier 1–5 MB idle / 5–20 MB active / 20–40 MB transient estimates are planning
estimates, not measured production guarantees. First-password/login scrypt also
needs approximately 16 MB per hash, with one hash allowed at a time. Node's memory
allocator may retain pages after a collection; suspending work does not force RSS
back down. Use the dashboard's process RSS/heap and container RAM cards to observe
real usage on Oracle. No automatic forced garbage collection is performed.

## Metrics and limits

- Backend health/readiness, uptime, process RSS and heap, OS-exposed host RAM/load,
  cgroup v2 container RAM/limit when available, and the backend filesystem's disk
  use. No Docker socket, root access or host filesystem mounts are needed. Missing
  container statistics show unavailable. Filesystem figures are not a sum of
  writable container layers or separate disks. RAM used includes OS cache.
- Requests in flight, unique accounts currently making requests, previous complete
  minute request/5xx count and mean latency. These are per backend process.
- Unique accounts observed in the last five minutes, capped at 10,000. Accounts
  are not people or devices; guests are included. A foreground heartbeat once per
  minute improves local-only presence on updated clients. Existing Beta 6 clients
  are counted only when they make an API request until a later app update ships.
  No heartbeat creates accounts, uploads workspace data or queues offline work.
- Atlas `dbStats` reads only aggregate application-database data, allocated document
  storage and indexes. It is not cluster-wide Atlas billing usage or a measure of
  all databases against the free-tier limit. No Atlas management credential is
  required; unsupported commands/permissions show unavailable rather than zero.
  Cluster-wide usage and an authoritative capacity percentage require an Atlas
  monitoring integration later.
- Google discovery and GitHub release API reachability are checked only on demand
  with four-second deadlines. Reachability does not certify end-to-end sign-in or
  downloads. AI and Firebase show configuration plus the most recent real request
  observed by this process, including timestamps; there are no paid AI health
  probes or test pushes. No observations means unknown, not healthy.

The monitor goes down with Oracle. Independent uptime alerts are not configured;
an external checker and notification destination are still needed for outage
alerts. This dashboard intentionally does not collect unattended history.

## Development validation

`npm --prefix Alfred_Backend run check`, `npm --prefix Alfred_Backend test`,
`npm run test:monitor-ui`, `npm run lint`, and `npm run build:development`.
Backend monitor integration tests use a disposable MongoDB and stubbed Google
tokens. They never log in to or modify the normal Atlas database.
