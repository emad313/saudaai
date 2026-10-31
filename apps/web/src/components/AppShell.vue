<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api.ts'
import { useSession } from '../stores/session.ts'
import type { Pending } from '../types.ts'
import AppIcon from './AppIcon.vue'

const session = useSession()
const route = useRoute()
const router = useRouter()
const drawer = ref(false)
const account = ref(false)
const q = ref('')
const search = ref<HTMLInputElement | null>(null)

const groups = [
  {
    label: 'Overview',
    links: [
      { to: '/', label: 'Today', icon: 'today' },
      { to: '/approvals', label: 'Approvals', icon: 'approvals' },
    ],
  },
  {
    label: 'Sales',
    links: [
      { to: '/orders', label: 'Orders', icon: 'orders' },
      { to: '/catalog', label: 'Catalog', icon: 'catalog' },
      { to: '/customers', label: 'Customers', icon: 'customers' },
      { to: '/inbox', label: 'Inbox', icon: 'inbox' },
    ],
  },
  {
    label: 'Assistant',
    links: [
      { to: '/activity', label: 'Agent log', icon: 'log' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
] as const

const active = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to))

async function refreshPending() {
  const { pending } = await api<{ pending: Pending[] }>('/api/pending').catch(() => ({
    pending: [],
  }))
  session.pending = pending.length
}

function findOrders() {
  router.push({ path: '/orders', query: q.value.trim() ? { q: q.value.trim() } : {} })
  q.value = ''
  search.value?.blur()
}

function shortcut(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    search.value?.focus()
  }
}

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  refreshPending()
  timer = setInterval(refreshPending, 10_000)
  window.addEventListener('keydown', shortcut)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('keydown', shortcut)
})
watch(
  () => route.fullPath,
  () => {
    drawer.value = false
    account.value = false
  },
)

async function logout() {
  await session.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen">
    <div
      v-if="drawer"
      class="fixed inset-0 z-30 bg-night/30 lg:hidden"
      aria-hidden="true"
      @click="drawer = false"
    ></div>
    <aside
      class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-y-auto border-r border-line bg-white transition-transform lg:translate-x-0"
      :class="drawer ? 'translate-x-0' : '-translate-x-full'"
    >
      <RouterLink to="/" class="flex h-16 shrink-0 items-center gap-2.5 px-6">
        <span class="grid size-8 place-items-center rounded-lg bg-ink text-white">
          <svg viewBox="0 0 24 24" class="size-4.5" fill="currentColor" aria-hidden="true">
            <path d="M4 20 20 4v16z" />
          </svg>
        </span>
        <span class="text-base font-semibold">SaudaAI</span>
      </RouterLink>
      <nav class="flex flex-col gap-0.5 px-4 pb-6">
        <template v-for="g in groups" :key="g.label">
          <p class="mt-5 mb-2 px-3 text-xs font-medium text-muted">{{ g.label }}</p>
          <RouterLink
            v-for="l in g.links"
            :key="l.to"
            :to="l.to"
            class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
            :class="active(l.to) ? 'bg-sky font-medium text-ink' : 'text-night hover:text-ink'"
          >
            <AppIcon :name="l.icon" />
            <span class="flex-1">{{ l.label }}</span>
            <span
              v-if="l.to === '/approvals' && session.pending"
              class="min-w-5 rounded-full bg-ink px-1.5 text-center text-xs leading-5 font-semibold text-white"
              >{{ session.pending }}</span
            >
          </RouterLink>
        </template>
      </nav>
      <div class="mt-auto border-t border-line px-6 py-4 text-xs text-muted">
        {{ session.me?.name }}, {{ session.me?.area }}
      </div>
    </aside>

    <div class="lg:pl-64">
      <header
        class="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-cloud/85 px-4 backdrop-blur md:px-6"
      >
        <button
          class="btn-ghost min-h-9 px-2 lg:hidden"
          aria-label="Menu"
          :aria-expanded="drawer"
          @click="drawer = true"
        >
          <AppIcon name="menu" />
        </button>
        <form class="relative hidden w-72 sm:block" role="search" @submit.prevent="findOrders">
          <span class="pointer-events-none absolute top-2.5 left-3 text-muted"
            ><AppIcon name="search"
          /></span>
          <input
            ref="search"
            v-model="q"
            type="search"
            class="field min-h-10 pr-16 pl-10"
            placeholder="Search orders"
            aria-label="Find an order or customer"
          />
          <kbd
            class="pointer-events-none absolute top-2.5 right-2.5 rounded bg-night px-1.5 text-[11px] leading-5 text-white"
            >Ctrl K</kbd
          >
        </form>

        <div class="ml-auto flex items-center gap-1">
          <RouterLink
            to="/approvals"
            class="relative grid size-10 place-items-center rounded-lg text-muted hover:bg-sky hover:text-ink"
            :aria-label="`Approvals, ${session.pending} waiting`"
          >
            <AppIcon name="bell" />
            <span
              v-if="session.pending"
              class="absolute top-1.5 right-1.5 min-w-4 rounded-full bg-bad px-1 text-center text-[10px] leading-4 font-semibold text-white"
              >{{ session.pending }}</span
            >
          </RouterLink>
          <RouterLink
            to="/settings"
            class="grid size-10 place-items-center rounded-lg text-muted hover:bg-sky hover:text-ink"
            aria-label="Settings"
          >
            <AppIcon name="settings" />
          </RouterLink>
          <div class="relative ml-1">
            <button
              class="flex items-center gap-2 rounded-lg py-1 pr-1.5 pl-1 hover:bg-sky"
              :aria-expanded="account"
              aria-label="Account"
              @click="account = !account"
            >
              <span
                class="grid size-9 place-items-center rounded-full bg-ink font-semibold text-white"
                >{{ session.me?.ownerName.slice(0, 1) }}</span
              >
              <span class="hidden text-left md:block">
                <span class="block leading-tight font-medium">{{ session.me?.ownerName }}</span>
                <span class="block text-xs text-muted">{{ session.me?.name }}</span>
              </span>
              <span class="hidden text-muted md:block"><AppIcon name="down" /></span>
            </button>
            <div
              v-if="account"
              class="absolute right-0 mt-2 w-56 rounded-xl bg-white p-2 shadow-[0_8px_30px_rgb(29_38_48/0.14)]"
            >
              <p class="px-3 py-2">
                <span class="block font-medium">{{ session.me?.ownerName }}</span>
                <span class="block text-xs text-muted">{{ session.me?.name }}</span>
              </p>
              <RouterLink
                to="/settings"
                class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-sky hover:text-ink"
                ><AppIcon name="settings" />Settings</RouterLink
              >
              <button
                v-if="!session.me?.readonly"
                class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-sky hover:text-ink"
                @click="logout"
              >
                <AppIcon name="logout" />Log out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div
        v-if="session.me?.readonly"
        class="border-b border-ink/15 bg-sky px-4 py-2 text-ink md:px-6"
      >
        You are looking at the demo shop. Changes are switched off.
      </div>
      <main class="mx-auto max-w-[1400px] px-4 py-6 md:px-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
