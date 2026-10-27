<script setup lang="ts">
import { formatTaka } from '@saudaai/shared'
import { onMounted, ref } from 'vue'
import { api, send } from '../api.ts'
import StatusText from '../components/StatusText.vue'
import { useSession } from '../stores/session.ts'
import type { ProductRow } from '../types.ts'

const session = useSession()
const products = ref<ProductRow[]>([])
const error = ref('')

async function load() {
  products.value = (await api<{ products: ProductRow[] }>('/api/products')).products
}

async function act(fn: () => Promise<unknown>) {
  error.value = ''
  try {
    await fn()
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

const stock = (variantId: string, delta: number) =>
  act(() => send(`/api/variants/${variantId}`, 'PATCH', { delta, reason: 'dashboard' }))
const status = (id: string, s: string) =>
  act(() => send(`/api/products/${id}`, 'PATCH', { status: s }))
const label = (v: ProductRow['variants'][number]) =>
  [v.size, v.color].filter(Boolean).join(' / ') || 'Stock'

onMounted(load)
</script>

<template>
  <h1 class="text-2xl font-semibold">Catalog</h1>
  <p class="mt-1 text-muted">
    Send a product photo to the bot with the price and sizes to add something new.
  </p>
  <p v-if="error" class="mt-3 text-sm text-khata">{{ error }}</p>
  <div class="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    <article v-for="p in products" :key="p.id" class="flex flex-col bg-white">
      <img
        v-if="p.imageUrl"
        :src="p.imageUrl"
        :alt="p.name"
        class="aspect-square w-full object-cover"
      />
      <div
        v-else
        class="flex aspect-square items-center justify-center bg-rule/40 font-ledger text-4xl text-muted"
      >
        {{ p.name.slice(0, 1) }}
      </div>
      <div class="flex flex-1 flex-col p-4">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="font-medium">{{ p.name }}</h2>
          <StatusText v-if="p.status !== 'active'" :status="p.status" />
        </div>
        <div class="font-ledger text-xl">{{ formatTaka(p.pricePoisha) }}</div>
        <ul class="mt-3">
          <li
            v-for="v in p.variants"
            :key="v.id"
            class="flex items-center justify-between border-t border-rule py-1.5 text-sm"
          >
            <span>{{ label(v) }}</span>
            <span class="flex items-center gap-2">
              <button
                v-if="!session.me?.readonly"
                class="size-7 rounded border border-rule"
                :aria-label="`One less ${label(v)}`"
                @click="stock(v.id, -1)"
              >
                −
              </button>
              <span class="w-16 text-center" :class="v.stock - v.reserved <= 2 && 'text-khata'"
                >{{ v.stock - v.reserved
                }}<span v-if="v.reserved" class="text-muted"> +{{ v.reserved }}</span></span
              >
              <button
                v-if="!session.me?.readonly"
                class="size-7 rounded border border-rule"
                :aria-label="`One more ${label(v)}`"
                @click="stock(v.id, 1)"
              >
                +
              </button>
            </span>
          </li>
        </ul>
        <div v-if="!session.me?.readonly" class="mt-auto flex gap-2 pt-3">
          <button v-if="p.status === 'draft'" class="btn-primary" @click="status(p.id, 'active')">
            Publish
          </button>
          <button v-if="p.status === 'active'" class="btn-quiet" @click="status(p.id, 'archived')">
            Hide
          </button>
        </div>
      </div>
    </article>
  </div>
  <p class="mt-4 text-sm text-muted">
    Numbers show what is free to sell; +n is held by open orders.
  </p>
</template>
