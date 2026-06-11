# 部署 / Deployment

本项目用 Docker 部署。单一容器同时托管 Vue SPA 静态资源和 Hono `/api/*` 后端（SQLite + Anthropic 兼容的 LLM 代理）。

## 一分钟上手

```bash
# 1. 填好密钥（参考 .env.example）
cp .env.example .env
$EDITOR .env

# 2. 构建并启动
docker compose up -d --build

# 3. 访问
open http://localhost:3000          # 或者你设置的 DOCS_PORT
```

容器只暴露一个端口（默认 3000，由 Hono `@hono/node-server` 提供），前端构建产物 `dist/` 由同一进程上的 `serveStatic` 中间件分发。`/api/*` 走 Hono 路由，其它路径回落到 `index.html`（SPA history 模式需要）。

## 文件清单

| 文件 | 作用 |
| --- | --- |
| [Dockerfile](Dockerfile) | 多阶段构建。`deps` 装全依赖并编译 `better-sqlite3` 原生模块；`build` 跑 `vue-tsc -b && vite build`；`runtime` 只携带产物体积（Node 22-slim + tini，非 root 用户）。构建加速点见下方"构建性能"。 |
| [docker-compose.yml](docker-compose.yml) | 单服务编排，挂载 `docus-data`（SQLite）和 `docus-content`（笔记库）两个命名卷，开启 `read_only` + 非 root + 健康检查。 |
| [.dockerignore](.dockerignore) | 排除 `node_modules` / `dist` / `.env` / `data` / `.git` 等，减少构建上下文。 |
| [server/prod.ts](server/prod.ts) | 生产环境入口。用 `tsx` 直接跑（`npm run start`），无需编译步骤。 |
| `package.json` 新增 `start` 脚本 | `tsx server/prod.ts` |

## 构建性能

[Dockerfile](Dockerfile) 顶部几行做了一些与"裸多阶段构建"不同的优化：

**1. 切 apt 源到国内镜像。**

`node:22-bookworm-slim` 默认走 `deb.debian.org`，在国内裸拉 `apt-get install` 单一步就要 10+ 分钟。Dockerfile 用 `sed` 把所有可能的源文件位置（`/etc/apt/sources.list` 和 `/etc/apt/sources.list.d/{*.list,*.sources}`，覆盖新 deb822 格式和老 one-line 格式）里的 `deb.debian.org` / `security.debian.org` 换成 `http://mirrors.aliyun.com`。HTTP 而非 HTTPS 是因为 `bookworm-slim` 不带 `ca-certificates`、装它本身又要先 apt —— 死循环；包有 GPG 签名，apt 验签不靠 TLS，构建期用 HTTP 是安全的。**首构建从 15+ 分钟降到 ~65 秒。**切回官方源只需把 URL 改回 `deb.debian.org`，共两处（deps 和 runtime 阶段）。

**2. BuildKit cache mount。**

`# syntax=docker/dockerfile:1` 启用 BuildKit 指令后，`apt` 装包和 `npm ci` 步骤都加了 `--mount=type=cache,...`：
- `/var/cache/apt` 和 `/var/lib/apt`（`sharing=locked` 防并发损坏）跨构建复用包索引和已下载的 `.deb`
- `/root/.npm` 复用 npm 下载的 tarball

第二次构建在不修改 `package.json` / `package-lock.json` 的情况下，apt 阶段基本 0 秒、npm 下载也 0 秒，只重跑 `better-sqlite3` 的 node-gyp 原生编译（约 1-2 分钟）。**必须**用 BuildKit（Docker 23+ 默认开启、`docker buildx` 也行），否则 `--mount=type=cache` 会被当普通 flag 忽略、且不会报错。

**3. 删掉了 `rm -rf /var/lib/apt/lists/*`。**

挂载点的内容**不**进最终镜像，留着反而能跨构建复用索引；删了是给"压小镜像"白做功。

**注意**：换 Node 版本、改 `package.json`、换 apt 镜像，都建议 `docker compose build --no-cache` 跑一次再继续享受加速。

## 环境变量

所有变量在容器启动时由 `.env` 文件注入，Hono 服务在打开数据库前就通过 `dotenv/config` 加载。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | 走官方时必填 | Anthropic 官方 SDK 默认变量名 |
| `ANTHROPIC_AUTH_TOKEN` | 走代理时必填 | 一些国内代理使用的别名 |
| `ANTHROPIC_BASE_URL` | 否 | 留空走官方 `https://api.anthropic.com`；用代理时填代理地址 |
| `ANTHROPIC_MODEL` | 否 | 默认 `claude-sonnet-4-6` |
| `DOCS_PORT` | 否 | 宿主机端口，默认 `3000`（容器内端口固定 3000） |
| `PORT` / `HOST` | 否 | 容器内监听端口 / 地址，由 Dockerfile 设为 `3000` / `0.0.0.0` |

两个 auth 变量同时存在时，`ANTHROPIC_AUTH_TOKEN` 优先。详见 `server/ai/llm.ts`。

## 持久化数据

容器无状态。所有改动都落在两个命名卷里：

- `docus-data` → `/app/data`，里面是 `docus.db`（SQLite）+ WAL/SHM 文件。**聊天历史在这里**。
- `docus-content` → `/app/src/content`，里面是 vault 的 `inbox/` / `literature/` / `zettel/`。**笔记在这里**。

要查看真实路径：

```bash
docker volume inspect docus_docus-data
docker volume inspect docus_docus-content
```

要在宿主机上直接编辑笔记，把 `docker-compose.yml` 里这行：

```yaml
- docus-content:/app/src/content
```

换成：

```yaml
- ./src/content:/app/src/content:rw
```

文件末尾的注释块已经写好这个开关。

## 常用命令

```bash
# 查看日志
docker compose logs -f docus

# 升级（重新构建镜像 + 替换容器；卷不动；BuildKit 缓存复用）
docker compose build
docker compose up -d

# 升级且清空所有构建缓存（改 Dockerfile / 换 apt 源 / 换 Node 版本时需要）
docker compose build --no-cache
docker compose up -d

# 停服
docker compose down

# 完全重置（⚠ 会删库删笔记）
docker compose down -v
```

## 健康检查

容器内置 `/api/health`（见 `server/index.ts:27`），`HEALTHCHECK` 指令和 `docker-compose.yml` 的 `healthcheck` 都用同一个端点：

```bash
docker inspect --format '{{.State.Health.Status}}' docus
# healthy | starting | unhealthy
```

## 故障排查

| 现象 | 排查 |
| --- | --- |
| **首次 `docker compose build` 卡在 `apt-get install` 10+ 分钟** | 默认 `deb.debian.org` 在国内很慢。Dockerfile 已经把 apt 源换到 `mirrors.aliyun.com`，正常情况下这一步 30-60 秒。如果还是慢，检查 [Dockerfile](Dockerfile) 里那两条 `sed` 替换有没有被改回去，或 `mirrors.aliyun.com` 是不是被你公司网络封了。 |
| **`groupadd: group 'node' already exists`** | 用了非 `node:*` 标签的镜像、或者自己写了 `groupadd -g 1001 node` 又叠在 `node:22-bookworm-slim`（自带同名同 id 的用户/组）之上。本项目 Dockerfile 复用基础镜像自带的 `node` 用户（uid/gid 1000），不要新 groupadd。 |
| **sed 报 `unknown option to 's'`** | 用了 `|` 作为 `sed s-`命令的分隔符，且正则里有 `(deb|security)` 之类的 alternation。GNU sed 的 `s-`命令会把 `(...)` 里的 `|` 当成结束分隔符，导致模式被截断、后半段被当成 flag 解析。换成 `#` 或 `@` 等不在模式里出现的字符。 |
| **apt 报 `Certificate verification failed` / `No system certificates available`** | 把 apt 源改成了 HTTPS，但 `bookworm-slim` 不带 `ca-certificates`，且这一步在装它之前。本项目 Dockerfile 用 HTTP 解决（包有 GPG 签名，apt 验签不靠 TLS）。 |
| 启动报 `better-sqlite3` 找不到 / ABI 不匹配 | 多半是宿主机直接跑 `npm i` 留下了错误平台的预编译包。`docker compose build --no-cache` 重新拉一遍，容器内 `node:22-bookworm-slim` 装的是源生 build 然后用 prebuilds。 |
| AI 面板提示 "AI not configured" | 容器日志里 `dotenv` 没读到 key，常见原因：`.env` 写成 `ANTHROPIC_API_KEY = xxx`（变量名前后多了空格）；或者只设了 `ANTHROPIC_API_KEY` 但代理要 `ANTHROPIC_AUTH_TOKEN`。 |
| 刷新 `/vault/inbox/foo` 报 404 | Hono 入口里 SPA fallback 没生效。检查 `server/prod.ts` 是否被改过，确保 `app.get('*', ...)` 在 `serveStatic` 之后。 |
| `docker compose up` 起不来报 "bind: address already in use" | 改 `DOCS_PORT=8080`（或别的），再起。容器内 3000 是写死的，宿主机侧可调。 |
| 想换 Node 版本 | 改 [Dockerfile](Dockerfile) 顶部的 `node:22-bookworm-slim` tag 即可（Vite 8 / vue-tsc 3 / better-sqlite3 11 都跟 Node 20 LTS+ 兼容）。**注意**：换 Node 大版本后第一次构建要 `docker compose build --no-cache`，把 apt 缓存（带旧 Node 的）和 npm 缓存都清掉。 |
| 第二次构建没变快、看起来跑了全量 | BuildKit 没启用。`--mount=type=cache` 是 BuildKit 特性，老版 `DOCKER_BUILDKIT=0` 会静默忽略。用 `docker buildx` 或 Docker Desktop（23+ 默认 BuildKit）即可。 |
