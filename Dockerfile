# Multi-stage build for docus — a Vue 3 + Hono personal knowledge base.
#
# Stage 1 (deps): install ALL deps, including dev deps, so we can run
# `vite build`. The native build step for better-sqlite3 needs
# python3 + make + g++ in addition to the Node base image.
#
# Stage 2 (build): produce the static bundle in dist/.
#
# Stage 3 (runtime): copy only the production node_modules + the
# prebuilt dist/ + the server/ source + tsx (used to run server/prod.ts).
# Runs as a non-root user on a single port that serves both the SPA
# and the /api/* Hono endpoints.

# ---------- 1. install ----------
FROM node:22-bookworm-slim AS deps

# Native build toolchain for better-sqlite3's node-gyp step.
# Without these, `npm ci` fails on the optional install attempt.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install with the lockfile so the prod image is reproducible.
# `--ignore-scripts` would skip better-sqlite3's native compile, which
# is fine IF we run a second pass with the toolchain present, but
# letting the install script run here is simpler and produces a
# working tree we can copy in the runtime stage.
COPY package.json package-lock.json* ./
RUN npm ci

# ---------- 2. build ----------
FROM deps AS build

# Type-check + bundle the SPA. vue-tsc -b runs the project references
# in tsconfig.app.json; vite then produces dist/.
COPY tsconfig*.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY server ./server
RUN npm run build

# Prune dev dependencies so the runtime image only carries what's
# needed to start server/prod.ts via tsx.
RUN npm prune --omit=dev

# ---------- 3. runtime ----------
FROM node:22-bookworm-slim AS runtime

# Tini gives us proper SIGTERM/SIGINT handling so `docker stop` doesn't
# leave a half-killed Node process. ca-certificates lets Node verify
# TLS when reaching the Anthropic API.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Reuse the `node` user the base image already ships (uid/gid 1000)
# instead of groupadd/useradd-ing a new one — the name `node` is
# already taken in node:22-bookworm-slim. docker-compose.yml's
# `user: "1000:1000"` matches this id.
WORKDIR /app
RUN chown -R node:node /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/package.json ./package.json

# data/ holds the SQLite WAL; src/content/ is the markdown vault —
# both are bind-mounted in docker-compose so the container can be
# replaced without losing notes or chat history.
RUN mkdir -p /app/data /app/src/content && chown -R node:node /app/data /app/src/content

USER node
EXPOSE 3000

# /api/health is the cheapest endpoint the Hono app exposes; perfect
# for compose's `healthcheck:` and for an external load balancer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]
