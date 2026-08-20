import html2pdf from 'html2pdf.js'
import { parseDoc } from './frontmatter'

export interface PdfDownloadOptions {
  /** The default filename used by the browser download. */
  title: string
  /** Already-prepared article HTML from the rendered reading surface. */
  articleHtml: string
}

const A4_PAGE_HEIGHT_MM = 297
const PDF_PAGE_MARGIN_TOP_MM = 16
const PDF_PAGE_MARGIN_BOTTOM_MM = 18
const PDF_PRINTABLE_PAGE_HEIGHT_MM = A4_PAGE_HEIGHT_MM
  - PDF_PAGE_MARGIN_TOP_MM
  - PDF_PAGE_MARGIN_BOTTOM_MM
const CSS_PX_PER_MM = 96 / 25.4
const PDF_PRINTABLE_PAGE_HEIGHT_PX = PDF_PRINTABLE_PAGE_HEIGHT_MM * CSS_PX_PER_MM

const PDF_DOWNLOAD_STYLES = `
@page {
  size: A4;
  margin: 16mm 18mm 18mm;
}

.pdf-download-root {
  margin: 0;
  padding: 0;
  color-scheme: light;
  background: #ffffff;
  color: #202124;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Keep the vault's markdown selectors active while removing the app chrome
   and the scroll container that only makes sense in the live reader. */
.pdf-document.vault {
  display: block !important;
  width: auto !important;
  height: auto !important;
  min-height: 0 !important;
  overflow: visible !important;
  background: #ffffff !important;
  color: #202124 !important;
  --vs-bg-1: #ffffff !important;
  --vs-bg-2: #f5f6f8 !important;
  --vs-bg-3: #e9edf2 !important;
  --vs-border: #d7dce2 !important;
  --vs-text-1: #202124 !important;
  --vs-text-2: #4b5563 !important;
  --vs-text-3: #6b7280 !important;
  --vs-accent: #005fb8 !important;
  --vs-accent-hover: #0258a8 !important;
  --vs-hover-bg: #eef3f8 !important;
  --vs-table-border: #d7dce2 !important;
  --text: #202124 !important;
  --text-h: #111827 !important;
  --text-muted: #4b5563 !important;
  --bg: #ffffff !important;
  --bg-soft: #f5f6f8 !important;
  --border: #d7dce2 !important;
  --code-bg: #f5f6f8 !important;
  --accent: #005fb8 !important;
}

.pdf-document .reading-pane {
  display: block !important;
  width: auto !important;
  height: auto !important;
  min-height: 0 !important;
  overflow: visible !important;
  padding: 0 !important;
}

.pdf-document .article.reading {
  display: block !important;
  width: auto !important;
  max-width: none !important;
  min-width: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  color: #202124 !important;
  font-size: 11.5pt !important;
  line-height: 1.68 !important;
}

.pdf-document .article :where(h1, h2, h3, h4, h5, h6) {
  color: #111827 !important;
  break-inside: avoid;
  page-break-inside: avoid;
  break-after: avoid;
  page-break-after: avoid;
}

.pdf-document .article h1 {
  margin-top: 0 !important;
  font-size: 25pt !important;
}

.pdf-document .article h2 {
  font-size: 17pt !important;
}

.pdf-document .article h3 {
  font-size: 13.5pt !important;
}

.pdf-document .article h4,
.pdf-document .article h5,
.pdf-document .article h6 {
  font-size: 11.5pt !important;
}

.pdf-document .article a {
  color: inherit !important;
  text-decoration: none !important;
}

.pdf-document .article pre,
.pdf-document .article blockquote,
.pdf-document .article .table-scroll,
.pdf-document .article img,
.pdf-document .article .markmap-widget,
.pdf-document .article .mermaid-widget-host {
  break-inside: avoid;
  page-break-inside: avoid;
}

.pdf-document .article pre {
  overflow: visible !important;
  white-space: pre-wrap !important;
  overflow-wrap: anywhere;
  background: #f5f6f8 !important;
  border: 1px solid #d7dce2 !important;
  color: #202124 !important;
}

.pdf-document .article pre code {
  white-space: inherit !important;
  overflow-wrap: anywhere !important;
  word-break: break-word !important;
}

.pdf-document .article blockquote {
  background: #f5f6f8 !important;
  border-left-color: #005fb8 !important;
  color: #4b5563 !important;
}

/* The reader callout theme uses color-mix(), which html2canvas's CSS parser
   cannot consume in every Chromium build. Resolve the printable palette here
   so a callout cannot abort the entire PDF transaction. */
.pdf-document .article .callout {
  background: #f5f6f8 !important;
  border-color: #d7dce2 !important;
  border-left-color: #005fb8 !important;
  color: #4b5563 !important;
}

.pdf-document .article .callout-title,
.pdf-document .article .callout-icon {
  color: #005fb8 !important;
}

.pdf-document .article .table-scroll {
  box-sizing: border-box;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  overflow: visible !important;
  border-color: #d7dce2 !important;
  background: #ffffff !important;
}

.pdf-document .article .table-scroll > table {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  table-layout: fixed !important;
  font-size: 10.5pt !important;
}

.pdf-document .article th {
  background: #eef1f4 !important;
}

.pdf-document .article th,
.pdf-document .article td {
  border-color: #d7dce2 !important;
  white-space: normal !important;
  overflow-wrap: anywhere !important;
  word-break: break-word !important;
}

/* Resolve the reader's alternating-row color-mix() before html2canvas
   parses the PDF clone. The PDF keeps a quiet printable row background and
   never relies on the interactive hover state. */
.pdf-document .article tbody tr,
.pdf-document .article tbody tr:nth-child(even),
.pdf-document .article tbody tr:hover {
  background: #ffffff !important;
}

.pdf-document .article thead {
  display: table-header-group;
}

.pdf-document .article img {
  max-width: 100% !important;
  height: auto !important;
}

/* Mermaid is interactive in the reader: the live widget has a fixed
   height, svg-pan-zoom transforms, and a hover toolbar. Those rules are
   useful on screen but make a PDF snapshot easy to clip or scale twice.
   preparePdfArticleHtml() turns the widget into a static SVG; these rules
   give that SVG a document-width, viewBox-driven layout for the download. */
.pdf-document .article .mermaid-widget-host,
.pdf-document .article .pdf-mermaid {
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}

.pdf-document .article .mermaid-widget-host {
  display: block !important;
  width: 100% !important;
  min-height: 0 !important;
  margin: 1.15em 0 !important;
  font-size: 1em !important;
  line-height: normal !important;
}

.pdf-document .article .pdf-mermaid {
  display: block !important;
  width: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  background: #ffffff !important;
  text-align: center !important;
}

.pdf-document .article .pdf-mermaid > svg {
  display: block !important;
  width: 100% !important;
  height: auto !important;
  max-width: 100% !important;
  margin: 0 auto !important;
  overflow: visible !important;
  background: transparent !important;
}

/* MarkMap's reader SVG has no stable viewBox: Markmap uses a root-group
   transform for auto-fit and keeps the widget at a fixed screen height. The
   export surface captures that settled fit transform, and the static clone
   below reuses it in a document-width box without the reader toolbar. */
.pdf-document .article .pdf-markmap {
  display: block !important;
  width: 100% !important;
  height: 480px !important;
  margin: 1.15em 0 !important;
  overflow: visible !important;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}

/* html2pdf.js understands break-inside: avoid on a block, but it does not
   interpret break-after: avoid on a heading. Keep a diagram heading in the
   same pagination unit as its widget so a widget that moves to the next page
   cannot leave its heading behind. */
.pdf-document .article .pdf-heading-group {
  display: block !important;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}

/* Keep short blocks together, but let a block that is taller than the
   printable A4 page continue onto the next page. The class is added only to
   the PDF clone after its real browser geometry is available. */
.pdf-document .article .pdf-allow-split {
  break-inside: auto !important;
  page-break-inside: auto !important;
}

.pdf-document .article .pdf-markmap > svg {
  display: block !important;
  width: 100% !important;
  height: 480px !important;
  max-width: 100% !important;
  overflow: visible !important;
  background: transparent !important;
}

.pdf-document .article .pdf-markmap-error {
  box-sizing: border-box;
  min-height: 3em;
  padding: 0.8em 1em;
  color: #4b5563 !important;
  background: #f5f6f8 !important;
  border: 1px solid #d7dce2 !important;
}

.pdf-document .article .markmap-toolbar-area,
.pdf-document .article .mermaid-toolbar-area,
.pdf-document .article button {
  display: none !important;
}
`

/** Make a browser-friendly filename while preserving Unicode titles. */
export function sanitizePdfFileName(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  return (sanitized || 'docus-document').slice(0, 120)
}

/** Pick the same human-facing title a reader sees when the caller has no tab title. */
export function resolvePdfDocumentLabel(input: {
  raw: string
  documentTitle?: string
  documentPath?: string
}): string {
  const parsed = parseDoc(input.raw)
  const frontmatterTitle = typeof parsed.frontmatter.title === 'string'
    ? parsed.frontmatter.title.trim()
    : ''
  if (frontmatterTitle) return frontmatterTitle

  const headingTitle = parsed.content.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() ?? ''
  if (headingTitle) {
    return headingTitle
      .replace(/[`*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const documentTitle = input.documentTitle?.trim() ?? ''
  if (documentTitle) return documentTitle

  const basename = input.documentPath?.split('/').pop()?.replace(/\.md$/i, '').trim() ?? ''
  return basename || 'docus-document'
}

function stripPanZoomViewport(svg: SVGSVGElement): void {
  for (const viewport of svg.querySelectorAll<SVGGElement>('.svg-pan-zoom_viewport')) {
    /* svg-pan-zoom stores the current fit/pan state as both an SVG
       transform attribute and an inline CSS transform. A PDF clone
       has a different width from the reader, so carrying that matrix over
       would make the diagram look offset, tiny, or clipped. */
    viewport.removeAttribute('transform')
    viewport.style.removeProperty('transform')
    if (!viewport.style.cssText.trim()) viewport.removeAttribute('style')
    const classNames = (viewport.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter((name) => name && name !== 'svg-pan-zoom_viewport')
    if (classNames.length > 0) viewport.setAttribute('class', classNames.join(' '))
    else viewport.removeAttribute('class')
  }
}

function prepareMermaidSvg(source: SVGSVGElement): SVGSVGElement {
  const svg = source.cloneNode(true) as SVGSVGElement
  const originalViewBox = svg.getAttribute('data-mermaid-viewbox')
    ?? svg.getAttribute('viewBox')
  if (originalViewBox) svg.setAttribute('viewBox', originalViewBox)
  /* Mermaid's live component and svg-pan-zoom both write inline sizing
     metadata. Let the PDF stylesheet size the clone from its viewBox. */
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.removeAttribute('style')
  svg.removeAttribute('data-pan-zoom-bound')
  svg.removeAttribute('data-mermaid-viewbox')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  stripPanZoomViewport(svg)
  return svg
}

function prepareMarkmapSvg(source: SVGSVGElement): SVGSVGElement {
  const svg = source.cloneNode(true) as SVGSVGElement
  /* MarkMap has no diagram viewBox. Its settled auto-fit lives on the direct
     root <g>; restore the fit captured by the isolated export surface so a
     reader-side pan/zoom can never leak into the PDF clone. */
  const fitTransform = source.getAttribute('data-markmap-fit-transform')
  const rootGroup = Array.from(svg.children).find((child) => child.tagName.toLowerCase() === 'g')
  if (rootGroup?.tagName.toLowerCase() === 'g' && fitTransform) {
    rootGroup.setAttribute('transform', fitTransform)
  }

  /* The live MarkMap SVG is CSS-sized and intentionally has no viewBox. Give
     the clone the export surface's user coordinate system; otherwise canvas
     renderers use SVG's 300x150 fallback and the graph collapses into a tiny
     clipped corner. */
  const viewport = source.getAttribute('data-markmap-viewport')?.trim() ?? ''
  const [width, height] = viewport.split(/\s+/).map(Number)
  if (!svg.getAttribute('viewBox') && Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
  }

  svg.removeAttribute('style')
  svg.removeAttribute('data-markmap-fit-transform')
  svg.removeAttribute('data-markmap-viewport')
  const classNames = (svg.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter((name) => name && name !== 'markmap-svg' && !name.startsWith('mm-'))
  if (!classNames.includes('markmap')) classNames.push('markmap')
  svg.setAttribute('class', classNames.join(' '))
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute('data-markmap-static', 'true')
  return svg
}

function unwrapStandaloneFenceWidget(host: HTMLElement): void {
  /* markdown-it emits custom fences as <pre><code>...</code></pre>. The
     post-mount Vue widget replaces the fence contents but intentionally keeps
     that source wrapper in the reader DOM. A PDF snapshot must remove the
     wrapper: its code-block pagination rule would otherwise separate the
     heading from the static diagram and add an unrelated code background. */
  const code = host.parentElement
  const fence = code?.parentElement
  if (!code || !fence || code.tagName !== 'CODE' || fence.tagName !== 'PRE') return

  const containsOnly = (parent: HTMLElement, child: HTMLElement) =>
    Array.from(parent.childNodes).every((node) => (
      node === child || (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim())
    ))
  if (!containsOnly(code, host) || !containsOnly(fence, code)) return
  fence.replaceWith(host)
}

function groupHeadingWithBlock(block: HTMLElement): void {
  const heading = block.previousElementSibling
  if (!(heading instanceof HTMLElement) || !/^H[1-6]$/.test(heading.tagName)) return
  const parent = heading.parentElement
  if (!parent || parent !== block.parentElement) return

  const group = block.ownerDocument.createElement('div')
  group.className = 'pdf-heading-group'
  parent.insertBefore(group, heading)
  group.append(heading, block)
}

const PDF_LAYOUT_BLOCK_SELECTOR = [
  '.article pre',
  '.article .table-scroll',
  '.article blockquote',
  '.article .mermaid-widget-host',
  '.article .pdf-mermaid',
  '.article .markmap-widget-host',
  '.article .pdf-markmap',
  '.article .pdf-heading-group',
].join(', ')

function measurePdfPrintablePageHeight(root: HTMLElement): number {
  const probe = root.ownerDocument.createElement('div')
  probe.style.cssText = [
    'position: absolute',
    'visibility: hidden',
    'pointer-events: none',
    `height: ${PDF_PRINTABLE_PAGE_HEIGHT_MM}mm`,
    'width: 1px',
  ].join(';')
  root.appendChild(probe)
  const measured = probe.getBoundingClientRect().height
  probe.remove()
  return measured > 0 ? measured : PDF_PRINTABLE_PAGE_HEIGHT_PX
}

/**
 * Allow only genuinely oversized PDF blocks to split across pages.
 *
 * The measurement is made after the download root is attached, so it uses
 * the same CSS width and font metrics that html2canvas will capture. The
 * threshold is expressed as the A4 printable height from the PDF margins,
 * not a developer viewport height. Short blocks retain their keep-together
 * rule.
 */
export function markOversizedPdfBlocks(root: HTMLElement): void {
  const printablePageHeight = measurePdfPrintablePageHeight(root)

  for (const block of root.querySelectorAll<HTMLElement>(PDF_LAYOUT_BLOCK_SELECTOR)) {
    if (block.getBoundingClientRect().height <= printablePageHeight) continue
    block.classList.add('pdf-allow-split')
    block.closest<HTMLElement>('.pdf-heading-group')?.classList.add('pdf-allow-split')
  }
}

/**
 * Clone the live article and remove reader-only Mermaid runtime state.
 *
 * The original DOM is deliberately left untouched: the reader may have a
 * user-selected zoom/pan position, while the export must start from the
 * diagram's own viewBox and fit the PDF column.
 */
export function preparePdfArticleHtml(article: HTMLElement): string {
  const clone = article.cloneNode(true) as HTMLElement

  clone.querySelectorAll('.mermaid-toolbar-area, .markmap-toolbar-area')
    .forEach((toolbar) => toolbar.remove())

  for (const host of clone.querySelectorAll<HTMLElement>('.mermaid-widget-host')) {
    const sourceSvg = host.querySelector<SVGSVGElement>('.mermaid-svg > svg')
    if (!sourceSvg) {
      unwrapStandaloneFenceWidget(host)
      continue
    }

    const staticDiagram = clone.ownerDocument.createElement('div')
    staticDiagram.className = 'pdf-mermaid'
    staticDiagram.appendChild(prepareMermaidSvg(sourceSvg))
    host.replaceChildren(staticDiagram)
    unwrapStandaloneFenceWidget(host)
  }

  for (const host of clone.querySelectorAll<HTMLElement>('.markmap-widget-host')) {
    const widget = host.querySelector<HTMLElement>('.markmap-widget')
    const sourceSvg = widget?.querySelector<SVGSVGElement>('.markmap-svg')
    const error = widget?.querySelector<HTMLElement>('.markmap-error')
    if (!sourceSvg || !sourceSvg.querySelector('g')) {
      if (error) {
        const errorBox = clone.ownerDocument.createElement('div')
        errorBox.className = 'pdf-markmap-error'
        errorBox.textContent = error.textContent?.trim() || '思维导图加载失败'
        host.replaceChildren(errorBox)
      }
      unwrapStandaloneFenceWidget(host)
      continue
    }

    const staticDiagram = clone.ownerDocument.createElement('div')
    staticDiagram.className = 'pdf-markmap'
    staticDiagram.appendChild(prepareMarkmapSvg(sourceSvg))
    host.replaceChildren(staticDiagram)
    unwrapStandaloneFenceWidget(host)
  }

  /* A CSS `break-after: avoid` on a heading is not acted on by html2pdf.js's
     page-break plugin. Wrap diagram headings with their now-static widget so
     the plugin can move the complete pair when the widget would cross a page. */
  const widgetHosts = Array.from(clone.querySelectorAll<HTMLElement>(
    '.mermaid-widget-host, .markmap-widget-host',
  ))
  for (const host of widgetHosts) groupHeadingWithBlock(host)

  /* Images inside a paragraph have the same pagination hazard: html2pdf.js
     moves the image paragraph to the next page while the preceding heading
     remains in place. Keep an image-only paragraph with its heading as well. */
  for (const paragraph of clone.querySelectorAll<HTMLElement>('p')) {
    if (paragraph.children.length !== 1 || paragraph.firstElementChild?.tagName !== 'IMG') continue
    groupHeadingWithBlock(paragraph)
  }

  /* A wide table can be short enough to keep together but still be moved by
     the page-break plugin when the remaining page space is small. Group its
     heading with the table so the heading does not become an orphan at the
     bottom of the previous page. */
  for (const table of clone.querySelectorAll<HTMLElement>('.table-scroll')) {
    groupHeadingWithBlock(table)
  }

  return clone.outerHTML
}

/** Build the DOM fragment passed to html2pdf.js. */
export function buildPdfDownloadDocument(articleHtml: string): string {
  return `<main class="pdf-document vault">
    <div class="reading-pane">
      ${articleHtml}
    </div>
  </main>`
}

interface PdfDownloadSurface {
  host: HTMLElement
  root: HTMLElement
}

function createPdfDownloadElement(articleHtml: string): PdfDownloadSurface {
  const host = document.createElement('div')
  host.className = 'pdf-download-host'
  host.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: -100000px',
    'width: 720px',
    'height: 1px',
    'overflow: visible',
    'visibility: visible',
    'pointer-events: none',
    'z-index: -1',
  ].join(';')

  const root = document.createElement('div')
  root.className = 'pdf-download-root'
  root.dataset.docusPdfDownloadRoot = 'true'
  root.setAttribute('aria-hidden', 'true')
  root.style.cssText = [
    'display: block',
    'width: 100%',
    'min-height: 1px',
    'overflow: visible',
    'visibility: visible',
    'pointer-events: none',
  ].join(';')
  root.innerHTML = buildPdfDownloadDocument(articleHtml)

  const stylesheet = document.createElement('style')
  stylesheet.id = 'docus-pdf-download-styles'
  stylesheet.textContent = PDF_DOWNLOAD_STYLES
  root.prepend(stylesheet)
  host.appendChild(root)
  return { host, root }
}

function pdfFileName(title: string): string {
  const safeTitle = sanitizePdfFileName(title)
  return safeTitle.toLowerCase().endsWith('.pdf') ? safeTitle : `${safeTitle}.pdf`
}

/** Render the prepared article to a PDF blob and trigger a browser download. */
export async function downloadPdfDocument(options: PdfDownloadOptions): Promise<void> {
  const surface = createPdfDownloadElement(options.articleHtml)
  document.body.appendChild(surface.host)

  try {
    markOversizedPdfBlocks(surface.root)
    const pdfOptions = {
      margin: [16, 18, 18, 18] as [number, number, number, number],
      filename: pdfFileName(options.title),
      image: { type: 'jpeg' as const, quality: 0.98 },
      enableLinks: true,
      pagebreak: { mode: ['css', 'legacy'] },
      html2canvas: {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        imageTimeout: 15000,
        logging: false,
        onclone: (clonedDocument: Document) => {
          const clonedRoot = clonedDocument.querySelector<HTMLElement>('[data-docus-pdf-download-root="true"]')
          if (!clonedRoot) return
          // html2pdf clones the source into a hidden overlay. Keep the
          // cloned document in normal flow so html2canvas measures its full
          // content height instead of inheriting any host positioning.
          clonedRoot.style.position = 'static'
          clonedRoot.style.top = 'auto'
          clonedRoot.style.left = 'auto'
          clonedRoot.style.width = '100%'
          clonedRoot.style.visibility = 'visible'
          clonedRoot.style.pointerEvents = 'auto'
        },
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait' as const,
      },
    }
    const worker = html2pdf().set(pdfOptions).from(surface.root)

    await worker.save()
  } finally {
    surface.host.remove()
  }
}

export const __testing__ = {
  PDF_DOWNLOAD_STYLES,
  PDF_PRINTABLE_PAGE_HEIGHT_MM,
  markOversizedPdfBlocks,
  prepareMarkmapSvg,
}
