<script setup lang="ts">
import { onMounted, ref } from 'vue'

const status = ref<'checking' | 'up' | 'down'>('checking')

onMounted(async () => {
  const res = await fetch('/api/health').catch(() => null)
  status.value = res?.ok ? 'up' : 'down'
})
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4">
    <h1 class="text-4xl font-semibold text-brand">SaudaAI</h1>
    <p class="text-lg text-gray-700">ভয়েস নোটে দোকান চালান। Run your shop by voice.</p>
    <p class="flex items-center gap-2 text-sm text-gray-500">
      <span
        class="inline-block size-2 rounded-full"
        :class="{
          'bg-gray-400': status === 'checking',
          'bg-green-500': status === 'up',
          'bg-red-500': status === 'down',
        }"
      ></span>
      server {{ status }}
    </p>
  </main>
</template>
