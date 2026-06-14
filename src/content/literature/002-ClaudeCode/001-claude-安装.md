---
title: Claude Code 安装指南
created: 2026-05-13
updated: 2026-05-13
tags: []
summary: ""
---
# Claude Code 安装指南

## 中国大陆安装方式

### 问题说明

官方安装脚本在大陆地区无法直接使用：

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

该方式会被防火墙拦截，无法完成安装。

### 推荐方案：使用 npm 安装

通过 npm 包管理器安装 Claude Code：

```bash
npm install -g @anthropic-ai/claude-code
```

该方式在中国大陆可以正常安装。

## 安装后配置

### 配置MiniMax API key

编辑或创建 Claude Code 的配置文件

MacOS & Linux 为 `~/.claude/settings.json`

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "MINIMAX_API_KEY",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "ANTHROPIC_MODEL": "MiniMax-M2.7",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "MiniMax-M2.7",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "MiniMax-M2.7",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "MiniMax-M2.7"
  }
}
```

### 验证安装

在终端执行 claude，开始对话即表示安装成功。


## VS Code 扩展

Claude Code 也提供了 VS Code 扩展，可在 VS Code 中直接使用。

### 安装方式

1. 打开 VS Code
2. 进入扩展市场（`Command + Shift + X`）
3. 搜索 "Claude Code"
4. 点击安装

### 配置权限

安装完成后如需跳过权限确认，请参考[权限设置](002-claude-权限设置.md)

## 更新与卸载

### 更新

```bash
npm update -g @anthropic-ai/claude-code
```

### 卸载

```bash
npm uninstall -g @anthropic-ai/claude-code
```