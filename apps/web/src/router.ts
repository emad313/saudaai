import { createRouter, createWebHistory } from 'vue-router'
import { useSession } from './stores/session.ts'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { public: true } },
    { path: '/s/:slug', component: () => import('./pages/ShopPage.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('./components/AppShell.vue'),
      children: [
        { path: '', component: () => import('./pages/TodayPage.vue') },
        { path: 'approvals', component: () => import('./pages/ApprovalsPage.vue') },
        { path: 'inbox', component: () => import('./pages/InboxPage.vue') },
        { path: 'inbox/:id', component: () => import('./pages/ChatPage.vue') },
        { path: 'orders', component: () => import('./pages/OrdersPage.vue') },
        { path: 'orders/:id', component: () => import('./pages/OrderPage.vue') },
        { path: 'catalog', component: () => import('./pages/CatalogPage.vue') },
        { path: 'customers', component: () => import('./pages/CustomersPage.vue') },
        { path: 'customers/:id', component: () => import('./pages/CustomerPage.vue') },
        { path: 'activity', component: () => import('./pages/ActivityPage.vue') },
        { path: 'settings', component: () => import('./pages/SettingsPage.vue') },
      ],
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true
  const session = useSession()
  if (!session.me && !(await session.load()))
    return { path: '/login', query: { next: to.fullPath } }
  return true
})
