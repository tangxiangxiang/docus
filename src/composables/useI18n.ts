// Minimal i18n: a tiny `t(key)` lookup with a per-locale string table.
// Locale is detected from navigator.language and cached for the
// session. The composable is intentionally small — docus is a
// self-use app with most strings hardcoded in Chinese, so this
// composable only covers the strings we've decided to translate
// (currently the AI panel, History/Diff workspace, and file explorer).
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
  'search.dialog_label': { zh: '全局搜索', en: 'Global search' },
  'search.input_label': { zh: '搜索全部内容', en: 'Search all content' },
  'search.placeholder': { zh: '搜索 {count} 篇文档…', en: 'Search {count} documents…' },
  'search.section.files': { zh: '文件', en: 'Files' },
  'search.no_results': { zh: '没有匹配结果', en: 'No matching results' },
  'search.create': { zh: '新建“{query}”', en: 'Create “{query}”' },
  'search.navigate': { zh: '↑↓ 切换', en: '↑↓ Navigate' },
  'search.open': { zh: '↵ 打开', en: '↵ Open' },
  'search.close': { zh: 'Esc 关闭', en: 'Esc Close' },
  'search.match.title': { zh: '标题', en: 'Title' },
  'search.match.path': { zh: '路径', en: 'Path' },
  'search.match.tag': { zh: '标签', en: 'Tag' },
  'search.match.summary': { zh: '摘要', en: 'Summary' },
  'search.match.body': { zh: '正文', en: 'Content' },
  'document_hover.modified': { zh: '修改于 {date}', en: 'Modified {date}' },
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
    zh: '帮我找出 inbox 或 literature 中适合整理成归档笔记的内容。',
    en: 'Find content in inbox or literature that is ready to be archived.',
  },
  'quick_prompts.no_note.suggest_tidy.label': {
    zh: '整理建议',
    en: 'Tidy suggestions',
  },
  'quick_prompts.no_note.suggest_tidy.text': {
    zh: '根据当前 vault，给我一些整理和命名上的建议。',
    en: 'Give me some organization and naming suggestions for this vault.',
  },
  'history.title': { zh: '历史', en: 'History' },
  'history.activity_label': { zh: '历史', en: 'History' },
  'history.changed_files': { zh: '{count} 个已更改文件', en: '{count} changed files' },
  'history.today': { zh: '今天', en: 'Today' },
  'history.yesterday': { zh: '昨天', en: 'Yesterday' },
  'history.last_week': { zh: '上周', en: 'Last Week' },
  'history.earlier': { zh: '更早', en: 'Earlier' },
  'history.no_history': { zh: '还没有历史记录。', en: 'No history yet.' },
  'history.loading': { zh: '正在加载历史记录…', en: 'Loading history...' },
  'history.load_failed': { zh: '加载历史记录失败。', en: 'Failed to load history.' },
  'history.no_revisions': { zh: '这篇文档还没有可用版本。', en: 'No revisions available for this document.' },
  'history.created': { zh: '创建文档', en: 'Created' },
  'history.updated': { zh: '更新文档', en: 'Updated document' },
  'history.revisions': { zh: '{count} 个版本', en: '{count} revisions' },
  'history.back_to_documents': { zh: '返回文档时间线', en: 'Back to document timeline' },
  'history.document_list': { zh: '最近修改的文档', en: 'Recently changed documents' },
  'history.revision_list': { zh: '文档版本', en: 'Document revisions' },
  'history.snapshot_tab_suffix': { zh: '历史', en: 'History' },
  'history.diff_tab_suffix': { zh: '差异', en: 'Diff' },
  'history.snapshot_viewer': { zh: '历史版本查看器', en: 'Historical revision viewer' },
  'history.viewing_historical': { zh: '正在查看历史版本', en: 'Viewing historical version' },
  'history.current_unchanged': { zh: '当前文档未被修改。', en: 'Current document is unchanged.' },
  'history.view_current': { zh: '查看当前版本', en: 'View Current' },
  'history.viewing_revision': { zh: '查看版本', en: 'Viewing revision' },
  'history.read_only': { zh: '只读', en: 'Read only' },
  'history.snapshot_toolbar': { zh: '历史版本工具栏', en: 'History revision toolbar' },
  'history.open_diff': { zh: '打开差异', en: 'Open Diff' },
  'history.comparison_viewer': { zh: '历史版本与当前版本比较', en: 'Historical and current version comparison' },
  'history.comparing_current': { zh: '与当前版本比较', en: 'Comparing with current' },
  'history.historical_version': { zh: '历史版本', en: 'Historical Version' },
  'history.current_version': { zh: '当前版本', en: 'Current Version' },
  'history.current_unsaved': { zh: '未保存修改', en: 'Unsaved changes' },
  'history.current_saved': { zh: '最新版本', en: 'Latest version' },
  'history.view_historical': { zh: '查看历史版本', en: 'View Historical' },
  'history.close_diff': { zh: '关闭比较', en: 'Close Diff' },
  'history.comparison_toolbar': { zh: '版本比较工具栏', en: 'Version comparison toolbar' },
  'history.loading_comparison': { zh: '正在比较版本…', en: 'Comparing versions...' },
  'history.comparison_load_failed': { zh: '无法加载当前版本。', en: 'Failed to load the current version.' },
  'history.retry': { zh: '重试', en: 'Retry' },
  'history.no_comparison_changes': { zh: '历史版本与当前版本内容相同。', en: 'The historical and current versions are identical.' },
  'history.close_history': { zh: '关闭历史版本', en: 'Close History' },
  'history.loading_revision': { zh: '正在加载版本…', en: 'Loading revision...' },
  'history.snapshot_load_failed': { zh: '加载版本失败。', en: 'Failed to load revision.' },
  'history.restore_version': { zh: '恢复此版本', en: 'Restore this version' },
  'history.restoring': { zh: '正在恢复…', en: 'Restoring...' },
  'history.restore_title': { zh: '恢复历史版本？', en: 'Restore historical version?' },
  'history.restore_detail': {
    zh: '这将使用 {date} 的版本替换“{title}”的当前内容。',
    en: 'This will replace the current content of “{title}” with the version from {date}.',
  },
  'history.restore_unsaved': {
    zh: '此文档有未保存的修改。恢复将替换这些未保存的内容。',
    en: 'This document has unsaved changes. Restoring will replace those unsaved changes.',
  },
  'history.restore_no_commit': {
    zh: '此操作不会自动创建 Git 提交。',
    en: 'This action will not create a Git commit.',
  },
  'history.restore_confirm': { zh: '恢复版本', en: 'Restore Version' },
  'history.restore_cancel': { zh: '取消', en: 'Cancel' },
  'history.restore_success': { zh: '“{title}”已恢复到所选版本。', en: '“{title}” was restored to the selected version.' },
  'history.restore_failed': { zh: '恢复版本失败：{error}', en: 'Failed to restore version: {error}' },
  'history.restore_partial': {
    zh: '“{title}”已恢复，但部分界面未能刷新。',
    en: '“{title}” was restored, but some views could not be refreshed.',
  },
  'history.ai_disabled': { zh: '历史版本为只读，AI 编辑不可用', en: 'AI editing is unavailable for read-only history' },
  'history.changed': { zh: '{count} 个更改', en: '{count} changed' },
  'history.git_unavailable': { zh: 'Git 不可用', en: 'Git is not available' },
  'history.git_unavailable_body': {
    zh: '历史记录不可用，因为当前环境中没有可用的 Git。',
    en: 'History is unavailable because Git is not available.',
  },
  'history.vault_git_unavailable': { zh: '知识库 Git 不可用', en: 'Vault git unavailable' },
  'history.initializing': { zh: '正在初始化知识库…', en: 'Initializing vault…' },
  'workspace_tab.close': { zh: '关闭', en: 'Close' },
  'workspace_tab.close_named': { zh: '关闭 {name}', en: 'Close {name}' },
  'workspace_tab.close_hint': { zh: '中键或右键关闭；右键打开标签菜单', en: 'Middle-click or right-click to close; right-click for tab menu' },
  'workspace_tab.close_others': { zh: '关闭其它', en: 'Close Others' },
  'workspace_tab.close_right': { zh: '关闭右侧', en: 'Close to the Right' },
  'workspace_tab.close_all': { zh: '关闭所有', en: 'Close All' },
  'file_tree.label': { zh: '文件资源管理器', en: 'File explorer' },
  'file_tree.search': { zh: '筛选文件…', en: 'Filter files...' },
  'file_tree.clear_search': { zh: '清空搜索', en: 'Clear search' },
  'file_tree.no_query_match': { zh: '没有匹配“{query}”的文件。', en: 'No files match “{query}”.' },
  'file_tree.empty': { zh: '还没有文件。', en: 'No files yet.' },
  'file_tree.matched_in': { zh: '匹配字段：{fields}', en: 'Matched in: {fields}' },
  'file_tree.field_filename': { zh: '文件名', en: 'filename' },
  'file_tree.field_path': { zh: '路径', en: 'path' },
  'file_tree.field_title': { zh: '标题', en: 'title' },
  'file_tree.move_here': { zh: '移动到此处', en: 'Move here' },
  'file_tree.create': { zh: '创建', en: 'Create' },
  'file_tree.organize': { zh: '整理', en: 'Organize' },
  'file_tree.danger': { zh: '危险操作', en: 'Danger zone' },
  'file_tree.new_file': { zh: '新建文件', en: 'New file' },
  'file_tree.new_folder': { zh: '新建文件夹', en: 'New folder' },
  'file_tree.rename': { zh: '重命名', en: 'Rename' },
  'file_tree.archive': { zh: '归档', en: 'Archive' },
  'file_tree.delete': { zh: '删除', en: 'Delete' },
  'tags.panel_label': { zh: '标签浏览器', en: 'Tag explorer' },
  'tags.filter': { zh: '筛选标签…', en: 'Filter tags...' },
  'tags.clear_filter': { zh: '清空过滤', en: 'Clear filter' },
  'tags.total': { zh: '共 {count} 个标签', en: '{count} tags' },
  'tags.filtered_count': { zh: '显示 {visible} / {total} 个标签', en: 'Showing {visible} of {total} tags' },
  'tags.list_label': { zh: '标签列表', en: 'Tag list' },
  'tags.browse': { zh: '浏览 #{tag}', en: 'Browse #{tag}' },
  'tags.deselect': { zh: '取消选择 #{tag}', en: 'Deselect #{tag}' },
  'tags.no_match': { zh: '没有匹配的标签。', en: 'No matching tags.' },
  'tags.empty': { zh: '还没有标签。', en: 'No tags yet.' },
  'tags.note_count': { zh: '{count} 篇笔记', en: '{count} notes' },
  'tags.no_notes': { zh: '没有包含此标签的笔记。', en: 'No notes with this tag.' },
  'common.unknown_error': { zh: '未知错误', en: 'unknown error' },
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
  function t(key: string, params: Record<string, string | number> = {}): string {
    const entry = STRINGS[key]
    if (!entry) return key
    const value = entry[_locale.value] ?? entry.zh ?? key
    return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => (
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    ))
  }
  return {
    locale: _locale,
    t,
    /** Test-only: force a locale regardless of navigator. */
    setLocale: (l: Locale) => { _locale.value = l },
  }
}
