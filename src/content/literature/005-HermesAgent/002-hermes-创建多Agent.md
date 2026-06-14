---
title: 创建多 Agent Profile
created: 2026-05-12
updated: 2026-05-12
tags: []
summary: ""
---
# 创建多 Agent Profile

## Writer Profile 概述

| 项目 | 值 |
|------|-----|
| Profile 路径 | `~/.hermes/profiles/writer/` |
| 独立记忆文件 | `~/.hermes/profiles/writer/memories/USER.md` |
| 全局记忆文件 | `~/.hermes/memories/USER.md` |
| 默认模型 | MiniMax-M2.7 → **qwen3.5-plus** |
| 启动命令 | `hermes --profile writer` |

## 记忆文件隔离机制

```
~/.hermes/
├── memories/
│   └── USER.md          # 全局记忆（所有 Profile 共享）
└── profiles/
    └── writer/
        └── memories/
            └── USER.md  # Writer Profile 独立记忆
```

**核心特性**：
- 每个 Profile 拥有独立的 `memories/USER.md`
- 全局记忆与 Profile 记忆互不污染
- 便于针对不同场景（写作、编程、翻译等）维护独立上下文