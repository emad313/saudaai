<script setup lang="ts">
import { formatTaka } from '@saudaai/shared'
import { onMounted, ref, watch } from 'vue'
import { api } from '../api.ts'
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
const q = ref('')
const orders = ref<OrderRow[]>([])

async function load() {
  const params = new URLSearchParams()
  if (status.value) params.set('status', status.value)
  if (q.value.trim()) params.set('q', q.value.trim())
  orders.value = (await api<{ orders: OrderRow[] }>(`/api/orders?${params}`)).orders
}

watch(status, load)
onMounted(load)
</script>

<template>
  <h1 class="text-2xl font-semibold">Orders</h1>
  <div class="mt-4 flex flex-wrap gap-2">
    <button
      v-for="f in filters"
      :key="f.value"
      :class="status === f.value ? 'btn-primary' : 'btn-quiet'"
      @click="status = f.value"
    >
      {{ f.label }}
    </button>
  </div>
  <form class="mt-3 flex gap-2" @submit.prevent="load">
    <input
      v-model="q"
      class="field"
      placeholder="Order number or customer name"
      aria-label="Search orders"
    />
    <button class="btn-quiet">Search</button>
  </form>
  <div class="mt-4">
    <RouterLink
      v-for="o in orders"
      :key="o.orderId"
      :to="`/orders/${o.orderId}`"
      class="ledger-row hover:bg-white"
    >
      <span class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span class="font-ledger">#{{ o.number }}</span>
        <span class="truncate font-medium">{{ o.customer }}</span>
        <StatusText :status="o.status" />
        <span class="text-sm text-muted">{{ methodName[o.paymentMethod] ?? o.paymentMethod }}</span>
      </span>
      <span class="shrink-0 text-right">
        <span class="font-ledger text-lg">{{ o.total }}</span>
        <span v-if="o.duePoisha && o.status !== 'cancelled'" class="block text-sm text-khata"
          >{{ formatTaka(o.duePoisha) }} due</span
        >
        <span class="block text-sm text-muted">{{ when(o.createdAt) }}</span>
      </span>
    </RouterLink>
    <p v-if="!orders.length" class="py-10 text-center text-muted">
      No orders here. Tell the bot about an order, or wait for customers to order in chat.
    </p>
  </div>
</template>
