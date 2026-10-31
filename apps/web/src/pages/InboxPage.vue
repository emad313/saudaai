<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '../api.ts'
import { channelName, when } from '../format.ts'
import type { ConversationRow } from '../types.ts'

const channel = ref('')
const rows = ref<ConversationRow[]>([])

async function load() {
  rows.value = (
    await api<{ conversations: ConversationRow[] }>(
      `/api/conversations${channel.value ? `?channel=${channel.value}` : ''}`,
    )
  ).conversations
}

watch(channel, load)
let timer: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  timer = setInterval(load, 8_000)
})
onBeforeUnmount(() => clearInterval(timer))

const channels = [
  { value: '', label: 'All chats' },
  { value: 'messenger', label: 'Messenger' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'webchat', label: 'Web chat' },
]
const badge: Record<string, string> = {
  messenger: 'bg-[#0866ff]',
  instagram: 'bg-[#d62976]',
  whatsapp: 'bg-[#25d366]',
  webchat: 'bg-night',
}
</script>

<template>
  <h1 class="page-title">Inbox</h1>
  <p class="mt-2 max-w-2xl text-muted">
    The assistant answers these customers. Open a chat to read it or answer yourself.
  </p>
  <div class="mt-6 flex flex-wrap gap-2">
    <button
      v-for="c in channels"
      :key="c.value"
      :class="channel === c.value ? 'chip-on' : 'chip'"
      @click="channel = c.value"
    >
      {{ c.label }}
    </button>
  </div>
  <div class="panel mt-4 overflow-hidden">
    <RouterLink v-for="c in rows" :key="c.id" :to="`/inbox/${c.id}`" class="row-link">
      <span class="flex min-w-0 items-center gap-3.5">
        <span class="relative shrink-0">
          <span
            class="grid size-11 place-items-center rounded-full bg-sky font-semibold text-ink"
            >{{ c.name.slice(0, 1) }}</span
          >
          <span
            class="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-white"
            :class="badge[c.channel]"
            :title="channelName[c.channel]"
          ></span>
        </span>
        <span class="min-w-0">
          <span class="flex items-center gap-2">
            <span class="truncate font-medium">{{ c.name }}</span>
            <span
              v-if="c.pausedUntil && c.pausedUntil > Date.now()"
              class="shrink-0 rounded-full bg-warn/10 px-2 text-xs leading-5 text-warn"
              >You are answering</span
            >
          </span>
          <span class="block truncate text-sm text-muted">{{ c.last }}</span>
        </span>
      </span>
      <span class="shrink-0 text-right text-xs text-muted"
        >{{ when(c.lastAt) }}<span class="mt-0.5 block">{{ channelName[c.channel] }}</span></span
      >
    </RouterLink>
    <p v-if="!rows.length" class="empty">
      No chats yet. Customers who message the Page, the WhatsApp number or the shop link appear
      here.
    </p>
  </div>
</template>
