import matter from 'gray-matter'
import type { Plugin } from 'vite'

/**
 * 把 src/content/posts/*.md 编译为 JS 模块。
 * - `?meta` query:仅导出 frontmatter + slug(用于列表/标签/归档,正文不进 main bundle)
 * - `?full` query:导出 frontmatter + content + slug(用于详情页)
 * - 无 query:导出 frontmatter + content + slug(向后兼容)
 *
 * 运行时机:Vite transform 阶段(Node 环境),可直接使用 gray-matter。
 */
export function mdPlugin(): Plugin {
  return {
    name: 'docus-md',
    enforce: 'pre',
    transform(code, id) {
      const queryIdx = id.indexOf('?')
      const path = queryIdx === -1 ? id : id.slice(0, queryIdx)
      if (!path.includes('/src/content/posts/') || !path.endsWith('.md')) return null
      const { data, content } = matter(code)
      // Derive slug from the file's path relative to /src/content/posts/.
      // For "src/content/posts/hello-world.md" -> "hello-world"
      // For "src/content/posts/notes/draft.md" -> "notes/draft"
      const postsMarker = '/src/content/posts/'
      const markerIdx = path.lastIndexOf(postsMarker)
      const slug = markerIdx === -1
        ? path.split('/').pop()!.replace(/\.md$/, '')
        : path.slice(markerIdx + postsMarker.length, -3)   // strip .md
      const includeContent = id.includes('?full') || !id.includes('?meta')

      const lines = [
        `export const frontmatter = ${JSON.stringify(data)};`,
        `export const slug = ${JSON.stringify(slug)};`,
      ]
      if (includeContent) {
        lines.push(`export const content = ${JSON.stringify(content)};`)
      }
      lines.push(
        `export default { frontmatter, slug${includeContent ? ', content' : ''} };`,
      )
      lines.push('')
      return { code: lines.join('\n'), map: null }
    },
  }
}
