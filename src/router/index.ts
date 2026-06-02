import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/vault' },
    { path: '/tags', name: 'tags', component: () => import('../views/TagsView.vue') },
    { path: '/tags/:tag', name: 'tag', component: () => import('../views/TagDetailView.vue'), props: true },
    { path: '/vault', name: 'vault', component: () => import('../views/VaultView.vue'), meta: { fullWidth: true } },
    { path: '/vault/:slug', name: 'vault-post', component: () => import('../views/VaultView.vue'), props: true, meta: { fullWidth: true } },
    { path: '/:pathMatch(.*)*', redirect: '/vault' },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router
