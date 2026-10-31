<script setup lang="ts">
import { ref } from 'vue'
import { send } from '../api.ts'
import { useSession } from '../stores/session.ts'
import type { Pending } from '../types.ts'
import { when } from '../format.ts'

const props = defineProps<{ item: Pending }>()
const emit = defineEmits<{ decided: [] }>()
const session = useSession()

const editing = ref(false)
const text = ref(typeof props.item.args.text === 'string' ? props.item.args.text : '')
const busy = ref(false)
const error = ref('')

const kind: Record<string, string> = {
  send_order_confirmation: 'Confirm order',
  customer_reply: 'Reply to customer',
  record_payment: 'Payment',
  send_payment_reminder: 'Payment reminder',
  update_order_status: 'Cancel order',
  confirm_product: 'Publish product',
}

async function decide(action: 'approve' | 'cancel') {
  busy.value = true
  error.value = ''
  try {
    const res = await send<{ ok?: boolean; line?: string }>(
      `/api/pending/${props.item.id}`,
      'POST',
      {
        action,
        ...(action === 'approve' && editing.value ? { text: text.value } : {}),
      },
    )
    if (res && res.ok === false) error.value = res.line ?? 'Could not do it'
    else {
      session.pending = Math.max(0, session.pending - 1)
      emit('decided')
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="panel p-4 md:p-5">
    <div class="flex items-center justify-between gap-3">
      <span class="rounded-full bg-sky px-2.5 text-xs leading-6 font-medium text-ink">{{
        kind[item.tool] ?? item.tool
      }}</span>
      <span class="text-sm text-muted">{{ when(item.createdAt) }}</span>
    </div>
    <p v-if="!editing" class="mt-3 leading-relaxed whitespace-pre-wrap">{{ item.preview }}</p>
    <textarea
      v-else
      v-model="text"
      rows="4"
      class="field mt-3 py-2.5"
      aria-label="Reply text"
    ></textarea>
    <p v-if="error" class="mt-2 text-sm text-bad">{{ error }}</p>
    <div
      v-if="item.status === 'pending' && !session.me?.readonly"
      class="mt-4 flex flex-wrap gap-2"
    >
      <button class="btn-primary" :disabled="busy" @click="decide('approve')">
        {{ editing ? 'Send edited reply' : 'Approve' }}
      </button>
      <button
        v-if="'text' in item.args && !editing"
        class="btn-quiet"
        :disabled="busy"
        @click="editing = true"
      >
        Edit
      </button>
      <button class="btn-ghost" :disabled="busy" @click="decide('cancel')">Cancel</button>
    </div>
  </article>
</template>
