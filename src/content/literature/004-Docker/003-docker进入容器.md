---
title: Docker 进入容器
created: 2026-05-14
updated: 2026-05-14
tags: []
summary: ""
---
# Docker 进入容器

```bash
docker exec -it tkb sh
```

## 命令说明

| 参数 | 含义 |
|------|------|
| `docker exec` | 在运行中的容器内执行命令 |
| `-i` | 保持标准输入打开（interactive） |
| `-t` | 分配一个伪终端（tty） |
| `tkb` | 容器名称（或容器 ID） |
| `sh` | 进入后启动的 shell |

## 常用衍生

```bash
# 使用 bash（容器支持时）
docker exec -it tkb bash

# 指定工作目录进入
docker exec -it -w /app tkb sh

# 以 root 用户进入
docker exec -it -u root tkb sh

# 直接进入后执行单条命令
docker exec tkb ls /app
```
