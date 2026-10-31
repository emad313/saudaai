<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api.ts'
import AppIcon from '../components/AppIcon.vue'
import StatusText from '../components/StatusText.vue'
import { channelName, when } from '../format.ts'
import type { OrderRow } from '../types.ts'

type Detail = {
  customer: {
    customerId: string
    name: string
    phone: string | null
    address: string | null
    area: string | null
  }
  orders: OrderRow[]
  chats: { id: string; channel: string }[]
}

const route = useRoute()
const data = ref<Detail | null>(null)
onMounted(async () => {
  data.value = await api<Detail>(`/api/customers/${route.params.id}`)
})
</script>

<template>
  <div v-if="data">
    <RouterLink to="/customers" class="back-link"><AppIcon name="back" />Customers</RouterLink>
    <div class="mt-4 flex flex-wrap items-center gap-4">
      <span
        class="grid size-16 shrink-0 place-items-center rounded-2xl bg-ink text-2xl font-semibold text-white"
        >{{ data.customer.name.slice(0, 1) }}</span
      >
      <div class="min-w-0">
        <h1 class="page-title">{{ data.customer.name }}</h1>
        <p class="mt-1 text-muted">
          {{
            [data.customer.phone, data.customer.address ?? data.customer.area]
              .filter(Boolean)
              .join(', ')
          }}
        </p>
      </div>
    </div>
    <div v-if="data.chats.length" class="mt-5 flex flex-wrap gap-2">
      <RouterLink v-for="c in data.chats" :key="c.id" :to="`/inbox/${c.id}`" class="btn-quiet"
        ><AppIcon name="chat" />Chat on {{ channelName[c.channel] }}</RouterLink
      >
    </div>
    <h2 class="mt-8 text-xl font-semibold">Orders</h2>
    <div class="panel mt-3 overflow-hidden">
      <RouterLink
        v-for="o in data.orders"
        :key="o.orderId"
        :to="`/orders/${o.orderId}`"
        class="row-link"
      >
        <span class="flex min-w-0 flex-wrap items-center gap-2.5">
          <span class="w-14 text-sm font-semibold text-muted">#{{ o.number }}</span>
          <StatusText :status="o.status" />
          <StatusText :status="o.paymentStatus" />
        </span>
        <span class="shrink-0 text-right">
          <span class="block font-semibold">{{ o.total }}</span>
          <span class="block text-xs text-muted">{{ when(o.createdAt) }}</span>
        </span>
      </RouterLink>
      <p v-if="!data.orders.length" class="empty">No orders yet.</p>
    </div>
  </div>
</template>
