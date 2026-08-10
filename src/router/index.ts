import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { safeInternalRedirect } from '../lib/auth-redirect'
import { ensureVaultIdentity } from '../lib/vault-identity'

declare module 'vue-router' {
  interface RouteMeta {
    authPage?: boolean
    publicDevPreview?: boolean
    workspace?: boolean
    fullWidth?: boolean
  }
}

const devRoutes = import.meta.env.DEV
  ? [
      {
        path: '/__markdown-test',
        component: () => import('../views/MarkdownTestView.vue'),
        meta: { fullWidth: true, publicDevPreview: true },
      },
      {
        path: '/__icon-preview',
        component: () => import('../views/IconPreviewView.vue'),
        meta: { fullWidth: true, publicDevPreview: true },
      },
    ]
  : []

const router = createRouter({
  history: createWebHistory(),
  routes: [
    ...devRoutes,
    { path: '/', redirect: '/vault', meta: { workspace: true } },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { authPage: true },
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('../views/SetupView.vue'),
      meta: { authPage: true },
    },
    {
      path: '/vault',
      name: 'vault',
      component: () => import('../views/VaultView.vue'),
      meta: { fullWidth: true, workspace: true },
    },
    {
      path: '/vault/:pathMatch(.*)*',
      name: 'vault-doc',
      component: () => import('../views/VaultView.vue'),
      meta: { fullWidth: true, workspace: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/vault', meta: { workspace: true } },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

const auth = useAuth()

function intendedRedirect(route: RouteLocationNormalized): string {
  return safeInternalRedirect(route.fullPath, '/vault')
}

function authRouteTarget(route: RouteLocationNormalized, name: 'login' | 'setup') {
  const redirect = safeInternalRedirect(route.query.redirect, '')
  return redirect
    ? { name, query: { redirect } }
    : { name }
}

router.beforeEach(async (to) => {
  if (to.meta.publicDevPreview) return true

  const state = await auth.ensureHydrated()
  // A failed status request remains recoverable through the App shell. Do not
  // mount either VaultView or an auth form based on untrusted/absent data.
  if (state === 'unknown') return false

  if (to.meta.authPage) {
    if (state === 'setup-required') {
      return to.name === 'setup' ? true : authRouteTarget(to, 'setup')
    }
    if (state === 'unauthenticated') {
      return to.name === 'login' ? true : authRouteTarget(to, 'login')
    }
    if (state === 'authenticated') {
      return safeInternalRedirect(to.query.redirect, '/vault')
    }
    return false
  }

  if (to.meta.workspace) {
    if (state === 'setup-required') {
      return { name: 'setup', query: { redirect: intendedRedirect(to) } }
    }
    if (state === 'unauthenticated') {
      return { name: 'login', query: { redirect: intendedRedirect(to) } }
    }
    if (state === 'authenticated') {
      try {
        await ensureVaultIdentity()
        return true
      } catch {
        // Keep the intended workspace route in the URL while the App shell
        // exposes the recoverable identity retry surface. A 401 is observed
        // by authFetch and transitions auth to unauthenticated; in that case
        // the shared session-expiry observer owns the redirect.
        return auth.state.value !== 'unauthenticated'
      }
    }
  }
  return true
})

// The coordinator owns the state transition; the router owns the navigation
// side effect. This keeps the auth module free of a router import/cycle.
auth.onSessionExpired(() => {
  const current = router.currentRoute.value
  if (current.meta.authPage || current.meta.publicDevPreview) return
  const redirect = safeInternalRedirect(current.fullPath, '/vault')
  void router.replace({ name: 'login', query: { reason: 'expired', redirect } })
})

export default router
