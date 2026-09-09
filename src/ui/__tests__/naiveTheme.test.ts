// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { NConfigProvider, NInput } from 'naive-ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDocusNaiveThemeOverrides,
  docusNaivePrimaryColors,
} from '../naiveTheme'

const tokensCss = readFileSync(resolve(process.cwd(), 'src/ui/tokens.css'), 'utf8')
const styleCss = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8')

function cssBlock(selector: string): string {
  const selectorStart = tokensCss.indexOf(`${selector} {`)
  if (selectorStart < 0) throw new Error(`Missing CSS selector: ${selector}`)
  const openBrace = tokensCss.indexOf('{', selectorStart)
  let depth = 0
  for (let index = openBrace; index < tokensCss.length; index += 1) {
    if (tokensCss[index] === '{') depth += 1
    if (tokensCss[index] === '}') {
      depth -= 1
      if (depth === 0) return tokensCss.slice(openBrace + 1, index)
    }
  }
  throw new Error(`Unclosed CSS block: ${selector}`)
}

function cssValue(block: string, token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = block.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`))
  if (!match) throw new Error(`Missing token ${token}`)
  return match[1].trim()
}

function installBrowserApiShims(): void {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia
  }
  globalThis.matchMedia = window.matchMedia
  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  }
  globalThis.ResizeObserver = window.ResizeObserver
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)
    window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle)
  }
  globalThis.requestAnimationFrame = window.requestAnimationFrame
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame
}

describe('Docus semantic tokens', () => {
  it('defines the Phase 1 semantic families', () => {
    const required = [
      '--docus-bg', '--docus-surface-1', '--docus-surface-2',
      '--docus-text-1', '--docus-text-2', '--docus-text-3',
      '--docus-border', '--docus-divider',
      '--docus-accent', '--docus-accent-hover', '--docus-accent-pressed',
      '--docus-positive', '--docus-negative', '--docus-warning', '--docus-info',
      '--docus-radius-sm', '--docus-radius-md', '--docus-radius-lg',
      '--docus-space-1', '--docus-space-2', '--docus-space-3',
      '--docus-space-4', '--docus-space-5', '--docus-space-6',
      '--docus-font-size-xs', '--docus-font-size-sm',
      '--docus-font-size-md', '--docus-font-size-lg',
    ]

    for (const token of required) {
      expect(tokensCss).toMatch(new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`))
    }
  })

  it('preserves the validated light and dark base palette', () => {
    const light = cssBlock(':root')
    const darkFallback = cssBlock(':root:not([data-theme])')
    const explicitLight = cssBlock(":root[data-theme='light']")
    const explicitDark = cssBlock(":root[data-theme='dark']")

    expect(cssValue(light, '--docus-bg')).toBe('#ffffff')
    expect(cssValue(light, '--docus-surface-1')).toBe('#f9fafb')
    expect(cssValue(light, '--docus-text-1')).toBe('#111827')
    expect(cssValue(light, '--docus-text-2')).toBe('#4b5563')
    expect(cssValue(light, '--docus-text-3')).toBe('#6b7280')
    expect(cssValue(light, '--docus-border')).toBe('#e5e7eb')
    expect(cssValue(light, '--docus-accent')).toBe('#6366f1')
    expect(cssValue(light, '--docus-accent-hover')).toBe('#4f46e5')

    expect(cssValue(darkFallback, '--docus-bg')).toBe('#1e1e1e')
    expect(cssValue(darkFallback, '--docus-surface-1')).toBe('#252526')
    expect(cssValue(darkFallback, '--docus-text-1')).toBe('#f9fafb')
    expect(cssValue(darkFallback, '--docus-text-2')).toBe('#d1d5db')
    expect(cssValue(darkFallback, '--docus-text-3')).toBe('#9ca3af')
    expect(cssValue(darkFallback, '--docus-border')).toBe('#374151')
    expect(cssValue(darkFallback, '--docus-accent')).toBe('#818cf8')
    expect(cssValue(darkFallback, '--docus-accent-hover')).toBe('#a5b4fc')

    expect(cssValue(explicitLight, '--docus-bg')).toBe(cssValue(light, '--docus-bg'))
    expect(cssValue(explicitDark, '--docus-bg')).toBe(cssValue(darkFallback, '--docus-bg'))
    expect(cssValue(explicitLight, '--docus-accent')).toBe(cssValue(light, '--docus-accent'))
    expect(cssValue(explicitDark, '--docus-accent')).toBe(cssValue(darkFallback, '--docus-accent'))
  })

  it('keeps legacy aliases in tokens.css and removes competing global definitions', () => {
    const light = cssBlock(':root')
    const aliases: Record<string, string> = {
      '--bg': 'var(--docus-bg)',
      '--bg-soft': 'var(--docus-surface-1)',
      '--text-h': 'var(--docus-text-1)',
      '--text': 'var(--docus-text-2)',
      '--text-muted': 'var(--docus-text-3)',
      '--border': 'var(--docus-border)',
      '--accent': 'var(--docus-accent)',
      '--accent-hover': 'var(--docus-accent-hover)',
      '--code-bg': 'var(--docus-code-bg)',
      '--navbar-vault-bg': 'var(--docus-navbar-vault-bg)',
      '--navbar-vault-border': 'var(--docus-navbar-vault-border)',
    }
    for (const [alias, value] of Object.entries(aliases)) expect(cssValue(light, alias)).toBe(value)

    const globalStylePrefix = styleCss.slice(0, styleCss.indexOf('/* Vault: 3-pane layout */'))
    expect(globalStylePrefix).not.toMatch(/^\s*--(?:bg|bg-soft|text|text-h|text-muted|border|code-bg|accent|accent-hover|navbar-vault-bg|navbar-vault-border)\s*:/m)
    expect(styleCss).not.toMatch(/:root\[data-theme='(?:light|dark)'\]\s*\{\s*--(?:bg|text|border|accent)/)
    expect(styleCss).not.toMatch(/^\s*--docus-/m)
  })

  it('keeps OS fallback and explicit theme precedence structural', () => {
    expect(tokensCss).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme\]\)/)
    expect(tokensCss.indexOf(":root[data-theme='light']"))
      .toBeGreaterThan(tokensCss.indexOf('@media (prefers-color-scheme: dark)'))
    expect(tokensCss.indexOf(":root[data-theme='dark']"))
      .toBeGreaterThan(tokensCss.indexOf(":root[data-theme='light']"))
  })

  it('does not pull workspace-local token systems into the global authority', () => {
    expect(tokensCss).not.toMatch(/^\s*--(?:vs|ledger)-/m)
    expect(styleCss).toContain('--vs-bg-1')
  })
})

describe('Naive UI theme mapping', () => {
  it('keeps safe fields CSS-backed and mirrors only parser-required primaryColor', () => {
    const light = createDocusNaiveThemeOverrides('light').common ?? {}
    const dark = createDocusNaiveThemeOverrides('dark').common ?? {}

    expect(light.bodyColor).toBe('var(--docus-bg)')
    expect(light.cardColor).toBe('var(--docus-surface-1)')
    expect(light.modalColor).toBe('var(--docus-surface-1)')
    expect(light.borderColor).toBe('var(--docus-border)')
    expect(light.dividerColor).toBe('var(--docus-divider)')
    expect(light.primaryColorHover).toBe('var(--docus-accent-hover)')
    expect(light.primaryColorPressed).toBe('var(--docus-accent-pressed)')
    expect(light.primaryColor).toBe(docusNaivePrimaryColors.light)
    expect(dark.primaryColor).toBe(docusNaivePrimaryColors.dark)

    const concreteFields = Object.entries(light)
      .filter(([, value]) => typeof value === 'string' && !value.startsWith('var('))
      .map(([name]) => name)
    expect(concreteFields).toEqual(['primaryColor'])
  })

  it('keeps the concrete mirror synchronized with CSS accent tokens', () => {
    const light = cssBlock(":root[data-theme='light']")
    const dark = cssBlock(":root[data-theme='dark']")
    expect(docusNaivePrimaryColors.light).toBe(cssValue(light, '--docus-accent'))
    expect(docusNaivePrimaryColors.dark).toBe(cssValue(dark, '--docus-accent'))
  })

  it('mounts a real NInput without the seemly CSS-var parser error', async () => {
    installBrowserApiShims()
    const wrapper: VueWrapper = mount(NConfigProvider, {
      attachTo: document.body,
      props: {
        themeOverrides: createDocusNaiveThemeOverrides('light'),
        preflightStyleDisabled: true,
      },
      slots: {
        default: () => h(NInput, { value: '' }),
      },
    })

    await nextTick()
    expect(wrapper.find('input').exists()).toBe(true)
    wrapper.unmount()
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
  vi.unstubAllGlobals()
})

beforeEach(() => {
  document.body.innerHTML = ''
})
