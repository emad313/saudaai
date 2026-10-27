<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api.ts'
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
  run: 'text-leaf',
  pending: 'text-marigold',
  reject: 'text-khata',
  invalid: 'text-khata',
  error: 'text-khata',
}
const label: Record<string, string> = {
  run: 'done',
  pending: 'sent for approval',
  reject: 'refused',
  invalid: 'bad input',
  error: 'failed',
}
const pretty = (v: unknown) => JSON.stringify(v, null, 2)
</script>

<template>
  <h1 class="text-2xl font-semibold">Agent log</h1>
  <p class="mt-1 max-w-2xl text-muted">
    Every step the assistant took: which tool it chose, what it passed, what the shop's code decided
    and returned.
  </p>
  <section v-for="t in turns" :key="t.id" class="mt-6">
    <h2 class="text-sm text-muted">
      {{
        t.actor === 'customer'
          ? 'Customer chat'
          : t.actor === 'system'
            ? 'Scheduled job'
            : 'Seller'
      }}, {{ when(t.at) }}
    </h2>
    <ol class="mt-1 border-l-2 border-rule">
      <li v-for="s in t.steps" :key="s.id" class="relative py-1.5 pl-4">
        <button
          class="flex w-full flex-wrap items-baseline gap-x-3 text-left"
          :aria-expanded="open === s.id"
          @click="open = open === s.id ? null : s.id"
        >
          <code class="text-[15px] font-medium">{{ s.tool }}</code>
          <span class="text-sm" :class="decision[s.decision]">{{ label[s.decision] }}</span>
          <span class="text-xs text-muted">{{ s.latencyMs }} ms</span>
        </button>
        <div v-if="open === s.id" class="mt-2 grid gap-2 text-xs md:grid-cols-2">
          <pre class="overflow-x-auto bg-white p-2">{{ pretty(s.args) }}</pre>
          <pre class="overflow-x-auto bg-white p-2">{{ pretty(s.result) }}</pre>
        </div>
      </li>
    </ol>
  </section>
  <p v-if="!turns.length" class="py-10 text-center text-muted">
    Nothing yet. Steps appear here as soon as the assistant handles a message.
  </p>
</template>
