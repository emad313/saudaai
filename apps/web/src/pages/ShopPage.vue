<script setup lang="ts">
import { formatTaka } from '@saudaai/shared'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, send } from '../api.ts'

type Variant = {
  id: string
  size: string | null
  color: string | null
  pricePoisha: number
  available: number
}
type Product = {
  id: string
  name: string
  category: string
  pricePoisha: number
  imageUrl: string | null
  variants: Variant[]
}
type Shop = {
  name: string
  area: string
  paymentMethods: string[]
  delivery: { insideDhakaPoisha: number; outsideDhakaPoisha: number }
  products: Product[]
}
type Line = {
  id: string
  role: 'customer' | 'agent' | 'seller' | 'system'
  text: string | null
  imageUrl?: string | null
  quickReplies?: string[]
}

const route = useRoute()
const slug = String(route.params.slug)
const shop = ref<Shop | null>(null)
const lines = ref<Line[]>([])
const draft = ref('')
const typing = ref(false)
const chatOpen = ref(false)
const picked = ref<Product | null>(null)
const ordering = ref(false)
const recording = ref(false)
const error = ref('')
const log = ref<HTMLElement | null>(null)

const methods: Record<string, string> = { cod: 'ক্যাশ অন ডেলিভারি', bkash: 'বিকাশ', nagad: 'নগদ' }
const variantLabel = (v: Variant) => [v.size, v.color].filter(Boolean).join(' / ') || 'একটি'

async function scroll() {
  await nextTick()
  log.value?.scrollTo({ top: log.value.scrollHeight })
}

async function loadHistory() {
  const res = await api<{
    messages: { id: string; role: Line['role']; text: string | null; imageUrl: string | null }[]
  }>(`/api/s/${slug}/messages`)
  lines.value = res.messages
  scroll()
}

let stream: EventSource | null = null
function listen() {
  stream = new EventSource(`/api/s/${slug}/stream`)
  stream.onmessage = (e) => {
    const ev = JSON.parse(e.data) as {
      kind: string
      role: Line['role']
      text?: string
      imageUrl?: string
      quickReplies?: string[]
    }
    if (ev.kind === 'typing') {
      typing.value = true
      return
    }
    typing.value = false
    lines.value.push({
      id: crypto.randomUUID(),
      role: ev.role,
      text: ev.text ?? null,
      imageUrl: ev.imageUrl,
      quickReplies: ev.quickReplies,
    })
    scroll()
  }
}

async function say(text: string) {
  if (!text.trim()) return
  error.value = ''
  chatOpen.value = true
  lines.value.push({ id: crypto.randomUUID(), role: 'customer', text })
  draft.value = ''
  scroll()
  try {
    await send(`/api/s/${slug}/messages`, 'POST', { text })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

let recorder: MediaRecorder | null = null
async function toggleVoice() {
  if (recording.value) {
    recorder?.stop()
    return
  }
  error.value = ''
  try {
    const media = await navigator.mediaDevices.getUserMedia({ audio: true })
    const chunks: Blob[] = []
    recorder = new MediaRecorder(media)
    recorder.ondataavailable = (e) => chunks.push(e.data)
    recorder.onstop = async () => {
      recording.value = false
      media.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' })
      const form = new FormData()
      form.append('voice', blob, 'voice.webm')
      lines.value.push({
        id: crypto.randomUUID(),
        role: 'customer',
        text: 'ভয়েস মেসেজ পাঠানো হয়েছে',
      })
      scroll()
      await api(`/api/s/${slug}/messages`, { method: 'POST', body: form }).catch(
        (err: Error) => (error.value = err.message),
      )
    }
    recorder.start()
    recording.value = true
  } catch {
    error.value = 'মাইক্রোফোন চালু করা যায়নি। টাইপ করে লিখুন।'
  }
}

const order = ref({
  variantId: '',
  qty: 1,
  name: '',
  phone: '',
  address: '',
  area: '',
  paymentMethod: 'cod',
})
const pickedVariant = computed(() =>
  picked.value?.variants.find((v) => v.id === order.value.variantId),
)

function choose(p: Product) {
  picked.value = p
  ordering.value = false
  order.value.variantId = p.variants.find((v) => v.available > 0)?.id ?? ''
}

function askAbout() {
  if (!picked.value) return
  const v = pickedVariant.value
  say(`${picked.value.name}${v ? ` ${variantLabel(v)}` : ''} আছে?`)
  picked.value = null
}

async function placeOrder() {
  error.value = ''
  try {
    const o = order.value
    const res = await send<{ number: number; total: string }>(`/api/s/${slug}/order`, 'POST', {
      items: [{ variantId: o.variantId, qty: o.qty }],
      name: o.name,
      phone: o.phone,
      address: o.address,
      area: o.area,
      paymentMethod: o.paymentMethod,
    })
    picked.value = null
    chatOpen.value = true
    lines.value.push({
      id: crypto.randomUUID(),
      role: 'agent',
      text: `অর্ডার #${res.number} পেয়েছি, মোট ${res.total}। দোকান থেকে কনফার্ম করে ইনভয়েস পাঠানো হবে।`,
    })
    scroll()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(async () => {
  shop.value = await api<Shop>(`/api/s/${slug}`)
  await loadHistory()
  listen()
})
onBeforeUnmount(() => stream?.close())
</script>

<template>
  <div v-if="shop" class="min-h-screen bg-paper lg:grid lg:grid-cols-[1fr_400px]">
    <main class="pb-28 lg:pb-10">
      <header class="bg-khata px-5 pt-10 pb-6 text-white md:px-10">
        <h1 class="font-ledger text-4xl">{{ shop.name }}</h1>
        <p class="mt-2 text-white/85">
          {{ shop.area }}. ঢাকায় ডেলিভারি {{ formatTaka(shop.delivery.insideDhakaPoisha) }}, ঢাকার
          বাইরে {{ formatTaka(shop.delivery.outsideDhakaPoisha) }}।
        </p>
        <p class="mt-1 text-sm text-white/70">
          Ask anything in Bangla or English, by text or voice. We reply in seconds.
        </p>
      </header>

      <section class="grid grid-cols-2 gap-3 p-3 md:grid-cols-3 md:gap-5 md:p-10">
        <button
          v-for="p in shop.products"
          :key="p.id"
          class="flex flex-col bg-white text-left"
          @click="choose(p)"
        >
          <img
            v-if="p.imageUrl"
            :src="p.imageUrl"
            :alt="p.name"
            class="aspect-square w-full object-cover"
          />
          <span
            v-else
            class="flex aspect-square items-center justify-center bg-rule/40 font-ledger text-5xl text-muted"
            >{{ p.name.slice(0, 1) }}</span
          >
          <span class="p-3">
            <span class="block text-[15px] leading-snug font-medium">{{ p.name }}</span>
            <span class="font-ledger text-lg">{{ formatTaka(p.pricePoisha) }}</span>
          </span>
        </button>
      </section>
    </main>

    <aside
      class="fixed inset-x-0 bottom-0 z-30 flex flex-col border-t border-rule bg-white lg:sticky lg:top-0 lg:h-screen lg:border-t-0 lg:border-l"
      :class="chatOpen ? 'top-0' : ''"
    >
      <button
        class="flex items-center justify-between px-4 py-3 text-left lg:pointer-events-none"
        @click="chatOpen = !chatOpen"
      >
        <span class="font-semibold">দোকানের সাথে কথা বলুন</span>
        <span class="text-sm text-muted lg:hidden">{{ chatOpen ? 'বন্ধ করুন' : 'খুলুন' }}</span>
      </button>
      <div
        ref="log"
        class="flex-1 overflow-y-auto px-4 lg:flex"
        :class="chatOpen ? 'flex flex-col' : 'hidden'"
      >
        <div class="flex flex-col gap-2 py-3">
          <p v-if="!lines.length" class="text-sm text-muted">
            যেমন: “মেরুন কুর্তি XL আছে? চট্টগ্রামে ডেলিভারি কত?”
          </p>
          <div
            v-for="l in lines"
            :key="l.id"
            class="max-w-[85%] rounded-lg px-3 py-2"
            :class="l.role === 'customer' ? 'self-end bg-ink text-white' : 'self-start bg-paper'"
          >
            <img v-if="l.imageUrl" :src="l.imageUrl" alt="" class="mb-1 max-h-72 rounded" />
            <p v-if="l.text" class="whitespace-pre-wrap">{{ l.text }}</p>
            <div v-if="l.quickReplies?.length" class="mt-2 flex flex-wrap gap-1.5">
              <button
                v-for="q in l.quickReplies"
                :key="q"
                class="rounded-full border border-khata px-3 py-1 text-sm text-khata"
                @click="say(q)"
              >
                {{ q }}
              </button>
            </div>
          </div>
          <p v-if="typing" class="self-start text-sm text-muted">লিখছে…</p>
        </div>
      </div>
      <form
        class="flex gap-2 border-t border-rule p-3"
        :class="chatOpen ? 'flex' : 'hidden lg:flex'"
        @submit.prevent="say(draft)"
      >
        <input v-model="draft" class="field" placeholder="লিখুন…" aria-label="Message" />
        <button
          type="button"
          class="btn-quiet"
          :class="recording && 'border-khata text-khata'"
          :aria-pressed="recording"
          @click="toggleVoice"
        >
          {{ recording ? 'থামান' : 'ভয়েস' }}
        </button>
        <button class="btn-primary" :disabled="!draft.trim()">পাঠান</button>
      </form>
      <p v-if="error && chatOpen" class="px-3 pb-2 text-sm text-khata">{{ error }}</p>
    </aside>

    <div
      v-if="picked"
      class="fixed inset-0 z-40 flex items-end bg-ink/40 md:items-center md:justify-center"
      @click.self="picked = null"
    >
      <section
        class="max-h-[92vh] w-full overflow-y-auto bg-white p-5 md:max-w-lg"
        role="dialog"
        :aria-label="picked.name"
      >
        <div class="flex gap-4">
          <img v-if="picked.imageUrl" :src="picked.imageUrl" alt="" class="size-24 object-cover" />
          <div>
            <h2 class="text-lg font-semibold">{{ picked.name }}</h2>
            <p class="font-ledger text-2xl">
              {{ formatTaka(pickedVariant?.pricePoisha ?? picked.pricePoisha) }}
            </p>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            v-for="v in picked.variants"
            :key="v.id"
            class="rounded-md border px-3 py-1.5 text-sm"
            :class="[
              order.variantId === v.id ? 'border-khata bg-khata text-white' : 'border-rule',
              !v.available && 'opacity-40 line-through',
            ]"
            :disabled="!v.available"
            @click="order.variantId = v.id"
          >
            {{ variantLabel(v) }}
          </button>
        </div>

        <div v-if="!ordering" class="mt-5 flex gap-2">
          <button class="btn-primary" :disabled="!order.variantId" @click="ordering = true">
            অর্ডার করুন
          </button>
          <button class="btn-quiet" @click="askAbout">জিজ্ঞেস করুন</button>
        </div>

        <form v-else class="mt-5 flex flex-col gap-3" @submit.prevent="placeOrder">
          <label class="block"
            >পরিমাণ<input
              v-model.number="order.qty"
              type="number"
              min="1"
              :max="pickedVariant?.available ?? 1"
              class="field mt-1 w-24"
          /></label>
          <label class="block"
            >নাম<input v-model="order.name" required class="field mt-1" autocomplete="name"
          /></label>
          <label class="block"
            >মোবাইল নম্বর<input
              v-model="order.phone"
              required
              class="field mt-1"
              inputmode="tel"
              autocomplete="tel"
          /></label>
          <label class="block"
            >ঠিকানা<input
              v-model="order.address"
              required
              class="field mt-1"
              autocomplete="street-address"
          /></label>
          <label class="block"
            >এলাকা / শহর<input
              v-model="order.area"
              required
              class="field mt-1"
              placeholder="যেমন: মিরপুর, চট্টগ্রাম"
          /></label>
          <fieldset>
            <legend>পেমেন্ট</legend>
            <div class="mt-1 flex flex-wrap gap-4">
              <label v-for="m in shop.paymentMethods" :key="m" class="flex items-center gap-2"
                ><input v-model="order.paymentMethod" type="radio" :value="m" />{{
                  methods[m] ?? m
                }}</label
              >
            </div>
          </fieldset>
          <p v-if="error" class="text-sm text-khata">{{ error }}</p>
          <button class="btn-primary">অর্ডার পাঠান</button>
        </form>
      </section>
    </div>
  </div>
</template>
