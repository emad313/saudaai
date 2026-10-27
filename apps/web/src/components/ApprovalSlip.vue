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
  <article
    class="border-l-4 border-khata bg-white py-3 pr-3 pl-4 shadow-[0_1px_0_var(--color-rule)]"
  >
    <div class="flex items-baseline justify-between gap-3 text-sm text-muted">
      <span class="font-medium text-ink">{{ kind[item.tool] ?? item.tool }}</span>
      <span>{{ when(item.createdAt) }}</span>
    </div>
    <p v-if="!editing" class="mt-1.5 whitespace-pre-wrap">{{ item.preview }}</p>
    <textarea
      v-else
      v-model="text"
      rows="4"
      class="field mt-2 py-2"
      aria-label="Reply text"
    ></textarea>
    <p v-if="error" class="mt-2 text-sm text-khata">{{ error }}</p>
    <div
      v-if="item.status === 'pending' && !session.me?.readonly"
      class="mt-3 flex flex-wrap gap-2"
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
      <button class="btn-quiet" :disabled="busy" @click="decide('cancel')">Cancel</button>
    </div>
  </article>
</template>
