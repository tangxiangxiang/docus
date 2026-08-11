<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { ICON_AB_USER, ICON_LOGOUT } from './icons'

const props = withDefaults(defineProps<{
  username?: string | null
  logoutBusy?: boolean
}>(), {
  username: '',
  logoutBusy: false,
})

const emit = defineEmits<{
  logout: []
}>()

const { t } = useI18n()
const rootRef = ref<HTMLElement | null>(null)
const buttonRef = ref<HTMLButtonElement | null>(null)
const accountMenuOpen = ref(false)
const displayUsername = computed(() => props.username?.trim() || t('activity.owner'))

function closeAccountMenu(restoreFocus = false): void {
  if (!accountMenuOpen.value) return
  accountMenuOpen.value = false
  if (restoreFocus) {
    void nextTick(() => buttonRef.value?.focus())
  }
}

function toggleAccountMenu(): void {
  if (props.logoutBusy) return
  if (accountMenuOpen.value) closeAccountMenu()
  else accountMenuOpen.value = true
}

function handleLogout(): void {
  if (props.logoutBusy) return
  closeAccountMenu(true)
  emit('logout')
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!accountMenuOpen.value) return
  const target = event.target
  if (!(target instanceof Node) || !rootRef.value?.contains(target)) closeAccountMenu()
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !accountMenuOpen.value) return
  event.preventDefault()
  closeAccountMenu(true)
}

watch(() => props.logoutBusy, (busy) => {
  if (busy) closeAccountMenu()
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div ref="rootRef" class="account-menu-root">
    <button
      ref="buttonRef"
      type="button"
      class="ab-btn ab-btn-account"
      :title="t('activity.account')"
      :aria-label="t('activity.account')"
      :aria-expanded="accountMenuOpen"
      aria-haspopup="menu"
      :aria-controls="accountMenuOpen ? 'account-menu' : undefined"
      :aria-busy="props.logoutBusy || undefined"
      :disabled="props.logoutBusy"
      data-testid="account-button"
      @click="toggleAccountMenu"
    >
      <span class="ab-btn-icon" v-html="ICON_AB_USER" aria-hidden="true" />
    </button>

    <div
      v-if="accountMenuOpen"
      id="account-menu"
      class="account-popover"
      role="menu"
      :aria-label="t('activity.account_menu')"
      data-testid="account-menu"
    >
      <div class="account-menu-summary">
        <span class="account-menu-summary-label">{{ t('activity.current_user') }}</span>
        <span class="account-menu-username" :title="displayUsername">{{ displayUsername }}</span>
      </div>
      <div class="account-menu-divider" role="separator" />
      <button
        type="button"
        class="account-menu-item"
        role="menuitem"
        :disabled="props.logoutBusy"
        :aria-busy="props.logoutBusy || undefined"
        data-testid="account-logout"
        @click="handleLogout"
      >
        <span class="account-menu-item-icon" v-html="ICON_LOGOUT" aria-hidden="true" />
        <span>{{ props.logoutBusy ? t('auth.logging_out') : t('nav.logout') }}</span>
      </button>
    </div>
  </div>
</template>
