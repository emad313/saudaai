import type { Product } from './db.ts'

type Widget = { src: string; shop: string; product?: string } | null

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

const taka = (poisha: number) => `৳${(poisha / 100).toLocaleString('en-IN')}`

const priceOf = (p: Product) => Math.min(...p.variants.map((v) => v.pricePoisha))

const inStock = (p: Product) => p.variants.some((v) => v.stock === null || v.stock > 0)

// Drawn swatches instead of photos: the repo ships no product images it does not own.
function swatch(p: Product, size: number) {
  if (p.imageUrl) {
    return `<img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" width="${size}" height="${size}" style="object-fit:cover;aspect-ratio:1;width:100%;height:auto;display:block">`
  }
  const light = /^#(e|f|d)/i.test(p.color)
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${esc(p.name)}">
    <rect width="100" height="100" fill="${p.color}"/>
    <text x="50" y="62" text-anchor="middle" font-size="34" font-weight="600" fill="${light ? '#1d2630' : '#fff'}" opacity=".85">${esc(p.name.slice(0, 1))}</text>
  </svg>`
}

function page(title: string, body: string, widget: Widget) {
  const script = widget
    ? `<script src="${esc(widget.src)}" data-shop="${esc(widget.shop)}"${widget.product ? ` data-product="${esc(widget.product)}"` : ''} data-color="#1a8cf0" defer></script>`
    : ''
  return `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --ink: #1a8cf0; --night: #1d2630; --muted: #6b7785; --line: #e8ecf1; --cloud: #f6f8fa; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, 'Noto Sans Bengali', sans-serif; color: var(--night); background: var(--cloud); }
  a { color: inherit; text-decoration: none; }
  header { background: #fff; border-bottom: 1px solid var(--line); }
  .bar { max-width: 1080px; margin: 0 auto; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; }
  .brand { font-weight: 700; font-size: 20px; }
  .note { color: var(--muted); font-size: 13px; }
  main { max-width: 1080px; margin: 0 auto; padding: 24px 20px 96px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
  .card { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 20px rgb(69 90 100 / .08); }
  .card svg { display: block; width: 100%; height: auto; }
  .card div { padding: 12px 14px; }
  .price { color: var(--ink); font-weight: 600; }
  .out { color: #e04b4b; font-size: 13px; }
  .detail { display: grid; gap: 24px; grid-template-columns: minmax(0, 1fr); background: #fff; border-radius: 12px; padding: 20px; }
  @media (min-width: 760px) { .detail { grid-template-columns: 360px 1fr; } }
  .detail svg { width: 100%; height: auto; border-radius: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  .chip { border: 1px solid var(--line); border-radius: 8px; padding: 4px 10px; font-size: 14px; }
  .chip.off { opacity: .4; text-decoration: line-through; }
  .ask { background: #e8f4fe; color: var(--ink); border-radius: 10px; padding: 12px 14px; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; margin-bottom: 24px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); font-size: 14px; }
  input { width: 80px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; }
  .buy { display: grid; gap: 10px; margin: 16px 0; max-width: 460px; }
  .buy label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
  .buy input, .buy select { width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; font: inherit; color: var(--night); background: #fff; }
  .buy .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .buy button { padding: 11px; font-size: 15px; font-weight: 600; border-radius: 8px; }
  button { background: var(--ink); color: #fff; border: 0; border-radius: 6px; padding: 5px 10px; cursor: pointer; }
</style>
</head>
<body>
<header><div class="bar"><a class="brand" href="/">Nusrat's Closet</a><span class="note">Demo store for SaudaAI. Chat with the shop at the bottom right.</span></div></header>
<main>${body}</main>
${script}
</body>
</html>`
}

export function shopPage(products: Product[], widget: Widget) {
  const cards = products
    .map(
      (p) => `<a class="card" href="/p/${encodeURIComponent(p.id)}">${swatch(p, 200)}<div>
        <div>${esc(p.name)}</div>
        <div class="price">${taka(priceOf(p))}</div>
        ${inStock(p) ? '' : '<div class="out">Out of stock</div>'}
      </div></a>`,
    )
    .join('')
  return page("Nusrat's Closet", `<div class="grid">${cards}</div>`, widget)
}

export function productPage(p: Product, widget: Widget) {
  const options = p.variants
    .filter((v) => v.stock === null || v.stock > 0)
    .map(
      (v) =>
        `<option value="${esc(v.id)}">${esc([v.size, v.color].filter(Boolean).join(' / ') || 'One size')} - ${taka(v.pricePoisha)}</option>`,
    )
    .join('')
  const chips = p.variants
    .map((v) => {
      const label = [v.size, v.color].filter(Boolean).join(' / ') || 'One size'
      const off = v.stock !== null && v.stock <= 0
      return `<span class="chip${off ? ' off' : ''}">${esc(label)}</span>`
    })
    .join('')
  return page(
    `${p.name} - Nusrat's Closet`,
    `<p><a class="note" href="/">All products</a></p>
    <div class="detail">${swatch(p, 360)}<div>
      <h1 style="margin:0 0 4px">${esc(p.name)}</h1>
      <div class="price" style="font-size:22px">${taka(priceOf(p))}</div>
      <p>${esc(p.description)}</p>
      <div class="chips">${chips}</div>
      <form class="buy" method="post" action="/checkout">
        <div class="pair">
          <label>Size / colour<select name="variant" required>${options}</select></label>
          <label>Quantity<input name="qty" type="number" min="1" value="1" required></label>
        </div>
        <label>Name<input name="name" autocomplete="name" required></label>
        <label>Mobile<input name="phone" inputmode="tel" autocomplete="tel" required></label>
        <label>Address<input name="address" autocomplete="street-address" required></label>
        <div class="pair">
          <label>Area<input name="area" placeholder="Mirpur, Chattogram"></label>
          <label>Delivery<select name="zone"><option value="inside">Inside Dhaka ৳60</option><option value="outside">Outside Dhaka ৳120</option></select></label>
        </div>
        <label>Payment<select name="payment"><option value="cod">Cash on delivery</option><option value="bkash">bKash</option></select></label>
        <button>Order now</button>
      </form>
      <p class="ask">Questions first? Ask in the chat at the bottom right, in Bangla, Banglish or English, by text or voice.</p>
    </div></div>`,
    widget,
  )
}

export function adminPage(products: Product[], orders: Record<string, unknown>[], key: string) {
  const rows = products
    .flatMap((p) =>
      p.variants.map(
        (
          v,
        ) => `<tr><td>${esc(p.name)}</td><td>${esc([v.size, v.color].filter(Boolean).join(' / '))}</td>
        <td colspan="2"><form method="post" action="/admin/variant?key=${encodeURIComponent(key)}" style="display:flex;gap:6px;align-items:center">
          <input type="hidden" name="id" value="${esc(v.id)}">
          ৳<input name="taka" value="${v.pricePoisha / 100}" inputmode="numeric" aria-label="Price in taka">
          <input name="stock" value="${v.stock ?? ''}" inputmode="numeric" aria-label="Stock, empty for untracked">
          <button>Save</button></form></td></tr>`,
      ),
    )
    .join('')
  const list = orders
    .map((o) => {
      const customer = JSON.parse(String(o.customer)) as { name: string }
      return `<tr id="${esc(String(o.number))}"><td>${esc(String(o.number))}</td><td>${esc(customer.name)}</td><td>${taka(Number(o.total_poisha))}</td><td>${taka(Number(o.paid_poisha))} paid</td><td>${esc(String(o.status))}</td><td>${esc(String(o.tags))}</td></tr>`
    })
    .join('')
  return page(
    'Store admin',
    `<h2>Orders</h2><table><tr><th>Order</th><th>Customer</th><th>Total</th><th>Paid</th><th>Status</th><th>Tags</th></tr>${list || '<tr><td colspan="6">No orders yet.</td></tr>'}</table>
    <h2>Price and stock</h2><p class="note">Saving sends the change to SaudaAI right away.</p>
    <table><tr><th>Product</th><th>Variant</th><th colspan="2">Price, stock</th></tr>${rows}</table>`,
    null,
  )
}

export function messagePage(text: string) {
  return page(
    "Nusrat's Closet",
    `<div class="detail" style="display:block"><p style="font-size:17px;margin:0">${esc(text)}</p><p><a class="note" href="/">Back to the shop</a></p></div>`,
    null,
  )
}
