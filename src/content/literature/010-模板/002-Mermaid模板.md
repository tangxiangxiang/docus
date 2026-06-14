---
title: Mermaid Demo
created: 2026-05-18
updated: 2026-05-18
tags: []
summary: ""
---
# Mermaid Demo

## 流程图

```mermaid
flowchart TB
    c1 --> a2
    subgraph one
        a1 --> a2
    end
    subgraph two
        b1 --> b2
    end
    subgraph three
        c1 --> c2
    end
    one --> two
    three --> two
    two --> c2
```



## 思维导图

```mermaid
mindmap
  root((VuePress))
    Out of box
      Default theme
        Navbar
        Sidebar
        Darkmode
      I18n
      Search
        Search
        DocSearch by algolia
    Customize
      Theme
        (hope)
      Plugins
        (components)
        (md-enhance)
```

