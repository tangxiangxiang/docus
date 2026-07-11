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

export function markdownDecorationSpecs(text: string): MonacoDecorationSpec[] {
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
      [/\[\[[^\]\n]+\]\]/g, 'monaco-md-link'],
      [/\[[^\]\n]+\]\(https?:\/\/(?:[^()\s]|\([^()\s]*\))*\)/g, 'monaco-md-link'],
    ]
    for (const [pattern, className] of patterns) {
      for (const match of line.matchAll(pattern)) {
        specs.push({ startLineNumber: lineNumber, startColumn: (match.index ?? 0) + 1, endLineNumber: lineNumber, endColumn: (match.index ?? 0) + match[0].length + 1, inlineClassName: className })
      }
    }
    if (index > 0 && inFrontmatter && trimmed === '---') inFrontmatter = false
  })
  return specs
}
