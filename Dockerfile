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
COPY AW_MODlink_pro_vertical.jpg AW_MODlink_student_vertical.jpg ./

# node:20-alpine already ships a non-root "node" user — use it instead of root.
USER node

EXPOSE 9999

# No secrets, no config baked in here. Everything (ADFS_*, THAID_*,
# MASTERDATA_*, PORT, REDIRECT_URI, SESSION_SECRET, ...) is supplied at
# `docker run` time via --env-file or -e — see DEPLOY.md. The app itself
# refuses to start with a clear error message if a required var is missing.
CMD ["node", "server.js"]
