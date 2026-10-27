<script setup lang="ts">
import { formatTaka } from '@saudaai/shared'
import { onMounted, ref } from 'vue'
import { api } from '../api.ts'

type Row = {
  customerId: string
  name: string
  phone: string | null
  area: string | null
  orders: number
  duePoisha: number
}

const q = ref('')
const rows = ref<Row[]>([])

async function load() {
  rows.value = (
    await api<{ customers: Row[] }>(
      `/api/customers${q.value.trim() ? `?q=${encodeURIComponent(q.value.trim())}` : ''}`,
    )
  ).customers
}
onMounted(load)
</script>

<template>
  <h1 class="text-2xl font-semibold">Customers</h1>
  <form class="mt-4 flex gap-2" @submit.prevent="load">
    <input v-model="q" class="field" placeholder="Name or phone" aria-label="Search customers" />
    <button class="btn-quiet">Search</button>
  </form>
  <div class="mt-4">
    <RouterLink
      v-for="c in rows"
      :key="c.customerId"
      :to="`/customers/${c.customerId}`"
      class="ledger-row hover:bg-white"
    >
      <span class="min-w-0">
        <span class="font-medium">{{ c.name }}</span>
        <span class="block truncate text-sm text-muted">{{
          [c.phone, c.area].filter(Boolean).join(', ')
        }}</span>
      </span>
      <span class="shrink-0 text-right text-sm">
        {{ c.orders }} orders
        <span v-if="c.duePoisha" class="block text-khata">{{ formatTaka(c.duePoisha) }} due</span>
      </span>
    </RouterLink>
    <p v-if="!rows.length" class="py-10 text-center text-muted">No customers match.</p>
  </div>
</template>
