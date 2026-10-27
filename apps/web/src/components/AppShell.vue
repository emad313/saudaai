<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api.ts'
import { useSession } from '../stores/session.ts'
import type { Pending } from '../types.ts'

const session = useSession()
const route = useRoute()
const router = useRouter()
const menu = ref(false)

const links = [
  { to: '/', label: 'Today', bar: true },
  { to: '/approvals', label: 'Approvals', bar: true },
  { to: '/inbox', label: 'Inbox', bar: true },
  { to: '/orders', label: 'Orders', bar: true },
  { to: '/catalog', label: 'Catalog', bar: false },
  { to: '/customers', label: 'Customers', bar: false },
  { to: '/activity', label: 'Agent log', bar: false },
  { to: '/settings', label: 'Settings', bar: false },
]

const active = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to))

async function refreshPending() {
  const { pending } = await api<{ pending: Pending[] }>('/api/pending').catch(() => ({
    pending: [],
  }))
  session.pending = pending.length
}

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  refreshPending()
  timer = setInterval(refreshPending, 10_000)
})
onBeforeUnmount(() => clearInterval(timer))
watch(
  () => route.path,
  () => (menu.value = false),
)

async function logout() {
  await session.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen md:flex">
    <aside class="hidden w-56 shrink-0 flex-col bg-khata text-white md:flex">
      <div class="px-5 pt-6 pb-8">
        <div class="font-ledger text-2xl leading-tight">{{ session.me?.name }}</div>
        <div class="text-sm text-white/70">SaudaAI</div>
      </div>
      <nav class="flex flex-col gap-0.5 px-3">
        <RouterLink
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="flex items-center justify-between rounded-md px-3 py-2 text-[15px]"
          :class="active(l.to) ? 'bg-white text-khata' : 'text-white/85 hover:bg-white/10'"
        >
          {{ l.label }}
          <span
            v-if="l.to === '/approvals' && session.pending"
            class="min-w-6 rounded-full bg-marigold px-1.5 text-center text-xs font-semibold text-ink"
            >{{ session.pending }}</span
          >
        </RouterLink>
      </nav>
      <button
        v-if="!session.me?.readonly"
        class="mt-auto px-8 py-6 text-left text-sm text-white/70 hover:text-white"
        @click="logout"
      >
        Log out
      </button>
    </aside>

    <header
      class="sticky top-0 z-20 flex items-center justify-between bg-khata px-4 py-3 text-white md:hidden"
    >
      <div class="font-ledger text-xl">{{ session.me?.name }}</div>
      <button
        class="rounded-md border border-white/40 px-3 py-1 text-sm"
        :aria-expanded="menu"
        @click="menu = !menu"
      >
        Menu
      </button>
    </header>
    <div v-if="menu" class="fixed inset-0 z-30 bg-ink/40 md:hidden" @click.self="menu = false">
      <nav class="absolute top-14 right-3 left-3 flex flex-col rounded-lg bg-white p-2 shadow-xl">
        <RouterLink
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="rounded px-3 py-2.5"
          :class="active(l.to) && 'bg-paper font-semibold'"
          >{{ l.label }}</RouterLink
        >
        <button
          v-if="!session.me?.readonly"
          class="px-3 py-2.5 text-left text-muted"
          @click="logout"
        >
          Log out
        </button>
      </nav>
    </div>

    <main class="min-w-0 flex-1 pb-24 md:pb-10">
      <div
        v-if="session.me?.readonly"
        class="border-b border-marigold/40 bg-marigold/15 px-4 py-2 text-sm md:px-10"
      >
        You are looking at the demo shop. Changes are switched off.
      </div>
      <div class="mx-auto max-w-5xl px-4 pt-6 md:px-10 md:pt-10">
        <RouterView />
      </div>
    </main>

    <nav
      class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-rule bg-white md:hidden"
    >
      <RouterLink
        v-for="l in links.filter((x) => x.bar)"
        :key="l.to"
        :to="l.to"
        class="relative py-3 text-center text-sm"
        :class="active(l.to) ? 'font-semibold text-khata' : 'text-muted'"
      >
        {{ l.label }}
        <span
          v-if="l.to === '/approvals' && session.pending"
          class="absolute top-1.5 ml-0.5 size-2 rounded-full bg-marigold"
        ></span>
      </RouterLink>
    </nav>
  </div>
</template>
