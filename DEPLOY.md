# Deploying bpuu-workflow

Node.js/Express app, gated behind KMUTT ADFS login (plus an optional ThaID
path for external users). Ships as a Docker image with no secrets baked in —
config comes entirely from environment variables at run time.

## Load & run

You received a **pre-built image**, not source — no `docker build` needed or
possible from what's in this zip. `bpuu-workflow-uat.env` is bundled in this
same zip, ready to use as-is — no separate file to track down.

```
# 1. Import the image (this restores the "bpuu-workflow:latest" tag)
docker load -i bpuu-workflow-image.tar.gz

# 2. Run it with the bundled env file:
docker run --env-file bpuu-workflow-uat.env -p 9999:9999 bpuu-workflow:latest
```

(If you ever do need to rebuild from source instead — e.g. after a code
change — that requires the actual repo, not this zip: `docker build -t
bpuu-workflow .` from the project root.)

**`bpuu-workflow-uat.env` contains real, live secrets** (ADFS, Master Data,
and ThaID client credentials, plus a session-signing secret) — treat this
zip itself as sensitive from here on, the same care you'd give any file with
live credentials in it. `REDIRECT_URI`/`POST_LOGOUT_REDIRECT_URI` and
`THAID_REDIRECT_URI` are already set to `bpuu-service-uat.kmutt.ac.th` and
already confirmed accepted by ADFS/DOPA respectively — no placeholders left
to fill in. Without `--env-file` (or the vars set some other way — `-e`, a
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
- `/external` (ThaID) is fully configured and live-verified end-to-end
  (real QR scan, real callback) as of 2026-07-21 — no placeholder state left
  here. If those credentials ever get unset, this path degrades gracefully
  to a friendly "not available" page rather than an error.
