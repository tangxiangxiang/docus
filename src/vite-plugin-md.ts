import matter from 'gray-matter'
import type { Plugin } from 'vite'

/**
 * 把 src/content/ 下的 .md 编译为 JS 模块。
 * - `?meta` query:仅导出 frontmatter + slug(用于列表/标签/归档,正文不进 main bundle)
 * - `?full` query:导出 frontmatter + content + slug(用于详情页)
 * - 无 query:导出 frontmatter + content + slug(向后兼容)
 *
 * 运行时机:Vite transform 阶段(Node 环境),可直接使用 gray-matter。
 *
 * 历史上这个插件只处理 src/content/posts/ 下的文件,但实际内容在
 * src/content/{inbox,literature,zettel},所以插件以前从未命中任何文件;
 * 列表/标签页拿不到数据。现在改到 src/content/ 之后插件和后端的扫描
 * 范围一致,slug 也就是文件相对 src/content/ 的路径(去掉 .md)。
 */
export function mdPlugin(): Plugin {
  return {
    name: 'docus-md',
    enforce: 'pre',
    transform(code, id) {
      const queryIdx = id.indexOf('?')
      const path = queryIdx === -1 ? id : id.slice(0, queryIdx)
      if (!path.includes('/src/content/') || !path.endsWith('.md')) return null
      const { data, content } = matter(code)
      // Derive slug from the file's path relative to /src/content/.
      // For "src/content/hello-world.md" -> "hello-world"
      // For "src/content/notes/draft.md" -> "notes/draft"
      const contentMarker = '/src/content/'
      const markerIdx = path.lastIndexOf(contentMarker)
      const slug = markerIdx === -1
        ? path.split('/').pop()!.replace(/\.md$/, '')
        : path.slice(markerIdx + contentMarker.length, -3)   // strip .md
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
