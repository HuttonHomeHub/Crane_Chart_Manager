# Crane Charts' production image. Multi-stage: the build stage compiles the front end
# and the native SQLite module; the runtime stage carries only the pruned production
# node_modules, the built dist/, the server and the vendored platform.

# ---- Build stage ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain for better-sqlite3 when no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# The shared platform is vendored; npm resolves its file: dependencies from here.
COPY vendor ./vendor
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

# ---- Runtime stage ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# All state lives under /config (the shared container standard): crane.db, uploads/
# and backups/. The entrypoint fixes their ownership at startup.
ENV NODE_ENV=production \
    PORT=5000 \
    DATA_DIR=/config
RUN mkdir -p /config

# Release version stamped in by the publish workflow (from VERSION). Reported at
# GET /health and /version, and shown in the app bar.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
# @hhh/server is a runtime dependency, installed as a link into the vendored platform.
COPY --from=build /app/vendor ./vendor
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 5000
VOLUME ["/config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The entrypoint runs as root, fixes ownership of the data folders, then drops to
# PUID:PGID with setpriv and execs the server, which stays PID 1 so SIGTERM reaches it
# for a graceful shutdown (server/index.ts).
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.ts"]
