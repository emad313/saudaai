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
</script>

<template>
  <h1 class="text-2xl font-semibold">Settings</h1>

  <section class="mt-6 max-w-xl bg-white p-5">
    <h2 class="font-semibold">Telegram</h2>
    <p v-if="session.me?.telegramLinked" class="mt-1 text-leaf">
      Linked. Voice notes and approvals arrive in your bot.
    </p>
    <p v-else-if="session.me?.linkCode" class="mt-1">
      Open your SaudaAI bot and send
      <code class="bg-paper px-1.5 py-0.5">/start {{ session.me.linkCode }}</code>
    </p>
    <h2 class="mt-5 font-semibold">Shop chat link</h2>
    <p class="mt-1 break-all">
      <a :href="shopLink()" class="text-khata underline" target="_blank">{{ shopLink() }}</a>
    </p>
    <p class="text-sm text-muted">
      Put this in your Page bio. Customers can chat, send voice notes and order here.
    </p>
  </section>

  <form class="mt-6 flex max-w-xl flex-col gap-4" @submit.prevent="save">
    <label class="block">Shop name<input v-model="form.name" class="field mt-1" /></label>
    <label class="block">Area<input v-model="form.area" class="field mt-1" /></label>
    <label class="block"
      >bKash / Nagad number<input v-model="form.bkashNumber" class="field mt-1" inputmode="tel"
    /></label>
    <fieldset>
      <legend>Payment methods</legend>
      <div class="mt-1 flex gap-4">
        <label v-for="m in ['cod', 'bkash', 'nagad']" :key="m" class="flex items-center gap-2"
          ><input v-model="form.paymentMethods" type="checkbox" :value="m" />{{
            { cod: 'Cash on delivery', bkash: 'bKash', nagad: 'Nagad' }[m]
          }}</label
        >
      </div>
    </fieldset>
    <div class="grid grid-cols-2 gap-3">
      <label class="block"
        >Delivery inside Dhaka (৳)<input
          v-model.number="form.insideDhakaTaka"
          type="number"
          min="0"
          class="field mt-1"
      /></label>
      <label class="block"
        >Outside Dhaka (৳)<input
          v-model.number="form.outsideDhakaTaka"
          type="number"
          min="0"
          class="field mt-1"
      /></label>
    </div>

    <fieldset class="mt-2 border-t border-rule pt-4">
      <legend class="font-semibold">What the assistant may do without asking</legend>
      <p class="text-sm text-muted">Everything else waits for your tap.</p>
      <label class="mt-3 flex items-center gap-2"
        ><input v-model="form.autoConfirm" type="checkbox" />Confirm customer orders up to</label
      >
      <input
        v-if="form.autoConfirm"
        v-model.number="form.autoConfirmUpToTaka"
        type="number"
        min="1"
        class="field mt-1 w-40"
        aria-label="Maximum order in taka"
      />
      <label class="mt-3 flex items-center gap-2"
        ><input v-model="form.autoSendConfirmation" type="checkbox" />Confirm every order and send
        the invoice</label
      >
      <label class="mt-3 flex items-center gap-2"
        ><input v-model="form.autoSendReminders" type="checkbox" />Send payment reminders</label
      >
      <label class="mt-3 flex items-center gap-2"
        ><input v-model="form.feedMuted" type="checkbox" />Stop telling me every customer reply on
        Telegram</label
      >
    </fieldset>

    <div class="flex items-center gap-3">
      <button class="btn-primary" :disabled="session.me?.readonly">Save settings</button>
      <span v-if="saved" class="text-leaf">Saved</span>
      <span v-if="error" class="text-khata">{{ error }}</span>
    </div>
  </form>
</template>
