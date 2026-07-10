// Minimal i18n: a tiny `t(key)` lookup with a per-locale string table.
// Locale is detected from navigator.language and cached for the
// session. The composable is intentionally small — docus is a
// self-use app with most strings hardcoded in Chinese, so this
// composable only covers the strings we've decided to translate
// (currently the AI panel's quick prompts).
//
// Usage:
//   const { t } = useI18n()
//   t('quick_prompts.summarize_current.label')  // '总结当前笔记' or 'Summarize current note'
//
// Adding a new key:
//   1. Add a `zh` and `en` entry to STRINGS below
//   2. Call t('namespace.key') wherever the string was hardcoded
//
// If a key is missing for the active locale, falls back to zh, then
// to the key string itself (so a typo shows up in the UI rather
// than rendering as empty).

import { ref } from 'vue'

type Locale = 'zh' | 'en'
type Strings = Record<string, Record<Locale, string>>

const STRINGS: Strings = {
  // AI panel quick prompts (note open)
  'quick_prompts.with_note.summarize.label': {
    zh: '总结当前笔记',
    en: 'Summarize current note',
  },
  'quick_prompts.with_note.summarize.text': {
    zh: '总结当前笔记，提炼核心观点和可行动的下一步。',
    en: 'Summarize the current note — pull out the key points and any actionable next steps.',
  },
  'quick_prompts.with_note.find_related.label': {
    zh: '找相关笔记',
    en: 'Find related notes',
  },
  'quick_prompts.with_note.find_related.text': {
    zh: '基于当前笔记，帮我找可能相关的笔记，并说明关联原因。',
    en: 'Based on the current note, find notes that might be related and explain why each is a match.',
  },
  'quick_prompts.with_note.suggest_tidy.label': {
    zh: '提出整理建议',
    en: 'Suggest a cleanup',
  },
  'quick_prompts.with_note.suggest_tidy.text': {
    zh: '基于当前笔记，建议我应该如何整理、重命名或归档它。',
    en: 'Based on the current note, suggest how to tidy, rename, or archive it.',
  },
  // AI panel quick prompts (no note open)
  'quick_prompts.no_note.browse.label': {
    zh: '浏览知识库',
    en: 'Browse vault',
  },
  'quick_prompts.no_note.browse.text': {
    zh: '帮我概览这个 vault 的主要主题和最近值得关注的笔记。',
    en: 'Give me an overview of the main topics in this vault and the recent notes worth looking at.',
  },
  'quick_prompts.no_note.find_unprocessed.label': {
    zh: '找未整理内容',
    en: 'Find unprocessed',
  },
  'quick_prompts.no_note.find_unprocessed.text': {
    zh: '帮我找出 inbox 或 literature 中适合整理成永久笔记的内容。',
    en: 'Find content in inbox or literature that is ready to be promoted into a permanent note.',
  },
  'quick_prompts.no_note.suggest_tidy.label': {
    zh: '整理建议',
    en: 'Tidy suggestions',
  },
  'quick_prompts.no_note.suggest_tidy.text': {
    zh: '根据当前 vault，给我一些整理和命名上的建议。',
    en: 'Give me some organization and naming suggestions for this vault.',
  },
}

function detectLocale(): Locale {
  // navigator is undefined in some test envs (jsdom + happy-dom
  // sometimes); default to 'zh' since the app's primary user is
  // Chinese-speaking.
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN'
  return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

const _locale = ref<Locale>(detectLocale())

export function useI18n() {
  function t(key: string): string {
    const entry = STRINGS[key]
    if (!entry) return key
    return entry[_locale.value] ?? entry.zh ?? key
  }
  return {
    locale: _locale,
    t,
    /** Test-only: force a locale regardless of navigator. */
    setLocale: (l: Locale) => { _locale.value = l },
  }
}