# ---- deps: install only production dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime image ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY css ./css
COPY js ./js
# ชุดข้อมูลสถานที่ตั้งต้น (read-only) — แอปจะคัดลอกลง /app/data ครั้งแรกที่บูต
# ถ้า volume ยังไม่มี locations.json ทำให้ทุก environment ขึ้นมาพร้อมข้อมูลชุด
# เดียวกันโดยไม่ต้อง docker cp เข้าไปเอง
COPY data-seed ./data-seed
COPY img ./img
COPY AW_MODlink_pro_vertical.jpg AW_MODlink_student_vertical.jpg ./

# เลขเวอร์ชันที่โชว์ใน footer — ผูกกับ build ตั้งแต่ตอนสร้าง image เพื่อไม่ให้
# เลขกับ build จริงหลุดจากกันตอน deploy:
#   docker buildx build --build-arg APP_VERSION=v.20260804-1 ...
# ยัง override ที่ runtime ผ่าน --env-file / -e APP_VERSION ได้ถ้าจำเป็น
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# /app itself is root-owned (created by WORKDIR/COPY above) and is NOT
# writable by the non-root "node" user this container runs as. admin-
# allowlist.json needs a real writable location — /app/data, chowned to
# "node" specifically, rather than loosening permissions on /app as a whole.
# Mount this as a volume for the allowlist to survive container restarts;
# without a mount it still works, it just resets to the seed admin on every
# restart (same as the in-memory session store's own limitation).
RUN mkdir -p /app/data && chown node:node /app/data

# node:20-alpine already ships a non-root "node" user — use it instead of root.
USER node

EXPOSE 9999

# No secrets, no config baked in here. Everything (ADFS_*, THAID_*,
# MASTERDATA_*, PORT, REDIRECT_URI, SESSION_SECRET, ADMIN_ALLOWLIST_PATH,
# ...) is supplied at `docker run` time via --env-file or -e — see
# DEPLOY.md. The app itself refuses to start with a clear error message if
# a required var is missing.
CMD ["node", "server.js"]
