import { createRouter, createWebHistory } from 'vue-router'

const devRoutes = import.meta.env.DEV
  ? [
      { path: '/__editor-test', component: () => import('../views/EditorTestView.vue'), meta: { fullWidth: true } },
      { path: '/__markdown-test', component: () => import('../views/MarkdownTestView.vue'), meta: { fullWidth: true } },
    ]
  : []

const router = createRouter({
  history: createWebHistory(),
  routes: [
    ...devRoutes,
    { path: '/', redirect: '/vault' },
    { path: '/vault', name: 'vault', component: () => import('../views/VaultView.vue'), meta: { fullWidth: true } },
    { path: '/vault/:pathMatch(.*)*', name: 'vault-doc', component: () => import('../views/VaultView.vue'), meta: { fullWidth: true } },
    { path: '/:pathMatch(.*)*', redirect: '/vault' },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router
