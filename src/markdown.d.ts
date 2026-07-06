declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it'
  interface TaskListsOptions {
    enabled?: boolean
    label?: boolean
    labelAfter?: boolean
    lineNumber?: boolean
  }
  const plugin: (md: MarkdownIt, opts?: TaskListsOptions) => void
  export default plugin
}

declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it'
  // markdown-it-footnote 4.x 默认不接受配置;所有行为通过覆盖
  // md.renderer.rules.footnote_* 完成。这里只声明插件函数本身。
  const plugin: (md: MarkdownIt) => void
  export default plugin
}
