import { expect, test } from '@playwright/test'

const annotatedSource = [
  '```ts {1,3}:line-numbers=10 [example.ts]',
  'const first = 1 // [!code highlight]',
  'const second = 2 // [!code focus:2]',
  'const added = 3 // [!code ++]',
  'const warning = 4 // [!code warning]',
  'const deferred = 5 // [!code highlight:2]',
  '```',
  '',
  '```mermaid {1}',
  'graph TD',
  'A --> B',
  '```',
].join('\n')

test('MD-EXT-3 separates fence metadata from approved Shiki source notation', async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')

  const result = await page.evaluate(async (markdown: string) => {
    const { render } = await import('/src/lib/markdown.ts')
    const article = document.createElement('article')
    article.className = 'article reading md-ext-3-browser-fixture'
    article.innerHTML = await render(markdown)
    document.body.append(article)

    const lines = Array.from(article.querySelectorAll<HTMLElement>('pre.shiki .line'))
    const lineContaining = (text: string) => lines.find((line) => line.textContent?.includes(text))
    const first = lineContaining('const first')
    const focused = lineContaining('const second')
    const added = lineContaining('const added')
    const warning = lineContaining('const warning')
    const deferred = lineContaining('const deferred')
    const beforeSwitch = article.innerHTML
    const firstNode = first

    const { useTheme } = await import('/src/composables/useTheme.ts')
    useTheme().set('dark')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const result = {
      firstHighlighted: first?.classList.contains('highlighted') ?? false,
      focused: focused?.classList.contains('focused') ?? false,
      added: added?.classList.contains('diff') && added?.classList.contains('add'),
      warning: warning?.classList.contains('warning') ?? false,
      deferredKeptAsSource: deferred?.textContent?.includes('[!code highlight:2]') ?? false,
      deferredNotActivated: deferred?.classList.contains('highlighted') === false,
      noLineNumberDom: article.querySelector('.docus-line-number, .docus-line-content') === null,
      metadataMermaidNotSpecial: article.querySelector('.mermaid-mount') === null,
      deferredGateMarkerLeaked: article.innerHTML.includes('docus-deferred-notation'),
      annotationBackground: first ? getComputedStyle(first).backgroundColor : '',
      annotationBorder: first ? getComputedStyle(first).boxShadow : '',
      themeSwitchKeptDom: article.innerHTML === beforeSwitch && first === firstNode,
    }
    article.remove()
    useTheme().set('light')
    return result
  }, annotatedSource)

  expect(result).toEqual({
    firstHighlighted: true,
    focused: true,
    added: true,
    warning: true,
    deferredKeptAsSource: true,
    deferredNotActivated: true,
    noLineNumberDom: true,
    metadataMermaidNotSpecial: true,
    deferredGateMarkerLeaked: false,
    annotationBackground: expect.not.stringMatching(/^(|rgba\(0, 0, 0, 0\))$/),
    annotationBorder: expect.not.stringMatching(/^(|none)$/),
    themeSwitchKeptDom: true,
  })
})

test('MD-EXT-3 preserves author sentinel-like source and deferred markers', async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')

  const result = await page.evaluate(async () => {
    const { render } = await import('/src/lib/markdown.ts')
    const article = document.createElement('article')
    article.className = 'article reading md-ext-3-source-fidelity-fixture'
    article.innerHTML = await render([
      '```ts',
      'const old = "[!code docus-deferred-notation hello]"',
      'const collision = "[!code docus-deferred-notation-0- hello]"',
      'const deferred = 1 // [!code highlight:2]',
      '```',
    ].join('\n'))
    document.body.append(article)

    const lines = Array.from(article.querySelectorAll<HTMLElement>('pre.shiki .line'))
    const text = lines.map((line) => line.textContent ?? '').join('\n')
    const deferred = lines.find((line) => line.textContent?.includes('const deferred'))
    const result = {
      oldSentinelPreserved: text.includes('[!code docus-deferred-notation hello]'),
      collisionCandidatePreserved: text.includes('[!code docus-deferred-notation-0- hello]'),
      deferredMarkerPreserved: text.includes('[!code highlight:2]'),
      deferredNotActivated: deferred?.classList.contains('highlighted') === false,
      invocationMarkerLeaked: article.innerHTML.includes('docus-deferred-notation-1-'),
    }
    article.remove()
    return result
  })

  expect(result).toEqual({
    oldSentinelPreserved: true,
    collisionCandidatePreserved: true,
    deferredMarkerPreserved: true,
    deferredNotActivated: true,
    invocationMarkerLeaked: false,
  })
})

test('MD-EXT-3 keeps annotations and expands generated details only in the PDF surface', async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')

  const result = await page.evaluate(async () => {
    const { render } = await import('/src/lib/markdown.ts')
    const pdf = await import('/src/lib/pdfExport.ts')
    const article = document.createElement('article')
    article.className = 'article reading'
    article.innerHTML = await render([
      '::: details Hidden annotation',
      '',
      '```ts',
      'const value = 1 // [!code error]',
      '```',
      '',
      ':::',
    ].join('\n'))
    document.body.append(article)

    const liveDetails = article.querySelector<HTMLDetailsElement>('.markdown-container-details')
    if (!liveDetails) throw new Error('MD-EXT-3 PDF fixture is missing details')
    liveDetails.open = false

    const stylesheet = document.createElement('style')
    stylesheet.textContent = pdf.__testing__.buildPdfDownloadStyles()
    document.head.append(stylesheet)

    const host = document.createElement('main')
    host.className = 'pdf-document vault'
    const prepared = document.createElement('div')
    prepared.innerHTML = pdf.preparePdfArticleHtml(article)
    host.append(prepared)
    document.body.append(host)

    const cloneDetails = prepared.querySelector<HTMLDetailsElement>('.markdown-container-details')
    const errorLine = prepared.querySelector<HTMLElement>('pre.shiki .line.error')
    const token = errorLine?.querySelector<HTMLElement>('[class*="docus-shiki-"]')
    if (!cloneDetails || !errorLine || !token) throw new Error('MD-EXT-3 PDF fixture is incomplete')

    const tokenStyle = getComputedStyle(token)
    const normalize = (value: string) => {
      const probe = document.createElement('span')
      probe.style.color = value.trim()
      document.body.append(probe)
      const normalized = getComputedStyle(probe).color
      probe.remove()
      return normalized
    }
    const result = {
      liveDetailsOpen: liveDetails.open,
      cloneDetailsOpen: cloneDetails.open,
      errorClass: errorLine.classList.contains('error'),
      lineBackground: getComputedStyle(errorLine).backgroundColor,
      lineBorder: getComputedStyle(errorLine).boxShadow,
      tokenColor: tokenStyle.color,
      lightTokenColor: normalize(tokenStyle.getPropertyValue('--shiki-light')),
      darkTokenColor: normalize(tokenStyle.getPropertyValue('--shiki-dark')),
      noInlineStyle: prepared.querySelector('[style]') === null,
    }

    host.remove()
    article.remove()
    stylesheet.remove()
    return result
  })

  expect(result.liveDetailsOpen).toBe(false)
  expect(result.cloneDetailsOpen).toBe(true)
  expect(result.errorClass).toBe(true)
  expect(result.lineBackground).not.toBe('rgba(0, 0, 0, 0)')
  expect(result.lineBorder).not.toBe('none')
  expect(result.tokenColor).toBe(result.lightTokenColor)
  expect(result.tokenColor).not.toBe(result.darkTokenColor)
  expect(result.noInlineStyle).toBe(true)
})
