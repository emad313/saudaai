<script setup lang="ts">
import type { PropType } from 'vue'

defineProps({ name: { type: String as PropType<keyof typeof paths>, required: true } })
</script>

<script lang="ts">
const paths = {
  today: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  approvals: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 3 3 5-6',
  inbox: 'M4 5h16v11H8l-4 4zM8 9.5h8M8 12.5h5',
  orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  catalog: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9',
  customers:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  log: 'M3 12h4l3-8 4 16 3-8h4',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.2-1.3L14.4 3h-4l-.3 2.4a7.6 7.6 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.2 1.3l.3 2.4h4l.3-2.4a7.6 7.6 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H4',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 3-4-4',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0M12 18v3',
  send: 'M4 12 20 4l-6 16-3-7z',
  stop: 'M7 7h10v10H7z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  file: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  down: 'M6 9l6 6 6-6',
  truck:
    'M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
}
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="size-5 shrink-0"
  >
    <path :d="paths[name]" />
  </svg>
</template>
