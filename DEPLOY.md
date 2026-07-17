# Deploying bpuu-workflow

Node.js/Express app, gated behind KMUTT ADFS login (plus an optional ThaID
path for external users). Ships as a Docker image with no secrets baked in —
config comes entirely from environment variables at run time.

## Load & run

You received a **pre-built image**, not source — no `docker build` needed or
possible from what's in this zip.

```
# 1. Import the image (this restores the "bpuu-workflow:latest" tag)
docker load -i bpuu-workflow-image.tar.gz

# 2. Fill in REDIRECT_URI / POST_LOGOUT_REDIRECT_URI in the env file (see
#    below) to match wherever this container will actually be reachable,
#    then start it:
docker run --env-file bpuu-workflow-uat.env -p 9999:9999 bpuu-workflow:latest
```

(If you ever do need to rebuild from source instead — e.g. after a code
change — that requires the actual repo, not this zip: `docker build -t
bpuu-workflow .` from the project root.)

`bpuu-workflow-uat.env` was sent separately (not in this zip, not in any
repo) — it has the real ADFS/Master Data credentials already filled in.
**`REDIRECT_URI` and `POST_LOGOUT_REDIRECT_URI` in that file are
placeholders** — they need to be the actual host/port this container ends up
reachable at, and that same `REDIRECT_URI` needs to be registered on the
KMUTT ADFS Relying Party Trust for this client (`70443b94-...`) or login
will fail with an invalid-redirect error, same as we hit during local
testing. Without `--env-file` (or the vars set some other way — `-e`, a
Kubernetes Secret, etc.), the container starts and exits immediately with an
error naming exactly which required variable is missing.

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

## Before attempting a real login, check `GET /diagnostics`

Unauthenticated, safe to check before ADFS is even correctly configured —
it's the fastest way to confirm a deploy is set up right without needing a
working login first. Returns JSON: the actual `configuredRedirectUri` /
`configuredPostLogoutRedirectUri` this instance is using (confirm it matches
what's registered with ADFS and how you're actually reaching this
container), whether it's serving `https` or `http` internally, and whether
ADFS/ThaID/Master Data discovery succeeded at boot. Never returns a secret or
full client_id (only an 8-character preview).

## Notes

- Sessions are in-memory (single instance only, no shared session store yet
  — fine for UAT with expected traffic, worth revisiting before real
  production load).
- `/external` (ThaID) shows a friendly "not available" page until
  `THAID_CLIENT_ID`/`THAID_CLIENT_SECRET` are set — no code changes needed
  once DOPA issues real credentials, just fill in the env file.
