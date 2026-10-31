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
  <main class="flex min-h-screen flex-col bg-white md:flex-row">
    <section
      class="relative flex flex-col justify-between overflow-hidden bg-ink px-6 pt-10 pb-10 text-white md:w-[46%] md:px-14 md:py-14"
    >
      <span class="font-semibold">SaudaAI</span>
      <div class="mt-16 md:mt-0">
        <p class="text-7xl leading-none font-semibold md:text-8xl">সওদা</p>
        <p class="mt-6 max-w-sm text-lg leading-relaxed text-white/80">
          The back office for shops that run on Facebook and WhatsApp. Talk to it in Bangla, and it
          keeps the khata for you.
        </p>
      </div>
    </section>
    <section class="flex flex-1 items-center justify-center px-6 py-12 md:px-16">
      <form class="w-full max-w-sm" @submit.prevent="submit">
        <h1 class="page-title">Log in</h1>
        <p class="mt-3 leading-relaxed text-muted">
          Send <b class="font-semibold text-night">/login</b> to your SaudaAI bot on Telegram, then
          type the 6-digit code it gives you.
        </p>
        <label class="mt-8 block text-sm font-medium" for="code">Code</label>
        <input
          id="code"
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          class="field mt-2 h-16 text-center text-3xl font-semibold tracking-[0.35em]"
        />
        <p v-if="error" class="mt-2 text-sm text-bad">{{ error }}</p>
        <button
          class="btn-primary mt-5 min-h-12 w-full text-base"
          :disabled="busy || code.length !== 6"
        >
          Log in
        </button>
        <p class="mt-10 text-sm text-muted">
          Just looking?
          <RouterLink to="/s/nusrats-closet" class="font-medium text-ink hover:underline"
            >Chat with the demo shop</RouterLink
          >
          as a customer.
        </p>
      </form>
    </section>
  </main>
</template>
