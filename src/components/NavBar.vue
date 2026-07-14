<script setup lang="ts">
import { computed, inject } from 'vue'
import { RouterLink } from 'vue-router'
import { useTheme } from '../composables/useTheme'
import { VaultViewModeKey } from '../composables/vault/viewMode'
import { useScopeFilter } from '../composables/vault/useScopeFilter'
import { PROTECTED_ROOTS } from '../composables/archiveProtocol'
import { ICON_EDIT, ICON_PANEL_RIGHT_CLOSE, ICON_PANEL_RIGHT_OPEN, ICON_READ, ICON_SCOPE_INBOX, ICON_SCOPE_LITERATURE, ICON_SCOPE_ARCHIVE, ICON_SEARCH, ICON_NAV_THEME_LIGHT, ICON_NAV_THEME_DARK } from './vault/icons'
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

/* View-mode toggle. The button shows the icon of the *opposite*
   mode (i.e. "click to switch to that"), matching the convention
   used by theme/AI toggles in this bar. State is owned by App.vue
   (via VaultViewModeKey) so the keyboard shortcut Cmd/Ctrl+E and
   this button share one source of truth and stay in sync. */
const viewModeApi = inject(VaultViewModeKey, null)
const isReadMode = computed(() => viewModeApi?.mode.value === 'read')

/* Scope filter (vault root chips). Owned by the composable so
   FileTree can read the active scope and the chips here can write it.
   Counts are pushed in by VaultView whenever the tree changes. */
const { activeScope, toggleScope } = useScopeFilter()

/* AI panel toggle. Lives here (not in VaultView) because the button
   is a sibling of the existing nav-search / view-toggle, and the
   useVaultLayout singleton makes this safe. */
const { rightRailTab, rightRailCollapsed, toggleAi } = useVaultLayout()
const aiRailOpen = computed(() => !rightRailCollapsed.value && rightRailTab.value === 'ai')

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
          <span class="nav-search-icon" v-html="ICON_SEARCH" aria-hidden="true" />
        </button>
        <button
          v-if="isVault && viewModeApi"
          class="view-toggle"
          :class="{ 'is-read': isReadMode }"
          type="button"
          :aria-label="isReadMode ? 'Switch to edit' : 'Switch to read'"
          :title="isReadMode ? 'Switch to edit (Cmd/Ctrl+E)' : 'Switch to read (Cmd/Ctrl+E)'"
          data-testid="view-toggle"
          @click="viewModeApi.toggle()"
        >
          <span class="view-toggle-icon" aria-hidden="true" v-html="isReadMode ? ICON_EDIT : ICON_READ" />
        </button>
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
