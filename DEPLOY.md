# Deploying bpuu-workflow

Node.js/Express app, gated behind KMUTT ADFS login (plus an optional ThaID
path for external users). Ships as a Docker image with no secrets baked in —
config comes entirely from environment variables at run time.

## Load & run

You received a **pre-built image**, not source — no `docker build` needed or
possible from what's in this zip. `bpuu-workflow-uat.env` is bundled in this
same zip, ready to use as-is — no separate file to track down.

```
# 1. Import the image — the tag it restores is printed by this command,
#    e.g. "Loaded image: bpuu-workflow:uat-20260807"
docker load -i bpuu-workflow-image.tar.gz

# 2. Run it with the bundled env file (ใส่ tag ให้ตรงกับที่ขั้นที่ 1 พิมพ์ออกมา):
docker run -d --name bpuu-workflow --restart unless-stopped \
  --env-file bpuu-workflow-uat.env -p 9999:9999 \
  -v bpuu-workflow-admin-data:/app/data \
  bpuu-workflow:uat-20260807
```

แต่ละรอบส่งมอบใช้ tag ที่ระบุวันที่เสมอ ไม่ใช้ `:latest` เพราะ `:latest` จะถูก
เขียนทับทุกครั้งที่ load image ใหม่ ทำให้ container ที่ restart ขึ้นมาอาจกลาย
เป็นคนละ build โดยไม่รู้ตัว — ตรวจว่ากำลังรัน build ไหนได้จาก
`docker ps --format '{{.Image}}'` หรือดูเลขเวอร์ชันมุมขวาล่างของหน้าเว็บ
(ตรงกับ `GET /api/version`)

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

## Admin dashboard (`/admin`)

ADFS-gated (KMUTT login only — ThaID/external users can never qualify), and
allowlisted on top of that: only KMUTT emails in `admin-allowlist.json` can
actually see the page, seeded on first use from `ADMIN_SEED_EMAIL` (defaults
to `chotthanin.neti@kmutt.ac.th` if unset). Manage the allowlist through the
page itself once logged in as an existing admin, or by editing the file
directly.

**Mount a volume — required, not optional.** `/app/data` holds two files
(the directory is created writable specifically for this — `/app` itself is
read-only to the process):

- `admin-allowlist.json` — without the mount, admins added through the UI
  are lost on restart, reverting to just the seed admin (inconvenient).
- `approval-decisions.json` — the double-approval guard's record of who
  decided what on each approval step. Without the mount, a restart forgets
  every recorded decision and previously-decided approval links become
  clickable again (a real integrity gap, not an inconvenience — the app
  logs a warning at boot when this directory isn't writable).

```
docker run --env-file bpuu-workflow-uat.env -p 9999:9999 \
  -v bpuu-workflow-admin-data:/app/data \
  bpuu-workflow:latest
```

แท็บ "รายการคำขอ" และแท็บ "รายงาน" ดึงข้อมูลจาก JotForm จึงต้องมี
`JOTFORM_API_KEY` — **มีอยู่ในไฟล์ env ที่แนบมาแล้ว** ถ้าถูกลบออกไป สองแท็บนี้
จะขึ้นว่า "ยังไม่ได้ตั้งค่า JotForm API key" เฉย ๆ ไม่ใช่ error ส่วนการ login
และเมนูอื่นทำงานได้ตามปกติไม่ว่าจะมีคีย์หรือไม่

## แท็บ "รายงาน" ในหน้า `/admin`

รายงาน 11 ชุดตามไฟล์ต้นแบบ "รายงานระบบ Work Flow.xlsx" (พื้นที่ชั่วคราว/คู่สัญญา/
จอดค้างคืน/จอดรายเดือน แยกบุคลากร-บุคคลภายนอก-นักศึกษา, ตราประทับ, แจ้งปัญหา)
กรองตามช่วงวันที่คำขอ หน่วยงาน และประเภทผู้ยื่นได้ คลิกที่หมายเลขคำขอเพื่อดู
รายละเอียด เช่นทะเบียนรถครบทุกคัน และดาวน์โหลดเป็น CSV (UTF-8 BOM เปิดใน Excel
ภาษาไทยไม่เพี้ยน)

คอลัมน์กลุ่มใบเสร็จรับเงิน/ใบแจ้งหนี้/เลขที่ Voucher **แสดงเป็นช่องว่าง**
โดยตั้งใจ — ระบบ workflow ไม่ได้เก็บข้อมูลส่วนนี้ (เกิดขึ้นหลังจบกระบวนการ)
หัวคอลัมน์จึงเป็นสีเทาเพื่อให้เห็นว่าเว้นไว้ให้กรอกเอง ไม่ใช่ข้อมูลหาย

## KMUTT-hosted attachments (`/app/data/attachments`)

ไฟล์แนบจากฟอร์มถูกเก็บบนเครื่องนี้ ไม่ได้ฝากไว้กับ JotForm — ฟอร์มส่งเฉพาะ
ลิงก์ `/files/<signed-token>` (มีวันหมดอายุ, เปิดได้โดยไม่ต้อง login ใด ๆ)
เข้าไปใน q32_summary ให้ workflow/อีเมลใช้ต่อ

- **ต้อง mount volume `/app/data`** (ข้อเดียวกับ admin allowlist ด้านบน) —
  ไม่งั้นไฟล์แนบทั้งหมดหายทุกครั้งที่ redeploy
- แนะนำตั้ง `FILE_LINK_SECRET` ใน env (ถ้าไม่ตั้ง จะใช้ SESSION_SECRET เซ็น
  ลิงก์แทน — ใช้ได้ แต่ rotate session secret แล้วลิงก์เก่าจะตายหมด)
- อายุลิงก์ตั้งผ่าน `FILE_LINK_TTL_DAYS` (default 60 วัน) หมดอายุแล้วลิงก์
  ของจริงจะเด้งเข้าหน้า login KMUTT/ThaID แทนที่จะ 404
- สำรองข้อมูล: โฟลเดอร์ `attachments/` ใน volume คือตัวไฟล์ (`<id>.bin`) คู่กับ
  metadata (`<id>.json` — ชื่อไฟล์เดิม ผู้อัปโหลด เวลา) — backup ทั้งคู่

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
