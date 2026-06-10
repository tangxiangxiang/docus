# docus 的多阶段构建 —— 一个 Vue 3 + Hono 个人知识库。
#
# 阶段 1（deps）：安装全部依赖（包括 devDependencies），因为后面要跑 `vite build`。
# better-sqlite3 的原生构建步骤在 Node 基础镜像之外还需要 python3 + make + g++。
#
# 阶段 2（build）：在 dist/ 生成静态资源包。
#
# 阶段 3（runtime）：只拷入产线 node_modules、预构建好的 dist/、server/ 源码、tsx
#（用来跑 server/prod.ts）。以非 root 用户身份运行，单端口同时服务 SPA 和
# Hono 的 /api/* 接口。

# ---------- 1. 安装依赖 ----------
FROM node:22-bookworm-slim AS deps

# better-sqlite3 走 node-gyp 时需要的原生工具链。
# 不装这几个，`npm ci` 在尝试装可选依赖时会失败。
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 用 lockfile 安装，确保产线镜像可复现。
# `--ignore-scripts` 会跳过 better-sqlite3 的原生编译 —— 如果后面再补一次带工具链
# 的安装也行，但直接在这里让 install 脚本跑更简单，runtime 阶段拷过去就是一份能跑的工作目录。
COPY package.json package-lock.json* ./
RUN npm ci

# ---------- 2. 构建前端 ----------
FROM deps AS build

# 类型检查 + 打包 SPA。vue-tsc -b 跑 tsconfig.app.json 里的 project references；
# 之后 vite 把产物输出到 dist/。
COPY tsconfig*.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY server ./server
RUN npm run build

# 砍掉 dev 依赖，让 runtime 镜像只带启动 server/prod.ts（通过 tsx）真正需要的包。
RUN npm prune --omit=dev

# ---------- 3. 运行阶段 ----------
FROM node:22-bookworm-slim AS runtime

# tini 提供正确的 SIGTERM/SIGINT 处理，这样 `docker stop` 时 Node 进程不会被半路截断。
# ca-certificates 让 Node 调用 Anthropic API 时能正常校验 TLS 证书。
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# 复用基础镜像自带的 `node` 用户（uid/gid 1000），不要新 groupadd/useradd 一个 —
# 名字 `node` 在 node:22-bookworm-slim 里已经被占用了。docker-compose.yml 里的
# `user: "1000:1000"` 与之对应。
WORKDIR /app
RUN chown -R node:node /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/package.json ./package.json

# data/ 放 SQLite 的 WAL；src/content/ 是 markdown 笔记库 —— 两者在 docker-compose
# 里都挂成了卷，这样重建容器时笔记和聊天记录都不会丢。
RUN mkdir -p /app/data /app/src/content && chown -R node:node /app/data /app/src/content

USER node
EXPOSE 3000

# /api/health 是 Hono 应用最便宜的端点，正好给 compose 的 `healthcheck:` 和
# 外部负载均衡器用。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]
