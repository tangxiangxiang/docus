import YAML from 'yaml'

export interface ParsedDoc {
  raw: string
  frontmatter: Record<string, unknown>
  content: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** 把 .md 源文本拆成 frontmatter(YAML 对象) + 正文。 */
export function parseDoc(raw: string): ParsedDoc {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) {
    return { raw, frontmatter: {}, content: raw }
  }
  const fmText = match[1]
  const content = raw.slice(match[0].length)
  let frontmatter: Record<string, unknown> = {}
  try {
    const parsed = YAML.parse(fmText) ?? {}
    frontmatter = typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    frontmatter = {}
  }
  return { raw, frontmatter, content }
}

/** 用给定的 frontmatter + 正文合成 .md 源文本。 */
export function stringifyDoc(frontmatter: Record<string, unknown>, content: string): string {
  const yaml = YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd()
  return `---\n${yaml}\n---\n${content.startsWith('\n') ? content : '\n' + content}`
}

/** 简单 slugify:把任意字符串转成 [a-z0-9-]。 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled'
}
