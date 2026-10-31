<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '../api.ts'
import ApprovalSlip from '../components/ApprovalSlip.vue'
import StatusText from '../components/StatusText.vue'
import { when } from '../format.ts'
import type { Pending } from '../types.ts'

const tab = ref<'waiting' | 'decided'>('waiting')
const items = ref<Pending[]>([])

async function load() {
  const status = tab.value === 'waiting' ? 'pending' : 'approved,edited,cancelled,expired,failed'
  items.value = (await api<{ pending: Pending[] }>(`/api/pending?status=${status}`)).pending
}

watch(tab, load)
let timer: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  timer = setInterval(load, 10_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <h1 class="page-title">Approvals</h1>
  <p class="mt-2 max-w-2xl text-muted">
    Anything that commits the shop or touches money waits here and on Telegram until you decide.
  </p>
  <div class="mt-6 inline-flex rounded-xl border border-line bg-white p-1" role="tablist">
    <button
      v-for="t in ['waiting', 'decided'] as const"
      :key="t"
      role="tab"
      :aria-selected="tab === t"
      class="rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-colors"
      :class="tab === t ? 'bg-ink text-white' : 'text-muted hover:text-ink'"
      @click="tab = t"
    >
      {{ t }}
    </button>
  </div>
  <div v-if="tab === 'waiting'" class="mt-6 grid gap-3 lg:grid-cols-2">
    <ApprovalSlip v-for="p in items" :key="p.id" :item="p" @decided="load" />
    <p v-if="!items.length" class="panel empty lg:col-span-2">
      Nothing is waiting. New requests from the assistant show up here.
    </p>
  </div>
  <div v-else class="panel mt-6">
    <div v-for="p in items" :key="p.id" class="row items-start">
      <span class="min-w-0 leading-relaxed whitespace-pre-wrap">{{ p.preview }}</span>
      <span class="flex shrink-0 flex-col items-end gap-1 text-sm text-muted"
        ><StatusText :status="p.status" />{{ when(p.decidedAt ?? p.createdAt) }}</span
      >
    </div>
    <p v-if="!items.length" class="empty">Nothing decided yet.</p>
  </div>
</template>
