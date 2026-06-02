declare module '*.md' {
  export const frontmatter: Record<string, unknown>
  export const content: string
  export const slug: string
  const _default: { frontmatter: Record<string, unknown>; content: string; slug: string }
  export default _default
}

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
