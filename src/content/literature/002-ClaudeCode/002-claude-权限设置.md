---
title: Claude Code 权限跳过设置
created: 2026-05-08
updated: 2026-05-08
tags: []
summary: ""
---
# Claude Code 权限跳过设置

## 概述

Claude Code 默认会在执行可能敏感的操作前提示用户确认。如果你确信操作是安全的，可以跳过这些权限确认。

## VS Code 扩展

在 VS Code 中使用 Claude Code 时：

- 打开设置，搜索 `Allow dangerously skip permissions`
- 启用该选项，即可在 VS Code 界面中跳过权限确认提示

## 终端命令

在命令行直接使用 Claude Code 时：

```bash
claude --dangerously-skip-permissions
```

加上 `--dangerously-skip-permissions` 参数即可跳过所有权限确认。

## 注意事项

> **警告**：跳过权限确认意味着不再提示你是否允许执行危险操作。请确保你完全信任当前的操作，谨慎使用此功能。

### 适用场景

- 在自动化脚本中使用
- 在确认安全的操作流程中
- 开发环境调试

### 风险提示

- 危险操作（如删除文件、系统修改）将直接执行，不会暂停
- 建议仅在受控环境中使用
- 生产环境不建议开启