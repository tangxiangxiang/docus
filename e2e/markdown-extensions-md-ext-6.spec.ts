import { expect, test } from '@playwright/test'

const resourceFiles: Record<string, string> = {
  'docs/parts.md': [
    '## Included Heading',
    '',
    '[Sibling](./sibling.md)',
    '',
    '<<< @/snippets/demo.py [Python]',
    '',
    '::: code-group',
    '<<< @/snippets/demo.ts [TypeScript]',
    '```js [JavaScript]',
    'console.log(1)',
    '```',
    ':::',
  ].join('\n'),
  'snippets/demo.py': 'print("included")',
  'snippets/demo.ts': 'const included = 1',
}

test('MD-EXT-6 expands nested Markdown, snippets, source context, and code groups', async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')

  const result = await page.evaluate(async ({ files }) => {
    const { createApp, h, ref } = await import('/@id/vue')
    const { render } = await import('/src/lib/markdown.ts')
    const { useCodeGroupMount } = await import('/src/composables/useCodeGroupMount.ts')
    const { useTheme } = await import('/src/composables/useTheme.ts')
    const calls: Array<{ kind: string; path: string }> = []
    const resourceResolver = {
      async read(request: { kind: string; path: string }) {
        calls.push({ kind: request.kind, path: request.path })
        const content = files[request.path]
        if (content === undefined) throw new Error('missing fixture')
        return { kind: request.kind, path: request.path, content }
      },
    }
    const html = await render([
      '[[toc]]',
      '',
      '# Resource Demo',
      '',
      '<!--@include: ./parts.md-->',
    ].join('\n'), {
      sourcePath: 'docs/index',
      resourceResolver,
      resolver: (ref: string, _anchor?: string, context?: { sourcePath?: string }) => ({
        target: `${context?.sourcePath ?? 'root'}:${ref}`,
      }),
    })
    const host = document.createElement('div')
    document.body.append(host)
    const Harness = {
      setup() {
        const article = ref<HTMLElement | null>(null)
        useCodeGroupMount(article)
        return () => h('article', {
          ref: article,
          class: 'article reading md-ext-6-browser-fixture',
          innerHTML: html,
        })
      },
    }
    const app = createApp(Harness)
    app.mount(host)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const article = host.querySelector<HTMLElement>('article')
    if (!article) throw new Error('MD-EXT-6 article was not mounted')
    const group = article.querySelector<HTMLElement>('.docus-code-group')
    const tabs = group ? Array.from(group.querySelectorAll<HTMLElement>('[role="tab"]')) : []
    const beforeTheme = article.innerHTML
    useTheme().set('dark')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const result = {
      includedHeading: article.querySelector('h2')?.textContent,
      tocHref: article.querySelector('nav.docus-toc a')?.getAttribute('href'),
      relativeLinkTarget: article.querySelector('a.wiki-link')?.getAttribute('data-target'),
      snippetPython: article.querySelector('pre.shiki')?.textContent?.includes('print'),
      groupPanels: group?.querySelectorAll('[role="tabpanel"]').length,
      groupLabels: tabs.map((tab) => tab.textContent),
      resourceCalls: calls.slice(),
      themeRerendered: article.innerHTML !== beforeTheme,
      noHostPathLeak: !article.textContent?.match(/(?:\/Users\/|C:\\|\/home\/)/u),
    }
    app.unmount()
    host.remove()
    useTheme().set('light')
    return result
  }, { files: resourceFiles })

  expect(result.includedHeading).toContain('Included Heading')
  expect(result.tocHref).toBe('#included-heading')
  expect(result.relativeLinkTarget).toContain('docs/parts.md:./sibling')
  expect(result.snippetPython).toBe(true)
  expect(result.groupPanels).toBe(2)
  expect(result.groupLabels).toEqual(['TypeScript', 'JavaScript'])
  expect(result.resourceCalls).toEqual([
    { kind: 'include', path: 'docs/parts.md' },
    { kind: 'snippet', path: 'snippets/demo.py' },
    { kind: 'snippet', path: 'snippets/demo.ts' },
  ])
  expect(result.themeRerendered).toBe(false)
  expect(result.noHostPathLeak).toBe(true)
})

test('MD-EXT-6 resource content is settled before PDF preparation and is not reread', async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')
  const downloadPromise = page.waitForEvent('download')
  const resultPromise = page.evaluate(async ({ files }) => {
    const { render } = await import('/src/lib/markdown.ts')
    const pdf = await import('/src/lib/pdfExport.ts')
    const { activateCodeGroupTab } = await import('/src/composables/useCodeGroupMount.ts')
    const calls: Array<{ kind: string; path: string }> = []
    const resourceResolver = {
      async read(request: { kind: string; path: string }) {
        calls.push({ kind: request.kind, path: request.path })
        const content = files[request.path]
        if (content === undefined) throw new Error('missing fixture')
        return { kind: request.kind, path: request.path, content }
      },
    }
    const article = document.createElement('article')
    article.className = 'article reading'
    article.innerHTML = await render('<!--@include: ./parts.md-->', {
      sourcePath: 'docs/index',
      resourceResolver,
    })
    document.body.append(article)
    const group = article.querySelector<HTMLElement>('.docus-code-group')
    const tabs = group ? Array.from(group.querySelectorAll<HTMLElement>('[role="tab"]')) : []
    if (!group || !tabs[1]) throw new Error('included code group missing')
    activateCodeGroupTab(group, tabs[1])
    const liveHtml = article.innerHTML
    const callsBeforePdf = calls.length
    const preparedHtml = pdf.preparePdfArticleHtml(article)
    const callsAfterPdf = calls.length
    try {
      await pdf.downloadPdfDocument({ title: 'MD-EXT-6 Resources', articleHtml: preparedHtml })
      return {
        liveHtmlUnchanged: article.innerHTML === liveHtml,
        callsBeforePdf,
        callsAfterPdf,
        preparedHasBothPanels: (preparedHtml.match(/docus-code-group-panel/g) ?? []).length >= 2,
        preparedHasSnippet: preparedHtml.includes('included'),
      }
    } finally {
      article.remove()
    }
  }, { files: resourceFiles })

  const [download, result] = await Promise.all([downloadPromise, resultPromise])
  expect(download.suggestedFilename()).toBe('MD-EXT-6 Resources.pdf')
  await download.delete()
  expect(result).toEqual({
    liveHtmlUnchanged: true,
    callsBeforePdf: 3,
    callsAfterPdf: 3,
    preparedHasBothPanels: true,
    preparedHasSnippet: true,
  })
})
