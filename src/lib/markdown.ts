import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import taskLists from 'markdown-it-task-lists'
import anchor from 'markdown-it-anchor'
import footnote from 'markdown-it-footnote'
import deflist from 'markdown-it-deflist'
import mark from 'markdown-it-mark'
import { bareEmoji } from '@mdit/plugin-emoji'
import {
  EXTERNAL_LINK_PROVENANCE_ATTR,
  wikiLinkPlugin,
  type Resolver as WikiResolver,
  type WikiLinkEnv,
} from './wikiLinks'
import { calloutPlugin } from './callouts'
import { markdownContainersPlugin } from './markdownContainers'
import { mathPlugin } from './math'
import { emojiDefinitions } from './emoji'
import {
  markdownHeadingsPlugin,
  slugifyHeadingWithState,
} from './markdownHeadings'
import {
  highlightShikiFence,
  prepareShikiLanguages,
  syncGeneratedShikiStylesheet,
} from './shiki'
import { parseFenceMeta, type FenceMeta } from './fenceMeta'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
    'nav',
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
    'aria-label',
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
    'open',
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

export type MarkdownSanitizer = (html: string) => string

function createExternalLinkProvenance(): string {
  const secureCrypto = globalThis.crypto
  if (typeof secureCrypto?.randomUUID === 'function') return secureCrypto.randomUUID()
  if (typeof secureCrypto?.getRandomValues === 'function') {
    const bytes = secureCrypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  throw new Error('Secure randomness is required for Markdown link provenance')
}

function isGeneratedExternalAnchor(node: Element, provenanceToken: string): boolean {
  return typeof node?.tagName === 'string'
    && typeof node.getAttribute === 'function'
    && node.tagName.toLowerCase() === 'a'
    && node.getAttribute(EXTERNAL_LINK_PROVENANCE_ATTR) === provenanceToken
    && /^https?:/i.test(node.getAttribute('href') ?? '')
    && node.getAttribute('target') === '_blank'
}

export function createMarkdownSanitizer(provenanceToken?: string): MarkdownSanitizer {
  // DOMPurify's ESM default export is a factory when the module is evaluated
  // without a DOM (for example, before Vitest installs jsdom). Creating the
  // instance lazily keeps the same code safe in the browser and test runtime.
  const purifier = DOMPurify(typeof window === 'undefined' ? undefined : window)
  const trustedGeneratedAnchors = new WeakSet<Element>()

  purifier.addHook('beforeSanitizeAttributes', (node) => {
    if (!provenanceToken || !isGeneratedExternalAnchor(node, provenanceToken)) return
    trustedGeneratedAnchors.add(node)
    // The generated renderer owns this value. Normalize it here so a trusted
    // generated link cannot be weakened before the final sanitized output.
    node.setAttribute('rel', 'noopener noreferrer')
  })
  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName.startsWith('on')) {
      data.keepAttr = false
      return
    }

    // The provenance marker is a temporary sanitizer input, never a public
    // Markdown data attribute. It is removed for both valid and forged values.
    if (data.attrName === EXTERNAL_LINK_PROVENANCE_ATTR) {
      data.keepAttr = false
      return
    }

    // DOMPurify treats `target` as a URI-valued attribute and therefore
    // removes `_blank` even when it is listed in ALLOWED_ATTR. Preserve only
    // the renderer-produced value whose opaque per-render marker was verified
    // by beforeSanitizeAttributes. A public class is intentionally irrelevant.
    if (
      data.attrName === 'target'
      && data.attrValue === '_blank'
      && trustedGeneratedAnchors.has(node)
    ) {
      data.forceKeepAttr = true
      return
    }
    // Permit only the four attributes used by our mount and wiki-link
    // features; all other data-* attributes remain blocked.
    if (data.attrName.startsWith('data-')) {
      data.keepAttr = ALLOWED_MARKDOWN_DATA_ATTRS.has(data.attrName)
    }
  })
  return (html: string) => purifier.sanitize(html, MARKDOWN_SANITIZE_CONFIG)
}

export function sanitizeMarkdownHtml(html: string, provenanceToken?: string): string {
  return createMarkdownSanitizer(provenanceToken)(html)
}

/* URL-encode the markmap / mermaid source before putting it in a data
   attribute. Besides keeping the HTML attribute well-formed, this prevents
   Mermaid arrows such as `-->` from looking like an HTML comment terminator
   to DOMPurify's mXSS protections. The mount composables decode it again. */
function encodeMountAttr(s: string): string {
  return encodeURIComponent(s)
}

function renderPlainCodeFallback(source: string): string {
  return `<pre class="shiki docus-shiki-plain"><code>${escapeHtml(source)}</code></pre>`
}

function renderFence(str: string, info: string): string {
  const meta = parseFenceMeta(info)

  /* ```markmap → placeholder div. The real widget is mounted by
     useMarkmapMount (in components that v-html the rendered output). Keep
     this exact, case-sensitive branch before any Shiki lookup. */
  if (meta.specialFence === 'markmap') {
    return `<div class="markmap-mount" data-content="${encodeMountAttr(str)}"></div>`
  }

  /* ```mermaid → placeholder div. Mermaid's async mount lifecycle remains
     outside normal syntax highlighting and receives the encoded source. */
  if (meta.specialFence === 'mermaid') {
    return `<div class="mermaid-mount" data-content="${encodeMountAttr(str)}"></div>`
  }

  return highlightShikiFence(str, meta) ?? renderPlainCodeFallback(str)
}

let mdPromise: Promise<MarkdownIt> | null = null

async function getMd(): Promise<MarkdownIt> {
  if (mdPromise) return mdPromise
  mdPromise = (async () => {
    const md = new MarkdownIt({
      // HTML is enabled for Markdown compatibility, then sanitized by
      // DOMPurify in render() before the result reaches v-html.
      html: true,
      linkify: true,
      typographer: true,
      highlight(str, lang, attrs) {
        // MarkdownIt's callback exposes the first info token separately from
        // the remaining fence metadata. Recombine both channels so the
        // canonical FenceMeta parser sees the complete original info string;
        // in particular, `mermaid {1}` must not become the bare special fence
        // `mermaid`.
        const info = [lang, attrs].filter(Boolean).join(' ')
        return renderFence(str, info)
      },
    })
      // 任务列表: - [ ] / - [x], 启用 disabled 属性让 checkbox 在 preview 中可点(只是视觉,不会真保存)
      .use(taskLists, { enabled: true, label: true, lineNumber: false })
      // 标题锚点:给 h2/h3/h4 加 id,锚点样式由 .article 下的样式处理
      .use(anchor, {
        slugifyWithState: slugifyHeadingWithState,
        uniqueSlugStartIndex: 2,
        permalink: anchor.permalink.headerLink({ safariReaderFix: true }),
      })
      // MD-EXT-1 heading metadata/TOC rules register around the named anchor
      // core rule. The module owns only the narrow {#safe-id} suffix and the
      // final-ID TOC; it is not a generic attribute parser.
      .use(markdownHeadingsPlugin)
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
      // Docus-owned VitePress-style built-in containers. The rule is inserted
      // by name before MarkdownIt's paragraph rule and keeps the existing
      // callout, math, fence, and widget pipelines inside the same token flow.
      .use(markdownContainersPlugin)
      // Math placeholders are emitted before sanitization and upgraded by
      // useMathMount after v-html has inserted the safe HTML.
      .use(mathPlugin)
      // Shortcodes are rendered as native Unicode text. An explicit empty
      // shortcuts map keeps emoticon forms such as `:)` literal.
      .use(bareEmoji, { definitions: emojiDefinitions, shortcuts: {} })
    md.renderer.rules.table_open = () => '<div class="table-scroll"><table>\n'
    md.renderer.rules.table_close = () => '</table></div>\n'

    const defaultImageRenderer = md.renderer.rules.image
    md.renderer.rules.image = (tokens, index, options, env, self) => {
      // This renderer is reached only for Markdown image tokens. Raw HTML
      // <img> remains html_inline and therefore keeps its existing contract.
      tokens[index].attrSet('loading', 'lazy')
      return defaultImageRenderer
        ? defaultImageRenderer(tokens, index, options, env, self)
        : self.renderToken(tokens, index, options)
    }
    return md
  })()
  return mdPromise
}

export interface MarkdownRenderOptions {
  resolver?: WikiResolver
}

/**
 * Discover only MarkdownIt's actual fenced-code tokens. The discovery parse
 * receives a fresh empty env on every call, so wiki-link parsing can use its
 * internal fallback without invoking the caller's render-scoped resolver.
 */
export function discoverFenceLanguageIdentifiers(md: MarkdownIt, markdown: string): string[] {
  return discoverFenceMetas(md, markdown)
    .map((meta) => meta.language)
    .filter(Boolean)
}

/**
 * Discover MarkdownIt's actual fence tokens and parse each info string through
 * the one canonical FenceMeta parser. The discovery env remains isolated from
 * the caller's WikiLink resolver.
 */
export function discoverFenceMetas(md: MarkdownIt, markdown: string): FenceMeta[] {
  const discoveryEnv: WikiLinkEnv = {}
  return md
    .parse(markdown, discoveryEnv)
    .filter((token) => token.type === 'fence')
    .map((token) => parseFenceMeta(token.info ?? ''))
}

export async function render(markdown: string, options: MarkdownRenderOptions = {}): Promise<string> {
  const md = await getMd()
  const fenceMetas = discoverFenceMetas(md, markdown)
  await prepareShikiLanguages(fenceMetas)

  // Keep the final env separate from the discovery env. In particular, the
  // real resolver must only be visible to the actual render pass.
  const externalLinkProvenance = createExternalLinkProvenance()
  const env: WikiLinkEnv = {
    ...(options.resolver ? { wikiResolver: options.resolver } : {}),
    externalLinkProvenance,
  }
  const html = md.render(markdown, env)
  syncGeneratedShikiStylesheet()
  return sanitizeMarkdownHtml(html, externalLinkProvenance)
}
