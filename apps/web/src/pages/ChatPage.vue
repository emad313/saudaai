<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, send } from '../api.ts'
import AppIcon from '../components/AppIcon.vue'
import { channelName, when } from '../format.ts'
import type { Message } from '../types.ts'

type Conversation = {
  id: string
  channel: string
  profileName: string | null
  pausedUntil: number | null
  customerId: string | null
}

const route = useRoute()
const conv = ref<Conversation | null>(null)
const messages = ref<Message[]>([])
const text = ref('')
const error = ref('')
const list = ref<HTMLElement | null>(null)

const paused = computed(() =>
  Boolean(conv.value?.pausedUntil && conv.value.pausedUntil > Date.now()),
)

async function load() {
  const before = messages.value.length
  const res = await api<{ conversation: Conversation; messages: Message[] }>(
    `/api/conversations/${route.params.id}/messages`,
  )
  conv.value = res.conversation
  messages.value = res.messages
  if (res.messages.length !== before) {
    await nextTick()
    list.value?.lastElementChild?.scrollIntoView({ block: 'end' })
  }
}

async function reply() {
  error.value = ''
  try {
    await send(`/api/conversations/${route.params.id}/messages`, 'POST', { text: text.value })
    text.value = ''
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function toggle() {
  await send(
    `/api/conversations/${route.params.id}/${paused.value ? 'resume' : 'takeover'}`,
    'POST',
  )
  await load()
}

const who: Record<string, string> = {
  customer: '',
  agent: 'Assistant',
  seller: 'You',
  system: 'System',
}
const bubble: Record<string, string> = {
  customer: 'self-start rounded-bl-md border border-line bg-white',
  agent: 'self-end rounded-br-md bg-sky',
  seller: 'self-end rounded-br-md bg-ink text-white',
  system: 'self-center bg-cloud text-sm text-muted',
}

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  timer = setInterval(load, 4_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div v-if="conv" class="mx-auto flex max-w-3xl flex-col">
    <RouterLink to="/inbox" class="back-link"><AppIcon name="back" />Inbox</RouterLink>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="page-title">{{ conv.profileName ?? 'Customer' }}</h1>
        <p class="mt-1 text-sm text-muted">On {{ channelName[conv.channel] }}</p>
      </div>
      <div class="flex gap-2">
        <RouterLink v-if="conv.customerId" :to="`/customers/${conv.customerId}`" class="btn-quiet"
          >Customer</RouterLink
        >
        <button :class="paused ? 'btn-primary' : 'btn-quiet'" @click="toggle">
          {{ paused ? 'Let the assistant answer' : 'I will answer' }}
        </button>
      </div>
    </div>
    <p v-if="paused" class="mt-4 rounded-xl bg-warn/10 px-4 py-2.5 text-sm text-warn">
      The assistant is paused here. Your messages go to the customer as written.
    </p>

    <ol ref="list" class="mt-6 flex flex-col gap-2.5">
      <li
        v-for="m in messages"
        :key="m.id"
        class="max-w-[85%] rounded-2xl px-3.5 py-2.5"
        :class="bubble[m.role]"
      >
        <div v-if="who[m.role]" class="text-xs font-medium opacity-70">{{ who[m.role] }}</div>
        <img
          v-if="m.mediaUrl && m.kind !== 'voice'"
          :src="m.mediaUrl"
          alt=""
          class="mt-1 max-h-64 rounded-xl"
        />
        <audio
          v-if="m.mediaUrl && m.kind === 'voice'"
          :src="m.mediaUrl"
          controls
          class="mt-1 w-56"
        ></audio>
        <p v-if="m.text" class="leading-relaxed whitespace-pre-wrap">{{ m.text }}</p>
        <p v-if="m.transcript && m.transcript !== m.text" class="mt-1 text-sm italic opacity-80">
          {{ m.transcript }}
        </p>
        <div class="mt-0.5 text-right text-[11px] opacity-60">{{ when(m.createdAt) }}</div>
      </li>
    </ol>

    <form
      class="sticky bottom-4 mt-6 flex gap-2 rounded-2xl border border-line bg-white p-2 shadow-lg shadow-night/5"
      @submit.prevent="reply"
    >
      <input
        v-model="text"
        class="min-h-10 flex-1 bg-transparent px-2 outline-none"
        placeholder="Write to the customer"
        aria-label="Message"
      />
      <button class="btn-primary" :disabled="!text.trim()"><AppIcon name="send" />Send</button>
    </form>
    <p v-if="error" class="mt-2 text-sm text-bad">{{ error }}</p>
  </div>
</template>
