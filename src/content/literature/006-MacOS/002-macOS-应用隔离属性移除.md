---
title: macOS 应用隔离属性（com.apple.quarantine）移除
created: 2026-05-10
updated: 2026-05-10
tags: []
summary: ""
---
# macOS 应用隔离属性（com.apple.quarantine）移除

## 概述

从互联网下载的 macOS 应用会被系统添加 `com.apple.quarantine` 属性，用于安全限制。初次运行时会弹出"无法验证开发者"等警告。

## 解决方法

### 批量移除（推荐）

移除 `/Applications/` 下所有应用的隔离属性：

```bash
sudo xattr -rd com.apple.quarantine /Applications/*
```

### 单独应用

移除特定应用的隔离属性：

```bash
sudo xattr -rd com.apple.quarantine /Applications/应用名称.app
```

### 参数说明

- `-r`：递归处理子目录
- `-d`：删除指定属性

## 注意事项

| 事项 | 说明 |
|------|------|
| 权限要求 | 需要 `sudo` 提升权限 |
| 安全性 | 仅移除你自己下载的应用，谨慎操作 |
| Gatekeeper | 移除隔离属性后仍可能受 Gatekeeper 限制，可使用 `sudo xattr -rd com.apple.quarantine` 配合 `sudo spctl --master-disable` 临时禁用 |

## 相关命令

- 查看应用属性：`xattr -l /Applications/应用名.app`
- 单独移除：`xattr -d com.apple.quarantine /Applications/应用名.app`