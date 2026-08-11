<script setup lang="ts">
import { computed, provide, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NavBar from './components/NavBar.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmHost from './components/ConfirmHost.vue'
import PromptHost from './components/PromptHost.vue'
import { VaultViewModeKey, type VaultViewMode } from './composables/vault/viewMode'
import { useAuth } from './composables/useAuth'
import { shouldShowNormalChrome } from './lib/auth-chrome'
import { useI18n } from './composables/useI18n'
import { ensureVaultIdentity, getVaultIdentityState } from './lib/vault-identity'
import { useToast } from './composables/useToast'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const vaultIdentity = getVaultIdentityState()
const { t } = useI18n()
const toast = useToast()
/* Vault routes AND dev previews both set `fullWidth: true` so the
   navbar sits at its shorter height. But only vault routes should
   lock the outer scroll — the dev previews (/__icon-preview,
   /__markdown-test, /__editor-test) are standalone pages that
   need to scroll vertically through their full content. The
   `/__` path prefix is the marker; adding new dev previews
   under that prefix automatically inherits the correct behavior. */
const isVault = computed(() =>
  route.meta.fullWidth === true
  && !route.path.startsWith('/__')
  && auth.state.value === 'authenticated'
  && vaultIdentity.state.value === 'ready',
)
const isPublicDevPreview = computed(() => route.meta.publicDevPreview === true)
const showNormalChrome = computed(() => shouldShowNormalChrome(
  auth.state.value,
  route.meta.authPage === true,
  isPublicDevPreview.value,
  !route.meta.workspace || vaultIdentity.state.value === 'ready',
))
const identityLoading = computed(() => auth.state.value === 'authenticated'
  && route.meta.workspace
  && (vaultIdentity.state.value === 'unknown' || vaultIdentity.state.value === 'loading'))
const identityFailure = computed(() => auth.state.value === 'authenticated'
  && route.meta.workspace
  && vaultIdentity.state.value === 'error')
const showRoutedContent = computed(() => isPublicDevPreview.value
  || (auth.state.value !== 'unknown' && (!route.meta.workspace || vaultIdentity.state.value === 'ready')))
const authLoading = computed(() => auth.hydrating.value || (auth.state.value === 'unknown' && !auth.hydrationError.value))
const authFailureMessage = computed(() => {
  return auth.hydrationError.value ? t('auth.unavailable') : ''
})
const bootstrapBusy = computed(() => authLoading.value || identityLoading.value)
const bootstrapFailure = computed(() => Boolean(authFailureMessage.value || identityFailure.value))
async function retryAuth(): Promise<void> {
  const nextState = await auth.refreshStatus()
  if (nextState !== 'unknown') await router.replace(route.fullPath || '/vault')
}
async function retryVaultIdentity(): Promise<void> {
  try {
    await ensureVaultIdentity()
    await router.replace(route.fullPath || '/vault')
  } catch {
    // Keep the retry surface visible; the next click starts a new request.
  }
}

async function onLogout(): Promise<void> {
  if (auth.transitionKind.value) return
  try {
    const result = await auth.logout()
    if (result.status === 'logged-out') {
      if ('warning' in result) toast.info(t('auth.logout_revoke_unconfirmed'), 6000)
      await router.replace({ name: 'login' })
    }
  } catch {
    toast.error(t('auth.unavailable'))
  }
}

/* The vault uses an internal scrollable surface (FileTree, Editor,
   Preview). It must NOT let the outer document scroll, otherwise
   two scrollbars fight and the page wobbles. We toggle a body
   class on route change so the lock applies only to vault routes. */
watchEffect(() => {
  document.body.classList.toggle('vault-mode', isVault.value)
})

/* Global open-search trigger: incremented by NavBar, watched by the
   vault view to open the CommandPalette. Lives in App so a button in
   the chrome (outside the router view) can reach the vault. */
const openSearchTick = ref(0)
function onOpenSearch() { openSearchTick.value++ }
provide('openSearch', { tick: openSearchTick, trigger: onOpenSearch })

/* View mode for the vault (edit vs read). Persisted to localStorage so
   the user's preference survives reloads. Defaults to 'edit' — the
   current split-pane authoring experience. Provided globally so the
   NavBar (in the chrome) can toggle it and VaultView (in the router
   view) can react to it. */
const VIEW_MODE_KEY = 'docus.vault.viewMode'

function readViewMode(): VaultViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY)
    if (raw === 'read' || raw === 'edit') return raw
  } catch { /* private mode / storage blocked — fall through */ }
  return 'edit'
}

const viewMode = ref<VaultViewMode>(readViewMode())
function setViewMode(m: VaultViewMode) {
  viewMode.value = m
  try { localStorage.setItem(VIEW_MODE_KEY, m) } catch { /* ignore */ }
}
function toggleViewMode() {
  setViewMode(viewMode.value === 'edit' ? 'read' : 'edit')
}
provide(VaultViewModeKey, { mode: viewMode, set: setViewMode, toggle: toggleViewMode })
</script>

<template>
  <NavBar
    v-if="showNormalChrome"
    :is-vault="isVault"
    :logout-busy="auth.transitionKind.value === 'logout'"
    @open-search="onOpenSearch"
  />
  <section
    v-if="!showRoutedContent"
    :class="['auth-bootstrap-surface', { 'is-error': bootstrapFailure }]"
    :aria-busy="bootstrapBusy"
    aria-live="polite"
  >
    <div class="auth-bootstrap-card">
      <p v-if="authLoading" role="status">{{ t('auth.loading') }}</p>
      <template v-else-if="identityLoading">
        <p role="status">{{ t('auth.vault_identity_loading') }}</p>
      </template>
      <template v-else-if="identityFailure">
        <p role="alert">{{ t('auth.vault_identity_unavailable') }}</p>
        <button type="button" @click="retryVaultIdentity">{{ t('auth.retry') }}</button>
      </template>
      <template v-else>
        <p role="alert">{{ authFailureMessage }}</p>
        <button type="button" @click="retryAuth">{{ t('auth.retry') }}</button>
      </template>
    </div>
  </section>
  <RouterView v-else v-slot="{ Component, route: r }">
    <!-- Do not key the wrapper on r.fullPath. The key on <main> caused
         VaultView to re-mount on every route change (e.g. /vault ->
         /vault/inbox/markdown-syntax), which reset the tabs ref to []
         and made multi-tab state impossible to keep. The component
         itself is keyed by the router, and re-mounting on every
         navigation is what we explicitly want to avoid. -->
    <main
      :class="['container', { 'full-width': r.meta.fullWidth }]"
      :style="{ '--navbar-h': isVault ? '36px' : '56px' }"
      :inert="auth.transitionKind.value !== null || undefined"
      :aria-busy="auth.transitionKind.value !== null || undefined"
    >
      <component :is="Component" @logout="onLogout" />
    </main>
  </RouterView>
  <ToastHost />
  <ConfirmHost />
  <PromptHost />
</template>
