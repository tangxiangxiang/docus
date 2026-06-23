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
