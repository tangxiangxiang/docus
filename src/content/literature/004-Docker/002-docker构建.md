---
title: Docker 构建
created: 2026-05-14
updated: 2026-05-14
tags: []
summary: ""
---
# Docker 构建

```bash
sudo docker compose up -d --build
```

## 命令说明

| 参数 | 含义 |
|------|------|
| `sudo` | 以 root 权限执行（需 docker 组权限时可省略） |
| `docker compose` | 使用 Compose 管理多容器服务 |
| `up` | 创建并启动容器 |
| `-d` | 后台运行（detached 模式） |
| `--build` | 启动前重新构建镜像，忽略已有缓存 |

## 执行流程

1. 读取当前目录下的 `docker-compose.yml`（或 `compose.yaml`）
2. 根据 `build` 配置重新构建 Dockerfile 生成镜像
3. 创建并启动容器
4. 后台运行，不占用终端

## 常用衍生

```bash
# 仅构建，不启动
sudo docker compose build

# 强制重新构建，清除所有缓存
sudo docker compose build --no-cache

# 停止并清理容器
sudo docker compose down
```
