<script setup lang="ts">
import { computed, inject } from 'vue'
import { RouterLink } from 'vue-router'
import { useTheme } from '../composables/useTheme'
import { VaultViewModeKey } from '../composables/vault/viewMode'
import { useScopeFilter } from '../composables/vault/useScopeFilter'
import { PROTECTED_ROOTS } from '../composables/archiveProtocol'
import { ICON_PANEL_RIGHT_CLOSE, ICON_PANEL_RIGHT_OPEN, ICON_SCOPE_INBOX, ICON_SCOPE_LITERATURE, ICON_SCOPE_ARCHIVE, ICON_NAV_SEARCH, ICON_NAV_THEME_LIGHT, ICON_NAV_THEME_DARK } from './vault/icons'
import { useVaultLayout } from '../composables/vault/useVaultLayout'
import ViewModeMenu from './ViewModeMenu.vue'

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

/* View-mode is provided globally by App.vue. The picker itself
   lives in <ViewModeMenu>; we just feed it the current state and
   translate its emit back into the source-of-truth setters. Keeping
   the source of truth in App.vue means keyboard shortcuts
   (Cmd-\ toggles preview, Cmd-Shift-R toggles read) keep working
   alongside the menu without duplicating logic. */
const viewModeApi = inject(VaultViewModeKey, null)
const viewMode = computed(() => viewModeApi?.mode.value ?? 'edit')

/* Scope filter (vault root chips). Owned by the composable so
   FileTree can read the active scope and the chips here can write it.
   Counts are pushed in by VaultView whenever the tree changes. */
const { activeScope, toggleScope } = useScopeFilter()

/* AI panel toggle. Lives here (not in VaultView) because the button
   is a sibling of the existing nav-search / view-mode-menu, and the
   useVaultLayout singleton makes this safe. */
const { rightRailTab, rightRailCollapsed, toggleAi } = useVaultLayout()
const aiRailOpen = computed(() => !rightRailCollapsed.value && rightRailTab.value === 'ai')

/* Preview-pane toggle state lives in useVaultLayout; the menu emits
   a desired (mode, previewOpen) tuple and we apply each bit to its
   respective setter. Toggling preview (rather than always writing
   `previewOpen = opt.previewOpen`) preserves the user's existing
   `previewOpen` bit when switching to read — switching to read
   doesn't silently reset the preview flag, it just hides the
   preview pane for as long as read mode is active (the underlying
   bit sticks, mirroring the Cmd-\ shortcut's behavior). */
const { previewOpen, togglePreview } = useVaultLayout()

function onViewModeSelect(payload: { mode: 'edit' | 'read'; previewOpen: boolean }) {
  if (viewModeApi && payload.mode !== viewModeApi.mode.value) {
    viewModeApi.set(payload.mode)
  }
  if (payload.previewOpen !== previewOpen.value) {
    togglePreview()
  }
}

const SCOPE_ICONS: Record<string, string> = {
  inbox: ICON_SCOPE_INBOX,
  literature: ICON_SCOPE_LITERATURE,
  archive: ICON_SCOPE_ARCHIVE,
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
          <span class="nav-search-icon" v-html="ICON_NAV_SEARCH" aria-hidden="true" />
        </button>
        <ViewModeMenu
          v-if="isVault"
          :mode="viewMode"
          :preview-open="previewOpen"
          @select="onViewModeSelect"
        />
        <button
          class="theme-toggle"
          type="button"
          :title="themeTitle"
          :aria-label="themeTitle"
          @click="toggle"
        >
        <span
          class="theme-toggle-icon"
          v-html="themeIcon === 'sun' ? ICON_NAV_THEME_LIGHT : ICON_NAV_THEME_DARK"
          aria-hidden="true"
        />
      </button>
        <button
          v-if="isVault"
          class="ai-toggle"
          type="button"
          :title="aiRailOpen ? 'AI panel (click to close)' : 'AI panel'"
          :aria-label="aiRailOpen ? 'AI panel (click to close)' : 'AI panel'"
          :aria-pressed="aiRailOpen"
          @click="toggleAi"
        >
          <span class="ai-toggle-icon" aria-hidden="true" v-html="aiRailOpen ? ICON_PANEL_RIGHT_OPEN : ICON_PANEL_RIGHT_CLOSE" />
        </button>
      </div>
    </div>
  </header>
</template>
