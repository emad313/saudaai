import { methodLabel } from '../agent/copy.ts'
import type { Db } from '../db/client.ts'
import { saveMedia } from '../media/store.ts'
import type { Shop } from '../tools/ctx.ts'
import { getOrder } from '../tools/orders.ts'
import { dhakaDate } from '../tools/text.ts'
import { esc, pdf, screenshot } from './browser.ts'

type OrderView = Awaited<ReturnType<typeof getOrder>>

const statusLabel: Record<string, string> = {
  draft: 'খসড়া / Draft',
  confirmed: 'কনফার্মড / Confirmed',
  shipped: 'পাঠানো হয়েছে / Shipped',
  delivered: 'ডেলিভারড / Delivered',
  cancelled: 'বাতিল / Cancelled',
}

export function invoiceHtml(shop: Shop, o: OrderView, width = 800) {
  const paid = o.duePoisha === 0
  const rows = o.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.product)}<div class="muted">${esc([l.size, l.color].filter(Boolean).join(' / '))}</div></td><td class="n">${l.qty}</td><td class="n">${esc(l.unitPrice)}</td><td class="n">${esc(l.lineTotal)}</td></tr>`,
    )
    .join('')
  return `<style>
  .inv{width:${width}px;padding:44px;background:#fff;color:#1c1917;font-size:18px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0f766e;padding-bottom:20px}
  h1{font-size:32px;color:#0f766e;font-weight:700}
  .muted{color:#78716c;font-size:15px}
  .tag{font-size:26px;font-weight:700;text-align:right}
  .grid{display:flex;justify-content:space-between;margin:24px 0}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th{text-align:left;font-size:15px;color:#78716c;font-weight:600;border-bottom:1px solid #e7e5e4;padding:10px 6px}
  td{padding:12px 6px;border-bottom:1px solid #f5f5f4;vertical-align:top}
  .n{text-align:right;white-space:nowrap}
  .sum{margin-left:auto;width:50%;margin-top:16px}
  .sum div{display:flex;justify-content:space-between;padding:6px 0}
  .total{font-size:24px;font-weight:700;border-top:2px solid #1c1917;margin-top:6px;padding-top:10px!important}
  .stamp{display:inline-block;margin-top:24px;padding:8px 18px;border-radius:999px;font-weight:700;font-size:17px;background:${paid ? '#dcfce7;color:#166534' : '#fef3c7;color:#92400e'}}
  .foot{margin-top:28px;font-size:15px;color:#78716c;text-align:center}
</style>
<div class="inv">
  <div class="top">
    <div><h1>${esc(shop.name)}</h1><div class="muted">${esc(shop.area)}${shop.bkashNumber ? ` · bKash ${esc(shop.bkashNumber)}` : ''}</div></div>
    <div class="tag">চালান / Invoice<div class="muted">#${o.number} · ${dhakaDate(o.createdAt)}</div></div>
  </div>
  <div class="grid">
    <div><div class="muted">গ্রাহক / Customer</div><div><b>${esc(o.customer.name)}</b></div><div>${esc(o.customer.phone ?? '')}</div><div>${esc(o.deliveryAddress ?? o.deliveryArea)}</div></div>
    <div style="text-align:right"><div class="muted">অবস্থা / Status</div><div>${esc(statusLabel[o.status] ?? o.status)}</div><div class="muted" style="margin-top:8px">পেমেন্ট / Payment</div><div>${esc(methodLabel(o.paymentMethod))}</div></div>
  </div>
  <table><thead><tr><th>পণ্য / Item</th><th class="n">পরিমাণ</th><th class="n">দাম</th><th class="n">মোট</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="sum">
    <div><span>সাবটোটাল / Subtotal</span><span>${esc(o.subtotal)}</span></div>
    <div><span>ডেলিভারি / Delivery</span><span>${esc(o.delivery)}</span></div>
    <div class="total"><span>মোট / Total</span><span>${esc(o.total)}</span></div>
    <div><span>পরিশোধিত / Paid</span><span>${esc(o.paid)}</span></div>
    <div><span><b>বাকি / Due</b></span><span><b>${esc(o.due)}</b></span></div>
  </div>
  <div class="stamp">${paid ? 'পরিশোধিত / PAID' : `বাকি ${esc(o.due)} / DUE`}</div>
  <div class="foot">ধন্যবাদ! Thank you for shopping with ${esc(shop.name)}.</div>
</div>`
}

export async function renderInvoice(db: Db, shop: Shop, orderId: string) {
  const order = await getOrder({ db, shop, actor: 'seller', now: Date.now() }, { orderId })
  const png = await screenshot(invoiceHtml(shop, order), { width: 800 })
  return saveMedia(db, png, 'image/png', { role: 'invoice' })
}

export async function invoicePdf(db: Db, shop: Shop, orderId: string) {
  const order = await getOrder({ db, shop, actor: 'seller', now: Date.now() }, { orderId })
  return pdf(invoiceHtml(shop, order, 520))
}
