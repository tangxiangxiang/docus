import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import anchor from 'markdown-it-anchor'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface HighlightFn {
  (str: string, lang: string): string
}

async function buildHighlight(): Promise<HighlightFn> {
  const [{ default: hljs }, { default: theme }] = await Promise.all([
    import('highlight.js'),
    import('highlight.js/styles/atom-one-dark.css'),
  ])
  // 防止 vite tree-shake 掉 CSS 副作用 import
  void theme
  return (str: string, lang: string) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
        }</code></pre>`
      } catch {
        /* fall through */
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`
  }
}

let mdPromise: Promise<MarkdownIt> | null = null

async function getMd(): Promise<MarkdownIt> {
  if (mdPromise) return mdPromise
  mdPromise = (async () => {
    const highlight = await buildHighlight()
    return new MarkdownIt({
      html: false,
      linkify: true,
      typographer: true,
      highlight(str, lang) {
        return highlight(str, lang)
      },
    })
      // 任务列表: - [ ] / - [x], 启用 disabled 属性让 checkbox 在 preview 中可点(只是视觉,不会真保存)
      .use(taskLists, { enabled: true, label: true, lineNumber: false })
      // 标题锚点:给 h2/h3/h4 加 id,锚点样式由 .article 下的样式处理
      .use(anchor, {
        slugify: (s: string) =>
          s
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
            .replace(/^-+|-+$/g, ''),
        permalink: anchor.permalink.headerLink({ safariReaderFix: true }),
      })
  })()
  return mdPromise
}

export async function render(markdown: string): Promise<string> {
  const md = await getMd()
  return md.render(markdown)
}
