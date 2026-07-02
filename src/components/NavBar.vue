<script setup lang="ts">
import { computed, inject } from 'vue'
import { RouterLink } from 'vue-router'
import { useTheme } from '../composables/useTheme'
import { VaultViewModeKey } from '../composables/vault/viewMode'
import { useScopeFilter } from '../composables/vault/useScopeFilter'
import { PROTECTED_ROOTS } from '../composables/zettelProtocol'
import { ICON_AI, ICON_EYE, ICON_SCOPE_INBOX, ICON_SCOPE_LITERATURE, ICON_SCOPE_ZETTEL } from './vault/icons'
import { useVaultLayout } from '../composables/vault/useVaultLayout'

defineProps<{ isVault?: boolean }>()
const emit = defineEmits<{
  'open-search': []
}>()

const { theme, toggle } = useTheme()

/* Sun when current theme is dark (click to lighten),
   moon when current theme is light (click to darken). */
const themeIcon = computed<'sun' | 'moon'>(() => (theme.value === 'dark' ? 'sun' : 'moon'))

const themeTitle = computed<string>(() => {
  const next = theme.value === 'dark' ? 'Light' : 'Dark'
  const cur = theme.value === 'dark' ? 'Dark' : 'Light'
  return `Theme: ${cur} (click for ${next})`
})

/* View-mode toggle is provided globally by App.vue. Every route now
   lands in the vault (the catch-all below the /vault/* entries routes
   anything unknown to /vault), so the inject is always non-null in
   practice — we keep the null fallback defensively for tests and
   future standalone pages, plus a no-op toggle so consumers can call
   it freely without a guard. */
const viewModeApi = inject(VaultViewModeKey, null)
const viewMode = computed(() => viewModeApi?.mode.value ?? 'edit')

/* In edit mode the button invites a switch to read (book icon).
   In read mode it invites a switch back to edit (pencil icon). */
const modeIcon = computed<'book-open' | 'pencil'>(() => (viewMode.value === 'edit' ? 'book-open' : 'pencil'))
const modeTitle = computed<string>(() => {
  const next = viewMode.value === 'edit' ? 'Read' : 'Edit'
  return `${next} mode (click to switch)`
})
function onToggleViewMode() { viewModeApi?.toggle() }

/* Scope filter (Zettelkasten root chips). Owned by the composable so
   FileTree can read the active scope and the chips here can write it.
   Counts are pushed in by VaultView whenever the tree changes. */
const { activeScope, toggleScope } = useScopeFilter()

/* AI panel toggle. Lives here (not in VaultView) because the button
   is a sibling of the existing nav-search / mode-toggle, and the
   useVaultLayout singleton makes this safe. */
const { aiOpen, toggleAi } = useVaultLayout()

/* Preview-pane toggle. Shown only in edit mode (read mode has its own
   ReadingPane that already renders the rendered markdown, so a
   separate preview pane would be redundant). Reads the same module-
   level `previewOpen` ref the keyboard shortcut (Cmd-\) and the
   VaultView template gate use, so all three affordances stay in
   sync without a round-trip. */
const { previewOpen, togglePreview } = useVaultLayout()
const isReadMode = computed(() => viewMode.value === 'read')
const previewTitle = computed(() =>
  previewOpen.value
    ? 'Preview pane (click or ⌘\\ to close)'
    : 'Preview pane (click or ⌘\\ to open)'
)
const SCOPE_ICONS: Record<string, string> = {
  inbox: ICON_SCOPE_INBOX,
  literature: ICON_SCOPE_LITERATURE,
  zettel: ICON_SCOPE_ZETTEL,
}
</script>

<template>
  <header :class="['navbar', { 'is-vault': isVault }]">
    <div :class="['navbar-inner', { container: !isVault, 'full-width': isVault }]">
      <RouterLink to="/" class="brand" aria-label="docus home">
        <img class="brand-logo" src="/logo.svg" alt="docus logo" width="24" height="24" />
        <span class="brand-wordmark">docus</span>
      </RouterLink>
      <!-- Scope filter: lives in the navbar (the file tree header is too
           narrow on 150px sidebars). Hidden outside the vault since the
           rest of the app doesn't have a file tree to filter. -->
      <div v-if="isVault" class="scope-chips" role="tablist" aria-label="范围过滤">
        <button
          v-for="root in PROTECTED_ROOTS"
          :key="root"
          class="scope-chip"
          :class="{ active: activeScope === root }"
          :aria-pressed="activeScope === root"
          :aria-label="activeScope === root ? `已过滤为 ${root}（再次点击取消）` : `只看 ${root}`"
          :title="activeScope === root ? `已过滤为 ${root}（再次点击取消）` : `只看 ${root}`"
          @click="toggleScope(root)"
        >
          <span class="scope-chip-icon" aria-hidden="true" v-html="SCOPE_ICONS[root]" />
          <span class="scope-chip-label">{{ root }}</span>
        </button>
      </div>
      <div class="nav-spacer" />
      <div class="nav-actions">
        <button
          v-if="isVault"
          class="nav-search"
          type="button"
          title="Search (Ctrl/Cmd+P)"
          aria-label="Search"
          @click="emit('open-search')"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="20" y1="20" x2="16.5" y2="16.5" />
          </svg>
        </button>
        <button
          v-if="isVault"
          class="ai-toggle"
          type="button"
          :title="aiOpen ? 'AI panel (click to close)' : 'AI panel'"
          :aria-label="aiOpen ? 'AI panel (click to close)' : 'AI panel'"
          :aria-pressed="aiOpen"
          @click="toggleAi"
        >
          <span class="ai-toggle-icon" aria-hidden="true" v-html="ICON_AI" />
        </button>
        <button
          v-if="isVault"
          class="mode-toggle"
          type="button"
          :title="modeTitle"
          :aria-label="modeTitle"
          :aria-pressed="viewMode === 'read'"
          @click="onToggleViewMode"
        >
          <!-- read mode active: show pencil (click to switch back to edit) -->
          <svg v-if="modeIcon === 'pencil'" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
          <!-- edit mode active: show book-open (click to switch to read) -->
          <svg v-else aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 4h7a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" />
            <path d="M22 4h-7a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h8z" />
          </svg>
        </button>
        <!-- Preview-pane toggle. Sits next to mode-toggle so the two
             read as a paired group: "what kind of view do I have?" —
             {edit/read} on the left, {preview on/off} on the right.
             Hidden in read mode because read mode already renders the
             markdown; showing the toggle there would imply a separate
             preview surface that doesn't exist. The keyboard shortcut
             (Cmd-\) still toggles `previewOpen` in read mode but has
             no visible effect — the bit sticks for when the user
             switches back. The icon is the same in both states; the
             active state is the button's aria-pressed + CSS accent,
             matching the AI-toggle pattern. -->
        <button
          v-if="isVault && !isReadMode"
          class="preview-toggle"
          type="button"
          :title="previewTitle"
          :aria-label="previewTitle"
          :aria-pressed="previewOpen"
          @click="togglePreview"
        >
          <span class="preview-toggle-icon" aria-hidden="true" v-html="ICON_EYE" />
        </button>
        <button
          class="theme-toggle"
          type="button"
          :title="themeTitle"
          :aria-label="themeTitle"
          @click="toggle"
        >
        <!-- dark theme: sun (click to switch to light) -->
        <svg v-if="themeIcon === 'sun'" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <!-- light theme: moon (click to switch to dark) -->
        <svg v-else aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>
      </div>
    </div>
  </header>
</template>
