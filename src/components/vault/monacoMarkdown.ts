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

export function markdownIndentUnit(line: string, tabSize = 2): string {
  if (line.startsWith('\t')) return '\t'
  const spaces = /^ +/.exec(line)?.[0].length ?? 0
  if (spaces >= 4 && spaces % 4 === 0) return '    '
  return ' '.repeat(tabSize)
}

export function indentMarkdownLine(line: string, outdent: boolean, tabSize = 2): string {
  const unit = markdownIndentUnit(line, tabSize)
  if (outdent) {
    if (line.startsWith('\t')) return line.slice(1)
    return line.startsWith(unit) ? line.slice(unit.length) : line.replace(/^ +/, '')
  }
  return `${unit}${line}`
}

export interface MarkdownSlashCommand {
  label: string
  detail: string
  insertText: string
}

export const MARKDOWN_SLASH_COMMANDS: readonly MarkdownSlashCommand[] = [
  { label: 'heading 1', detail: '一级标题', insertText: '# ${1:Heading}' },
  { label: 'heading 2', detail: '二级标题', insertText: '## ${1:Heading}' },
  { label: 'heading 3', detail: '三级标题', insertText: '### ${1:Heading}' },
  { label: 'bullet list', detail: '无序列表', insertText: '- ${1:Item}' },
  { label: 'numbered list', detail: '有序列表', insertText: '1. ${1:Item}' },
  { label: 'task', detail: '任务列表', insertText: '- [ ] ${1:Task}' },
  { label: 'quote', detail: '引用', insertText: '> ${1:Quote}' },
  { label: 'code block', detail: '代码块', insertText: '```$1\n$2\n```' },
  { label: 'mermaid', detail: 'Mermaid 图表', insertText: '```mermaid\n${1:graph TD\n  A --> B}\n```' },
  { label: 'markmap', detail: 'Markmap 思维导图', insertText: '```markmap\n# ${1:Topic}\n- ${2:Branch}\n```' },
  { label: 'table', detail: 'Markdown 表格', insertText: '| ${1:Column} | ${2:Column} |\n| --- | --- |\n| ${3:Value} | ${4:Value} |' },
] as const

export function filterMarkdownSlashCommands(query: string): readonly MarkdownSlashCommand[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return MARKDOWN_SLASH_COMMANDS
  return MARKDOWN_SLASH_COMMANDS.filter((command) =>
    `${command.label} ${command.detail}`.toLocaleLowerCase().includes(needle),
  )
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

export interface MarkdownWrapEdit {
  text: string
  selectionOffset: number
  selectionLength: number
}

export function markdownWrapEdit(text: string, wrap: MarkdownWrap): MarkdownWrapEdit {
  const unwrapping = text.startsWith(wrap.before) && text.endsWith(wrap.after)
  if (unwrapping) {
    const unwrapped = text.slice(wrap.before.length, text.length - wrap.after.length)
    return { text: unwrapped, selectionOffset: 0, selectionLength: unwrapped.length }
  }
  const inner = text || wrap.placeholder
  return {
    text: `${wrap.before}${inner}${wrap.after}`,
    selectionOffset: wrap.before.length,
    selectionLength: inner.length,
  }
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

export function markdownDecorationSpecs(
  text: string,
  validWikiPaths?: ReadonlySet<string> | ((ref: string) => boolean),
  lineOffset = 0,
): MonacoDecorationSpec[] {
  const specs: MonacoDecorationSpec[] = []
  const lines = text.split('\n')
  let inFrontmatter = lineOffset === 0 && lines.length > 1 && lines[0].trim() === '---'
  lines.forEach((line, index) => {
    const lineNumber = lineOffset + index + 1
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
      const valid = typeof validWikiPaths === 'function'
        ? validWikiPaths(match[1])
        : validWikiPaths?.has(match[1])
      const className = validWikiPaths && !valid ? 'monaco-md-link-invalid' : 'monaco-md-link'
      specs.push({ startLineNumber: lineNumber, startColumn: (match.index ?? 0) + 1, endLineNumber: lineNumber, endColumn: (match.index ?? 0) + match[0].length + 1, inlineClassName: className })
    }
    if (index > 0 && inFrontmatter && trimmed === '---') inFrontmatter = false
  })
  return specs
}
