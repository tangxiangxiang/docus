declare module '*.md' {
  export const frontmatter: Record<string, unknown>
  export const content: string
  export const slug: string
  const _default: { frontmatter: Record<string, unknown>; content: string; slug: string }
  export default _default
}
