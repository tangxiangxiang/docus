<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AuthApiError } from '../lib/auth-api'
import { safeInternalRedirect } from '../lib/auth-redirect'
import { useAuth } from '../composables/useAuth'
import { useI18n } from '../composables/useI18n'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const { t } = useI18n()

const username = ref('')
const password = ref('')
const error = ref('')
const usernameInput = ref<HTMLInputElement | null>(null)

function errorText(value: unknown): string {
  if (!(value instanceof AuthApiError)) return t('auth.unavailable')
  if (value.code === 'invalid-credentials') return t('auth.invalid_credentials')
  if (value.code === 'auth-rate-limited') {
    return value.retryAfterSeconds
      ? t('auth.rate_limited', { seconds: value.retryAfterSeconds })
      : t('auth.rate_limited_generic')
  }
  if (value.code === 'validation-error') return t('auth.validation_error')
  return t('auth.unavailable')
}

function redirectTarget(): string {
  return safeInternalRedirect(route.query.redirect, '/vault')
}

async function submit(): Promise<void> {
  error.value = ''
  try {
    await auth.login({ username: username.value, password: password.value })
    password.value = ''
    await router.replace(router.resolve(redirectTarget()))
  } catch (cause) {
    error.value = errorText(cause)
    await nextTick()
    usernameInput.value?.focus()
  }
}

onMounted(() => usernameInput.value?.focus())
</script>

<template>
  <section class="auth-page" aria-labelledby="login-title">
    <div class="auth-card">
      <p class="auth-brand">Docus</p>
      <h1 id="login-title">{{ t('auth.welcome_back') }}</h1>
      <p class="auth-subtitle">{{ t('auth.sign_in_description') }}</p>

      <p v-if="route.query.reason === 'expired'" class="auth-notice" role="status">
        {{ t('auth.session_expired') }}
      </p>
      <form class="auth-form" @submit.prevent="submit">
        <div class="auth-field">
          <label for="login-username">{{ t('auth.username') }}</label>
          <input
            id="login-username"
            ref="usernameInput"
            v-model="username"
            name="username"
            type="text"
            autocomplete="username"
            required
            :disabled="auth.submitting.value"
          />
        </div>
        <div class="auth-field">
          <label for="login-password">{{ t('auth.password') }}</label>
          <input
            id="login-password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            :disabled="auth.submitting.value"
          />
        </div>
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
        <button class="auth-submit" type="submit" :disabled="auth.submitting.value">
          {{ auth.submitting.value ? t('auth.signing_in') : t('auth.sign_in') }}
        </button>
      </form>
    </div>
  </section>
</template>
