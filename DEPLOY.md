# Deploying bpuudemo

Node.js/Express app, gated behind KMUTT ADFS login (plus an optional ThaID
path for external users). Ships as a Docker image with no secrets baked in —
config comes entirely from environment variables at run time.

## Build & run

```
docker build -t bpuudemo .
docker run --env-file bpuudemo-uat.env -p 9999:9999 bpuudemo
```

`bpuudemo-uat.env` was sent separately (not in this repo) — it has the real
ADFS/Master Data credentials already filled in. **`REDIRECT_URI` and
`POST_LOGOUT_REDIRECT_URI` in that file are placeholders** — they need to be
the actual host/port this container ends up reachable at, and that same
`REDIRECT_URI` needs to be registered on the KMUTT ADFS Relying Party Trust
for this client (`70443b94-...`) or login will fail with an invalid-redirect
error, same as we hit during local testing.

## TLS

The app listens on `PORT` (default `9999`). If `TLS_CERT_PATH`/`TLS_KEY_PATH`
env vars point to a mounted cert+key, it serves HTTPS directly; otherwise it
falls back to plain HTTP with a console warning. ADFS requires an HTTPS
redirect_uri regardless — so either terminate TLS at a reverse proxy /
ingress in front of this container (typical, and what we'd default to), or
mount a real cert and set those two env vars if the container should
terminate TLS itself.

## Health check

`GET /api/me` always responds (200 or 401, never requires auth) — use it for
a liveness/readiness probe.

## Notes

- Sessions are in-memory (single instance only, no shared session store yet
  — fine for UAT with expected traffic, worth revisiting before real
  production load).
- `/external` (ThaID) shows a friendly "not available" page until
  `THAID_CLIENT_ID`/`THAID_CLIENT_SECRET` are set — no code changes needed
  once DOPA issues real credentials, just fill in the env file.
