<script setup lang="ts">
import { money } from '../format.ts'
import { onMounted, ref } from 'vue'
import { api, send } from '../api.ts'
import AppIcon from '../components/AppIcon.vue'
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
  <h1 class="page-title">Catalog</h1>
  <p class="mt-2 max-w-2xl text-muted">
    Send a product photo to the bot with the price and sizes to add something new. Numbers show what
    is free to sell; +n is held by open orders.
  </p>
  <p v-if="error" class="mt-3 text-sm text-bad">{{ error }}</p>
  <div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    <article v-for="p in products" :key="p.id" class="panel flex flex-col overflow-hidden">
      <div class="relative">
        <img
          v-if="p.imageUrl"
          :src="p.imageUrl"
          :alt="p.name"
          class="aspect-[4/3] w-full bg-cloud object-cover"
        />
        <div
          v-else
          class="grid aspect-[4/3] place-items-center bg-sky text-5xl font-semibold text-ink/40"
        >
          {{ p.name.slice(0, 1) }}
        </div>
        <span v-if="p.status !== 'active'" class="absolute top-3 left-3 rounded-full bg-white">
          <StatusText :status="p.status" />
        </span>
      </div>
      <div class="flex flex-1 flex-col p-4">
        <div class="flex items-start justify-between gap-3">
          <h2 class="font-medium leading-snug">{{ p.name }}</h2>
          <span class="shrink-0 font-semibold text-ink">{{ money(p.pricePoisha) }}</span>
        </div>
        <ul class="mt-3 flex flex-col gap-1">
          <li
            v-for="v in p.variants"
            :key="v.id"
            class="flex items-center justify-between rounded-lg bg-cloud px-3 py-1.5 text-sm"
          >
            <span>{{ label(v) }}</span>
            <span class="flex items-center gap-1">
              <button
                v-if="!session.me?.readonly"
                class="grid size-7 place-items-center rounded-md text-muted hover:bg-white hover:text-ink"
                :aria-label="`One less ${label(v)}`"
                @click="stock(v.id, -1)"
              >
                <AppIcon name="minus" />
              </button>
              <span
                class="w-14 text-center font-medium"
                :class="v.stock - v.reserved <= 2 && 'text-bad'"
                >{{ v.stock - v.reserved
                }}<span v-if="v.reserved" class="font-normal text-muted">
                  +{{ v.reserved }}</span
                ></span
              >
              <button
                v-if="!session.me?.readonly"
                class="grid size-7 place-items-center rounded-md text-muted hover:bg-white hover:text-ink"
                :aria-label="`One more ${label(v)}`"
                @click="stock(v.id, 1)"
              >
                <AppIcon name="plus" />
              </button>
            </span>
          </li>
        </ul>
        <div v-if="!session.me?.readonly" class="mt-auto flex gap-2 pt-4">
          <button
            v-if="p.status === 'draft'"
            class="btn-primary w-full"
            @click="status(p.id, 'active')"
          >
            Publish
          </button>
          <button
            v-if="p.status === 'active'"
            class="btn-ghost w-full"
            @click="status(p.id, 'archived')"
          >
            Hide from shop
          </button>
        </div>
      </div>
    </article>
  </div>
</template>
