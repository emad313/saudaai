<script setup lang="ts">
import { formatTaka } from '@saudaai/shared'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, send } from '../api.ts'
import AppIcon from '../components/AppIcon.vue'

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
  <div v-if="shop" class="min-h-screen bg-cloud lg:grid lg:grid-cols-[minmax(0,1fr)_420px]">
    <main class="pb-28 lg:pb-12">
      <header class="bg-ink px-5 pt-10 pb-8 text-white md:px-10 md:pt-14 md:pb-10">
        <p class="text-sm text-white/70">{{ shop.area }}</p>
        <h1 class="mt-1 text-4xl leading-tight font-semibold md:text-5xl">{{ shop.name }}</h1>
        <div class="mt-5 flex flex-wrap gap-2 text-sm">
          <span class="flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5"
            ><AppIcon name="truck" />ঢাকায় {{ formatTaka(shop.delivery.insideDhakaPoisha) }}</span
          >
          <span class="rounded-full bg-white/12 px-3 py-1.5"
            >ঢাকার বাইরে {{ formatTaka(shop.delivery.outsideDhakaPoisha) }}</span
          >
          <span
            v-for="m in shop.paymentMethods"
            :key="m"
            class="rounded-full bg-white/12 px-3 py-1.5"
            >{{ methods[m] ?? m }}</span
          >
        </div>
        <p class="mt-5 max-w-lg text-white/80">
          Ask anything in Bangla or English, by text or voice. We reply in seconds.
        </p>
      </header>

      <section class="grid grid-cols-2 gap-3 p-3 md:grid-cols-3 md:gap-5 md:p-10">
        <button
          v-for="p in shop.products"
          :key="p.id"
          class="flex flex-col overflow-hidden rounded-xl bg-white text-left shadow-card transition-shadow hover:shadow-lg"
          @click="choose(p)"
        >
          <img
            v-if="p.imageUrl"
            :src="p.imageUrl"
            :alt="p.name"
            class="aspect-square w-full bg-cloud object-cover"
          />
          <span
            v-else
            class="grid aspect-square place-items-center bg-sky text-6xl font-semibold text-ink/35"
            >{{ p.name.slice(0, 1) }}</span
          >
          <span class="flex flex-1 flex-col p-3 md:p-4">
            <span class="block text-[15px] leading-snug font-medium">{{ p.name }}</span>
            <span class="mt-auto pt-1.5 text-lg font-semibold text-ink">{{
              formatTaka(p.pricePoisha)
            }}</span>
          </span>
        </button>
      </section>
    </main>

    <aside
      class="fixed inset-x-0 bottom-0 z-30 flex flex-col bg-white shadow-[0_-8px_30px_rgb(11_21_51/0.08)] lg:sticky lg:top-0 lg:h-screen lg:border-l lg:border-line lg:shadow-none"
      :class="chatOpen ? 'top-0' : 'rounded-t-[20px]'"
    >
      <button
        class="flex items-center gap-3 border-b border-line px-4 py-3.5 text-left lg:pointer-events-none"
        @click="chatOpen = !chatOpen"
      >
        <span class="grid size-10 place-items-center rounded-full bg-ink text-white"
          ><AppIcon name="chat"
        /></span>
        <span class="flex-1">
          <span class="block font-semibold">দোকানের সাথে কথা বলুন</span>
          <span class="block text-xs text-good">{{ typing ? 'লিখছে…' : 'অনলাইন' }}</span>
        </span>
        <span class="text-muted lg:hidden"
          ><AppIcon :name="chatOpen ? 'close' : 'next'" class="-rotate-90"
        /></span>
      </button>
      <div
        ref="log"
        class="flex-1 overflow-y-auto bg-cloud px-4 lg:flex lg:flex-col"
        :class="chatOpen ? 'flex flex-col' : 'hidden'"
      >
        <div class="flex flex-col gap-2.5 py-4">
          <p v-if="!lines.length" class="rounded-2xl bg-white px-4 py-3 text-sm text-muted">
            যেমন: “মেরুন কুর্তি XL আছে? চট্টগ্রামে ডেলিভারি কত?”
          </p>
          <div
            v-for="l in lines"
            :key="l.id"
            class="max-w-[85%] rounded-2xl px-3.5 py-2.5"
            :class="
              l.role === 'customer'
                ? 'self-end rounded-br-md bg-ink text-white'
                : 'self-start rounded-bl-md border border-line bg-white'
            "
          >
            <img v-if="l.imageUrl" :src="l.imageUrl" alt="" class="mb-1.5 max-h-72 rounded-xl" />
            <p v-if="l.text" class="leading-relaxed whitespace-pre-wrap">{{ l.text }}</p>
            <div v-if="l.quickReplies?.length" class="mt-2.5 flex flex-wrap gap-1.5">
              <button
                v-for="q in l.quickReplies"
                :key="q"
                class="rounded-full border border-ink/30 bg-sky px-3 py-1 text-sm text-ink hover:border-ink"
                @click="say(q)"
              >
                {{ q }}
              </button>
            </div>
          </div>
          <p v-if="typing" class="self-start rounded-2xl bg-white px-3.5 py-2 text-sm text-muted">
            লিখছে…
          </p>
        </div>
      </div>
      <form
        class="items-center gap-2 border-t border-line p-3"
        :class="chatOpen ? 'flex' : 'hidden lg:flex'"
        @submit.prevent="say(draft)"
      >
        <input
          v-model="draft"
          class="field rounded-full"
          placeholder="লিখুন…"
          aria-label="Message"
        />
        <button
          type="button"
          class="grid size-11 shrink-0 place-items-center rounded-full border transition-colors"
          :class="
            recording ? 'border-bad bg-bad text-white' : 'border-line text-muted hover:text-ink'
          "
          :aria-pressed="recording"
          :aria-label="recording ? 'থামান' : 'ভয়েস'"
          @click="toggleVoice"
        >
          <AppIcon :name="recording ? 'stop' : 'mic'" />
        </button>
        <button
          class="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-white disabled:opacity-40"
          :disabled="!draft.trim()"
          aria-label="পাঠান"
        >
          <AppIcon name="send" />
        </button>
      </form>
      <p v-if="error && chatOpen" class="px-4 pb-3 text-sm text-bad">{{ error }}</p>
    </aside>

    <div
      v-if="picked"
      class="fixed inset-0 z-40 flex items-end bg-night/50 md:items-center md:justify-center"
      @click.self="picked = null"
    >
      <section
        class="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 md:max-w-lg md:rounded-2xl md:p-6"
        role="dialog"
        :aria-label="picked.name"
      >
        <div class="flex items-start gap-4">
          <img
            v-if="picked.imageUrl"
            :src="picked.imageUrl"
            alt=""
            class="size-24 rounded-2xl object-cover"
          />
          <div class="flex-1">
            <h2 class="text-lg leading-snug font-semibold">{{ picked.name }}</h2>
            <p class="mt-1 text-2xl font-semibold text-ink">
              {{ formatTaka(pickedVariant?.pricePoisha ?? picked.pricePoisha) }}
            </p>
          </div>
          <button class="btn-ghost min-h-9 px-2" aria-label="বন্ধ করুন" @click="picked = null">
            <AppIcon name="close" />
          </button>
        </div>
        <div class="mt-5 flex flex-wrap gap-2">
          <button
            v-for="v in picked.variants"
            :key="v.id"
            :class="[
              order.variantId === v.id ? 'chip-on' : 'chip',
              !v.available && 'line-through opacity-40',
            ]"
            :disabled="!v.available"
            @click="order.variantId = v.id"
          >
            {{ variantLabel(v) }}
          </button>
        </div>

        <div v-if="!ordering" class="mt-6 grid grid-cols-2 gap-2">
          <button
            class="btn-primary min-h-12"
            :disabled="!order.variantId"
            @click="ordering = true"
          >
            অর্ডার করুন
          </button>
          <button class="btn-quiet min-h-12" @click="askAbout">জিজ্ঞেস করুন</button>
        </div>

        <form v-else class="mt-6 flex flex-col gap-3.5" @submit.prevent="placeOrder">
          <label class="block text-sm font-medium"
            >পরিমাণ<input
              v-model.number="order.qty"
              type="number"
              min="1"
              :max="pickedVariant?.available ?? 1"
              class="field mt-1.5 w-24 font-normal"
          /></label>
          <label class="block text-sm font-medium"
            >নাম<input
              v-model="order.name"
              required
              class="field mt-1.5 font-normal"
              autocomplete="name"
          /></label>
          <label class="block text-sm font-medium"
            >মোবাইল নম্বর<input
              v-model="order.phone"
              required
              class="field mt-1.5 font-normal"
              inputmode="tel"
              autocomplete="tel"
          /></label>
          <label class="block text-sm font-medium"
            >ঠিকানা<input
              v-model="order.address"
              required
              class="field mt-1.5 font-normal"
              autocomplete="street-address"
          /></label>
          <label class="block text-sm font-medium"
            >এলাকা / শহর<input
              v-model="order.area"
              required
              class="field mt-1.5 font-normal"
              placeholder="যেমন: মিরপুর, চট্টগ্রাম"
          /></label>
          <fieldset>
            <legend class="text-sm font-medium">পেমেন্ট</legend>
            <div class="mt-2 flex flex-wrap gap-2">
              <label
                v-for="m in shop.paymentMethods"
                :key="m"
                class="chip cursor-pointer has-checked:border-ink has-checked:bg-sky has-checked:text-ink"
                ><input v-model="order.paymentMethod" type="radio" :value="m" class="sr-only" />{{
                  methods[m] ?? m
                }}</label
              >
            </div>
          </fieldset>
          <p v-if="error" class="text-sm text-bad">{{ error }}</p>
          <button class="btn-primary mt-1 min-h-12 text-base">অর্ডার পাঠান</button>
        </form>
      </section>
    </div>
  </div>
</template>
