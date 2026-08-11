<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from '../composables/useTheme'
import { VaultViewModeKey } from '../composables/vault/viewMode'
import { useScopeFilter } from '../composables/vault/useScopeFilter'
import { PROTECTED_ROOTS } from '../../shared/archiveProtocol'
import { ICON_EDIT, ICON_EYE, ICON_PANEL_RIGHT_OPEN, ICON_SCOPE_INBOX, ICON_SCOPE_LITERATURE, ICON_SCOPE_ARCHIVE, ICON_SEARCH, ICON_NAV_THEME_LIGHT, ICON_NAV_THEME_DARK } from './vault/icons'
import { useVaultLayout } from '../composables/vault/useVaultLayout'
import { useI18n } from '../composables/useI18n'

const props = defineProps<{ isVault?: boolean; logoutBusy?: boolean }>()
const emit = defineEmits<{
  'open-search': []
}>()

const { theme, toggle } = useTheme()
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

/* Sun when current theme is dark (click to lighten),
   moon when current theme is light (click to darken). */
const themeIcon = computed<'sun' | 'moon'>(() => (theme.value === 'dark' ? 'sun' : 'moon'))

const themeTitle = computed<string>(() => {
  const next = t(theme.value === 'dark' ? 'nav.theme_light' : 'nav.theme_dark')
  const current = t(theme.value === 'dark' ? 'nav.theme_dark' : 'nav.theme_light')
  return t('nav.theme', { current, next })
})

function scopeLabel(root: string): string {
  return activeScope.value === root
    ? t('nav.scope_active', { scope: root })
    : t('nav.scope_only', { scope: root })
}

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

/* Right-rail toggle. This button owns only the rail's expanded/collapsed
   state; the three tabs inside the rail own tab selection. Keeping those
   responsibilities separate means collapsing the rail never changes the
   user's selected tab. */
const { rightRailCollapsed, toggleRightRail } = useVaultLayout()

const showBrandConstellation = ref(false)
let brandHoverTimer: ReturnType<typeof setTimeout> | undefined

const BRAND_NODES = [
  { x: 500, y: 145 },
  { x: 728, y: 228 },
  { x: 849, y: 438 },
  { x: 808, y: 678 },
  { x: 621, y: 834 },
  { x: 379, y: 834 },
  { x: 192, y: 678 },
  { x: 151, y: 438 },
  { x: 272, y: 228 },
]

function clearBrandHoverTimer() {
  if (brandHoverTimer) {
    clearTimeout(brandHoverTimer)
    brandHoverTimer = undefined
  }
}

function setBrandCursorHidden(hidden: boolean) {
  document.body.classList.toggle('brand-constellation-active', hidden)
}

function startBrandConstellation() {
  clearBrandHoverTimer()
  brandHoverTimer = setTimeout(() => {
    showBrandConstellation.value = true
    setBrandCursorHidden(true)
  }, 3000)
}

function stopBrandConstellation() {
  clearBrandHoverTimer()
  showBrandConstellation.value = false
  setBrandCursorHidden(false)
}

function onWindowBlur() { stopBrandConstellation() }
function onVisibilityChange() {
  if (document.hidden) stopBrandConstellation()
}
function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') stopBrandConstellation()
}

watch(() => route?.fullPath, stopBrandConstellation)

onMounted(() => {
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('keydown', onEscape)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  stopBrandConstellation()
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('keydown', onEscape)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

const SCOPE_ICONS: Record<string, string> = {
  inbox: ICON_SCOPE_INBOX,
  literature: ICON_SCOPE_LITERATURE,
  archive: ICON_SCOPE_ARCHIVE,
}
</script>

<template>
  <header
    :class="['navbar', { 'is-vault': props.isVault }]"
    :inert="props.logoutBusy || undefined"
    :aria-busy="props.logoutBusy || undefined"
  >
    <div :class="['navbar-inner', { container: !props.isVault, 'full-width': props.isVault }]">
      <button
        type="button"
        class="brand"
        :aria-label="t('nav.home')"
        @mouseenter="startBrandConstellation"
        @mouseleave="stopBrandConstellation"
        @click="router.push('/')"
      >
        <img class="brand-logo" :src="'/logo-48.png'" :alt="t('nav.logo_alt')" width="24" height="24" />
        <span class="brand-wordmark">Docus</span>
      </button>
      <!-- Scope filter: lives in the navbar (the file tree header is too
           narrow on 150px sidebars). Hidden outside the vault since the
           rest of the app doesn't have a file tree to filter. -->
      <div v-if="props.isVault" class="scope-chips" role="tablist" :aria-label="t('nav.scope_label')">
        <button
          v-for="root in PROTECTED_ROOTS"
          :key="root"
          class="scope-chip"
          :class="{ active: activeScope === root }"
          :aria-pressed="activeScope === root"
          :aria-label="scopeLabel(root)"
          :title="scopeLabel(root)"
          @click="toggleScope(root)"
        >
          <span class="scope-chip-icon" aria-hidden="true" v-html="SCOPE_ICONS[root]" />
          <span class="scope-chip-label">{{ root }}</span>
        </button>
      </div>
      <div class="nav-spacer" />
      <div class="nav-actions">
        <button
          v-if="props.isVault"
          class="nav-search"
          type="button"
          :title="t('nav.search_hint')"
          :aria-label="t('nav.search')"
          @click="emit('open-search')"
        >
          <span class="nav-search-icon" v-html="ICON_SEARCH" aria-hidden="true" />
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
          v-if="props.isVault && viewModeApi"
          class="view-toggle"
          :class="{ 'is-read': isReadMode }"
          type="button"
          :aria-label="t(isReadMode ? 'nav.switch_edit' : 'nav.switch_read')"
          :title="t(isReadMode ? 'nav.switch_edit_hint' : 'nav.switch_read_hint')"
          data-testid="view-toggle"
          @click="viewModeApi.toggle()"
        >
          <span class="view-toggle-icon" aria-hidden="true" v-html="isReadMode ? ICON_EDIT : ICON_EYE" />
        </button>
        <button
          v-if="props.isVault"
          class="right-rail-toggle"
          type="button"
          :title="t(rightRailCollapsed ? 'nav.right_rail_open' : 'nav.right_rail_close')"
          :aria-label="t(rightRailCollapsed ? 'nav.right_rail_open' : 'nav.right_rail_close')"
          :aria-pressed="!rightRailCollapsed"
          @click="toggleRightRail"
        >
          <span class="right-rail-toggle-icon" aria-hidden="true" v-html="ICON_PANEL_RIGHT_OPEN" />
        </button>
      </div>
    </div>
  </header>

  <Transition name="brand-constellation">
    <div v-if="showBrandConstellation" class="brand-constellation" aria-hidden="true">
      <div class="brand-constellation-backdrop" />
      <div class="brand-constellation-stage">
        <svg class="brand-network" viewBox="0 0 1000 1000" focusable="false">
          <circle class="brand-network-halo" cx="500" cy="500" r="205" />

          <g
            v-for="(node, index) in BRAND_NODES"
            :key="`${node.x}-${node.y}`"
            class="brand-network-node"
            :style="{ '--node-delay': `${index * 140}ms` }"
          >
            <line class="brand-network-link" :x1="node.x" :y1="node.y" x2="500" y2="500" />
            <circle class="brand-network-dot" :cx="node.x" :cy="node.y" r="34" />
            <circle class="brand-network-dot-core" :cx="node.x" :cy="node.y" r="8" />
            <circle class="brand-network-particle" cx="0" cy="0" r="8">
              <animateMotion
                :begin="`${index * 140}ms`"
                dur="1.8s"
                repeatCount="indefinite"
                :path="`M ${node.x} ${node.y} L 500 500`"
              />
            </circle>
          </g>

          <circle class="brand-network-core" cx="500" cy="500" r="178" />
          <image class="brand-network-logo" :href="'/brain.svg'" x="375" y="375" width="250" height="250" preserveAspectRatio="xMidYMid meet" />
        </svg>
      </div>
    </div>
  </Transition>
</template>
