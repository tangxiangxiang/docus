---
title: Hermes Dashboard
created: 2026-05-12
updated: 2026-05-12
tags: []
summary: ""
---
# Hermes Dashboard

Hermes Dashboard 是一个 Web 可视化界面，用于监控和管理 Hermes 消息队列服务。

## 启动 Dashboard

```bash
hermes dashboard --insecure --host 0.0.0.0 --no-open 2>&1
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `--insecure` | 允许使用 HTTP（而非 HTTPS）连接 |
| `--host 0.0.0.0` | 监听所有网络接口，允许远程访问 |
| `--no-open` | 启动后不自动打开浏览器 |

> **注意**：`2>&1` 将标准错误输出重定向到标准输出，便于日志收集。

### 使用场景

- **本地开发**：`--host 127.0.0.1` 仅允许本机访问
- **生产环境**：建议配合反向代理（nginx）使用 HTTPS
- **无头服务器**：使用 `--no-open` 避免自动启动浏览器

## 停止 Dashboard

```bash
hermes dashboard --stop 2>&1
```

安全关闭 Dashboard 服务。

## 常用命令组合

### 仅本机访问

```bash
hermes dashboard --insecure --no-open
```

### 指定端口（需配置文件）

```bash
hermes dashboard --port 8080 --insecure --no-open
```

## 注意事项

1. **安全建议**：生产环境避免使用 `--insecure`，应配置 TLS 证书
2. **端口冲突**：如 9000 端口被占用，可通过配置文件指定其他端口
3. **日志查看**：使用 `2>&1 | tee dashboard.log` 可同时查看和保存日志
