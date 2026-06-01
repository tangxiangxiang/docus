import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/posts', name: 'posts', component: () => import('../views/PostListView.vue') },
    { path: '/posts/:slug', name: 'post', component: () => import('../views/PostDetailView.vue'), props: true },
    { path: '/archives', name: 'archives', component: () => import('../views/ArchivesView.vue') },
    { path: '/tags', name: 'tags', component: () => import('../views/TagsView.vue') },
    { path: '/tags/:tag', name: 'tag', component: () => import('../views/TagDetailView.vue'), props: true },
    { path: '/vault', name: 'vault', component: () => import('../views/VaultView.vue') },
    { path: '/vault/:slug', name: 'vault-post', component: () => import('../views/VaultView.vue'), props: true },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router
