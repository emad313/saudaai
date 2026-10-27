<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, send } from '../api.ts'
import { channelName, when } from '../format.ts'
import { useSession } from '../stores/session.ts'
import type { Message } from '../types.ts'

type Conversation = {
  id: string
  channel: string
  profileName: string | null
  pausedUntil: number | null
  customerId: string | null
}

const route = useRoute()
const session = useSession()
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

let timer: ReturnType<typeof setInterval>
onMounted(() => {
  load()
  timer = setInterval(load, 4_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div v-if="conv" class="flex flex-col">
    <RouterLink to="/inbox" class="text-sm text-khata underline">Inbox</RouterLink>
    <div class="mt-2 flex flex-wrap items-baseline justify-between gap-3">
      <h1 class="text-2xl font-semibold">
        {{ conv.profileName ?? 'Customer' }}
        <span class="text-base font-normal text-muted">on {{ channelName[conv.channel] }}</span>
      </h1>
      <div class="flex gap-2">
        <RouterLink v-if="conv.customerId" :to="`/customers/${conv.customerId}`" class="btn-quiet"
          >Customer</RouterLink
        >
        <button v-if="!session.me?.readonly" class="btn-quiet" @click="toggle">
          {{ paused ? 'Let the assistant answer' : 'I will answer' }}
        </button>
      </div>
    </div>
    <p v-if="paused" class="mt-2 text-sm text-marigold">
      The assistant is paused here. Your messages go to the customer as written.
    </p>

    <ol ref="list" class="mt-5 flex flex-col gap-2">
      <li
        v-for="m in messages"
        :key="m.id"
        class="max-w-[85%] rounded-lg px-3 py-2"
        :class="
          m.role === 'customer'
            ? 'self-start border border-rule bg-white'
            : m.role === 'seller'
              ? 'self-end bg-ink text-white'
              : 'self-end bg-khata/8'
        "
      >
        <div v-if="who[m.role]" class="text-xs font-medium opacity-70">{{ who[m.role] }}</div>
        <img
          v-if="m.mediaUrl && m.kind !== 'voice'"
          :src="m.mediaUrl"
          alt=""
          class="mt-1 max-h-64 rounded"
        />
        <audio
          v-if="m.mediaUrl && m.kind === 'voice'"
          :src="m.mediaUrl"
          controls
          class="mt-1 w-56"
        ></audio>
        <p v-if="m.text" class="whitespace-pre-wrap">{{ m.text }}</p>
        <p v-if="m.transcript && m.transcript !== m.text" class="mt-1 text-sm italic opacity-80">
          {{ m.transcript }}
        </p>
        <div class="mt-0.5 text-right text-[11px] opacity-60">{{ when(m.createdAt) }}</div>
      </li>
    </ol>

    <form
      v-if="!session.me?.readonly"
      class="sticky bottom-16 mt-5 flex gap-2 bg-paper py-3 md:bottom-0"
      @submit.prevent="reply"
    >
      <input
        v-model="text"
        class="field"
        placeholder="Write to the customer"
        aria-label="Message"
      />
      <button class="btn-primary" :disabled="!text.trim()">Send</button>
    </form>
    <p v-if="error" class="text-sm text-khata">{{ error }}</p>
  </div>
</template>
