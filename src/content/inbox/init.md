---
title: init
created: 2026-06-11
updated: 2026-06-12
tags: [meta, getting-started]
---

# init

这是我的第一篇笔记。

```py
print('Hello, world.')
```

## 这是什么

这里是个人知识库的工作区。所有内容以 Markdown 文件的形式存放在 `src/content/` 下,每篇笔记对应一个文件,文件在 `src/content/` 下的相对路径(去掉 `.md` 后缀)就是这篇文章的访问路径 —— 例如本文件 `src/content/inbox/init.md` 的访问路径是 `inbox/init`。

## 文件结构(Frontmatter)

每篇笔记的开头是一段 YAML 格式的元信息,称为 frontmatter,用 `---` 包裹:

```yaml
---
title: 笔记标题          # 必填,展示用
created: 2026-06-11     # 创建日期(UTC `YYYY-MM-DD`),新文件自动填
updated: 2026-06-11     # 最后内容修改日期(UTC `YYYY-MM-DD`),每次保存自动 bump;重命名/移动不更新
tags: [meta, getting-started]   # 标签数组,可用于归类
---
```

- `title`:可与文件名不同,适合显示得更有可读性
- `created`:创建日期,UTC `YYYY-MM-DD`;新文件自动填,老文件如果用 `date:` 也能读
- `updated`:最后内容修改日期,UTC `YYYY-MM-DD`;服务端在每次 PUT 时自动 bump,外部编辑器/重命名不会动它
- `tags`:多个标签用数组形式,后面可以按标签筛选

> 访问路径不在 frontmatter 里 —— 它就是文件在 `src/content/` 下的相对路径(去掉 `.md` 后缀),由文件系统决定,无法通过 frontmatter 覆盖。

## 写作建议

- **想到就记**:`inbox/` 目录适合放随手写、未整理的想法,稍后再归档
- **一段事一篇文章**:不要把多件不相关的事塞进同一篇
- **善用代码块**:标注语言能获得正确的语法高亮,例如 ` ```py `、` ```js `
- **链接其他笔记**:用 `[文字](路径)` 的形式,路径之间可以形成网状结构,例如 `[tag 列表](/tags)` 链到 `/tags` 页

## 接下来

给自己定个小目标:每天往 `inbox/` 里丢一条东西,哪怕只是「今天注意到 XXX」。积累比完美更重要。