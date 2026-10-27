<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../api.ts'
import ApprovalSlip from '../components/ApprovalSlip.vue'
import StatusText from '../components/StatusText.vue'
import { bnDate, when } from '../format.ts'
import type { OrderRow, Pending, Summary } from '../types.ts'

type Dashboard = {
  summary: Summary
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

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  timer = setInterval(load, 15_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div v-if="data">
    <h1 class="font-ledger text-3xl md:text-4xl">{{ bnDate(Date.now()) }}</h1>

    <section v-if="waiting.length" class="mt-6">
      <div class="flex items-baseline justify-between">
        <h2 class="text-xl font-semibold">Waiting for you</h2>
        <RouterLink to="/approvals" class="text-sm text-khata underline">All approvals</RouterLink>
      </div>
      <div class="mt-3 flex flex-col gap-3">
        <ApprovalSlip v-for="p in waiting.slice(0, 3)" :key="p.id" :item="p" @decided="load" />
      </div>
    </section>

    <section class="mt-8 grid gap-x-12 md:grid-cols-[1.2fr_1fr]">
      <div>
        <div class="ledger-row">
          <span
            >Sold today
            <span class="text-muted"
              >({{ data.summary.today.orders }}
              {{ data.summary.today.orders === 1 ? 'order' : 'orders' }})</span
            ></span
          >
          <span class="font-ledger text-3xl">{{ data.summary.today.revenue }}</span>
        </div>
        <div class="ledger-row">
          <span>Collected</span>
          <span class="font-ledger text-2xl text-leaf">{{ data.summary.today.collected }}</span>
        </div>
        <div class="ledger-row">
          <span>Spent</span>
          <span class="font-ledger text-2xl">{{ data.summary.today.expenses }}</span>
        </div>
        <div class="ledger-row">
          <span
            >Money due
            <span class="text-muted"
              >({{ data.summary.dues.orders }}
              {{ data.summary.dues.orders === 1 ? 'order' : 'orders' }})</span
            ></span
          >
          <span class="font-ledger text-2xl text-khata">{{ data.summary.dues.due }}</span>
        </div>
        <div class="ledger-row">
          <span>Drafts waiting</span>
          <span class="font-ledger text-2xl">{{ data.summary.draftOrders }}</span>
        </div>
      </div>
      <div class="mt-8 md:mt-0">
        <h2 class="font-semibold">Selling well</h2>
        <ul class="mt-2">
          <li v-for="p in data.summary.today.topProducts" :key="p.name" class="ledger-row py-2">
            <span>{{ p.name }}</span
            ><span class="text-muted">{{ p.qty }} sold</span>
          </li>
          <li v-if="!data.summary.today.topProducts.length" class="py-2 text-muted">
            Nothing sold yet today.
          </li>
        </ul>
        <h2 class="mt-6 font-semibold">Running low</h2>
        <ul class="mt-2">
          <li v-for="s in data.summary.lowStock" :key="s.item" class="ledger-row py-2">
            <span>{{ s.item }}</span
            ><span :class="s.available ? 'text-marigold' : 'text-khata'"
              >{{ s.available }} left</span
            >
          </li>
          <li v-if="!data.summary.lowStock.length" class="py-2 text-muted">Stock looks fine.</li>
        </ul>
      </div>
    </section>

    <section class="mt-10">
      <div class="flex items-baseline justify-between">
        <h2 class="text-xl font-semibold">Latest orders</h2>
        <RouterLink to="/orders" class="text-sm text-khata underline">All orders</RouterLink>
      </div>
      <RouterLink
        v-for="o in data.recent"
        :key="o.orderId"
        :to="`/orders/${o.orderId}`"
        class="ledger-row hover:bg-white"
      >
        <span class="flex min-w-0 items-baseline gap-3">
          <span class="font-ledger">#{{ o.number }}</span>
          <span class="truncate">{{ o.customer }}</span>
          <StatusText :status="o.status" />
        </span>
        <span class="shrink-0 text-right">
          <span class="font-ledger">{{ o.total }}</span>
          <span class="ml-3 hidden text-sm text-muted sm:inline">{{ when(o.createdAt) }}</span>
        </span>
      </RouterLink>
    </section>

    <p v-if="data.usage.length" class="mt-10 text-sm text-muted">
      Model calls today:
      <span v-for="(u, i) in data.usage" :key="u.purpose"
        >{{ i ? ', ' : '' }}{{ u.purpose }} {{ u.calls
        }}<template v-if="u.cached"> ({{ u.cached }} from cache)</template></span
      >.
    </p>
  </div>
</template>
