export interface MarkdownContinuation {
  insert: string
  removeMarkerFrom?: number
}

export function markdownContinuation(lineBeforeCursor: string): MarkdownContinuation {
  const match = /^(\s*)(?:(- \[[ xX]\])|([-+*])|(\d+)\.)(\s+)(.*)$/.exec(lineBeforeCursor)
  if (!match) return { insert: '\n' }
  const indent = match[1]
  const task = match[2]
  const bullet = match[3]
  const ordered = match[4]
  const content = match[6]
  if (!content.trim()) return { insert: '\n', removeMarkerFrom: indent.length }
  if (task) return { insert: `\n${indent}- [ ] ` }
  if (bullet) return { insert: `\n${indent}${bullet} ` }
  return { insert: `\n${indent}${Number(ordered) + 1}. ` }
}

export function markdownLinkFromPaste(label: string, pasted: string): string | null {
  const url = pasted.trim()
  if (!label || !/^https?:\/\/\S+$/i.test(url)) return null
  return `[${label.replace(/]/g, '\\]')}](${url.replace(/\)/g, '\\)')})`
}

export function indentMarkdownLine(line: string, outdent: boolean): string {
  if (outdent) return line.replace(/^ {1,2}/, '')
  return `  ${line}`
}

export interface MarkdownWrap {
  before: string
  after: string
  placeholder: string
}

export const MARKDOWN_WRAPS = {
  bold: { before: '**', after: '**', placeholder: 'bold text' },
  italic: { before: '*', after: '*', placeholder: 'italic text' },
  code: { before: '`', after: '`', placeholder: 'code' },
  link: { before: '[', after: '](https://)', placeholder: 'link text' },
} as const satisfies Record<string, MarkdownWrap>

export function toggleMarkdownWrap(text: string, wrap: MarkdownWrap): string {
  if (text.startsWith(wrap.before) && text.endsWith(wrap.after)) {
    return text.slice(wrap.before.length, text.length - wrap.after.length)
  }
  return `${wrap.before}${text || wrap.placeholder}${wrap.after}`
}

export function rankWikiTargets<T extends { path: string; title: string }>(
  targets: T[], query: string, recent: string[], currentPath: string,
): T[] {
  const needle = query.trim().toLocaleLowerCase()
  const score = (target: T) => {
    const title = target.title.toLocaleLowerCase()
    const path = target.path.toLocaleLowerCase()
    const recentIndex = recent.indexOf(target.path)
    let relevance = 0
    if (needle) {
      if (title === needle || path === needle) relevance = 100
      else if (title.startsWith(needle)) relevance = 80
      else if (path.startsWith(needle)) relevance = 70
      else if (title.includes(needle)) relevance = 60
      else if (path.includes(needle)) relevance = 50
      else {
        let cursor = 0
        for (const char of `${title} ${path}`) if (char === needle[cursor]) cursor += 1
        if (cursor !== needle.length) return null
        relevance = 20
      }
    }
    return relevance + (recentIndex < 0 ? 0 : Math.max(1, 15 - recentIndex))
  }
  return targets
    .filter((target) => target.path !== currentPath)
    .map((target) => ({ target, score: score(target) }))
    .filter((item): item is { target: T; score: number } => item.score !== null)
    .sort((a, b) => b.score - a.score || (a.target.title || a.target.path).localeCompare(b.target.title || b.target.path, 'zh-CN'))
    .map(({ target }) => target)
}

export function wikiLinkAtColumn(line: string, column: number): string | null {
  for (const match of line.matchAll(/\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|[^\]\n]+)?\]\]/g)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (column >= start && column <= end) return match[1]
  }
  return null
}

export const MARKDOWN_CODE_LANGUAGES = [
  'typescript', 'javascript', 'python', 'json', 'yaml', 'bash',
  'html', 'css', 'sql', 'vue', 'markdown', 'text',
] as const

export type MonacoDecorationSpec = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  className?: string
  inlineClassName?: string
}

export function markdownDecorationSpecs(text: string, validWikiPaths?: ReadonlySet<string>): MonacoDecorationSpec[] {
  const specs: MonacoDecorationSpec[] = []
  const lines = text.split('\n')
  let inFrontmatter = lines.length > 1 && lines[0].trim() === '---'
  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const trimmed = line.trimStart()
    const leading = line.length - trimmed.length
    const lineClass: string[] = []
    if (inFrontmatter) lineClass.push('monaco-md-frontmatter')
    const heading = /^(#{1,6})\s/.exec(trimmed)
    if (heading) lineClass.push('monaco-md-heading', `monaco-md-h${heading[1].length}`)
    if (/^>\s?/.test(trimmed)) lineClass.push('monaco-md-quote')
    if (lineClass.length) specs.push({ startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: 1, className: lineClass.join(' ') })
    const mark = heading?.[1] ?? (/^>/.test(trimmed) ? '>' : /^(?:[-+*]|\d+\.)/.exec(trimmed)?.[0])
    if (mark) specs.push({ startLineNumber: lineNumber, startColumn: leading + 1, endLineNumber: lineNumber, endColumn: leading + mark.length + 1, inlineClassName: 'monaco-md-marker' })
    if (inFrontmatter) {
      const field = /^([A-Za-z][\w-]*):(.*)$/.exec(trimmed)
      if (field) {
        specs.push({ startLineNumber: lineNumber, startColumn: leading + 1, endLineNumber: lineNumber, endColumn: leading + field[1].length + 1, inlineClassName: 'monaco-md-frontmatter-key' })
        if (field[2]) specs.push({ startLineNumber: lineNumber, startColumn: leading + field[1].length + 2, endLineNumber: lineNumber, endColumn: line.length + 1, inlineClassName: 'monaco-md-frontmatter-value' })
      }
    }
    const patterns: Array<[RegExp, string]> = [
      [/`[^`\n]+`/g, 'monaco-md-code'],
      [/\*\*[^*\n]+\*\*/g, 'monaco-md-strong'],
      [/\[[^\]\n]+\]\(https?:\/\/(?:[^()\s]|\([^()\s]*\))*\)/g, 'monaco-md-link'],
    ]
    for (const [pattern, className] of patterns) {
      for (const match of line.matchAll(pattern)) {
        specs.push({ startLineNumber: lineNumber, startColumn: (match.index ?? 0) + 1, endLineNumber: lineNumber, endColumn: (match.index ?? 0) + match[0].length + 1, inlineClassName: className })
      }
    }
    for (const match of line.matchAll(/\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|[^\]\n]+)?\]\]/g)) {
      const className = validWikiPaths && !validWikiPaths.has(match[1]) ? 'monaco-md-link-invalid' : 'monaco-md-link'
      specs.push({ startLineNumber: lineNumber, startColumn: (match.index ?? 0) + 1, endLineNumber: lineNumber, endColumn: (match.index ?? 0) + match[0].length + 1, inlineClassName: className })
    }
    if (index > 0 && inFrontmatter && trimmed === '---') inFrontmatter = false
  })
  return specs
}
