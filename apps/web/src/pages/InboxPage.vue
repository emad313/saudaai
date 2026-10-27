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

const dot: Record<string, string> = {
  messenger: 'bg-[#0866ff]',
  whatsapp: 'bg-[#25d366]',
  webchat: 'bg-khata',
}
</script>

<template>
  <div class="flex flex-wrap items-baseline justify-between gap-3">
    <h1 class="text-2xl font-semibold">Inbox</h1>
    <select v-model="channel" class="field w-auto" aria-label="Channel">
      <option value="">All chats</option>
      <option value="messenger">Messenger</option>
      <option value="whatsapp">WhatsApp</option>
      <option value="webchat">Web chat</option>
    </select>
  </div>
  <p class="mt-1 text-muted">
    The assistant answers these customers. Open a chat to read it or answer yourself.
  </p>
  <div class="mt-5">
    <RouterLink
      v-for="c in rows"
      :key="c.id"
      :to="`/inbox/${c.id}`"
      class="ledger-row items-center hover:bg-white"
    >
      <span class="flex min-w-0 items-center gap-3">
        <span
          class="size-2.5 shrink-0 rounded-full"
          :class="dot[c.channel]"
          :title="channelName[c.channel]"
        ></span>
        <span class="min-w-0">
          <span class="font-medium">{{ c.name }}</span>
          <span
            v-if="c.pausedUntil && c.pausedUntil > Date.now()"
            class="ml-2 text-xs text-marigold"
            >you are answering</span
          >
          <span class="block truncate text-sm text-muted">{{ c.last }}</span>
        </span>
      </span>
      <span class="shrink-0 text-right text-sm text-muted"
        >{{ channelName[c.channel] }}<br />{{ when(c.lastAt) }}</span
      >
    </RouterLink>
    <p v-if="!rows.length" class="py-10 text-center text-muted">
      No chats yet. Customers who message the Page, the WhatsApp number or the shop link appear
      here.
    </p>
  </div>
</template>
