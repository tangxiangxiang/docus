<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { TreeNode } from '../../lib/api'
import { ICON_FOLDER, ICON_FOLDER_OPEN, ICON_FILE_MD, ICON_CHEVRON } from './icons'
import {
  canModify,
  canCreateChild,
  readonlyHintLabel,
} from '../../composables/zettelProtocol'

const props = defineProps<{
  node: TreeNode
  depth: number
  currentPath: string | null
  expandedSet: Set<string>
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
// Two independent write-permission flags. The protocol distinguishes:
//   • canModify — rename / delete / drag-out. Blocked for both the zettel
//     subtree AND protected roots (the three top-level folder names are
//     pinned by the Zettelkasten spec).
//   • canCreateChild — in-place create-in. Blocked for the zettel subtree
//     (the permanent-notes sink is write-locked at every depth) but
//     ALLOWED for protected roots: the folder's name is pinned, but its
//     contents are still user content. Without this split, right-clicking
//     inbox/literature offered no way to add a child — see the
//     "顶层目录 · 不可修改" hint in zettelProtocol.ts for the original
//     "all or nothing" wording.
const canModifyRow = computed(() => canModify(props.node.path))
const canCreateChildRow = computed(() => canCreateChild(props.node.path))
// `readonlyHint` is the single-line footer that appears when the row is
// read-only in any sense. Reused for both menu states.
const readonlyHint = computed(() => readonlyHintLabel(props.node.path))

// True for files under inbox/ or literature/. The split-card menu
// item is gated on this — the server route also enforces it, but
// hiding it in the menu avoids the "click then 400" round-trip.
const canSplit = computed(() =>
  !isFolder.value && (
    props.node.path.startsWith('inbox/') || props.node.path === 'inbox' ||
    props.node.path.startsWith('literature/') || props.node.path === 'literature'
  )
)

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
  // still want their *children* to be draggable — the on-the-wire guard
  // in FileTree's onMove/onRootDrop catches a misrouted move and toasts
  // a clear error, but the better UX is to never start the drag in the
  // first place (no ghost, no half-grabbed cursor). canCreateChild
  // already encodes the deeper rule (zettel subtree children are also
  // un-draggable) because canModify and canCreateChild are both false
  // there.
  if (!canModifyRow.value) { e.preventDefault(); return }
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
  renaming.value = false
  const name = renameValue.value.trim()
  if (!name || name === props.node.name) return
  emit('rename', props.node.path, name, props.node.kind)
}
function cancelRename() {
  renaming.value = false
}
</script>

<template>
  <li
    class="tree-row"
    :class="{ active: isActive, expanded: isExpanded, folder: isFolder, dragging: isDragging, 'drop-target': isDropTarget }"
    :style="{ '--depth': depth }"
    :draggable="!renaming && canModifyRow"
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
        <input
          :id="'docus-rename-input-' + node.path"
          v-model="renameValue"
          class="rename-input"
          @keydown.enter="commitRename"
          @keydown.escape="cancelRename"
          @blur="commitRename"
          @click.stop
        />
      </template>
      <template v-else>
        <!-- Button, not anchor. A folder row toggles (not navigates) and
             a file row opens in the same SPA (not a new tab). Using an
             anchor with href="#" would pollute browser history on every
             click and confuse screen readers announcing "link" for what
             is really an activation. -->
        <button
          type="button"
          class="row-name"
          @click="isFolder ? emit('toggle', node.path) : emit('select', node.path)"
        >{{ node.name }}</button>
      </template>
    </div>

    <Teleport to="body">
      <div
        v-if="menuVisible"
        class="tree-context-menu"
        :style="{ left: menuX + 'px', top: menuY + 'px' }"
        @click.stop
      >
        <!-- create-in is allowed for ordinary folders AND for the three
             protected roots (inbox / literature). zettel/ subtree children
             cannot be created here — see canCreateChild in zettelProtocol.
             Render the create buttons first so the most-common action on
             a folder is the first thing under the cursor. -->
        <template v-if="isFolder && canCreateChildRow">
          <button @click="menuAction(() => emit('create-in', node.path, 'file'))">新建文件</button>
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
        <button v-if="canModifyRow" class="danger" @click="menuAction(() => emit('delete', node.path, node.kind))">删除</button>
        <span v-if="!canModifyRow || (isFolder && !canCreateChildRow)" class="readonly-hint">{{ readonlyHint }}</span>
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
        @select="(p) => emit('select', p)"
        @toggle="(p) => emit('toggle', p)"
        @rename="(oldP, n) => emit('rename', oldP, n, child.kind)"
        @delete="(p) => emit('delete', p, child.kind)"
        @move="(src, folder, srcKind) => emit('move', src, folder, srcKind)"
        @create-in="(folder, kind) => emit('create-in', folder, kind)"
        @split-card="(p) => emit('split-card', p)"
      />
    </ul>
  </li>
</template>
