<script setup lang="ts">
import { formatTaka } from '@saudaai/shared'
import { onMounted, ref } from 'vue'
import { api } from '../api.ts'
import AppIcon from '../components/AppIcon.vue'

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
  <div class="flex flex-wrap items-end justify-between gap-4">
    <h1 class="page-title">Customers</h1>
    <form class="relative w-full sm:w-80" @submit.prevent="load">
      <span class="pointer-events-none absolute top-3 left-3.5 text-muted"
        ><AppIcon name="search"
      /></span>
      <input
        v-model="q"
        type="search"
        class="field pl-11"
        placeholder="Name or phone"
        aria-label="Search customers"
      />
    </form>
  </div>
  <div class="panel mt-6 overflow-hidden">
    <RouterLink
      v-for="c in rows"
      :key="c.customerId"
      :to="`/customers/${c.customerId}`"
      class="row-link"
    >
      <span class="flex min-w-0 items-center gap-3.5">
        <span
          class="grid size-11 shrink-0 place-items-center rounded-full bg-sky font-semibold text-ink"
          >{{ c.name.slice(0, 1) }}</span
        >
        <span class="min-w-0">
          <span class="block truncate font-medium">{{ c.name }}</span>
          <span class="block truncate text-sm text-muted">{{
            [c.phone, c.area].filter(Boolean).join(', ')
          }}</span>
        </span>
      </span>
      <span class="shrink-0 text-right text-sm">
        <span class="block text-muted"
          >{{ c.orders }} {{ c.orders === 1 ? 'order' : 'orders' }}</span
        >
        <span v-if="c.duePoisha" class="block font-medium text-bad"
          >{{ formatTaka(c.duePoisha) }} due</span
        >
      </span>
    </RouterLink>
    <p v-if="!rows.length" class="empty">No customers match. Try a phone number or first name.</p>
  </div>
</template>
