import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import anchor from 'markdown-it-anchor'
import { wikiLinkPlugin, type Resolver as WikiResolver } from './wikiLinks'

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

/* HTML-attribute-encode for the markmap placeholder. We can't just
   JSON.stringify (we'd get literal " around the whole string and
   have to double-encode), and we can't use the more general
   escapeHtml (single-quotes inside an unquoted attribute would
   be fine, but inside `data-content="..."` the only character
   that NEEDS encoding is the double quote itself). Keep the
   encoding local to the markmap fence. */
function encodeMarkmapAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function buildHighlight(): Promise<HighlightFn> {
  const [{ default: hljs }] = await Promise.all([
    import('highlight.js'),
    // github.css is the unconditional base — its plain `.hljs-*`
    // selectors are overridden by the scoped rules in
    // ./hljs-dark.css whenever the page is in dark mode. See that
    // file for the prefers-color-scheme + [data-theme='dark']
    // dual-scoping that makes a user-forced light win over a dark
    // OS preference.
    import('highlight.js/styles/github.css'),
    import('../hljs-dark.css'),
  ])
  return (str: string, lang: string) => {
    /* ```markmap → placeholder div. The real widget is mounted by
       useMarkmapMount (in components that v-html the rendered
       output: PreviewPane, ReadingPane, Article). We emit a div
       with the source in data-content rather than rendering the
       tree server-side because markmap's layout depends on the
       viewport, and we want the same interactive controls
       (fullscreen, reset) the reference VitePress build had. */
    if (lang === 'markmap') {
      return `<div class="markmap-mount" data-content="${encodeMarkmapAttr(str)}"></div>`
    }
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

// Per-call resolver for wiki links. The MarkdownIt instance is a
// module-level singleton, but the resolver depends on the
// currently-mounted link index (which changes as the user edits).
// Reading the resolver through this mutable ref means the
// wikiLinkPlugin always sees the latest one without rebuilding
// the whole pipeline. `useMarkdownRender` (or its caller) sets this
// before each `render()` call; the test seam
// `__setMdResolverForTesting` does the same.
let activeResolver: WikiResolver = (ref) => ({ target: ref })

export function __setMdResolverForTesting(fn: WikiResolver | null): void {
  activeResolver = fn ?? ((ref) => ({ target: ref }))
}

async function getMd(): Promise<MarkdownIt> {
  if (mdPromise) return mdPromise
  mdPromise = (async () => {
    const highlight = await buildHighlight()
    const md = new MarkdownIt({
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
            .replace(/[^a-z0-9一-龥]+/g, '-')
            .replace(/^-+|-+$/g, ''),
        permalink: anchor.permalink.headerLink({ safariReaderFix: true }),
      })
      // Wiki link + standard `.md` link classification. Plugin
      // signature is `(md, opts) => void` — see wikiLinks.ts for why
      // currying doesn't work with `md.use`. The resolver reads
      // `activeResolver` on every call so updates flow through.
      .use(wikiLinkPlugin, {
        resolve: (ref: string, anchor?: string) => activeResolver(ref, anchor),
      })
    return md
  })()
  return mdPromise
}

export async function render(markdown: string): Promise<string> {
  const md = await getMd()
  return md.render(markdown)
}
