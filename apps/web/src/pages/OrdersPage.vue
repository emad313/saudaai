<script setup lang="ts">
import { formatTaka } from '@saudaai/shared'
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api.ts'
import AppIcon from '../components/AppIcon.vue'
import StatusText from '../components/StatusText.vue'
import { methodName, when } from '../format.ts'
import type { OrderRow } from '../types.ts'

const filters = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'confirmed', label: 'To ship' },
  { value: 'shipped', label: 'On the way' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
]
const status = ref('')
const route = useRoute()
const q = ref(String(route.query.q ?? ''))
const orders = ref<OrderRow[]>([])

async function load() {
  const params = new URLSearchParams()
  if (status.value) params.set('status', status.value)
  if (q.value.trim()) params.set('q', q.value.trim())
  orders.value = (await api<{ orders: OrderRow[] }>(`/api/orders?${params}`)).orders
}

watch(status, load)
watch(
  () => route.query.q,
  (v) => {
    q.value = String(v ?? '')
    load()
  },
)
onMounted(load)
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-4">
    <h1 class="page-title">Orders</h1>
    <form class="relative w-full sm:w-80" @submit.prevent="load">
      <span class="pointer-events-none absolute top-3 left-3.5 text-muted"
        ><AppIcon name="search"
      /></span>
      <input
        v-model="q"
        type="search"
        class="field pl-11"
        placeholder="Order number or customer name"
        aria-label="Search orders"
      />
    </form>
  </div>
  <div class="mt-6 flex flex-wrap gap-2">
    <button
      v-for="f in filters"
      :key="f.value"
      :class="status === f.value ? 'chip-on' : 'chip'"
      @click="status = f.value"
    >
      {{ f.label }}
    </button>
  </div>
  <div class="panel mt-4 overflow-hidden">
    <RouterLink v-for="o in orders" :key="o.orderId" :to="`/orders/${o.orderId}`" class="row-link">
      <span class="flex min-w-0 items-center gap-3 md:gap-4">
        <span class="w-14 shrink-0 text-sm font-semibold text-muted">#{{ o.number }}</span>
        <span class="min-w-0">
          <span class="block truncate font-medium">{{ o.customer }}</span>
          <span class="block text-sm text-muted"
            >{{ methodName[o.paymentMethod] ?? o.paymentMethod }}, {{ when(o.createdAt) }}</span
          >
        </span>
      </span>
      <span class="flex shrink-0 items-center gap-4">
        <span class="hidden sm:block"><StatusText :status="o.status" /></span>
        <span class="w-24 text-right">
          <span class="block font-semibold">{{ o.total }}</span>
          <span v-if="o.duePoisha && o.status !== 'cancelled'" class="block text-xs text-bad"
            >{{ formatTaka(o.duePoisha) }} due</span
          >
        </span>
      </span>
    </RouterLink>
    <p v-if="!orders.length" class="empty">
      No orders here. Tell the bot about an order, or wait for customers to order in chat.
    </p>
  </div>
</template>
