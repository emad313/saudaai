<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { send } from '../api.ts'
import { useSession } from '../stores/session.ts'

const session = useSession()
const saved = ref(false)
const error = ref('')
const form = ref({
  name: '',
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
})

function fill() {
  const me = session.me
  if (!me) return
  form.value = {
    name: me.name,
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
  }
}

async function save() {
  saved.value = false
  error.value = ''
  const f = form.value
  try {
    await send('/api/shop', 'PATCH', {
      name: f.name,
      area: f.area,
      bkashNumber: f.bkashNumber || null,
      paymentMethods: f.paymentMethods,
      insideDhakaTaka: f.insideDhakaTaka,
      outsideDhakaTaka: f.outsideDhakaTaka,
      autoConfirmUpToTaka: f.autoConfirm ? f.autoConfirmUpToTaka : null,
      autoSendConfirmation: f.autoSendConfirmation,
      autoSendReminders: f.autoSendReminders,
      feedMuted: f.feedMuted,
    })
    await session.load()
    saved.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(fill)
const shopLink = () => `${location.origin}/s/${session.me?.slug}`
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
    <form class="flex flex-col gap-6 lg:order-1" @submit.prevent="save">
      <section class="panel">
        <h2 class="card-head">Shop</h2>
        <div class="flex flex-col gap-4 p-5 md:p-6">
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block text-sm font-medium"
              >Shop name<input v-model="form.name" class="field mt-1.5 font-normal"
            /></label>
            <label class="block text-sm font-medium"
              >Area<input v-model="form.area" class="field mt-1.5 font-normal"
            /></label>
          </div>
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
              >Delivery inside Dhaka (৳)<input
                v-model.number="form.insideDhakaTaka"
                type="number"
                min="0"
                class="field mt-1.5 font-normal"
            /></label>
            <label class="block text-sm font-medium"
              >Outside Dhaka (৳)<input
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
                >Up to ৳<input
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

    <aside class="flex flex-col gap-4 lg:order-2">
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
        <h2 class="card-head">Shop chat link</h2>
        <div class="px-5 pb-5">
          <a
            :href="shopLink()"
            class="mt-1.5 block text-sm font-medium break-all text-ink hover:underline"
            target="_blank"
            >{{ shopLink() }}</a
          >
          <p class="mt-2 text-sm text-muted">
            Put this in your Page bio. Customers can chat, send voice notes and order here.
          </p>
        </div>
      </section>
    </aside>
  </div>
</template>
