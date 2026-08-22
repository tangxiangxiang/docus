import { expect, test } from '@playwright/test'

const lineNumberFixture = [
  '# MD-EXT-4',
  '',
  '```ts',
  'const defaultOff = 1',
  '```',
  '',
  '```ts:line-numbers',
  'alpha',
  'beta',
  '```',
  '',
  '```ts:line-numbers=98',
  'custom first',
  'custom second',
  '```',
  '',
  '```ts:no-line-numbers',
  'const explicitOff = 1',
  '```',
  '',
  '```ts {2}:line-numbers=10',
  'const first = 1',
  'const second = 2 // [!code error]',
  '```',
  '',
  '```definitely-not-a-language:line-numbers=7',
  '<script>alert(1)</script>',
  'a < b && c > d',
  '```',
  '',
  '```ts:line-numbers=100000',
  'const veryLongValue = "repeat enough text here to wrap in the reader and PDF surface repeat enough text here to wrap in the reader and PDF surface"',
  '```',
].join('\n')

test('MD-EXT-4 renders bounded structural gutters with copy and theme safety', async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')

  const result = await page.evaluate(async (markdown: string) => {
    const { render } = await import('/src/lib/markdown.ts')
    const { useTheme } = await import('/src/composables/useTheme.ts')
    const article = document.createElement('article')
    article.className = 'article reading md-ext-4-browser-fixture'
    article.style.width = '260px'
    article.innerHTML = await render(markdown)
    document.body.append(article)

    const blocks = Array.from(article.querySelectorAll<HTMLElement>('pre.shiki'))
    const defaultOff = blocks[0]
    const enabled = blocks[1]
    const customStart = blocks[2]
    const explicitOff = blocks[3]
    const annotated = blocks[4]
    const unknown = blocks[5]
    const wrapped = blocks[6]
    if (!defaultOff || !enabled || !customStart || !explicitOff || !annotated || !unknown || !wrapped) {
      throw new Error('MD-EXT-4 browser fixture is incomplete')
    }

    const enabledLines = Array.from(enabled.querySelectorAll<HTMLElement>('.line'))
    const customNumbers = Array.from(customStart.querySelectorAll<HTMLElement>('.docus-line-number'))
      .map((node) => node.textContent)
    const unknownLines = Array.from(unknown.querySelectorAll<HTMLElement>('.line'))
    const allGutters = Array.from(article.querySelectorAll<HTMLElement>('.docus-line-number'))
    const annotatedLine = Array.from(annotated.querySelectorAll<HTMLElement>('.line'))
      .find((line) => line.textContent?.includes('const second'))
    if (!annotatedLine) throw new Error('MD-EXT-4 annotation line is missing')
    const selection = window.getSelection()
    selection?.removeAllRanges()
    const code = enabled.querySelector('code')
    if (!code) throw new Error('MD-EXT-4 enabled code is missing')
    const range = document.createRange()
    range.selectNodeContents(code)
    selection?.addRange(range)

    const beforeThemeSwitch = article.innerHTML
    const enabledLine = enabled.querySelector('.line')
    useTheme().set('dark')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const enabledContent = enabled.querySelector<HTMLElement>('.docus-line-content')
    const wrappedContent = wrapped.querySelector<HTMLElement>('.docus-line-content')
    const lineHeight = Number.parseFloat(getComputedStyle(wrappedContent ?? wrapped).lineHeight)
    const wrappedHeight = wrappedContent?.getBoundingClientRect().height ?? 0

    const result = {
      defaultOffHasGutter: defaultOff.querySelector('.docus-line-number, .docus-line-content') !== null,
      enabledNumbers: enabledLines.map((line) => line.querySelector('.docus-line-number')?.textContent),
      enabledContent: enabledLines.map((line) => line.querySelector('.docus-line-content')?.textContent),
      customNumbers,
      explicitOffHasGutter: explicitOff.querySelector('.docus-line-number, .docus-line-content') !== null,
      annotatedClasses: {
        highlighted: annotatedLine.classList.contains('highlighted'),
        error: annotatedLine.classList.contains('error'),
      },
      unknownNumbers: unknownLines.map((line) => line.querySelector('.docus-line-number')?.textContent),
      wrappedNumbers: Array.from(wrapped.querySelectorAll<HTMLElement>('.docus-line-number'))
        .map((node) => node.textContent),
      unknownEscaped: unknown.querySelector('script') === null
        && unknown.querySelector('.docus-line-content')?.textContent?.includes('<script>alert(1)</script>') === true,
      ariaHidden: allGutters.every((node) => node.getAttribute('aria-hidden') === 'true'),
      noExtraAria: allGutters.every((node) => !node.hasAttribute('role') && !node.hasAttribute('tabindex') && !node.hasAttribute('aria-label')),
      noInlineStyleInCode: article.querySelector('pre [style]') === null,
      selectionHasAlpha: selection?.toString().includes('alpha') ?? false,
      selectionHasBeta: selection?.toString().includes('beta') ?? false,
      selectionHasNumbers: /(?:^|\s)(?:1|2|3)(?:\s|$)/u.test(selection?.toString() ?? ''),
      themeKeptHtml: article.innerHTML === beforeThemeSwitch,
      themeKeptLineIdentity: enabled.querySelector('.line') === enabledLine,
      enabledContentWidth: enabledContent?.getBoundingClientRect().width ?? 0,
      wrappedContentWhiteSpace: getComputedStyle(wrappedContent ?? wrapped).whiteSpace,
      wrappedContentHeight: wrappedHeight,
      wrappedLineHeight: Number.isFinite(lineHeight) ? lineHeight : 0,
    }

    article.remove()
    useTheme().set('light')
    return result
  }, lineNumberFixture)

  expect(result.defaultOffHasGutter).toBe(false)
  expect(result.enabledNumbers).toEqual(['1', '2', '3'])
  expect(result.enabledContent).toEqual(['alpha\n', 'beta\n', ''])
  expect(result.customNumbers).toEqual(['98', '99', '100'])
  expect(result.explicitOffHasGutter).toBe(false)
  expect(result.annotatedClasses).toEqual({ highlighted: true, error: true })
  expect(result.unknownNumbers).toEqual(['7', '8', '9'])
  expect(result.wrappedNumbers).toEqual(['100000', '100001'])
  expect(result.unknownEscaped).toBe(true)
  expect(result.ariaHidden).toBe(true)
  expect(result.noExtraAria).toBe(true)
  expect(result.noInlineStyleInCode).toBe(true)
  expect(result.selectionHasAlpha).toBe(true)
  expect(result.selectionHasBeta).toBe(true)
  expect(result.selectionHasNumbers).toBe(false)
  expect(result.themeKeptHtml).toBe(true)
  expect(result.themeKeptLineIdentity).toBe(true)
  expect(result.enabledContentWidth).toBeGreaterThan(0)
  expect(result.wrappedContentWhiteSpace).toBe('pre-wrap')
  expect(result.wrappedContentHeight).toBeGreaterThan(result.wrappedLineHeight)
})

test('MD-EXT-4 keeps numbered source in the printable PDF surface', async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')

  const downloadPromise = page.waitForEvent('download')
  const evidencePromise = page.evaluate(async () => {
    const { render } = await import('/src/lib/markdown.ts')
    const pdf = await import('/src/lib/pdfExport.ts')
    const { useTheme } = await import('/src/composables/useTheme.ts')
    useTheme().set('dark')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const article = document.createElement('article')
    article.className = 'article reading'
    article.innerHTML = await render([
      '```ts {2}:line-numbers=98',
      'const first = 1',
      'const second = 2 // [!code error]',
      '```',
    ].join('\n'))
    document.body.append(article)

    const liveLine = article.querySelector('.line')
    const liveNumbers = Array.from(article.querySelectorAll('.docus-line-number')).map((node) => node.textContent)
    const win = window as Window & { __docusMdExt4PdfEvidence?: unknown }
    pdf.__testing__.setPdfCloneObserver((clonedDocument, clonedRoot) => {
      const cloneArticle = clonedRoot.querySelector<HTMLElement>('.article')
      const pre = cloneArticle?.querySelector<HTMLElement>('pre.shiki.docus-line-numbers')
      const gutter = pre?.querySelector<HTMLElement>('.docus-line-number')
      const token = pre
        ? Array.from(pre.querySelectorAll<HTMLElement>('.docus-line-content span'))
          .find((element) => Array.from(element.classList).some((name) => name.startsWith('docus-shiki-')))
        : undefined
      if (!cloneArticle || !pre || !gutter || !token) throw new Error('MD-EXT-4 PDF clone is incomplete')

      const view = clonedDocument.defaultView ?? window
      const normalizeColor = (value: string) => {
        const probe = clonedDocument.createElement('span')
        probe.style.color = value.trim()
        clonedRoot.append(probe)
        const normalized = view.getComputedStyle(probe).color
        probe.remove()
        return normalized
      }
      const tokenStyle = view.getComputedStyle(token)
      const gutterStyle = view.getComputedStyle(gutter)
      win.__docusMdExt4PdfEvidence = {
        numbers: Array.from(pre.querySelectorAll('.docus-line-number')).map((node) => node.textContent),
        ariaHidden: Array.from(pre.querySelectorAll('.docus-line-number'))
          .every((node) => node.getAttribute('aria-hidden') === 'true'),
        error: pre.querySelector('.line.error') !== null,
        gutterColor: gutterStyle.color,
        gutterBorder: gutterStyle.borderRightColor,
        gutterWidth: gutter.getBoundingClientRect().width,
        contentWidth: pre.querySelector<HTMLElement>('.docus-line-content')?.getBoundingClientRect().width ?? 0,
        tokenColor: tokenStyle.color,
        lightTokenColor: normalizeColor(tokenStyle.getPropertyValue('--shiki-light')),
        darkTokenColor: normalizeColor(tokenStyle.getPropertyValue('--shiki-dark')),
        noArticleStylesheet: cloneArticle.querySelector('style#docus-pdf-download-styles') === null,
      }
    })

    try {
      await pdf.downloadPdfDocument({
        title: 'MD-EXT-4 Line Numbers',
        articleHtml: pdf.preparePdfArticleHtml(article),
      })
      return {
        liveNumbers,
        liveLinePreserved: article.querySelector('.line') === liveLine,
        evidence: win.__docusMdExt4PdfEvidence,
      }
    } finally {
      pdf.__testing__.setPdfCloneObserver(null)
      article.remove()
      useTheme().set('light')
    }
  })

  const [download, result] = await Promise.all([downloadPromise, evidencePromise])
  expect(download.suggestedFilename()).toBe('MD-EXT-4 Line Numbers.pdf')
  await download.delete()

  expect(result.liveNumbers).toEqual(['98', '99', '100'])
  expect(result.liveLinePreserved).toBe(true)
  expect(result.evidence).toMatchObject({
    numbers: ['98', '99', '100'],
    ariaHidden: true,
    error: true,
    noArticleStylesheet: true,
  })
  expect((result.evidence as { gutterColor: string }).gutterColor).not.toBe('')
  expect((result.evidence as { gutterWidth: number }).gutterWidth).toBeGreaterThan(0)
  expect((result.evidence as { contentWidth: number }).contentWidth).toBeGreaterThan(0)
  expect((result.evidence as { tokenColor: string; lightTokenColor: string; darkTokenColor: string }).tokenColor)
    .toBe((result.evidence as { lightTokenColor: string }).lightTokenColor)
  expect((result.evidence as { tokenColor: string; darkTokenColor: string }).tokenColor)
    .not.toBe((result.evidence as { darkTokenColor: string }).darkTokenColor)
})
