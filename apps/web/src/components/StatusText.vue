<script setup lang="ts">
const props = defineProps<{ status: string }>()

const tone: Record<string, string> = {
  draft: 'bg-warn/10 text-warn',
  confirmed: 'bg-sky text-ink',
  shipped: 'bg-sky text-ink',
  delivered: 'bg-good/10 text-good',
  cancelled: 'bg-cloud text-muted line-through',
  paid: 'bg-good/10 text-good',
  partial: 'bg-warn/10 text-warn',
  unpaid: 'bg-bad/10 text-bad',
  pending: 'bg-warn/10 text-warn',
  approved: 'bg-good/10 text-good',
  edited: 'bg-good/10 text-good',
  expired: 'bg-cloud text-muted',
  failed: 'bg-bad/10 text-bad',
  active: 'bg-good/10 text-good',
  archived: 'bg-cloud text-muted',
}
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded px-2 text-xs leading-6 font-medium whitespace-nowrap capitalize"
    :class="tone[props.status] ?? 'bg-cloud text-muted'"
    ><span class="size-1.5 rounded-full bg-current"></span>{{ props.status }}</span
  >
</template>
