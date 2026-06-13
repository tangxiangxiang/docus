---
title: Mermaid 图表示例
created: 2026-06-13
updated: 2026-06-13
tags: [meta, mermaid, demo]
summary: 在 ```mermaid 代码块里写图表语法，docus 会把它渲染成 SVG —— 流程图、时序图、类图、状态图等都支持。
---

# Mermaid 图表示例

使用 ```` ```mermaid ```` 代码块写 Mermaid 语法，docus 会把它渲染成 SVG。

## 流程图

```mermaid
graph TD
  A[写笔记] --> B{需要图表吗?}
  B -- 是 --> C[```mermaid 代码块]
  B -- 否 --> D[直接写正文]
  C --> E[docus 渲染 SVG]
  E --> F[跟随主题]
```

## 时序图

```mermaid
sequenceDiagram
  participant U as 用户
  participant A as Article
  participant M as Mermaid 挂载器
  participant R as mermaid.render
  U->>A: 打开页面
  A->>M: 扫描 .mermaid-mount
  M->>R: render(id, code)
  R-->>M: svg 字符串
  M-->>A: 注入到 DOM
```

## 状态图

```mermaid
stateDiagram-v2
  [*] --> 草稿
  草稿 --> 审阅: 提交
  审阅 --> 发布: 通过
  审阅 --> 草稿: 驳回
  发布 --> [*]
```

## 用法

把 ```` ```mermaid ```` 包住的 Mermaid 语法当作正文写进去就行。主题会跟随 docus 的明暗模式自动切换 —— 暗色下 mermaid 的 token 会被重写成 docus 的暗色调。
