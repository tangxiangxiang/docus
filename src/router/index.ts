import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
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
