<script setup lang="ts">
const props = defineProps<{ status: string }>()

const tone: Record<string, string> = {
  draft: 'text-marigold border-marigold',
  confirmed: 'text-ink border-ink',
  shipped: 'text-ink border-ink',
  delivered: 'text-leaf border-leaf',
  cancelled: 'text-muted border-rule line-through',
  paid: 'text-leaf border-leaf',
  partial: 'text-marigold border-marigold',
  unpaid: 'text-khata border-khata',
  pending: 'text-marigold border-marigold',
  approved: 'text-leaf border-leaf',
  edited: 'text-leaf border-leaf',
  expired: 'text-muted border-rule',
  failed: 'text-khata border-khata',
}
</script>

<template>
  <span
    class="inline-block rounded border px-1.5 text-xs leading-5 font-medium"
    :class="tone[props.status] ?? 'text-muted border-rule'"
    >{{ props.status }}</span
  >
</template>
