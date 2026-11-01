<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, send } from '../api.ts'
import AppIcon from '../components/AppIcon.vue'
import StatusText from '../components/StatusText.vue'
import { methodName, money, when } from '../format.ts'
import { useSession } from '../stores/session.ts'
import type { OrderDetail } from '../types.ts'

const route = useRoute()
const session = useSession()
const order = ref<OrderDetail | null>(null)
const payments = ref<{ id: string; amountPoisha: number; method: string; createdAt: number }[]>([])
const amount = ref<number | null>(null)
const method = ref('bkash')
const error = ref('')
const busy = ref(false)

async function load() {
  const res = await api<{ order: OrderDetail; payments: typeof payments.value }>(
    `/api/orders/${route.params.id}`,
  )
  order.value = res.order
  payments.value = res.payments
  amount.value = res.order.duePoisha / 100 || null
}

async function act(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

const setStatus = (status: string) =>
  act(() => send(`/api/orders/${route.params.id}`, 'PATCH', { status }))
const pay = () =>
  act(() =>
    send(`/api/orders/${route.params.id}/payments`, 'POST', {
      amountTaka: amount.value,
      method: method.value,
    }),
  )

const next: Record<string, { status: string; label: string }> = {
  draft: { status: 'confirmed', label: 'Confirm and send invoice' },
  confirmed: { status: 'shipped', label: 'Mark shipped' },
  shipped: { status: 'delivered', label: 'Mark delivered' },
}

onMounted(load)
</script>

<template>
  <div v-if="order">
    <RouterLink to="/orders" class="back-link"><AppIcon name="back" />Orders</RouterLink>
    <div class="mt-3 flex flex-wrap items-center gap-3">
      <h1 class="page-title">Order #{{ order.number }}</h1>
      <StatusText :status="order.status" />
      <StatusText :status="order.paymentStatus" />
    </div>
    <p class="mt-1 text-sm text-muted">
      {{ when(order.createdAt) }}
      <template v-if="order.externalNumber"
        >, store order
        <a
          v-if="order.adminUrl"
          :href="order.adminUrl"
          target="_blank"
          class="font-medium text-ink hover:underline"
          >{{ order.externalNumber }}</a
        ><span v-else>{{ order.externalNumber }}</span></template
      >
    </p>

    <div
      class="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
    >
      <section class="panel overflow-hidden">
        <div v-for="(l, i) in order.lines" :key="i" class="row">
          <span class="min-w-0">
            <span class="block font-medium">{{ l.product }}</span>
            <span class="block text-sm text-muted"
              >{{ [l.size, l.color].filter(Boolean).join(' / ') || 'One size' }}, {{ l.qty }} ×
              {{ l.unitPrice }}</span
            >
          </span>
          <span class="shrink-0 font-semibold">{{ l.lineTotal }}</span>
        </div>
        <div class="row text-muted">
          <span class="flex items-center gap-2"
            ><AppIcon name="truck" />Delivery to {{ order.deliveryArea }}</span
          ><span class="">{{ order.delivery }}</span>
        </div>
        <div class="bg-cloud px-4 py-4 md:px-5">
          <div class="flex items-baseline justify-between">
            <span class="font-semibold">Total</span
            ><span class="text-2xl font-semibold">{{ order.total }}</span>
          </div>
          <div class="mt-2 flex justify-between text-sm">
            <span class="text-muted">Paid</span><span class="text-good">{{ order.paid }}</span>
          </div>
          <div class="mt-1 flex justify-between text-sm">
            <span class="text-muted">Due</span
            ><span class="" :class="order.duePoisha ? 'text-bad' : 'text-muted'">{{
              order.due
            }}</span>
          </div>
        </div>
        <ul
          v-if="payments.length"
          class="border-t border-line px-4 py-3 text-sm text-muted md:px-5"
        >
          <li v-for="p in payments" :key="p.id" class="py-0.5">
            {{ when(p.createdAt) }}: {{ money(p.amountPoisha) }} by
            {{ methodName[p.method] ?? p.method }}
          </li>
        </ul>
      </section>

      <div class="flex flex-col gap-4">
        <section class="panel p-5">
          <h2 class="text-sm text-muted">Customer</h2>
          <RouterLink
            v-if="order.customer.customerId"
            :to="`/customers/${order.customer.customerId}`"
            class="mt-1 block text-lg font-semibold hover:text-ink"
            >{{ order.customer.name }}</RouterLink
          >
          <p class="mt-2 leading-relaxed text-muted">
            <span v-if="order.customer.phone" class="block">{{ order.customer.phone }}</span>
            <span class="block">{{ order.deliveryAddress ?? order.deliveryArea }}</span>
            <span class="block">{{ methodName[order.paymentMethod] ?? order.paymentMethod }}</span>
          </p>
          <a
            :href="`/api/orders/${order.orderId}/invoice.pdf`"
            target="_blank"
            class="btn-quiet mt-4 w-full"
            ><AppIcon name="file" />Invoice PDF</a
          >
        </section>

        <section
          v-if="
            !session.me?.readonly && order.status !== 'delivered' && order.status !== 'cancelled'
          "
          class="panel flex flex-col gap-2 p-5"
        >
          <button
            v-if="next[order.status]"
            class="btn-primary min-h-11"
            :disabled="busy"
            @click="setStatus(next[order.status]!.status)"
          >
            {{ next[order.status]!.label }}
          </button>
          <button
            v-if="['draft', 'confirmed'].includes(order.status)"
            class="btn-ghost"
            :disabled="busy"
            @click="setStatus('cancelled')"
          >
            Cancel order
          </button>
        </section>

        <form
          v-if="!session.me?.readonly && order.duePoisha > 0 && order.status !== 'cancelled'"
          class="panel flex flex-col gap-3 p-5"
          @submit.prevent="pay"
        >
          <h2 class="font-semibold">Record a payment</h2>
          <div class="flex gap-2">
            <input
              v-model.number="amount"
              type="number"
              min="0.01"
              step="0.01"
              class="field"
              aria-label="Amount"
            />
            <select v-model="method" class="field w-32" aria-label="Method">
              <option value="bkash">bKash</option>
              <option value="nagad">Nagad</option>
              <option value="cod">Cash</option>
            </select>
          </div>
          <button class="btn-quiet" :disabled="busy || !amount">Save payment</button>
        </form>
        <p v-if="error" class="text-sm text-bad">{{ error }}</p>
      </div>
    </div>
  </div>
</template>
