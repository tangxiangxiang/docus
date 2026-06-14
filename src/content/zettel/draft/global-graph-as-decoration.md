---
title: 全局图谱
created: 2026-06-14
updated: 2026-06-14
tags: [meta, knowledge-graph]
source:
---

# 全局图谱

**全局图谱(Global Graph)** 是笔记软件中的一种可视化视图:把整个语料库的所有节点和所有链接一次性画在一张图上,通常用 force-directed 布局让节点在力的作用下自然聚拢。Obsidian 的"Graph View"侧边栏就是这种视图的典型实现,Roam Research、Logseq 等也有类似功能。

特点:

- 节点数 = 语料库总笔记数,边数 = 总链接数
- 力导向布局试图让相互连接的节点聚类,无连接的节点被推远
- 适合在语料库规模较小时(几十到几百条)形成对"知识结构整体面貌"的直觉

对照:[[local-graph-as-daily-tool|本地图谱]] 只展示当前节点及其若干跳内的邻居,而不是整个语料库。
