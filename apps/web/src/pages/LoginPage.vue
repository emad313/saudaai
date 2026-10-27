<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { send } from '../api.ts'
import { useSession } from '../stores/session.ts'

const code = ref('')
const error = ref('')
const busy = ref(false)
const route = useRoute()
const router = useRouter()
const session = useSession()

async function submit() {
  busy.value = true
  error.value = ''
  try {
    await send('/api/auth/code', 'POST', { code: code.value.trim() })
    await session.load()
    router.replace(String(route.query.next ?? '/'))
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen flex-col md:flex-row">
    <section
      class="flex flex-col justify-end bg-khata px-6 pt-16 pb-10 text-white md:w-[44%] md:px-14 md:pb-16"
    >
      <p class="font-ledger text-5xl leading-tight md:text-6xl">সওদা</p>
      <p class="mt-4 max-w-sm text-lg text-white/85">
        The back office for shops that run on Facebook and WhatsApp. Talk to it in Bangla; it keeps
        the khata.
      </p>
    </section>
    <section class="flex flex-1 items-center px-6 py-12 md:px-16">
      <form class="w-full max-w-sm" @submit.prevent="submit">
        <h1 class="text-2xl font-semibold">Log in</h1>
        <p class="mt-2 text-muted">
          Send <b class="text-ink">/login</b> to your SaudaAI bot on Telegram and type the code it
          gives you.
        </p>
        <label class="mt-8 block text-sm font-medium" for="code">Code</label>
        <input
          id="code"
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          class="field mt-1 h-14 text-center font-ledger text-3xl tracking-[0.4em]"
        />
        <p v-if="error" class="mt-2 text-sm text-khata">{{ error }}</p>
        <button class="btn-primary mt-5 w-full" :disabled="busy || code.length !== 6">
          Log in
        </button>
        <p class="mt-10 text-sm text-muted">
          Just looking?
          <RouterLink to="/s/nusrats-closet" class="text-khata underline"
            >Chat with the demo shop</RouterLink
          >
          as a customer.
        </p>
      </form>
    </section>
  </main>
</template>
