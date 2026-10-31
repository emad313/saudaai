<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  points: { label: string; value: number; title: string }[]
  axis: (v: number) => string
}>()

const w = 640
const h = 240
const pad = { top: 16, right: 16, bottom: 32, left: 56 }
const hover = ref<number | null>(null)

const top = computed(() => {
  const max = Math.max(...props.points.map((p) => p.value), 1)
  const step = 10 ** Math.floor(Math.log10(max))
  return Math.ceil(max / step) * step
})
const ticks = computed(() => [0, 1, 2, 3, 4].map((i) => (top.value * i) / 4))

const xy = computed(() =>
  props.points.map((p, i) => ({
    x: pad.left + (i * (w - pad.left - pad.right)) / Math.max(props.points.length - 1, 1),
    y: pad.top + (1 - p.value / top.value) * (h - pad.top - pad.bottom),
  })),
)
const y = (v: number) => pad.top + (1 - v / top.value) * (h - pad.top - pad.bottom)

// Catmull-Rom to cubic bezier, clamped so the curve never dips below zero.
const line = computed(() => {
  const p = xy.value
  const base = y(0)
  return p
    .map((pt, i) => {
      if (i === 0) return `M${pt.x},${pt.y}`
      const a = p[i - 2] ?? p[i - 1]!
      const b = p[i - 1]!
      const c = p[i + 1] ?? pt
      const c1y = Math.min(b.y + (pt.y - a.y) / 6, base)
      const c2y = Math.min(pt.y - (c.y - b.y) / 6, base)
      return `C${b.x + (pt.x - a.x) / 6},${c1y} ${pt.x - (c.x - b.x) / 6},${c2y} ${pt.x},${pt.y}`
    })
    .join(' ')
})
const area = computed(() => {
  const p = xy.value
  return `${line.value} L${p.at(-1)!.x},${y(0)} L${p[0]!.x},${y(0)} Z`
})
</script>

<template>
  <svg :viewBox="`0 0 ${w} ${h}`" class="h-auto w-full" role="img">
    <defs>
      <linearGradient id="sales-fill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="var(--color-ink)" stop-opacity="0.22" />
        <stop offset="1" stop-color="var(--color-ink)" stop-opacity="0" />
      </linearGradient>
    </defs>
    <g v-for="t in ticks" :key="t">
      <line :x1="pad.left" :x2="w - pad.right" :y1="y(t)" :y2="y(t)" stroke="var(--color-line)" />
      <text :x="pad.left - 10" :y="y(t) + 4" text-anchor="end" class="fill-muted text-[11px]">
        {{ axis(t) }}
      </text>
    </g>
    <path :d="area" fill="url(#sales-fill)" />
    <path :d="line" fill="none" stroke="var(--color-ink)" stroke-width="2.5" />
    <g v-for="(p, i) in xy" :key="i">
      <text :x="p.x" :y="h - 8" text-anchor="middle" class="fill-muted text-[11px]">
        {{ points[i]!.label }}
      </text>
      <circle
        :cx="p.x"
        :cy="p.y"
        :r="hover === i ? 6 : 4"
        fill="white"
        stroke="var(--color-ink)"
        stroke-width="2.5"
      />
      <rect
        :x="p.x - 24"
        :y="pad.top"
        width="48"
        :height="h - pad.top - pad.bottom"
        fill="transparent"
        @pointerenter="hover = i"
        @pointerleave="hover = null"
      >
        <title>{{ points[i]!.title }}</title>
      </rect>
    </g>
    <g v-if="hover !== null" pointer-events="none">
      <rect
        :x="Math.min(Math.max(xy[hover]!.x - 60, 4), w - 124)"
        :y="Math.max(xy[hover]!.y - 40, 2)"
        width="120"
        height="26"
        rx="6"
        fill="var(--color-night)"
      />
      <text
        :x="Math.min(Math.max(xy[hover]!.x, 64), w - 64)"
        :y="Math.max(xy[hover]!.y - 40, 2) + 17"
        text-anchor="middle"
        class="fill-white text-[12px] font-medium"
      >
        {{ points[hover]!.title }}
      </text>
    </g>
  </svg>
</template>
