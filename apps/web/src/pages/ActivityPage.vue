<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api.ts'
import AppIcon from '../components/AppIcon.vue'
import { when } from '../format.ts'
import type { Activity } from '../types.ts'

const rows = ref<Activity[]>([])
const open = ref<string | null>(null)

onMounted(async () => {
  rows.value = (await api<{ activity: Activity[] }>('/api/activity')).activity
})

const turns = computed(() => {
  const map = new Map<string, Activity[]>()
  for (const r of rows.value) map.set(r.turnId, [...(map.get(r.turnId) ?? []), r])
  return [...map].map(([id, steps]) => ({
    id,
    steps: steps.sort((a, b) => a.step - b.step),
    at: steps[0]!.createdAt,
    actor: steps[0]!.actor,
  }))
})

const decision: Record<string, string> = {
  run: 'bg-good/10 text-good',
  pending: 'bg-warn/10 text-warn',
  reject: 'bg-bad/10 text-bad',
  invalid: 'bg-bad/10 text-bad',
  error: 'bg-bad/10 text-bad',
}
const label: Record<string, string> = {
  run: 'Done',
  pending: 'Sent for approval',
  reject: 'Refused',
  invalid: 'Bad input',
  error: 'Failed',
}
const actor: Record<string, string> = {
  customer: 'Customer chat',
  system: 'Scheduled job',
  seller: 'Seller',
}
const pretty = (v: unknown) => JSON.stringify(v, null, 2)
</script>

<template>
  <h1 class="page-title">Agent log</h1>
  <p class="mt-2 max-w-2xl text-muted">
    Every step the assistant took: which tool it chose, what it passed, what the shop's code decided
    and returned.
  </p>
  <div class="mt-6 flex flex-col gap-4">
    <section v-for="t in turns" :key="t.id" class="panel overflow-hidden">
      <h2 class="flex items-center justify-between border-b border-line px-5 py-3 text-sm">
        <span class="font-medium">{{ actor[t.actor] ?? 'Seller' }}</span>
        <span class="text-muted">{{ when(t.at) }}</span>
      </h2>
      <ol>
        <li v-for="s in t.steps" :key="s.id" class="border-b border-line last:border-b-0">
          <button
            class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left hover:bg-sky/50"
            :aria-expanded="open === s.id"
            @click="open = open === s.id ? null : s.id"
          >
            <span class="w-5 text-sm text-muted">{{ s.step }}</span>
            <code class="text-[15px] font-medium text-night">{{ s.tool }}</code>
            <span
              class="rounded-full px-2.5 text-xs leading-6 font-medium"
              :class="decision[s.decision]"
              >{{ label[s.decision] }}</span
            >
            <span class="ml-auto flex items-center gap-2 text-xs text-muted"
              >{{ s.latencyMs }} ms
              <span class="transition-transform" :class="open === s.id && 'rotate-90'"
                ><AppIcon name="next" /></span
            ></span>
          </button>
          <div v-if="open === s.id" class="grid gap-3 px-5 pb-4 text-xs md:grid-cols-2">
            <div>
              <p class="mb-1 text-muted">Input</p>
              <pre class="overflow-x-auto rounded-xl bg-night p-3 text-white/90">{{
                pretty(s.args)
              }}</pre>
            </div>
            <div>
              <p class="mb-1 text-muted">Result</p>
              <pre class="overflow-x-auto rounded-xl bg-night p-3 text-white/90">{{
                pretty(s.result)
              }}</pre>
            </div>
          </div>
        </li>
      </ol>
    </section>
    <p v-if="!turns.length" class="panel empty">
      Nothing yet. Steps appear here as soon as the assistant handles a message.
    </p>
  </div>
</template>
