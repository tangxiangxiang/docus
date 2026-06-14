---
title: Code-Server 常用 systemd 命令
created: 2026-05-14
updated: 2026-05-14
tags: []
summary: ""
---
# Code-Server 常用 systemd 命令

## 服务管理

| 操作 | 命令 |
|------|------|
| 启动 | `systemctl --user start code-server` |
| 停止 | `systemctl --user stop code-server` |
| 重启 | `systemctl --user restart code-server` |
| 状态 | `systemctl --user status code-server` |
| 开机自启 | `systemctl --user enable --now code-server` |
| 禁用自启 | `systemctl --user disable code-server` |

## 相关路径

- code-server 数据目录：`~/.local/share/code-server`
- 插件目录：`~/.local/share/code-server/extensions`
- 日志目录：`~/.local/share/code-server/logs`

## 重要注意：会话依赖

code-server 使用 `--user` service，**仅在当前用户会话保持活跃时运行**。关闭所有终端或注销登录后，用户会话结束，code-server 也会被终止。

## 为什么要用 `--user`？

因为 code-server 运行在**用户会话（user session）**中，而不是系统级服务。

| | 系统级 `systemctl` | 用户级 `systemctl --user` |
|---|---|---|
| 作用范围 | 系统服务（供所有用户） | 当前用户的服务 |
| 权限 | 需要 root | 普通用户即可 |
| 服务文件位置 | `/etc/systemd/system/` | `~/.config/systemd/user/` |

用 `--user` 的好处：
- 无需 sudo 权限
- 随用户登录/注销管理
- 不影响其他用户

> 如果装的是系统级 service（放在 `/etc/systemd/system/`），才用普通的 `systemctl start code-server`。
