---
title: Markmap 思维导图示例
created: 2026-06-13
updated: 2026-06-13
tags: [meta, markmap, demo]
summary: 在 ```markmap 代码块里写一个 Markdown 提纲，docus 会把它渲染成可缩放、可全屏的交互式思维导图。
---

# Markmap 思维导图示例

使用 ```` ```markmap ```` 代码块写一个 Markdown 提纲，docus 会把它渲染成可缩放、可拖拽、可全屏的交互式思维导图。

```markmap
# 思维导图

## 学习笔记
- 英语学习
  - 语法
  - 词汇
- 技术学习
  - Vue 3
  - VitePress
  - markmap

## 待办事项
- 短期任务
  - 完成文档整理
  - 更新笔记
- 长期目标
  - 建立知识体系

## 工具链
- Claude Code
- Docker
- Code Server
```

## 用法

把 ```` ```markmap ```` 包住的 Markdown 提纲当作正文写进去就行 —— 任何 `# / ## / -` 缩进结构都会被解析成节点。

主题会跟随 docus 的明暗模式自动切换：暗色用浅色节点轮廓，亮色用深色节点轮廓。右下角可以重置视图或者进入全屏。
