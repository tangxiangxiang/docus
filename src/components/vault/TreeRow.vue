<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { TreeNode } from '../../lib/api'
import { ICON_FOLDER, ICON_FOLDER_OPEN, ICON_FILE_MD, ICON_CHEVRON } from './icons'
import { suggestSlug } from '../../lib/ai-api'
import { toLocalSlug } from '../../lib/slug'
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
  expandedSet: Set<string>
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
  delete: [path: string, kind: 'file' | 'folder']
  move: [srcPath: string, targetFolder: string, srcKind: 'file' | 'folder']
  'create-in': [folder: string, kind: 'file' | 'folder']
  // File only: 'split-card' with the file's path. The parent
  // (FileTree) maps this to a mode (inbox|literature) based on the
  // path prefix and forwards to VaultView's splitCard action.
  'split-card': [path: string]
  // File only: archive-to-zettel moves inbox/* or literature/* straight
  // into zettel/ (the permanent-notes sink). Distinct from `move` because
  // `move` into zettel/ is still blocked — archiving is a deliberate
  // product action that only the menu can trigger.
  'archive-to-zettel': [path: string]
}>()

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
// Three independent write-permission flags. The protocol distinguishes:
//   • canModify — rename / delete. Blocked for both the zettel subtree AND
//     protected roots (the three top-level folder names are pinned by the
//     Zettelkasten spec).
//   • canMove — drag-out. Protected roots are pinned; zettel children can
//     move within zettel for reclassification.
//   • canCreateFileChild — in-place note creation. Blocked for the zettel
//     subtree so permanent notes still enter via archive/draft flows.
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
  canModifyRow.value ||
  canSplit.value,
)

// True for files under inbox/ or literature/. The split-card menu
// item is gated on this — the server route also enforces it, but
// hiding it in the menu avoids the "click then 400" round-trip.
const canSplit = computed(() =>
  !isFolder.value && (
    props.node.path.startsWith('inbox/') || props.node.path === 'inbox' ||
    props.node.path.startsWith('literature/') || props.node.path === 'literature'
  )
)
// Mirror of canSplit — same source paths, same file-only shape. The two
// actions are conceptually distinct (split = draft a card via AI; archive
// = promote a finished note into the permanent-notes sink) so each has
// its own gate.
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
  if (m.name) fields.push('filename')
  if (m.title) fields.push('title')
  if (m.summary) fields.push('summary')
  if (m.tag) fields.push('tags')
  if (!fields.length) return undefined
  return `Matched in: ${fields.join(', ')}`
})

// --- drag state ---
const isDragging = ref(false)
const isDropTarget = ref(false)
const dragDepth = ref(0)

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
  isDragging.value = false
  isDropTarget.value = false
  dragDepth.value = 0
}

function onDragEnter(e: DragEvent) {
  if (!isFolder.value) return
  e.preventDefault()
  dragDepth.value++
  isDropTarget.value = true
}
function onDragLeave() {
  if (!isFolder.value) return
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) isDropTarget.value = false
}
function onDragOver(e: DragEvent) {
  if (!isFolder.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}
function onDrop(e: DragEvent) {
  if (!isFolder.value) return
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
  emit('move', src, props.node.path, srcKind)
}

// --- context menu ---
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)

function showMenu(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  menuVisible.value = true
  menuX.value = e.clientX
  menuY.value = e.clientY
  nextTick(() => {
    document.addEventListener('click', closeMenu, { once: true })
    document.addEventListener('keydown', onMenuEscape)
  })
}
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

// --- inline rename state ---
const renaming = ref(false)
const renameValue = ref('')
const renameSuggesting = ref(false)

function startRename() {
  renaming.value = true
  renameValue.value = props.node.name
  nextTick(() => {
    const el = document.getElementById('docus-rename-input-' + props.node.path) as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}
function commitRename() {
  // The input's keydown (Enter) and blur both call us. When the user presses
  // Enter, this function runs synchronously and sets renaming.value = false;
  // the resulting DOM removal then fires blur, which would call us a second
  // time. The second call would re-emit `rename` against the *old* path —
  // and since the first call already moved the file on disk, the server
  // answers the duplicate PATCH with 404, producing a "rename failed" toast
  // for a rename that actually succeeded. The same hazard turns Escape
  // (cancelRename) into a commit: cancel sets renaming = false, the input
  // is unmounted, blur fires, commit runs. Guard with `if (!renaming.value)`
  // so we only act on the first invocation; subsequent blur-after-keydown
  // calls short-circuit, and the click-away (blur-only) path still commits
  // because renaming is still true at that point.
  if (!renaming.value) return
  const rawName = renameValue.value.trim()
  const name = toLocalSlug(rawName) || rawName
  if (!name || name === props.node.name) {
    renaming.value = false
    return
  }
  renaming.value = false
  emit('rename', props.node.path, name, props.node.kind)
}
function cancelRename() {
  renaming.value = false
}
async function suggestRename() {
  if (renameSuggesting.value) return
  const current = renameValue.value.trim()
  if (!current) return
  const local = toLocalSlug(current)
  if (local && /^[\x00-\x7F]+$/.test(current)) {
    renameValue.value = local
    return
  }
  renameSuggesting.value = true
  try {
    const out = await suggestSlug({ input: current, kind: props.node.kind })
    renameValue.value = out.slug
  } catch {
    if (local) renameValue.value = local
  } finally {
    renameSuggesting.value = false
    await nextTick()
    const el = document.getElementById('docus-rename-input-' + props.node.path) as HTMLInputElement | null
    el?.focus()
    el?.select()
  }
}
</script>

<template>
  <li
    class="tree-row"
    :class="{ active: isActive, expanded: isExpanded, folder: isFolder, dragging: isDragging, 'drop-target': isDropTarget }"
    :style="{ '--depth': depth }"
    :draggable="!renaming && canMoveRow"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
    @contextmenu="showMenu"
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
    <div class="row-line">
      <span
        v-if="isFolder"
        class="chevron"
        :class="{ expanded: isExpanded }"
        :aria-hidden="true"
        @click.stop="emit('toggle', node.path)"
        v-html="ICON_CHEVRON"
      />
      <span v-else class="chevron-spacer" />

      <span class="row-icon" v-if="isFolder" :aria-hidden="true" v-html="isExpanded ? ICON_FOLDER_OPEN : ICON_FOLDER" />
      <span class="row-icon" v-else :aria-hidden="true" v-html="ICON_FILE_MD" />

      <template v-if="renaming">
        <span class="rename-wrap" @click.stop>
          <input
            :id="'docus-rename-input-' + node.path"
            v-model="renameValue"
            class="rename-input"
            @keydown.enter="commitRename"
            @keydown.escape="cancelRename"
            @blur="commitRename"
          />
          <button
            type="button"
            class="rename-action"
            title="翻译为英文路径名"
            :disabled="renameSuggesting"
            @mousedown.prevent
            @click.stop="suggestRename"
          >{{ renameSuggesting ? '...' : 'AI' }}</button>
        </span>
      </template>
      <template v-else>
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
        <button
          type="button"
          class="row-name"
          :title="matchTooltip"
          @click="isFolder ? emit('toggle', node.path) : emit('select', node.path)"
        >{{ node.name }}</button>
      </template>
    </div>

    <Teleport to="body">
      <div
        v-if="menuVisible && hasAnyMenuItem"
        class="tree-context-menu"
        :style="{ left: menuX + 'px', top: menuY + 'px' }"
        @click.stop
      >
        <!-- create-in is allowed for ordinary folders and protected roots.
             Inside zettel/ only the folder button is offered; permanent
             notes still enter through archive/draft flows (gated by
             canCreateFileChild). The folder button is unconditional on
             isFolder — there's no protocol gate against sub-foldering.
             Render the create buttons first so the most-common action on
             a folder is the first thing under the cursor. -->
        <template v-if="isFolder">
          <button v-if="canCreateFileChildRow" @click="menuAction(() => emit('create-in', node.path, 'file'))">新建文件</button>
          <button @click="menuAction(() => emit('create-in', node.path, 'folder'))">新建文件夹</button>
          <!-- On a protected root the create buttons are followed only by
               a hint — no rename/delete divider, since the only other
               write op is the destructive one and we deliberately don't
               show "删除" (灰掉) for the root itself. -->
          <hr v-if="canModifyRow" />
        </template>
        <button v-if="canModifyRow" @click="menuAction(startRename)">重命名</button>
        <hr v-if="canModifyRow" />
        <button v-if="canSplit" @click="menuAction(() => emit('split-card', node.path))">📤 拆为原子卡</button>
        <hr v-if="canArchive" />
        <button v-if="canArchive" @click="menuAction(() => emit('archive-to-zettel', node.path))">🗂 归档到 zettel</button>
        <button v-if="canModifyRow" class="danger" @click="menuAction(() => emit('delete', node.path, node.kind))">删除</button>
      </div>
    </Teleport>

    <ul v-if="isFolder && isExpanded" class="tree-children">
      <TreeRow
        v-for="child in childNodes"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :current-path="currentPath"
        :expanded-set="expandedSet"
        :matched-fields="matchedFields"
        @select="(p) => emit('select', p)"
        @toggle="(p) => emit('toggle', p)"
        @rename="(oldP, n, kind) => emit('rename', oldP, n, kind)"
        @delete="(p, kind) => emit('delete', p, kind)"
        @move="(src, folder, srcKind) => emit('move', src, folder, srcKind)"
        @create-in="(folder, kind) => emit('create-in', folder, kind)"
        @split-card="(p) => emit('split-card', p)"
        @archive-to-zettel="(p) => emit('archive-to-zettel', p)"
      />
    </ul>
  </li>
</template>
