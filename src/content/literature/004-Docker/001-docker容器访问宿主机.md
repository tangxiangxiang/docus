---
title: Docker 容器访问宿主机
created: 2026-05-14
updated: 2026-05-14
tags: []
summary: ""
---
# Docker 容器访问宿主机

容器可通过 `host.docker.internal` 这个特殊 DNS 名称访问宿主机服务，常见于开发测试场景，如调用宿主机 API、数据库等。

## 使用方式

```bash
curl http://host.docker.internal:8080
```

```python
import socket
print(socket.gethostbyname('host.docker.internal'))
```

## 注意事项

1. 该 DNS 在 Docker Desktop for Mac/Windows 上默认可用
2. Linux 上需要 Docker ≥ 20.10，或在启动容器时添加 `--add-host=host.docker.internal:host-gateway`
3. `host.docker.internal` 不适用于 `--network=host` 模式（该模式下容器直接使用 `127.0.0.1` 即可访问宿主机）

## 常用替代方案

```bash
# Linux 上通过宿主机实际 IP 访问
docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' <container_name>

# Docker Compose 中配置
extra_hosts:
  - "host.docker.internal:host-gateway"
```
