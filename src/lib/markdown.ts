import MarkdownIt from 'markdown-it'

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
  })()
  return mdPromise
}

export async function render(markdown: string): Promise<string> {
  const md = await getMd()
  return md.render(markdown)
}
