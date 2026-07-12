<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import type { TreeNode } from '../../lib/api'
import {
  ICON_ARCHIVE, ICON_CHEVRON, ICON_DELETE, ICON_FILE_MD, ICON_FILE_PLUS,
  ICON_FOLDER, ICON_FOLDER_OPEN, ICON_FOLDER_PLUS, ICON_RENAME,
} from './icons'
import { useI18n } from '../../composables/useI18n'
import {
  canModify,
  canMove,
  canCreateFileChild,
} from '../../composables/zettelProtocol'
import type { MatchInfo } from './FileTree.vue'

const props = defineProps<{
  node: TreeNode
  depth: number
  currentPath: string | null
  focusedNodeKey: string | null
  expandedSet: Set<string>
  showPathHint?: boolean
  // Path → per-file match annotation from FileTree's search filter.
  // The whole map (not just this row's entry) is passed so the
  // recursive child rows can look up their own paths without
  // threading individual matchInfo props through the recursion.
  // Files kept only because an ancestor folder matched by name are
  // absent from the map, and the lookup correctly returns undefined
  // for them — no tooltip on those rows.
  matchedFields?: Map<string, MatchInfo>
}>()

const emit = defineEmits<{
  select: [path: string]
  toggle: [path: string]
  // `kind` is carried alongside `oldPath` / `path` so the parent can pick the
  // exact TreeNode from the (path-keyed) server tree. When a file and a
  // folder happen to share a path string (e.g. `inbox/notes.md` and
  // `inbox/notes/` both surface as path='inbox/notes'), looking up by path
  // alone is ambiguous: buildTree sorts folders first, so a path-only
  // lookup would always resolve to the folder even when the user right-
  // clicked the file. Without the kind, renaming the file would silently
  // rename the folder instead.
  rename: [oldPath: string, newName: string, kind: 'file' | 'folder']
  'request-rename': [path: string, kind: 'file' | 'folder']
  delete: [path: string, kind: 'file' | 'folder']
  move: [srcPath: string, targetFolder: string, srcKind: 'file' | 'folder']
  'create-in': [folder: string, kind: 'file' | 'folder']
  // File only: archive-to-zettel moves inbox/* or literature/* straight
  // into zettel/ (the permanent-notes sink). Distinct from `move` because
  // `move` into zettel/ is still blocked — archiving is a deliberate
  // product action that only the menu can trigger.
  'archive-to-zettel': [path: string]
  focus: [path: string, kind: 'file' | 'folder']
}>()

const { t } = useI18n()

const isFolder = computed(() => props.node.kind === 'folder')
const isActive = computed(() => !isFolder.value && props.node.path === props.currentPath)
const isExpanded = computed(() => isFolder.value && props.expandedSet.has(props.node.path))
// Narrow the discriminated union for the children list. The computed
// re-reads `props.node.kind` so TS sees the type guard fire here (the
// outer `isFolder` computed is a closure value, not a narrowing aid).
// Inside the template the v-if="isFolder && isExpanded" guards the
// <ul>, so the array is non-empty only when the kind is 'folder'.
const childNodes = computed(() =>
  props.node.kind === 'folder' ? props.node.children : [],
)
const parentPath = computed(() => {
  const parts = props.node.path.split('/')
  parts.pop()
  return parts.join('/')
})
const displayTitle = computed(() => props.node.kind === 'file' && props.node.title.trim()
  ? props.node.title.trim()
  : props.node.name)
const showFilename = computed(() => props.node.kind === 'file' && displayTitle.value !== props.node.name)
// Three independent write-permission flags. The protocol distinguishes:
//   • canModify — rename / delete. Blocked for both the zettel subtree AND
//     protected roots (the three top-level folder names are pinned by the
//     Zettelkasten spec).
//   • canMove — drag-out. Protected roots are pinned; zettel children can
//     move within zettel for reclassification.
//   • canCreateFileChild — in-place note creation. Blocked for the zettel
//     subtree so permanent notes still enter via explicit archive/move flows.
// Folder creation is always allowed for any folder row, so the "新建文件夹"
// button is rendered unconditionally on `isFolder` (no gate needed).
const canModifyRow = computed(() => canModify(props.node.path))
const canMoveRow = computed(() => canMove(props.node.path))
const canCreateFileChildRow = computed(() => canCreateFileChild(props.node.path))
// True if the row has at least one context-menu item to render. Without
// this gate, right-clicking a fully locked row (e.g. an in-zettel file)
// would show an empty menu box. Skip the menu entirely when there's
// nothing to show. Folders always have at least the folder-create button,
// so `isFolder` alone covers the create branch.
const hasAnyMenuItem = computed(() =>
  isFolder.value ||
  canModifyRow.value,
)

// True for files under inbox/ or literature/. The archive menu item
// is gated on this — the server route also enforces it, but hiding
// it in the menu avoids the "click then 400" round-trip.
const canArchive = computed(() =>
  !isFolder.value && (
    props.node.path.startsWith('inbox/') || props.node.path === 'inbox' ||
    props.node.path.startsWith('literature/') || props.node.path === 'literature'
  ),
)

// Native browser tooltip on the filename button. Only emitted for
// files that matched the search query themselves (not for files kept
// because an ancestor folder matched by name — those are absent from
// the map, and Vue strips the attribute when the computed returns
// undefined). Folders are never annotated: a folder kept because its
// name matched is a scope expansion, not a "match", and a tooltip
// would just say "folder name" which is already visible on screen.
const matchTooltip = computed<string | undefined>(() => {
  const m = props.matchedFields?.get(props.node.path)
  if (!m) return undefined
  const fields: string[] = []
  // User-facing labels are "filename" (not "name") so the tooltip
  // matches the field the user thinks in terms of; "node.name" is the
  // internal TreeNode property name.
  if (m.name) fields.push(t('file_tree.field_filename'))
  if (m.title) fields.push(t('file_tree.field_title'))
  if (m.summary) fields.push(t('file_tree.field_summary'))
  if (m.tag) fields.push(t('file_tree.field_tags'))
  if (!fields.length) return undefined
  return t('file_tree.matched_in', { fields: fields.join(', ') })
})

// --- drag state ---
const isDragging = ref(false)
const isDropTarget = ref(false)
const dragDepth = ref(0)
let expandTimer: ReturnType<typeof setTimeout> | null = null

function clearExpandTimer() {
  if (expandTimer) clearTimeout(expandTimer)
  expandTimer = null
}

function onDragStart(e: DragEvent) {
  // dragstart bubbles. Without this stopPropagation(), starting a drag on a
  // child row would also fire onDragStart on every ancestor row, and each
  // ancestor would overwrite the dataTransfer's path with its own. The user
  // would see a drag that looks correct (drag image = the row they grabbed)
  // but a drop on any folder would try to move the *outermost* ancestor
  // (e.g. dragging inbox/test/foo.md appears to the user as "moving
  // foo.md into inbox/" but actually moves the locked `inbox` folder, which
  // isProtectedRoot() then rejects with a confusing toast). Stop the event
  // here so only the row the user actually grabbed sets the drag payload.
  e.stopPropagation()
  // Protected roots (inbox/literature/zettel) cannot be re-parented. We
  // still want their children to be draggable, including zettel children
  // that are being reclassified inside the permanent-notes subtree.
  if (!canMoveRow.value) { e.preventDefault(); return }
  if (!e.dataTransfer) return
  e.dataTransfer.setData('text/x-docus-path', props.node.path)
  // Carry the source kind in the payload too. Path is not enough to
  // disambiguate a file from a folder when they share a name (see
  // emit signature comment above); the drop handler reads this back to
  // route the move to the right API endpoint and to run the cycle check
  // only when the source is a folder.
  e.dataTransfer.setData('text/x-docus-kind', props.node.kind)
  e.dataTransfer.effectAllowed = 'move'
  isDragging.value = true
}
function onDragEnd() {
  clearExpandTimer()
  isDragging.value = false
  isDropTarget.value = false
  dragDepth.value = 0
}

function onDragEnter(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  dragDepth.value++
  isDropTarget.value = true
  if (isFolder.value && !isExpanded.value && !expandTimer) {
    expandTimer = setTimeout(() => {
      emit('toggle', props.node.path)
      expandTimer = null
    }, 600)
  }
}
function onDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) {
    isDropTarget.value = false
    clearExpandTimer()
  }
}
function onDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  const src = e.dataTransfer?.getData('text/x-docus-path') ?? ''
  if (!src) return
  // Read the source kind back from the drag payload (set in onDragStart).
  // Default to 'file' if a future caller forgets to set the kind, so the
  // move still routes to the file API instead of silently 404'ing on a
  // missing path.
  const srcKind = (e.dataTransfer?.getData('text/x-docus-kind') === 'folder' ? 'folder' : 'file') as 'file' | 'folder'
  isDropTarget.value = false
  dragDepth.value = 0
  clearExpandTimer()
  emit('move', src, isFolder.value ? props.node.path : parentPath.value, srcKind)
}

// --- context menu ---
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuRef = ref<HTMLElement | null>(null)

function showMenu(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  menuVisible.value = true
  menuX.value = e.clientX
  menuY.value = e.clientY
  nextTick(() => {
    const menu = menuRef.value
    if (menu) {
      const gutter = 8
      menuX.value = Math.max(gutter, Math.min(menuX.value, window.innerWidth - menu.offsetWidth - gutter))
      menuY.value = Math.max(gutter, Math.min(menuY.value, window.innerHeight - menu.offsetHeight - gutter))
    }
    document.addEventListener('click', closeMenu, { once: true })
    document.addEventListener('keydown', onMenuEscape)
  })
}

onBeforeUnmount(() => {
  clearExpandTimer()
  document.removeEventListener('keydown', onMenuEscape)
})
function closeMenu() {
  menuVisible.value = false
  document.removeEventListener('keydown', onMenuEscape)
}
function onMenuEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenu()
}
function menuAction(fn: () => void) {
  closeMenu()
  fn()
}

</script>

<template>
  <li
    class="tree-row"
    :class="{ active: isActive, focused: focusedNodeKey === `${node.kind}:${node.path}`, expanded: isExpanded, folder: isFolder, 'top-level': depth === 0, dragging: isDragging, 'drop-target': isDropTarget }"
    :style="{ '--depth': depth }"
    :data-tree-path="node.path"
    :data-tree-kind="node.kind"
    :data-tree-key="`${node.kind}:${node.path}`"
    role="treeitem"
    :aria-level="depth + 1"
    :aria-expanded="isFolder ? isExpanded : undefined"
    :aria-selected="!isFolder ? isActive : undefined"
    :tabindex="focusedNodeKey === `${node.kind}:${node.path}` ? 0 : -1"
    :draggable="canMoveRow"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
    @contextmenu="showMenu"
    @focus="emit('focus', node.path, node.kind)"
  >
    <!-- .row-line is the *row's visible content* — chevron + icon +
         name (or the rename input). It is a sibling of .tree-children,
         NOT a parent. The hover/active background lives on .row-line
         via ::before; without this split, hovering an expanded folder
         row would paint the gray ::before across the entire <li>,
         which contains the .tree-children <ul> below — and since the
         child rows are transparent, the gray bleeds through and the
         whole "folder + children" panel reads as one hovered block.
         Splitting the line out confines the highlight to the line
         itself; the children area stays neutral until the user
         actually hovers a child row. -->
    <div
      class="row-line"
      @click="emit('focus', node.path, node.kind); isFolder ? emit('toggle', node.path) : emit('select', node.path)"
    >
      <span
        v-if="isFolder"
        class="chevron"
        :class="{ expanded: isExpanded }"
        :aria-hidden="true"
        @click.stop="emit('focus', node.path, node.kind); emit('toggle', node.path)"
        v-html="ICON_CHEVRON"
      />
      <span v-else class="chevron-spacer" />

      <span class="row-icon" v-if="isFolder" :aria-hidden="true" v-html="isExpanded ? ICON_FOLDER_OPEN : ICON_FOLDER" />
      <span class="row-icon" v-else :aria-hidden="true" v-html="ICON_FILE_MD" />

      <!-- Button, not anchor. A folder row toggles (not navigates) and
           a file row opens in the same SPA (not a new tab). Using an
           anchor with href="#" would pollute browser history on every
           click and confuse screen readers announcing "link" for what
           is really an activation.
           The native `title` is bound to `matchTooltip`: when the
           file matched the search query by name/title/summary, the
           tooltip names which fields matched; when the file is in
           the tree for another reason (folder-name match, or no
           query active), the attribute is omitted entirely. -->
      <div class="row-label">
        <span v-if="!isFolder" class="row-title">{{ displayTitle }}</span>
        <button
          type="button"
          class="row-name"
          :class="{ 'row-file-name': showFilename, 'row-file-name-hidden': !isFolder && !showFilename }"
          :title="matchTooltip"
          :aria-label="displayTitle"
          @click.stop="emit('focus', node.path, node.kind); isFolder ? emit('toggle', node.path) : emit('select', node.path)"
        >
          <span class="row-name-text">{{ node.name }}</span>
        </button>
        <span
          v-if="!isFolder && showPathHint && parentPath"
          class="row-path-hint"
        >{{ parentPath }}</span>
      </div>
      <span v-if="isDropTarget" class="drop-hint">{{ t('file_tree.move_here') }}</span>
    </div>

    <Teleport to="body">
      <div
        v-if="menuVisible && hasAnyMenuItem"
        ref="menuRef"
        class="tree-context-menu"
        :style="{ left: menuX + 'px', top: menuY + 'px' }"
        @click.stop
        >
        <!-- create-in is allowed for ordinary folders and protected roots.
             Inside zettel/ only the folder button is offered; permanent
             notes still enter through explicit archive/move flows (gated by
             canCreateFileChild). The folder button is unconditional on
             isFolder — there's no protocol gate against sub-foldering.
             Render the create buttons first so the most-common action on
             a folder is the first thing under the cursor. -->
        <template v-if="isFolder">
          <div class="tree-menu-label">{{ t('file_tree.create') }}</div>
          <button v-if="canCreateFileChildRow" @click="menuAction(() => emit('create-in', node.path, 'file'))"><span class="menu-icon" v-html="ICON_FILE_PLUS" />{{ t('file_tree.new_file') }}</button>
          <button @click="menuAction(() => emit('create-in', node.path, 'folder'))"><span class="menu-icon" v-html="ICON_FOLDER_PLUS" />{{ t('file_tree.new_folder') }}</button>
        </template>
        <div v-if="canModifyRow || canArchive" class="tree-menu-label">{{ t('file_tree.organize') }}</div>
        <button v-if="canModifyRow" @click="menuAction(() => emit('request-rename', node.path, node.kind))"><span class="menu-icon" v-html="ICON_RENAME" />{{ t('file_tree.rename') }}<kbd>F2</kbd></button>
        <button v-if="canArchive" @click="menuAction(() => emit('archive-to-zettel', node.path))"><span class="menu-icon" v-html="ICON_ARCHIVE" />{{ t('file_tree.archive') }}</button>
        <div v-if="canModifyRow" class="tree-menu-label">{{ t('file_tree.danger') }}</div>
        <button v-if="canModifyRow" class="danger" @click="menuAction(() => emit('delete', node.path, node.kind))"><span class="menu-icon" v-html="ICON_DELETE" />{{ t('file_tree.delete') }}<kbd>Delete</kbd></button>
      </div>
    </Teleport>

    <ul v-if="isFolder && isExpanded" class="tree-children">
      <TreeRow
        v-for="child in childNodes"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :current-path="currentPath"
        :focused-node-key="focusedNodeKey"
        :expanded-set="expandedSet"
        :matched-fields="matchedFields"
        :show-path-hint="showPathHint"
        @select="(p) => emit('select', p)"
        @toggle="(p) => emit('toggle', p)"
        @rename="(oldP, n, kind) => emit('rename', oldP, n, kind)"
        @request-rename="(p, kind) => emit('request-rename', p, kind)"
        @delete="(p, kind) => emit('delete', p, kind)"
        @move="(src, folder, srcKind) => emit('move', src, folder, srcKind)"
        @create-in="(folder, kind) => emit('create-in', folder, kind)"
        @archive-to-zettel="(p) => emit('archive-to-zettel', p)"
        @focus="(p, kind) => emit('focus', p, kind)"
      />
    </ul>
  </li>
</template>
