import type { GlobalThemeOverrides } from 'naive-ui'

export type DocusTheme = 'light' | 'dark'

/**
 * Naive UI derives alpha variants from common.primaryColor with seemly. That
 * parser cannot consume a CSS custom property in Naive UI 2.45.3, so this is
 * the only concrete TS mirror kept at the boundary. CSS tokens remain the
 * semantic authority; all fields Naive can safely consume stay CSS-backed.
 */
export const docusNaivePrimaryColors: Readonly<Record<DocusTheme, string>> = {
  light: '#6366f1',
  dark: '#818cf8',
}

/**
 * A small component-local mirror for Naive components that blend surfaces
 * with seemly. Keeping this out of `common` preserves CSS-backed global
 * tokens while preventing `composite(var(--token), ...)` at render time.
 */
const docusNaiveCompositeColors: Readonly<Record<DocusTheme, {
  cardColor: string
  modalColor: string
  borderColor: string
  dividerColor: string
}>> = {
  light: {
    cardColor: '#f9fafb',
    modalColor: '#f9fafb',
    borderColor: '#e5e7eb',
    dividerColor: '#e5e7eb',
  },
  dark: {
    cardColor: '#1f2937',
    modalColor: '#1f2937',
    borderColor: '#374151',
    dividerColor: '#374151',
  },
}

export function createDocusNaiveThemeOverrides(theme: DocusTheme): GlobalThemeOverrides {
  const compositeColors = docusNaiveCompositeColors[theme]
  return {
    common: {
      bodyColor: 'var(--docus-bg)',
      cardColor: 'var(--docus-surface-1)',
      modalColor: 'var(--docus-surface-1)',
      borderColor: 'var(--docus-border)',
      dividerColor: 'var(--docus-divider)',

      // See docusNaivePrimaryColors: this one field must be parseable by seemly.
      primaryColor: docusNaivePrimaryColors[theme],
      primaryColorHover: 'var(--docus-accent-hover)',
      primaryColorPressed: 'var(--docus-accent-pressed)',

      textColorBase: 'var(--docus-text-1)',
      textColor1: 'var(--docus-text-1)',
      textColor2: 'var(--docus-text-2)',
      textColor3: 'var(--docus-text-3)',
      borderRadius: 'var(--docus-radius-md)',
      fontFamily: 'var(--sans)',
      fontFamilyMono: 'var(--mono)',
      fontSize: 'var(--docus-font-size-md)',
    },
    Calendar: { common: compositeColors },
    DatePicker: { common: compositeColors },
    Descriptions: { common: compositeColors },
    List: { common: compositeColors },
    TimePicker: { common: compositeColors },
  }
}

/** A stable light export is useful to callers that only need the mapping. */
export const docusNaiveThemeOverrides = createDocusNaiveThemeOverrides('light')
