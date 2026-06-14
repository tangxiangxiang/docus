---
title: Docker 虚悬镜像
created: 2026-05-14
updated: 2026-05-14
tags: []
summary: ""
---
# Docker 虚悬镜像

虚悬镜像（dangling image）指**仓库名、标签都是 `<none>`** 的镜像，通常是构建/拉取覆盖后残留的旧版本，会占用磁盘空间。

## 查看虚悬镜像

```bash
docker images -f dangling=true
```

## 清理虚悬镜像

| 命令 | 说明 |
|------|------|
| `docker image prune` | 安全删除，会提示确认 |
| `docker image prune -f` | 强制删除，无提示 |
| `docker rmi $(docker images -f dangling=true -q)` | 旧版兼容写法 |

## 清理所有无用资源

同时清理虚悬镜像、停止的容器、无用网络和缓存：

```bash
docker system prune          # 清理虚悬镜像和未使用网络
docker system prune -a       # 额外删除所有未被容器使用的镜像
```

## 常用衍生

```bash
# 查看虚悬镜像占用的空间
docker system df

# 只清理构建缓存
docker builder prune -f
```
