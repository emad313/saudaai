<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, send } from '../api.ts'
import StatusText from '../components/StatusText.vue'
import { methodName, when } from '../format.ts'
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

onMounted(load)
</script>

<template>
  <div v-if="order">
    <RouterLink to="/orders" class="text-sm text-khata underline">Orders</RouterLink>
    <div class="mt-2 flex flex-wrap items-baseline gap-3">
      <h1 class="font-ledger text-3xl">#{{ order.number }}</h1>
      <StatusText :status="order.status" />
      <StatusText :status="order.paymentStatus" />
      <span class="text-sm text-muted">{{ when(order.createdAt) }}</span>
    </div>

    <section class="mt-6 grid gap-8 md:grid-cols-[1.4fr_1fr]">
      <div>
        <div v-for="(l, i) in order.lines" :key="i" class="ledger-row">
          <span>
            {{ l.product }}
            <span class="text-muted">{{ [l.size, l.color].filter(Boolean).join(' / ') }}</span>
            <span class="block text-sm text-muted">{{ l.qty }} × {{ l.unitPrice }}</span>
          </span>
          <span class="font-ledger">{{ l.lineTotal }}</span>
        </div>
        <div class="ledger-row text-muted">
          <span>Delivery to {{ order.deliveryArea }}</span
          ><span class="font-ledger">{{ order.delivery }}</span>
        </div>
        <div class="ledger-row border-b-2 border-ink">
          <span class="font-semibold">Total</span
          ><span class="font-ledger text-2xl">{{ order.total }}</span>
        </div>
        <div class="ledger-row">
          <span>Paid</span><span class="font-ledger text-leaf">{{ order.paid }}</span>
        </div>
        <div class="ledger-row">
          <span>Due</span><span class="font-ledger text-khata">{{ order.due }}</span>
        </div>
        <ul v-if="payments.length" class="mt-3 text-sm text-muted">
          <li v-for="p in payments" :key="p.id">
            {{ when(p.createdAt) }}: ৳{{ (p.amountPoisha / 100).toLocaleString('en-IN') }} by
            {{ methodName[p.method] ?? p.method }}
          </li>
        </ul>
      </div>

      <div>
        <h2 class="font-semibold">Customer</h2>
        <p class="mt-1">
          <RouterLink
            v-if="order.customer.customerId"
            :to="`/customers/${order.customer.customerId}`"
            class="underline"
            >{{ order.customer.name }}</RouterLink
          >
          <span class="block text-muted">{{ order.customer.phone }}</span>
          <span class="block text-muted">{{ order.deliveryAddress ?? order.deliveryArea }}</span>
          <span class="block text-muted">{{
            methodName[order.paymentMethod] ?? order.paymentMethod
          }}</span>
        </p>
        <a :href="`/api/orders/${order.orderId}/invoice.pdf`" target="_blank" class="btn-quiet mt-4"
          >Invoice PDF</a
        >

        <div v-if="!session.me?.readonly" class="mt-6 flex flex-col gap-2">
          <button
            v-if="order.status === 'draft'"
            class="btn-primary"
            :disabled="busy"
            @click="setStatus('confirmed')"
          >
            Confirm and send invoice
          </button>
          <button
            v-if="order.status === 'confirmed'"
            class="btn-primary"
            :disabled="busy"
            @click="setStatus('shipped')"
          >
            Mark shipped
          </button>
          <button
            v-if="order.status === 'shipped'"
            class="btn-primary"
            :disabled="busy"
            @click="setStatus('delivered')"
          >
            Mark delivered
          </button>
          <button
            v-if="['draft', 'confirmed'].includes(order.status)"
            class="btn-quiet"
            :disabled="busy"
            @click="setStatus('cancelled')"
          >
            Cancel order
          </button>

          <form
            v-if="order.duePoisha > 0 && order.status !== 'cancelled'"
            class="mt-4 flex flex-col gap-2"
            @submit.prevent="pay"
          >
            <h2 class="font-semibold">Record a payment</h2>
            <div class="flex gap-2">
              <input
                v-model.number="amount"
                type="number"
                min="1"
                class="field"
                aria-label="Amount in taka"
              />
              <select v-model="method" class="field w-36" aria-label="Method">
                <option value="bkash">bKash</option>
                <option value="nagad">Nagad</option>
                <option value="cod">Cash</option>
              </select>
            </div>
            <button class="btn-quiet" :disabled="busy || !amount">Save payment</button>
          </form>
        </div>
        <p v-if="error" class="mt-3 text-sm text-khata">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
