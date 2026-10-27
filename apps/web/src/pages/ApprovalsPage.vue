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
  <h1 class="text-2xl font-semibold">Approvals</h1>
  <p class="mt-1 text-muted">
    Anything that commits the shop or touches money waits here and on Telegram until you decide.
  </p>
  <div class="mt-5 flex gap-2" role="tablist">
    <button
      role="tab"
      :aria-selected="tab === 'waiting'"
      :class="tab === 'waiting' ? 'btn-primary' : 'btn-quiet'"
      @click="tab = 'waiting'"
    >
      Waiting
    </button>
    <button
      role="tab"
      :aria-selected="tab === 'decided'"
      :class="tab === 'decided' ? 'btn-primary' : 'btn-quiet'"
      @click="tab = 'decided'"
    >
      Decided
    </button>
  </div>
  <div v-if="tab === 'waiting'" class="mt-5 flex flex-col gap-3">
    <ApprovalSlip v-for="p in items" :key="p.id" :item="p" @decided="load" />
    <p v-if="!items.length" class="py-10 text-center text-muted">
      Nothing is waiting. New requests from the assistant show up here.
    </p>
  </div>
  <ul v-else class="mt-5">
    <li v-for="p in items" :key="p.id" class="ledger-row items-start">
      <span class="min-w-0 whitespace-pre-wrap">{{ p.preview }}</span>
      <span class="shrink-0 text-right text-sm text-muted"
        ><StatusText :status="p.status" /><br />{{ when(p.decidedAt ?? p.createdAt) }}</span
      >
    </li>
  </ul>
</template>
