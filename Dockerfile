# syntax=docker/dockerfile:1

# --- dependencies ----------------------------------------------------------
# Built in a separate stage so the compilers never reach the runtime image.
FROM node:22-bookworm-slim AS deps

# better-sqlite3 normally downloads a prebuilt binary for this image. These
# packages are only the fallback for building it from source.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- runtime ---------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    REPORTS_DIR=/storage/reports \
    DB_PATH=/storage/data/library.db

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

# Mount points only - reports and the database live on volumes, never in the
# image. Owned by the unprivileged "node" user (uid 1000) that runs the app.
RUN mkdir -p /storage/reports /storage/data \
    && chown -R node:node /storage /app

USER node

EXPOSE 4000

# Uses the app's own /healthz endpoint, via Node's built-in fetch, so the
# image needs no curl or wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
