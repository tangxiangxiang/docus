import { expect, test } from '@playwright/test'

const codeGroupFixture = [
  '::: code-group',
  '',
  '```ts:line-numbers=10 [TypeScript]',
  'const first = 1 // [!code highlight]',
  'const second = 2 // [!code error]',
  '```',
  '',
  '```javascript [JavaScript]',
  'console.log(first)',
  '```',
  ':::',
  '',
  ':::: info Nested container',
  '',
  '::: code-group',
  '```totally-unknown [<img src=x onerror=alert(1)>]',
  '<script>alert(1)</script>',
  '```',
  '',
  '```mermaid [Diagram]',
  'graph TD',
  'A --> B',
  '```',
  '',
  '```markmap [Map]',
  '# Root',
  '```',
  ':::',
  '',
  '::::',
].join('\n')

test('MD-EXT-5 renders static panels and mounts independent accessible tabs', async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')

  const result = await page.evaluate(async (markdown: string) => {
    const { createApp, h, ref } = await import('/@id/vue')
    const { render } = await import('/src/lib/markdown.ts')
    const { useCodeGroupMount } = await import('/src/composables/useCodeGroupMount.ts')
    const { useTheme } = await import('/src/composables/useTheme.ts')
    const html = await render(markdown)
    const host = document.createElement('div')
    document.body.append(host)

    const Harness = {
      setup() {
        const article = ref<HTMLElement | null>(null)
        useCodeGroupMount(article)
        return () => h('article', {
          ref: article,
          class: 'article reading md-ext-5-browser-fixture',
          innerHTML: html,
        })
      },
    }
    const app = createApp(Harness)
    app.mount(host)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const article = host.querySelector<HTMLElement>('article')
    if (!article) throw new Error('MD-EXT-5 article was not mounted')
    const groups = Array.from(article.querySelectorAll<HTMLElement>('.docus-code-group'))
    const first = groups[0]
    const second = groups[1]
    if (!first || !second) throw new Error('MD-EXT-5 groups are missing')

    const firstTabs = Array.from(first.querySelectorAll<HTMLElement>('[role="tab"]'))
    const firstPanels = Array.from(first.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
    const secondTabs = Array.from(second.querySelectorAll<HTMLElement>('[role="tab"]'))
    if (firstTabs.length !== 2 || firstPanels.length !== 2 || secondTabs.length !== 3) {
      throw new Error('MD-EXT-5 static tab/panel DOM is incomplete')
    }

    const initial = {
      firstSelected: firstTabs.map((tab) => tab.getAttribute('aria-selected')),
      firstVisible: firstPanels.map((panel) => panel.getAttribute('aria-hidden')),
      allPanelsPresent: groups.every((group) => group.querySelectorAll('[role="tabpanel"]').length > 0),
      idsUnique: new Set(Array.from(article.querySelectorAll<HTMLElement>('[id]')).map((node) => node.id)).size
        === article.querySelectorAll('[id]').length,
      labels: Array.from(article.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) => tab.textContent),
      hostileLabelIsText: secondTabs[0]?.textContent?.includes('<img src=x onerror=alert(1)>') === true
        && secondTabs[0]?.querySelector('img') === null,
      noGenericAttrs: article.querySelector('[style], [onclick], [onerror], [data-evil]') === null,
      unknownFallback: second.querySelector('pre.docus-shiki-plain') !== null,
      labeledMermaidNotMounted: second.querySelector('.mermaid-mount') === null,
      labeledMarkMapNotMounted: second.querySelector('.markmap-mount') === null,
    }

    const firstLine = first.querySelector('.line')
    firstTabs[1]?.click()
    const afterClick = {
      selected: firstTabs.map((tab) => tab.getAttribute('aria-selected')),
      visible: firstPanels.map((panel) => panel.getAttribute('aria-hidden')),
      activeClass: firstPanels.map((panel) => panel.classList.contains('is-active')),
    }

    firstTabs[1]?.focus()
    firstTabs[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    const afterHome = {
      selected: firstTabs.map((tab) => tab.getAttribute('aria-selected')),
      focused: document.activeElement === firstTabs[0],
    }

    secondTabs[2]?.click()
    const independent = {
      firstSelectedAfterSecondGroupClick: firstTabs.map((tab) => tab.getAttribute('aria-selected')),
      secondSelected: secondTabs.map((tab) => tab.getAttribute('aria-selected')),
    }

    const beforeTheme = article.innerHTML
    useTheme().set('dark')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const themeStable = {
      htmlUnchanged: article.innerHTML === beforeTheme,
      lineIdentity: first.querySelector('.line') === firstLine,
      activeFirstStillValid: firstTabs[0]?.getAttribute('aria-selected') === 'true',
    }

    const allTabIds = Array.from(article.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) => tab.id)
    const allPanelIds = Array.from(article.querySelectorAll<HTMLElement>('[role="tabpanel"]')).map((panel) => panel.id)
    const result = {
      initial,
      afterClick,
      afterHome,
      independent,
      themeStable,
      sameRenderScope: allTabIds.every((id) => id.startsWith('docus-cg-'))
        && new Set(allTabIds.map((id) => id.replace(/-g\d+-tab-\d+$/u, ''))).size === 1,
      groupIndexesSeparated: firstTabs[0]?.id !== secondTabs[0]?.id,
      tabPanelLinksValid: Array.from(article.querySelectorAll<HTMLElement>('[role="tab"]')).every((tab) => (
        article.querySelector(`#${CSS.escape(tab.getAttribute('aria-controls') ?? '')}`) !== null
      )) && allPanelIds.length === 5,
    }

    app.unmount()
    host.remove()
    useTheme().set('light')
    return result
  }, codeGroupFixture)

  expect(result.initial).toEqual({
    firstSelected: ['true', 'false'],
    firstVisible: ['false', 'true'],
    allPanelsPresent: true,
    idsUnique: true,
    labels: ['TypeScript', 'JavaScript', '<img src=x onerror=alert(1)>', 'Diagram', 'Map'],
    hostileLabelIsText: true,
    noGenericAttrs: true,
    unknownFallback: true,
    labeledMermaidNotMounted: true,
    labeledMarkMapNotMounted: true,
  })
  expect(result.afterClick).toEqual({
    selected: ['false', 'true'],
    visible: ['true', 'false'],
    activeClass: [false, true],
  })
  expect(result.afterHome).toEqual({
    selected: ['true', 'false'],
    focused: true,
  })
  expect(result.independent).toEqual({
    firstSelectedAfterSecondGroupClick: ['true', 'false'],
    secondSelected: ['false', 'false', 'true'],
  })
  expect(result.themeStable).toEqual({
    htmlUnchanged: true,
    lineIdentity: true,
    activeFirstStillValid: true,
  })
  expect(result.sameRenderScope).toBe(true)
  expect(result.groupIndexesSeparated).toBe(true)
  expect(result.tabPanelLinksValid).toBe(true)
})

test('MD-EXT-5 exports all code-group panels without mutating reader state', async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')

  const downloadPromise = page.waitForEvent('download')
  const resultPromise = page.evaluate(async () => {
    const { render } = await import('/src/lib/markdown.ts')
    const pdf = await import('/src/lib/pdfExport.ts')
    const { activateCodeGroupTab } = await import('/src/composables/useCodeGroupMount.ts')
    const article = document.createElement('article')
    article.className = 'article reading'
    article.innerHTML = await render([
      '::: code-group',
      '```ts [TypeScript]',
      'const ts = 1',
      '```',
      '```js [JavaScript]',
      'const js = 2',
      '```',
      ':::',
    ].join('\n'))
    document.body.append(article)

    const tabs = Array.from(article.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const group = article.querySelector<HTMLElement>('.docus-code-group')
    if (!group || !tabs[1]) throw new Error('MD-EXT-5 PDF tabs are missing')
    activateCodeGroupTab(group, tabs[1])
    const liveHtml = article.innerHTML
    const liveSelected = tabs.map((tab) => tab.getAttribute('aria-selected'))
    const preparedHtml = pdf.preparePdfArticleHtml(article)
    const preparedNoInlineStyles = !preparedHtml.includes(' style=')
    const win = window as Window & { __docusMdExt5PdfEvidence?: unknown }
    pdf.__testing__.setPdfCloneObserver((_clonedDocument, clonedRoot) => {
      const cloneArticle = clonedRoot.querySelector<HTMLElement>('.article')
      const group = cloneArticle?.querySelector<HTMLElement>('.docus-code-group')
      const items = group ? Array.from(group.querySelectorAll<HTMLElement>('.docus-code-group-pdf-item')) : []
      win.__docusMdExt5PdfEvidence = {
        tabsRemoved: group?.querySelector('.docus-code-group-tabs') === null,
        labels: items.map((item) => item.querySelector('.docus-code-group-pdf-label')?.textContent),
        panelsVisible: items.every((item) => item.querySelector('[role="tabpanel"]')?.getAttribute('aria-hidden') === 'false'),
        sourceOrder: items.map((item) => item.querySelector('pre')?.textContent?.trim()),
        noInlineStyles: preparedNoInlineStyles,
      }
    })

    try {
      await pdf.downloadPdfDocument({
        title: 'MD-EXT-5 Code Groups',
        articleHtml: preparedHtml,
      })
      return {
        liveHtmlUnchanged: article.innerHTML === liveHtml,
        liveSelected,
        evidence: win.__docusMdExt5PdfEvidence,
      }
    } finally {
      pdf.__testing__.setPdfCloneObserver(null)
      article.remove()
    }
  })

  const [download, result] = await Promise.all([downloadPromise, resultPromise])
  expect(download.suggestedFilename()).toBe('MD-EXT-5 Code Groups.pdf')
  await download.delete()
  expect(result.liveHtmlUnchanged).toBe(true)
  expect(result.liveSelected).toEqual(['false', 'true'])
  expect(result.evidence).toEqual({
    tabsRemoved: true,
    labels: ['TypeScript', 'JavaScript'],
    panelsVisible: true,
    sourceOrder: ['const ts = 1', 'const js = 2'],
    noInlineStyles: true,
  })
})
