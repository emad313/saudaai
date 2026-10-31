<script setup lang="ts">
import { formatTaka } from '@saudaai/shared'
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api.ts'
import LineChart from '../components/LineChart.vue'
import { channelName } from '../format.ts'

type Counted = { key: string; n: number }
type Analytics = {
  from: string
  to: string
  sales: {
    orders: number
    revenuePoisha: number
    averageOrderPoisha: number
    days: { date: string; orders: number; revenuePoisha: number }[]
    byChannel: { channel: string; orders: number; revenuePoisha: number }[]
    topProducts: { name: string; qty: number; revenuePoisha: number }[]
  }
  agent: {
    conversationsStarted: number
    channels: {
      channel: string
      messagesIn: number
      messagesOut: number
      medianFirstReplyMs: number | null
    }[]
    handledByAi: number
    handedToOwner: number
    heldReplies: Counted[]
    approvals: Counted[]
    chatToOrder: { conversations: number; ordered: number }
    failuresByDay: Counted[]
  }
  demand: {
    mostAsked: { name: string; n: number }[]
    noMatch: { query: string; n: number }[]
    outOfStockAsks: { name: string; n: number }[]
  }
  cost: {
    purposes: { purpose: string; calls: number; cached: number }[]
    cacheHitRate: number
    estimatedUsd: number | null
  }
}

const ranges = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
]
const span = ref(7)
const data = ref<Analytics | null>(null)
const error = ref('')

const dhakaDay = (offset: number) =>
  new Date(Date.now() - offset * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Dhaka',
  })

async function load() {
  error.value = ''
  try {
    data.value = await api<Analytics>(
      `/api/analytics?from=${dhakaDay(span.value - 1)}&to=${dhakaDay(0)}`,
    )
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
watch(span, load)
onMounted(load)

const channels: Record<string, string> = {
  ...channelName,
  instagram: 'Instagram',
  telegram: 'Entered by you',
  store: 'Directly on the store',
}
const weekday = (date: string) =>
  new Date(`${date}T12:00:00+06:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'Asia/Dhaka',
  })
const axis = (poisha: number) => {
  const t = poisha / 100
  return t >= 1000 ? `৳${+(t / 1000).toFixed(1)}k` : `৳${t}`
}
const seconds = (ms: number | null) =>
  ms === null ? '—' : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
const width = (n: number, max: number) => `${max ? Math.max(4, (n / max) * 100) : 0}%`

const points = computed(
  () =>
    data.value?.sales.days.map((d) => ({
      label: weekday(d.date),
      value: d.revenuePoisha,
      title: `${formatTaka(d.revenuePoisha)}, ${d.orders} ${d.orders === 1 ? 'order' : 'orders'}`,
    })) ?? [],
)
const channelMax = computed(() =>
  Math.max(0, ...(data.value?.sales.byChannel.map((c) => c.revenuePoisha) ?? [])),
)
const chats = computed(() => {
  const a = data.value?.agent
  return a ? a.handledByAi + a.handedToOwner : 0
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="page-title">Analytics</h1>
        <p v-if="data" class="mt-0.5 text-muted">{{ data.from }} to {{ data.to }}</p>
      </div>
      <div class="inline-flex rounded-lg border border-line bg-white p-1" role="tablist">
        <button
          v-for="r in ranges"
          :key="r.days"
          role="tab"
          :aria-selected="span === r.days"
          class="rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors"
          :class="span === r.days ? 'bg-ink text-white' : 'text-muted hover:text-ink'"
          @click="span = r.days"
        >
          {{ r.label }}
        </button>
      </div>
    </div>
    <p v-if="error" class="text-bad">{{ error }}</p>

    <template v-if="data">
      <div class="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <section class="panel p-5">
          <p class="text-muted">Revenue</p>
          <p class="mt-1 text-2xl font-semibold">{{ formatTaka(data.sales.revenuePoisha) }}</p>
          <p class="mt-1 text-xs text-muted">{{ data.sales.orders }} confirmed orders</p>
        </section>
        <section class="panel p-5">
          <p class="text-muted">Average order</p>
          <p class="mt-1 text-2xl font-semibold">
            {{ formatTaka(data.sales.averageOrderPoisha) }}
          </p>
          <p class="mt-1 text-xs text-muted">Items only, delivery not counted</p>
        </section>
        <section class="panel p-5">
          <p class="text-muted">Chats answered by AI</p>
          <p class="mt-1 text-2xl font-semibold">{{ pct(data.agent.handledByAi, chats) }}</p>
          <p class="mt-1 text-xs text-muted">
            {{ data.agent.handledByAi }} of {{ chats }}, {{ data.agent.handedToOwner }} needed you
          </p>
        </section>
        <section class="panel p-5">
          <p class="text-muted">Chats that became orders</p>
          <p class="mt-1 text-2xl font-semibold">
            {{ pct(data.agent.chatToOrder.ordered, data.agent.chatToOrder.conversations) }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ data.agent.chatToOrder.ordered }} of {{ data.agent.chatToOrder.conversations }} new
            chats, within 48 hours
          </p>
        </section>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section class="panel">
          <h2 class="card-head">Revenue by day</h2>
          <div class="px-3 pt-4 pb-2 md:px-5">
            <LineChart v-if="points.length > 1" :points="points" :axis="axis" />
            <p v-else class="py-10 text-center text-muted">
              {{ formatTaka(data.sales.revenuePoisha) }} today
            </p>
          </div>
        </section>
        <section class="panel">
          <h2 class="card-head">Where sales come from</h2>
          <div class="flex flex-col gap-4 p-5">
            <div v-for="c in data.sales.byChannel" :key="c.channel">
              <div class="flex justify-between text-sm">
                <span>{{ channels[c.channel] ?? c.channel }}</span>
                <span class="font-medium">{{ formatTaka(c.revenuePoisha) }}</span>
              </div>
              <div class="mt-1.5 h-2 rounded-full bg-cloud">
                <div
                  class="h-full rounded-full bg-ink"
                  :style="{ width: width(c.revenuePoisha, channelMax) }"
                ></div>
              </div>
              <p class="mt-1 text-xs text-muted">{{ c.orders }} orders</p>
            </div>
            <p v-if="!data.sales.byChannel.length" class="text-muted">No sales in this period.</p>
          </div>
        </section>
      </div>

      <div class="grid gap-6 lg:grid-cols-3">
        <section class="panel">
          <h2 class="card-head">Top products</h2>
          <div v-for="p in data.sales.topProducts" :key="p.name" class="row">
            <span class="min-w-0 truncate">{{ p.name }}</span>
            <span class="shrink-0 text-right text-sm"
              ><span class="font-medium">{{ p.qty }} sold</span
              ><span class="block text-xs text-muted">{{ formatTaka(p.revenuePoisha) }}</span></span
            >
          </div>
          <p v-if="!data.sales.topProducts.length" class="empty">Nothing sold yet.</p>
        </section>
        <section class="panel">
          <h2 class="card-head">Customers asked for</h2>
          <div v-for="p in data.demand.mostAsked" :key="p.name" class="row">
            <span class="min-w-0 truncate">{{ p.name }}</span>
            <span class="badge shrink-0 bg-sky text-ink">{{ p.n }}×</span>
          </div>
          <p v-if="!data.demand.mostAsked.length" class="empty">No product questions yet.</p>
        </section>
        <section class="panel">
          <h2 class="card-head">Wanted but not in your shop</h2>
          <div v-for="q in data.demand.noMatch" :key="q.query" class="row">
            <span class="min-w-0 truncate">“{{ q.query }}”</span>
            <span class="badge shrink-0 bg-warn/10 text-warn">{{ q.n }}×</span>
          </div>
          <template v-if="data.demand.outOfStockAsks.length">
            <p class="px-5 pt-4 pb-1 text-xs font-medium text-muted">Asked while sold out</p>
            <div v-for="p in data.demand.outOfStockAsks" :key="p.name" class="row">
              <span class="min-w-0 truncate">{{ p.name }}</span>
              <span class="badge shrink-0 bg-bad/10 text-bad">{{ p.n }}×</span>
            </div>
          </template>
          <p v-if="!data.demand.noMatch.length && !data.demand.outOfStockAsks.length" class="empty">
            Customers found what they looked for.
          </p>
        </section>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <section class="panel overflow-hidden">
          <h2 class="card-head">The assistant on each channel</h2>
          <table class="w-full text-left text-sm">
            <thead class="bg-cloud text-xs text-muted">
              <tr>
                <th class="px-5 py-2.5 font-medium">Channel</th>
                <th class="px-3 py-2.5 font-medium">In</th>
                <th class="px-3 py-2.5 font-medium">Out</th>
                <th class="px-5 py-2.5 text-right font-medium">First reply</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in data.agent.channels" :key="c.channel" class="border-t border-line">
                <td class="px-5 py-3">{{ channels[c.channel] ?? c.channel }}</td>
                <td class="px-3 py-3">{{ c.messagesIn }}</td>
                <td class="px-3 py-3">{{ c.messagesOut }}</td>
                <td class="px-5 py-3 text-right font-medium">
                  {{ seconds(c.medianFirstReplyMs) }}
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!data.agent.channels.length" class="empty">No customer chats in this period.</p>
          <div class="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-sm">
            <span v-for="h in data.agent.heldReplies" :key="h.key" class="text-muted"
              >Held for you ({{ h.key }}): <b class="text-night">{{ h.n }}</b></span
            >
            <span v-for="a in data.agent.approvals" :key="a.key" class="text-muted capitalize"
              >{{ a.key }}: <b class="text-night">{{ a.n }}</b></span
            >
          </div>
        </section>
        <section class="panel overflow-hidden">
          <h2 class="card-head">
            Model use
            <span v-if="data.cost.estimatedUsd !== null" class="text-ink"
              >≈ ${{ data.cost.estimatedUsd.toFixed(2) }}</span
            >
          </h2>
          <div v-for="p in data.cost.purposes" :key="p.purpose" class="row">
            <span class="capitalize">{{ p.purpose }}</span>
            <span class="text-sm text-muted"
              >{{ p.calls }} calls<template v-if="p.cached"
                >, {{ p.cached }} from cache</template
              ></span
            >
          </div>
          <p v-if="!data.cost.purposes.length" class="empty">No model calls in this period.</p>
          <div
            class="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-sm text-muted"
          >
            <span
              >Cache hit rate: <b class="text-night">{{ data.cost.cacheHitRate }}%</b></span
            >
            <span v-for="f in data.agent.failuresByDay" :key="f.key"
              >Failures {{ f.key }}: <b class="text-bad">{{ f.n }}</b></span
            >
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
