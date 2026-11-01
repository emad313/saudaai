<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { send } from '../api.ts'
import StoreConnect from '../components/StoreConnect.vue'
import { currencies } from '@saudaai/shared'
import { currencySymbol } from '../format.ts'
import { useSession } from '../stores/session.ts'

const session = useSession()
const saved = ref(false)
const error = ref('')
const form = ref({
  name: '',
  ownerName: '',
  area: '',
  bkashNumber: '',
  paymentMethods: [] as string[],
  insideDhakaTaka: 0,
  outsideDhakaTaka: 0,
  autoConfirm: false,
  autoConfirmUpToTaka: 2000,
  autoSendConfirmation: false,
  autoSendReminders: false,
  feedMuted: false,
  currency: 'BDT',
})

function fill() {
  const me = session.me
  if (!me) return
  form.value = {
    name: me.name,
    ownerName: me.ownerName,
    area: me.area,
    bkashNumber: me.bkashNumber ?? '',
    paymentMethods: [...me.paymentMethods],
    insideDhakaTaka: me.deliveryRules.insideDhakaPoisha / 100,
    outsideDhakaTaka: me.deliveryRules.outsideDhakaPoisha / 100,
    autoConfirm: Boolean(me.auto.confirm_order),
    autoConfirmUpToTaka: (me.auto.confirm_order?.maxPoisha ?? 200000) / 100,
    autoSendConfirmation: Boolean(me.auto.send_order_confirmation),
    autoSendReminders: Boolean(me.auto.send_payment_reminder),
    feedMuted: me.feedMuted,
    currency: me.currency,
  }
}

async function save() {
  saved.value = false
  error.value = ''
  const f = form.value
  try {
    await send('/api/shop', 'PATCH', {
      name: f.name,
      ownerName: f.ownerName,
      area: f.area,
      bkashNumber: f.bkashNumber || null,
      paymentMethods: f.paymentMethods,
      insideDhakaTaka: f.insideDhakaTaka,
      outsideDhakaTaka: f.outsideDhakaTaka,
      autoConfirmUpToTaka: f.autoConfirm ? f.autoConfirmUpToTaka : null,
      autoSendConfirmation: f.autoSendConfirmation,
      autoSendReminders: f.autoSendReminders,
      feedMuted: f.feedMuted,
      ...(session.me?.storeConnected ? {} : { currency: f.currency }),
    })
    await session.load()
    saved.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(fill)
const copied = ref(false)
const snippet = computed(() => session.me?.widgetSnippetShopify ?? session.me?.widgetSnippet ?? '')
async function copySnippet() {
  await navigator.clipboard.writeText(snippet.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}
const methods = { cod: 'Cash on delivery', bkash: 'bKash', nagad: 'Nagad' }
const switches = [
  { key: 'autoConfirm', label: 'Confirm customer orders up to an amount' },
  { key: 'autoSendConfirmation', label: 'Confirm every order and send the invoice' },
  { key: 'autoSendReminders', label: 'Send payment reminders' },
  { key: 'feedMuted', label: 'Stop telling me every customer reply on Telegram' },
] as const
</script>

<template>
  <h1 class="page-title">Settings</h1>

  <div
    class="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
  >
    <div class="flex flex-col gap-6 lg:order-1">
      <StoreConnect />
      <form class="flex flex-col gap-6" @submit.prevent="save">
        <section class="panel">
          <h2 class="card-head">Shop</h2>
          <div class="flex flex-col gap-4 p-5 md:p-6">
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="block text-sm font-medium"
                >Shop name<input v-model="form.name" class="field mt-1.5 font-normal"
              /></label>
              <label class="block text-sm font-medium"
                >Owner name<input v-model="form.ownerName" class="field mt-1.5 font-normal"
              /></label>
              <label class="block text-sm font-medium"
                >Area<input v-model="form.area" class="field mt-1.5 font-normal"
              /></label>
            </div>
            <label class="block text-sm font-medium"
              >Currency
              <select
                v-model="form.currency"
                class="field mt-1.5 font-normal"
                :disabled="session.me?.storeConnected"
              >
                <option v-for="c in currencies" :key="c" :value="c">{{ c }}</option>
              </select>
              <span
                v-if="session.me?.storeConnected"
                class="mt-1 block text-xs font-normal text-muted"
                >Comes from your connected store.</span
              ></label
            >
            <label class="block text-sm font-medium"
              >bKash / Nagad number<input
                v-model="form.bkashNumber"
                class="field mt-1.5 font-normal"
                inputmode="tel"
            /></label>
            <fieldset>
              <legend class="text-sm font-medium">Payment methods</legend>
              <div class="mt-2 flex flex-wrap gap-2">
                <label
                  v-for="(name, m) in methods"
                  :key="m"
                  class="chip cursor-pointer has-checked:border-ink has-checked:bg-sky has-checked:text-ink"
                  ><input
                    v-model="form.paymentMethods"
                    type="checkbox"
                    :value="m"
                    class="sr-only"
                  />{{ name }}</label
                >
              </div>
            </fieldset>
            <div class="grid grid-cols-2 gap-4">
              <label class="block text-sm font-medium"
                >Delivery inside Dhaka ({{ currencySymbol() }})<input
                  v-model.number="form.insideDhakaTaka"
                  type="number"
                  min="0"
                  class="field mt-1.5 font-normal"
              /></label>
              <label class="block text-sm font-medium"
                >Outside Dhaka ({{ currencySymbol() }})<input
                  v-model.number="form.outsideDhakaTaka"
                  type="number"
                  min="0"
                  class="field mt-1.5 font-normal"
              /></label>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2 class="card-head">What the assistant may do without asking</h2>
          <div class="px-5 pb-3 md:px-6">
            <p class="mt-4 text-sm text-muted">Everything else waits for your tap.</p>
            <div class="mt-4 flex flex-col divide-y divide-line">
              <div v-for="s in switches" :key="s.key" class="py-3">
                <label class="flex cursor-pointer items-center justify-between gap-4">
                  <span>{{ s.label }}</span>
                  <input v-model="form[s.key]" type="checkbox" class="peer sr-only" />
                  <span
                    class="relative h-6 w-11 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-ink peer-focus-visible:ring-4 peer-focus-visible:ring-ink/20 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
                  ></span>
                </label>
                <label
                  v-if="s.key === 'autoConfirm' && form.autoConfirm"
                  class="mt-3 flex items-center gap-2 text-sm text-muted"
                  >Up to {{ currencySymbol()
                  }}<input
                    v-model.number="form.autoConfirmUpToTaka"
                    type="number"
                    min="1"
                    class="field w-36 text-night"
                    aria-label="Maximum order in taka"
                /></label>
              </div>
            </div>
          </div>
        </section>

        <div class="flex items-center gap-3">
          <button class="btn-primary min-h-11 px-6" :disabled="session.me?.readonly">
            Save settings
          </button>
          <span v-if="saved" class="text-sm font-medium text-good">Settings saved</span>
          <span v-if="error" class="text-sm text-bad">{{ error }}</span>
        </div>
      </form>
    </div>

    <aside class="flex flex-col gap-4 lg:order-2">
      <section v-if="session.me?.ai" class="panel">
        <h2 class="card-head">
          AI models
          <span class="text-xs font-normal text-muted">{{ session.me.ai.provider }}</span>
        </h2>
        <div v-for="m in session.me.ai.models" :key="m.job" class="row py-2.5">
          <span class="text-sm text-muted">{{ m.job }}</span>
          <code class="rounded bg-sky px-1.5 py-0.5 text-xs text-ink">{{
            m.model ?? 'not set'
          }}</code>
        </div>
        <div class="px-5 py-3 text-sm text-muted">
          Model calls today:
          <b class="text-night">{{ session.me.ai.callsToday }}</b> of
          {{ session.me.ai.dailyLimit }}
          <div class="mt-2 h-1.5 rounded-full bg-cloud">
            <div
              class="h-full rounded-full bg-ink"
              :style="{
                width: `${Math.min(100, (session.me.ai.callsToday / session.me.ai.dailyLimit) * 100)}%`,
              }"
            ></div>
          </div>
          <p class="mt-2 text-xs">Models and the daily limit are set in the server's .env.</p>
        </div>
      </section>
      <section class="panel">
        <h2 class="card-head">Telegram</h2>
        <div class="px-5 pb-5">
          <p v-if="session.me?.telegramLinked" class="mt-1.5 text-sm text-good">
            Linked. Voice notes and approvals arrive in your bot.
          </p>
          <p v-else-if="session.me?.linkCode" class="mt-1.5 text-sm leading-relaxed text-muted">
            Open your SaudaAI bot and send
            <code class="rounded-md bg-sky px-1.5 py-0.5 text-ink"
              >/start {{ session.me.linkCode }}</code
            >
          </p>
          <p v-else class="mt-1.5 text-sm text-muted">
            Not linked. Run the seed script to get a link code for this shop.
          </p>
        </div>
      </section>
      <section class="panel">
        <h2 class="card-head">
          Website chat
          <button type="button" class="btn-ghost min-h-8 px-2 text-sm" @click="copySnippet">
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </h2>
        <div class="px-5 pb-5">
          <pre
            class="mt-3 overflow-x-auto rounded-lg bg-night p-3 text-xs leading-relaxed whitespace-pre-wrap text-white/90"
            >{{ snippet }}</pre>
          <p v-if="session.me?.widgetSnippetShopify" class="mt-2 text-sm text-muted">
            In Shopify open Online Store, Themes, Edit code, <code>layout/theme.liquid</code>, and
            paste this just before &lt;/body&gt;. On product pages the assistant then knows which
            product the customer is looking at.
          </p>
          <p v-else class="mt-2 text-sm text-muted">
            Paste this before &lt;/body&gt; on your website (WooCommerce: a footer code plugin).
            Customers can then chat, send voice notes and order from any page.
          </p>
          <p
            v-if="session.me && !session.me.publicUrl.startsWith('https://')"
            class="mt-2 text-sm text-warn"
          >
            SaudaAI runs on {{ session.me.publicUrl }}, which other sites cannot reach. Deploy it on
            a public https address before adding the chat to a live store.
          </p>
          <RouterLink to="/docs/guide" class="mt-2 inline-block text-sm font-medium text-ink"
            >Step-by-step guide</RouterLink
          >
        </div>
      </section>
      <section v-if="session.me?.channels" class="panel">
        <h2 class="card-head">Channels</h2>
        <div v-for="ch in session.me.channels" :key="ch.name" class="row py-2.5">
          <span class="text-sm">{{ ch.name }}</span>
          <span class="text-sm" :class="ch.on ? 'text-good' : 'text-muted'">{{
            ch.on ? 'Connected' : 'Not set up'
          }}</span>
        </div>
        <p class="px-5 py-3 text-xs text-muted">
          Channels are connected with keys in the server's .env;
          <RouterLink to="/docs/guide" class="text-ink">see the guide</RouterLink>.
        </p>
      </section>
    </aside>
  </div>
</template>
