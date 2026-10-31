<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, send } from '../api.ts'
import { useSession } from '../stores/session.ts'
import type { Pending } from '../types.ts'
import AppIcon from './AppIcon.vue'
import ApprovalSlip from './ApprovalSlip.vue'

type Reply = {
  transcript: string | null
  replies: { text: string; choices?: string[] }[]
  media: string[]
  pending: Pending[]
  failed: boolean
}
type Entry =
  | { id: number; who: 'owner'; text: string; image?: string }
  | { id: number; who: 'assistant'; text: string; choices?: string[] }
  | { id: number; who: 'media'; url: string }
  | { id: number; who: 'approval'; item: Pending }

const session = useSession()
const open = ref(false)
const entries = ref<Entry[]>([])
const draft = ref('')
const busy = ref(false)
const recording = ref(false)
const error = ref('')
const log = ref<HTMLElement | null>(null)
let seq = 0

async function scroll() {
  await nextTick()
  log.value?.scrollTo({ top: log.value.scrollHeight, behavior: 'smooth' })
}

function take(res: Reply, voice: boolean) {
  if (voice) entries.value.push({ id: seq++, who: 'owner', text: res.transcript || 'Voice note' })
  for (const r of res.replies) entries.value.push({ id: seq++, who: 'assistant', ...r })
  for (const url of res.media) entries.value.push({ id: seq++, who: 'media', url })
  for (const item of res.pending) entries.value.push({ id: seq++, who: 'approval', item })
  if (!res.replies.length && !res.pending.length && !res.media.length) {
    entries.value.push({ id: seq++, who: 'assistant', text: 'Done.' })
  }
  if (res.pending.length) session.pending += res.pending.length
}

async function ask(text: string) {
  if (!text.trim() || busy.value) return
  error.value = ''
  entries.value.push({ id: seq++, who: 'owner', text })
  draft.value = ''
  busy.value = true
  scroll()
  try {
    take(await send<Reply>('/api/command', 'POST', { text }), false)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
    scroll()
  }
}

const picker = ref<HTMLInputElement | null>(null)

// A product photo with the typed text as its caption (price, sizes): becomes a draft product in the store.
async function sendPhoto(file: File) {
  if (busy.value) return
  if (!file.type.startsWith('image/')) {
    error.value = 'That file is not an image.'
    return
  }
  error.value = ''
  const caption = draft.value.trim()
  entries.value.push({ id: seq++, who: 'owner', text: caption, image: URL.createObjectURL(file) })
  draft.value = ''
  const form = new FormData()
  form.append('photo', file, file.name || 'photo.jpg')
  if (caption) form.append('text', caption)
  busy.value = true
  scroll()
  try {
    take(await api<Reply>('/api/command', { method: 'POST', body: form }), false)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
    scroll()
  }
}

function onPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) sendPhoto(file)
  ;(e.target as HTMLInputElement).value = ''
}

function onPaste(e: ClipboardEvent) {
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
  if (!file) return
  e.preventDefault()
  sendPhoto(file)
}

let recorder: MediaRecorder | null = null
async function toggleVoice() {
  if (recorder) {
    recorder.stop()
    return
  }
  error.value = ''
  try {
    const media = await navigator.mediaDevices.getUserMedia({ audio: true })
    const chunks: Blob[] = []
    const rec = new MediaRecorder(media)
    recorder = rec
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = async () => {
      recorder = null
      recording.value = false
      media.getTracks().forEach((t) => t.stop())
      const form = new FormData()
      form.append('voice', new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), 'voice.webm')
      busy.value = true
      scroll()
      try {
        take(await api<Reply>('/api/command', { method: 'POST', body: form }), true)
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err)
      } finally {
        busy.value = false
        scroll()
      }
    }
    rec.start()
    recording.value = true
  } catch {
    error.value = 'Could not turn on the microphone. Type instead.'
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) open.value = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <template v-if="!session.me?.readonly">
    <button
      v-if="!open"
      class="fixed right-5 bottom-5 z-30 flex items-center gap-2 rounded-full bg-ink py-3 pr-5 pl-4 font-medium text-white shadow-[0_8px_24px_rgb(26_140_240/0.35)] hover:bg-ink-dark"
      @click="open = true"
    >
      <AppIcon name="mic" />Ask SaudaAI
    </button>
    <section
      v-else
      class="fixed inset-0 z-40 flex flex-col bg-cloud sm:inset-auto sm:right-5 sm:bottom-5 sm:h-[min(640px,calc(100vh-6rem))] sm:w-[420px] sm:overflow-hidden sm:rounded-2xl sm:shadow-[0_16px_48px_rgb(29_38_48/0.22)]"
      role="dialog"
      aria-label="Ask SaudaAI"
    >
      <header class="flex items-center gap-3 bg-ink px-4 py-3 text-white">
        <span class="grid size-9 place-items-center rounded-full bg-white/20"
          ><AppIcon name="chat"
        /></span>
        <div class="flex-1">
          <p class="font-semibold">Ask SaudaAI</p>
          <p class="text-xs text-white/80">Same assistant as your Telegram bot</p>
        </div>
        <button class="rounded-lg p-1.5 hover:bg-white/15" aria-label="Close" @click="open = false">
          <AppIcon name="close" />
        </button>
      </header>

      <div ref="log" class="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4" aria-live="polite">
        <div v-if="!entries.length" class="rounded-xl bg-white p-4 text-sm text-muted">
          <p class="font-medium text-night">Tell it what happened, in Bangla or English.</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="s in [
                'আজকে কত বিক্রি হলো?',
                'Rahim bhai 2 ta kalo t-shirt L nibe, Mirpur, bkash',
                'kon product kom ache?',
              ]"
              :key="s"
              class="chip text-left"
              @click="ask(s)"
            >
              {{ s }}
            </button>
          </div>
        </div>
        <template v-for="e in entries" :key="e.id">
          <div
            v-if="e.who === 'owner'"
            class="max-w-[85%] self-end overflow-hidden rounded-2xl rounded-br-md bg-ink text-white"
          >
            <img v-if="e.image" :src="e.image" alt="" class="max-h-56 w-full object-cover" />
            <p v-if="e.text" class="px-3.5 py-2 whitespace-pre-wrap">{{ e.text }}</p>
          </div>
          <div
            v-else-if="e.who === 'assistant'"
            class="max-w-[90%] self-start rounded-2xl rounded-bl-md bg-white px-3.5 py-2 shadow-card"
          >
            <p class="whitespace-pre-wrap">{{ e.text }}</p>
            <div v-if="e.choices?.length" class="mt-2 flex flex-wrap gap-1.5">
              <button v-for="c in e.choices" :key="c" class="chip min-h-7" @click="ask(c)">
                {{ c }}
              </button>
            </div>
          </div>
          <img
            v-else-if="e.who === 'media'"
            :src="e.url"
            alt=""
            class="max-h-72 self-start rounded-xl shadow-card"
          />
          <ApprovalSlip
            v-else
            :item="e.item"
            class="self-stretch"
            @decided="e.item.status = 'decided'"
          />
        </template>
        <p v-if="busy" class="self-start rounded-2xl bg-white px-3.5 py-2 text-sm text-muted">
          Working on it…
        </p>
      </div>

      <p v-if="error" class="px-4 pb-1 text-sm text-bad">{{ error }}</p>
      <form
        class="flex items-center gap-2 border-t border-line bg-white p-3"
        @submit.prevent="ask(draft)"
      >
        <input
          v-model="draft"
          class="field rounded-full"
          placeholder="Write, speak, or add a product photo"
          aria-label="Command"
          :disabled="busy"
          @paste="onPaste"
        />
        <input ref="picker" type="file" accept="image/*" class="hidden" @change="onPick" />
        <button
          type="button"
          class="grid size-10 shrink-0 place-items-center rounded-full border border-line text-muted hover:text-ink"
          aria-label="Add a product photo"
          :disabled="busy"
          @click="picker?.click()"
        >
          <AppIcon name="image" />
        </button>
        <button
          type="button"
          class="grid size-10 shrink-0 place-items-center rounded-full border transition-colors"
          :class="
            recording ? 'border-bad bg-bad text-white' : 'border-line text-muted hover:text-ink'
          "
          :aria-label="recording ? 'Stop recording' : 'Record a voice command'"
          :aria-pressed="recording"
          :disabled="busy && !recording"
          @click="toggleVoice"
        >
          <AppIcon :name="recording ? 'stop' : 'mic'" />
        </button>
        <button
          class="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-white disabled:opacity-40"
          :disabled="busy || !draft.trim()"
          aria-label="Send"
        >
          <AppIcon name="send" />
        </button>
      </form>
    </section>
  </template>
</template>
