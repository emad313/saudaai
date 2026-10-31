<script setup lang="ts">
import { formatTaka } from '@saudaai/shared'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../api.ts'
import AppIcon from '../components/AppIcon.vue'
import ApprovalSlip from '../components/ApprovalSlip.vue'
import LineChart from '../components/LineChart.vue'
import StatusText from '../components/StatusText.vue'
import { bnDate, methodName, when } from '../format.ts'
import type { OrderRow, Pending, Summary } from '../types.ts'

type Dashboard = {
  summary: Summary
  week: { date: string; orders: number; revenuePoisha: number }[]
  pending: number
  recent: OrderRow[]
  usage: { purpose: string; calls: number; cached: number | null }[]
}

const data = ref<Dashboard | null>(null)
const waiting = ref<Pending[]>([])

async function load() {
  const [d, p] = await Promise.all([
    api<Dashboard>('/api/dashboard'),
    api<{ pending: Pending[] }>('/api/pending'),
  ])
  data.value = d
  waiting.value = p.pending
}

const taka = (s: string) => Number(s.replace(/[^\d.]/g, ''))
const weekday = (date: string) =>
  new Date(`${date}T12:00:00+06:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'Asia/Dhaka',
  })
const axis = (poisha: number) => {
  const t = poisha / 100
  return t >= 1000 ? `৳${+(t / 1000).toFixed(1)}k` : `৳${t}`
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const collectedShare = computed(() => {
  const today = data.value?.summary.today
  if (!today || !taka(today.revenue)) return 0
  return Math.min(100, Math.round((taka(today.collected) / taka(today.revenue)) * 100))
})
const week = computed(() => data.value?.week ?? [])
const weekTotal = computed(() => week.value.reduce((s, d) => s + d.revenuePoisha, 0))
const weekOrders = computed(() => week.value.reduce((s, d) => s + d.orders, 0))
const weekMax = computed(() => Math.max(...week.value.map((d) => d.revenuePoisha), 1))
const ordersMax = computed(() => Math.max(...week.value.map((d) => d.orders), 1))
const points = computed(() =>
  week.value.map((d) => ({
    label: weekday(d.date),
    value: d.revenuePoisha,
    title: `${formatTaka(d.revenuePoisha)}, ${plural(d.orders, 'order')}`,
  })),
)

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  timer = setInterval(load, 15_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div v-if="data" class="flex flex-col gap-6">
    <div>
      <h1 class="page-title">Today</h1>
      <p class="mt-0.5 text-muted">{{ bnDate(Date.now()) }}</p>
    </div>

    <div class="grid gap-6 md:grid-cols-3">
      <section class="panel flex flex-col p-5">
        <p class="font-medium">Sold today</p>
        <p class="mt-2 flex items-center gap-2">
          <span class="text-2xl font-semibold">{{ data.summary.today.revenue }}</span>
          <span class="badge bg-sky text-ink">{{
            plural(data.summary.today.orders, 'order')
          }}</span>
        </p>
        <p class="mt-2 text-xs text-muted">
          {{ data.summary.today.collected }} collected, {{ data.summary.today.expenses }} spent
        </p>
        <div class="mt-auto pt-4">
          <div class="h-1.5 rounded-full bg-cloud" :title="`${collectedShare}% collected`">
            <div class="h-full rounded-full bg-ink" :style="{ width: `${collectedShare}%` }"></div>
          </div>
        </div>
      </section>

      <section class="panel flex flex-col p-5">
        <p class="font-medium">Money due</p>
        <p class="mt-2 flex items-center gap-2">
          <span class="text-2xl font-semibold">{{ data.summary.dues.due }}</span>
          <span class="badge bg-bad/10 text-bad">{{
            plural(data.summary.dues.orders, 'order')
          }}</span>
        </p>
        <p class="mt-2 text-xs text-muted">Customers who have not paid in full yet</p>
        <RouterLink to="/orders" class="mt-auto pt-4 text-xs font-medium text-ink hover:underline"
          >See orders</RouterLink
        >
      </section>

      <section class="flex flex-col rounded-xl bg-ink p-5 text-white shadow-card">
        <p class="font-medium">Last 7 days</p>
        <p class="mt-2 flex items-center gap-2">
          <span class="text-2xl font-semibold">{{ formatTaka(weekTotal) }}</span>
          <span class="badge bg-white/20">{{ plural(weekOrders, 'order') }}</span>
        </p>
        <div class="mt-auto flex h-12 items-end gap-1.5 pt-4" aria-hidden="true">
          <span
            v-for="d in week"
            :key="d.date"
            class="flex-1 rounded-sm bg-white/80"
            :style="{ height: `${Math.max(6, (d.revenuePoisha / weekMax) * 100)}%` }"
          ></span>
        </div>
      </section>
    </div>

    <div class="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section class="panel">
        <h2 class="card-head">
          Sales, last 7 days
          <span class="text-ink">{{ formatTaka(weekTotal) }}</span>
        </h2>
        <div class="px-3 pt-4 pb-2 md:px-5">
          <LineChart :points="points" :axis="axis" />
        </div>
      </section>

      <div class="flex flex-col gap-6">
        <section class="panel">
          <h2 class="card-head">Orders per day</h2>
          <div class="flex h-40 items-end gap-2 px-5 pt-5">
            <div
              v-for="d in week"
              :key="d.date"
              class="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
              :title="`${weekday(d.date)}: ${plural(d.orders, 'order')}`"
            >
              <span class="text-xs text-muted">{{ d.orders }}</span>
              <span
                class="w-full max-w-7 rounded-t"
                :class="d.orders ? 'bg-ink' : 'bg-line'"
                :style="{ height: `${Math.max(4, (d.orders / ordersMax) * 100)}%` }"
              ></span>
            </div>
          </div>
          <div class="flex gap-2 px-5 pt-2 pb-4">
            <span v-for="d in week" :key="d.date" class="flex-1 text-center text-xs text-muted">
              {{ weekday(d.date) }}
            </span>
          </div>
        </section>
        <section class="panel grid grid-cols-2 divide-x divide-line overflow-hidden">
          <RouterLink to="/approvals" class="flex items-center gap-3 p-5 hover:bg-cloud">
            <span class="grid size-10 place-items-center rounded-lg bg-warn/10 text-warn">
              <AppIcon name="approvals" />
            </span>
            <span>
              <span class="block text-xs text-muted">Approvals</span>
              <span class="block text-lg font-semibold">{{ data.pending }}</span>
            </span>
          </RouterLink>
          <RouterLink to="/orders" class="flex items-center gap-3 p-5 hover:bg-cloud">
            <span class="grid size-10 place-items-center rounded-lg bg-sky text-ink">
              <AppIcon name="orders" />
            </span>
            <span>
              <span class="block text-xs text-muted">Drafts</span>
              <span class="block text-lg font-semibold">{{ data.summary.draftOrders }}</span>
            </span>
          </RouterLink>
        </section>
      </div>
    </div>

    <section v-if="waiting.length">
      <div class="flex items-baseline justify-between">
        <h2 class="text-base font-semibold">Waiting for you</h2>
        <RouterLink to="/approvals" class="text-sm font-medium text-ink hover:underline"
          >All approvals</RouterLink
        >
      </div>
      <div class="mt-3 grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        <ApprovalSlip v-for="p in waiting.slice(0, 3)" :key="p.id" :item="p" @decided="load" />
      </div>
    </section>

    <div class="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section class="panel overflow-hidden">
        <h2 class="card-head">
          Latest orders
          <RouterLink to="/orders" class="text-sm font-medium text-ink hover:underline"
            >All orders</RouterLink
          >
        </h2>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="bg-cloud text-xs text-muted">
              <tr>
                <th class="px-5 py-2.5 font-medium">Order</th>
                <th class="px-3 py-2.5 font-medium">Customer</th>
                <th class="px-3 py-2.5 font-medium">Status</th>
                <th class="hidden px-3 py-2.5 font-medium md:table-cell">Payment</th>
                <th class="px-5 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="o in data.recent"
                :key="o.orderId"
                class="cursor-pointer border-t border-line hover:bg-cloud"
                @click="$router.push(`/orders/${o.orderId}`)"
              >
                <td class="px-5 py-3">
                  <RouterLink :to="`/orders/${o.orderId}`" class="font-medium text-ink"
                    >#{{ o.number }}</RouterLink
                  >
                  <span class="block text-xs text-muted">{{ when(o.createdAt) }}</span>
                </td>
                <td class="max-w-40 truncate px-3 py-3">{{ o.customer }}</td>
                <td class="px-3 py-3"><StatusText :status="o.status" /></td>
                <td class="hidden px-3 py-3 text-muted md:table-cell">
                  {{ methodName[o.paymentMethod] ?? o.paymentMethod }}
                </td>
                <td class="px-5 py-3 text-right font-semibold">{{ o.total }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!data.recent.length" class="empty">
          No orders yet. Send the bot a voice note about one.
        </p>
      </section>

      <div class="flex flex-col gap-6">
        <section class="panel">
          <h2 class="card-head">Selling well today</h2>
          <div v-for="p in data.summary.today.topProducts" :key="p.name" class="row">
            <span class="min-w-0 truncate">{{ p.name }}</span>
            <span class="badge shrink-0 bg-good/10 text-good">{{ p.qty }} sold</span>
          </div>
          <p v-if="!data.summary.today.topProducts.length" class="px-5 py-6 text-muted">
            Nothing sold yet today.
          </p>
        </section>
        <section class="panel">
          <h2 class="card-head">Running low</h2>
          <div v-for="s in data.summary.lowStock" :key="s.item" class="row">
            <span class="min-w-0 truncate">{{ s.item }}</span>
            <span
              class="badge shrink-0"
              :class="s.available ? 'bg-warn/10 text-warn' : 'bg-bad/10 text-bad'"
              >{{ s.available ? `${s.available} left` : 'Sold out' }}</span
            >
          </div>
          <p v-if="!data.summary.lowStock.length" class="px-5 py-6 text-muted">Stock looks fine.</p>
        </section>
      </div>
    </div>

    <p v-if="data.usage.length" class="text-xs text-muted">
      Model calls today:
      <span v-for="(u, i) in data.usage" :key="u.purpose"
        >{{ i ? ', ' : '' }}{{ u.purpose }} {{ u.calls
        }}<template v-if="u.cached"> ({{ u.cached }} from cache)</template></span
      >.
    </p>
  </div>
</template>
