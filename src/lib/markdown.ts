import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import taskLists from 'markdown-it-task-lists'
import anchor from 'markdown-it-anchor'
import footnote from 'markdown-it-footnote'
import deflist from 'markdown-it-deflist'
import mark from 'markdown-it-mark'
import { wikiLinkPlugin, type Resolver as WikiResolver, type WikiLinkEnv } from './wikiLinks'
import { calloutPlugin } from './callouts'

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

/* Markdown documents intentionally support semantic HTML, but the rendered
   result is inserted with Vue's v-html. Keep this allowlist tight enough for
   the Markdown renderer's output and existing HTML use cases, then let
   DOMPurify enforce it on the final HTML string. */
const MARKDOWN_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'a',
    'abbr',
    'b',
    'blockquote',
    'br',
    'caption',
    'code',
    'col',
    'colgroup',
    'dd',
    'del',
    'details',
    'div',
    'dl',
    'dt',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'input',
    'kbd',
    'label',
    'li',
    'mark',
    'ol',
    'p',
    'pre',
    'q',
    's',
    'samp',
    'section',
    'small',
    'span',
    'strong',
    'sub',
    'summary',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'u',
    'ul',
  ],
  ALLOWED_ATTR: [
    'alt',
    'aria-hidden',
    'checked',
    'class',
    'colspan',
    'data-anchor',
    'data-content',
    'data-missing',
    'data-target',
    'disabled',
    'height',
    'href',
    'id',
    'loading',
    'rel',
    'role',
    'rowspan',
    'src',
    'target',
    'title',
    'type',
    'width',
  ],
  // The hook below narrows this back down to the four data-* attributes
  // used by Docus; DOMPurify needs this enabled before the hook can inspect
  // and retain those explicitly supported attributes.
  ALLOW_DATA_ATTR: true,
  FORBID_ATTR: ['style'],
  FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'link', 'math', 'meta', 'object', 'script', 'style', 'svg'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|#|\/(?!\/)|\.{1,2}\/|[a-z0-9][a-z0-9+.-]*(?:[\/?#]|$))/i,
}

const ALLOWED_MARKDOWN_DATA_ATTRS = new Set([
  'data-anchor',
  'data-content',
  'data-missing',
  'data-target',
])

function sanitizeMarkdownHtml(html: string): string {
  // DOMPurify's ESM default export is a factory when the module is evaluated
  // without a DOM (for example, before Vitest installs jsdom). Creating the
  // instance lazily keeps the same code safe in the browser and test runtime.
  const purifier = DOMPurify(typeof window === 'undefined' ? undefined : window)
  purifier.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName.startsWith('on')) {
      data.keepAttr = false
      return
    }
    // Permit only the four attributes used by our mount and wiki-link
    // features; all other data-* attributes remain blocked.
    if (data.attrName.startsWith('data-')) {
      data.keepAttr = ALLOWED_MARKDOWN_DATA_ATTRS.has(data.attrName)
    }
  })
  return purifier.sanitize(html, MARKDOWN_SANITIZE_CONFIG)
}

/* URL-encode the markmap / mermaid source before putting it in a data
   attribute. Besides keeping the HTML attribute well-formed, this prevents
   Mermaid arrows such as `-->` from looking like an HTML comment terminator
   to DOMPurify's mXSS protections. The mount composables decode it again. */
function encodeMountAttr(s: string): string {
  return encodeURIComponent(s)
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
       output: ReadingPane). We emit a div
       with the source in data-content rather than rendering the
       tree server-side because markmap's layout depends on the
       viewport, and we want the same interactive controls
       (fullscreen, reset) the reference VitePress build had. */
    if (lang === 'markmap') {
      return `<div class="markmap-mount" data-content="${encodeMountAttr(str)}"></div>`
    }
    /* ```mermaid → placeholder div. Same post-mount pattern as
       markmap: a div with the source on data-content, and
       useMermaidMount replaces it with a `<Mermaid :code="...">`
       app instance. We don't render the diagram inline because
       mermaid's API is async (it lazy-loads its layout engines
       per diagram type) and the post-mount flow already handles
       lifecycle / theme switches cleanly. */
    if (lang === 'mermaid') {
      return `<div class="mermaid-mount" data-content="${encodeMountAttr(str)}"></div>`
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

async function getMd(): Promise<MarkdownIt> {
  if (mdPromise) return mdPromise
  mdPromise = (async () => {
    const highlight = await buildHighlight()
    const md = new MarkdownIt({
      // HTML is enabled for Markdown compatibility, then sanitized by
      // DOMPurify in render() before the result reaches v-html.
      html: true,
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
      // 脚注:pandoc 风格的 [^id] 引用 + 定义段。anchor id 始终按
      // 出现顺序编号(fn1, fn2, ...),[^label] 里的 label 只用来匹配
      // ref ↔ def,不参与 anchor 命名。放在 anchor 之后:脚注规则
      // 和标题 slugify 互不影响,但读起来"先标题、再脚注、再链接"
      // 比 anchor 之前更顺。
      .use(footnote)
      // 定义列表:pandoc 风格的 `Term\n:   Definition`。跟脚注
      // 不冲突(: 是行首字符,[^] 是行内),放在脚注之后读着自然。
      .use(deflist)
      // 高亮:`==text==` → `<mark>text</mark>`。Obsidian / VitePress
      // 风格的标记,语义用浏览器原生 <mark> 元素。不放在最前面
      // 是因为它跟其它行内标记(粗体、代码、链接)需要在同一阶段
      // 解析,但顺序对结果无影响 —— 这里跟 deflist 排在一起读着顺。
      .use(mark)
      // Wiki link + standard `.md` link classification. The resolver is
      // supplied through markdown-it's per-render env by render().
      .use(wikiLinkPlugin)
      // Obsidian-style `> [!note]` callouts. The plugin transforms the
      // parsed blockquote token and leaves ordinary blockquotes untouched.
      .use(calloutPlugin)
    md.renderer.rules.table_open = () => '<div class="table-scroll"><table>\n'
    md.renderer.rules.table_close = () => '</table></div>\n'
    return md
  })()
  return mdPromise
}

export interface MarkdownRenderOptions {
  resolver?: WikiResolver
}

export async function render(markdown: string, options: MarkdownRenderOptions = {}): Promise<string> {
  const md = await getMd()
  const env: WikiLinkEnv = options.resolver ? { wikiResolver: options.resolver } : {}
  return sanitizeMarkdownHtml(md.render(markdown, env))
}
