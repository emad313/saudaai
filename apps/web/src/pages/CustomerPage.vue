<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api.ts'
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
    <RouterLink to="/customers" class="text-sm text-khata underline">Customers</RouterLink>
    <h1 class="mt-2 text-2xl font-semibold">{{ data.customer.name }}</h1>
    <p class="text-muted">
      {{
        [data.customer.phone, data.customer.address ?? data.customer.area]
          .filter(Boolean)
          .join(', ')
      }}
    </p>
    <div v-if="data.chats.length" class="mt-3 flex flex-wrap gap-2">
      <RouterLink v-for="c in data.chats" :key="c.id" :to="`/inbox/${c.id}`" class="btn-quiet"
        >Chat on {{ channelName[c.channel] }}</RouterLink
      >
    </div>
    <h2 class="mt-8 font-semibold">Orders</h2>
    <RouterLink
      v-for="o in data.orders"
      :key="o.orderId"
      :to="`/orders/${o.orderId}`"
      class="ledger-row hover:bg-white"
    >
      <span class="flex items-baseline gap-3"
        ><span class="font-ledger">#{{ o.number }}</span
        ><StatusText :status="o.status" /><StatusText :status="o.paymentStatus"
      /></span>
      <span class="text-right"
        ><span class="font-ledger">{{ o.total }}</span
        ><span class="ml-3 text-sm text-muted">{{ when(o.createdAt) }}</span></span
      >
    </RouterLink>
    <p v-if="!data.orders.length" class="py-6 text-muted">No orders yet.</p>
  </div>
</template>
