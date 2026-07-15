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
  'history.changed': { zh: '{count} 个更改', en: '{count} changed' },
  'history.git_unavailable': { zh: 'Git 不可用', en: 'Git is not available' },
  'history.git_unavailable_body': { zh: '请安装 Git 并加入 PATH，然后重新加载。', en: 'Install git and add it to your PATH, then reload.' },
  'history.vault_git_unavailable': { zh: '知识库 Git 不可用', en: 'Vault git unavailable' },
  'history.initializing': { zh: '正在初始化知识库…', en: 'Initializing vault…' },
  'history.commit_placeholder': { zh: '提交信息…', en: 'Commit message…' },
  'history.select_files_first': { zh: '请先选择文件', en: 'Select files first' },
  'history.generate_message': { zh: '使用 AI 生成提交信息', en: 'Generate commit message with AI' },
  'history.ai_message_success': { zh: 'AI 已生成提交信息', en: 'AI generated a commit message' },
  'history.ai_message_failed': { zh: 'AI 生成提交信息失败：{error}', en: 'AI commit message failed: {error}' },
  'history.no_files_selected': { zh: '未选择文件', en: 'No files selected' },
  'history.message_required': { zh: '请输入提交信息', en: 'Message required' },
  'history.commit_selected': { zh: '提交选中的文件', en: 'Commit selected files' },
  'history.commit_files': { zh: '提交 {count} 个文件', en: 'Commit {count} {unit}' },
  'history.file_one': { zh: '文件', en: 'file' },
  'history.files_many': { zh: '文件', en: 'files' },
  'history.changes': { zh: '更改', en: 'Changes' },
  'history.no_changes': { zh: '没有未提交的更改。', en: 'No changes.' },
  'history.include_path': { zh: '在提交中包含 {path}', en: 'Include {path} in commit' },
  'history.added': { zh: '新增', en: 'Added' },
  'history.modified': { zh: '修改', en: 'Modified' },
  'history.deleted': { zh: '删除', en: 'Deleted' },
  'history.renamed': { zh: '重命名', en: 'Renamed' },
  'history.timeline': { zh: '时间线', en: 'Timeline' },
  'history.no_commits': { zh: '还没有提交。', en: 'No commits yet.' },
  'history.show_diff': { zh: '查看 {path} 在 {sha} 的差异', en: 'Show diff of {path} at {sha}' },
  'history.drop_commit': { zh: '移出提交', en: 'Drop commit' },
  'history.drop_confirm': { zh: '将提交 {sha} 移出历史？\n\n更改会保留在工作区。\n\n{subject}', en: 'Drop commit {sha}?\n\nIts changes will stay in the working tree.\n\n{subject}' },
  'history.drop_success': { zh: '已移出提交 {sha}', en: 'Dropped {sha}' },
  'history.drop_failed': { zh: '移出提交失败：{error}', en: 'Drop failed: {error}' },
  'history.no_file_to_diff': { zh: '请先打开文件或创建更改，没有可对比的文件。', en: 'Open a file or make a change first — no file to diff.' },
  'history.just_now': { zh: '刚刚', en: 'just now' },
  'history.minutes_ago': { zh: '{count} 分钟前', en: '{count}m ago' },
  'history.hours_ago': { zh: '{count} 小时前', en: '{count}h ago' },
  'history.days_ago': { zh: '{count} 天前', en: '{count}d ago' },
  'history.months_ago': { zh: '{count} 个月前', en: '{count}mo ago' },
  'history.years_ago': { zh: '{count} 年前', en: '{count}y ago' },
  'diff.working_tree': { zh: '工作区', en: 'Working tree' },
  'diff.title': { zh: '差异', en: 'Diff' },
  'diff.side_by_side': { zh: '并排差异', en: 'Side-by-side diff' },
  'diff.old_version': { zh: '旧版本', en: 'Old version' },
  'diff.new_version': { zh: '新版本', en: 'New version' },
  'diff.empty': { zh: '空版本', en: 'empty' },
  'diff.cannot_restore_worktree': { zh: '不能恢复到工作区本身，请选择一个提交或 HEAD。', en: 'Cannot restore to the working tree — pick a commit or HEAD as the old side.' },
  'diff.restore_confirm': { zh: '使用 {label} 版本覆盖“{file}”？\n\n此文件未保存的编辑将丢失。', en: 'Overwrite "{file}" with the {label} version?\n\nAny unsaved edits to this file will be lost.' },
  'diff.restore_success': { zh: '已将 {file} 恢复到 {label}', en: 'Restored {file} to {label}' },
  'diff.restore_failed': { zh: '恢复失败：{error}', en: 'Restore failed: {error}' },
  'diff.no_file_selected': { zh: '未选择文件', en: 'No file selected' },
  'diff.pick_file': { zh: '请在历史面板中选择一个更改文件或提交。', en: 'Pick a dirty file or a commit in the History panel.' },
  'diff.unchanged': { zh: '{count} 行未更改', en: '{count} unchanged' },
  'diff.restore_old': { zh: '恢复旧版本', en: 'Restore old version' },
  'diff.overwrite_title': { zh: '使用 {label} 版本覆盖 {file}', en: 'Overwrite {file} with the {label} version' },
  'diff.loading': { zh: '正在加载差异…', en: 'Loading diff…' },
  'diff.unable': { zh: '无法加载差异', en: 'Unable to load diff' },
  'diff.no_changes': { zh: '没有差异', en: 'No changes' },
  'diff.identical': { zh: '两个版本内容相同。', en: 'The two refs are identical.' },
  'diff.old': { zh: '旧版本', en: 'Old' },
  'diff.new': { zh: '新版本', en: 'New' },
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
