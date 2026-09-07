import { createApp, h } from 'vue'
import '../../src/style.css'
import NaiveUiFoundationSpike from '../../src/ui/__tests__/fixtures/NaiveUiFoundationSpike.vue'

const tokens: Record<string, string> = {
  '--accent': '#4f46e5',
  '--docus-accent': '#4f46e5',
  '--docus-accent-hover': '#4338ca',
  '--docus-accent-pressed': '#3730a3',
  '--docus-bg': '#ffffff',
  '--docus-surface-1': '#f8fafc',
  '--docus-text-1': '#111827',
  '--docus-text-2': '#374151',
  '--docus-text-3': '#6b7280',
  '--docus-border': '#d1d5db',
}
for (const [name, value] of Object.entries(tokens)) document.documentElement.style.setProperty(name, value)

createApp({
  render: () => h('main', [
    h('button', { 'data-testid': 'keyboard-start' }, 'Keyboard start'),
    h(NaiveUiFoundationSpike, { themeMode: 'light', locale: 'zh' }),
  ]),
}).mount('#app')
