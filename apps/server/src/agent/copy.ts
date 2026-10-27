import type { getOrder } from '../tools/orders.ts'

type OrderView = Awaited<ReturnType<typeof getOrder>>

const methods: Record<string, string> = {
  cod: 'ক্যাশ অন ডেলিভারি',
  bkash: 'বিকাশ',
  nagad: 'নগদ',
}

export const methodLabel = (m: string) => methods[m] ?? m

export function lineLabel(l: OrderView['lines'][number]) {
  return `${l.qty} x ${[l.product, l.size, l.color].filter(Boolean).join(' ')}`
}

export function confirmationText(shopName: string, o: OrderView) {
  return [
    `আপনার অর্ডার #${o.number} কনফার্ম হয়েছে।`,
    ...o.lines.map((l) => `${lineLabel(l)} - ${l.lineTotal}`),
    `ডেলিভারি চার্জ: ${o.delivery}`,
    `মোট: ${o.total}`,
    `পেমেন্ট: ${methodLabel(o.paymentMethod)}`,
    `ধন্যবাদ, ${shopName}`,
  ].join('\n')
}

export function reminderText(shopName: string, bkash: string | null, o: OrderView) {
  return [
    `প্রিয় ${o.customer.name}, অর্ডার #${o.number} এর ${o.due} পেমেন্ট বাকি আছে।`,
    bkash ? `বিকাশ/নগদ: ${bkash}` : null,
    `পেমেন্ট করে জানালে খুশি হব। ধন্যবাদ, ${shopName}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export const holdingReply = 'একটু অপেক্ষা করুন, দোকান থেকে কনফার্ম করে জানাচ্ছি।'
export const handoffReply = 'দোকানের মালিক শীঘ্রই আপনাকে উত্তর দেবেন। ধন্যবাদ।'
export const orderReceivedReply = (n: number) =>
  `অর্ডার #${n} পেয়েছি। দোকান থেকে কনফার্ম করে ইনভয়েস পাঠানো হবে।`
export const retryReply = 'দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার লিখুন।'
export const cancelledReply = (n: number) =>
  `দুঃখিত, অর্ডার #${n} এই মুহূর্তে কনফার্ম করা যাচ্ছে না। দোকানের মালিক আপনার সাথে যোগাযোগ করবেন।`
