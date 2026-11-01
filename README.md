# SaudaAI

**One AI employee for every place a small business sells and talks, whatever store it uses.**

_Sauda_ (সওদা) is the everyday Bangla word for buying and selling.

Millions of small sellers in Bangladesh, India, Indonesia and across Africa run real businesses through Facebook pages, WhatsApp and a small online store. Customers ask the same questions all day on five different apps, orders get typed in twice, stock in the store drifts from stock in the notebook, and the seller is often more comfortable talking than typing.

SaudaAI is not another store. It connects to the store the seller already has (Shopify, WooCommerce, or any custom site through the SaudaAI Store API; a built-in catalog for sellers with no site at all) and to every place customers chat: Messenger, WhatsApp, Instagram DM and a chat widget on the seller's website. The AI answers customers in Bangla, takes orders into the store, keeps stock and payments straight, sends invoices and reminders, and makes ads. The owner runs it by voice or text from Telegram or the dashboard, approves anything that commits the shop or touches money, and sees everything plus analytics in one place.

> Seller, voice note on Telegram: _"Rahim bhai 2 ta kalo t-shirt nibe, L size, Mirpur 10 e delivery, bikash e pay korbe"_
>
> SaudaAI: re-reads the live price and stock from the store, drafts order #1043 for Rahim Uddin with ৳60 Dhaka delivery, and asks for one tap. On approval the order is created in the store, tagged `saudaai`, and Rahim gets the confirmation and a Bangla invoice on his WhatsApp.

Built with Meta's models for the Meta Global AI Developer Hackathon (Indie Developer track, "Build for Your World").

## What it does

**Connects to the seller's store**

- **Shopify** (Admin GraphQL), **WooCommerce** (REST v3), **any custom site** (SaudaAI Store API, below), or the **built-in catalog**. Connect from Settings: paste credentials, SaudaAI tests the connection, syncs the catalog and, on Shopify and WooCommerce, registers its own webhooks.
- The store stays the source of truth. Products, prices, stock, images and orders come from it, including orders customers place on the website itself (imported by webhook and on every sync, and announced to the owner). Before any order SaudaAI re-reads the live price and stock; an order taken in chat is created in the store when it is confirmed, and the store's total is compared with ours.
- Photo to product creates a draft in the store; one tap publishes it.

**Answers customers everywhere**

- Messenger, WhatsApp, Instagram DM and a website chat widget, in Bangla, Banglish or English, by text, voice note or photo.
- Price, sizes, stock, delivery charge, order status and product photos are answered directly from shop data. On a product page the widget tells the assistant which product the customer is looking at.
- Orders are taken inside the chat and confirmed by the shop; the invoice comes back on the same channel.

**Works for the owner**

- **Voice to action** on Telegram or the dashboard command box: orders, stock, payments, expenses, questions about the business.
- **Approvals**: confirming orders, payments, cancellations, reminders and anything held for review arrive as Approve / Edit / Cancel, on Telegram and in the dashboard. Small orders can confirm themselves if the owner allows it.
- **Ad creatives** with the sale price computed in code and Bangla text rendered properly.
- **Daily summary, payment reminders, live feed and chat takeover.**
- **Analytics**: sales by day, channel and product; how the assistant did (reply time, handoffs, chat-to-order); what customers asked for, what they wanted that the shop does not list, and sold-out asks; model cost. The same numbers answer questions like _"ei soptahe kon channel theke beshi sell?"_.

## Meta models

| Model                                   | Used for                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| Muse Spark (Meta Model API)             | Agent planner with tool calling, the default brain; vision for product photos |
| Muse Voice Transcribe (Meta Model API)  | Seller and customer voice notes (Bangla mixed with English)                   |
| SAM 3.1 (Meta Model API)                | Cutting the product out of messy phone photos                                 |
| Muse Image (Meta Model API)             | Scenes behind the product in ad creatives                                     |
| Muse Spark Open (via Baseten, optional) | Open-weight alternative for the agent brain (`AGENT_PROVIDER=baseten`)        |

Muse Spark on the Meta Model API is the default agent brain. Muse Spark Open via Baseten is a supported alternative for the agent brain only; transcription, vision, SAM and image generation always use the Meta Model API. Model calls are cached by content hash and capped per day (`MODEL_DAILY_CALL_LIMIT`).

## How it works

```
 Owner (Telegram | dashboard)      Customers (Messenger | WhatsApp | Instagram | website widget)
        |                                        |
        |                   /webhooks/meta, /api/w (signatures and sessions checked)
        +---------------> inbox <----------------+
                 dedup, rate limit, one queue per shop
        voice -> Voice Transcribe      photo -> SAM 3.1 + Muse Spark vision
                            |
                 agent loop, up to 6 steps (Muse Spark)
                            |
             proposed tool calls, validated with zod
                            |
           policy: run | ask the owner | refuse
                            |
     TypeScript tools, money in poisha  <-->  store connector (Shopify | WooCommerce | custom | built-in)
                            |                         ^
         verification + activity log          /webhooks/store + 30 min pull
```

Rules that keep the assistant trustworthy:

- The model never writes to the database or the store. It proposes tool calls; code validates and runs them.
- Money is integer poisha and every total is computed in code from live store prices, never taken from model output.
- A customer only sees read tools plus ordering and handoff. Owner tools are not even offered to the model in a customer chat.
- Before a reply reaches a customer, code checks that every price in it came from shop data in this turn and that it promises no discount. Anything else is held for the owner.
- Store credentials are encrypted at rest (AES-256-GCM, `STORE_SECRET_KEY`), never logged and only shown masked. Every webhook is signature-checked before it is read.
- Every step (tool, arguments, decision, result, latency) is in the agent log in the dashboard.

## Connecting a store

In the dashboard open **Settings, Your store**.

- **Shopify**: in Shopify admin create a custom app (Settings, Apps and sales channels, Develop apps) with read and write access to products, inventory, orders, draft orders and merchant-managed fulfillment, and read access to locations. Paste the shop domain, the Admin API token and the API secret key.
- **WooCommerce**: WooCommerce, Settings, Advanced, REST API, add a Read/Write key. Paste the https site address, consumer key and secret.
- **Your own site**: implement the SaudaAI Store API below and paste the site address and a token your site accepts. Send store events to the webhook URL shown in Settings, signed with the secret shown there.

The shop uses the connected store's currency (BDT, USD, INR, PKR, EUR, GBP, AED, SAR, MYR, NGN, KES); prices are kept as integer minor units and shown in that currency. A shop without a website picks its currency in Settings. On a public https address SaudaAI registers Shopify and WooCommerce webhooks itself; locally a full sync runs every 30 minutes and from **Sync now**.

## SaudaAI Store API

Any site can be a SaudaAI store by answering five routes. Requests carry `Authorization: Bearer <token>` and JSON. Money is integer minor units of the store's currency (৳1 = 100 poisha, $1 = 100 cents).

| Method | Path                             | Body / query                      | Response                                                            |
| ------ | -------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| GET    | `/saudaai/info`                  |                                   | `{ name, currency }`                                                |
| GET    | `/saudaai/products?cursor`       |                                   | `{ products: ExternalProduct[], next?: string }`                    |
| GET    | `/saudaai/products/:id`          |                                   | `ExternalProduct`, or 404                                           |
| POST   | `/saudaai/orders`                | `ExternalOrderInput`              | `{ externalId, number, totalPoisha, adminUrl? }`                    |
| PATCH  | `/saudaai/orders/:id`            | `{ status?, paidPoisha?, note? }` | `{ ok: true }`                                                      |
| GET    | `/saudaai/orders?since=&cursor=` | `since` in ms                     | `{ orders: StoreOrder[], next?: string }`                           |
| GET    | `/saudaai/orders/:id`            |                                   | `StoreOrder` (status, customer, priced lines, totals, paid), or 404 |

```ts
type ExternalProduct = {
  externalId: string
  name: string
  category?: string
  imageUrl?: string
  status: 'active' | 'draft' | 'archived'
  variants: {
    externalId: string
    size?: string
    color?: string
    sku?: string
    pricePoisha: number
    stock: number | null // null: the site does not track stock for it
  }[]
}

type ExternalOrderInput = {
  customer: { name: string; phone?: string; email?: string; address?: string; area?: string }
  lines: { variantExternalId: string; qty: number }[]
  shippingPoisha: number
  paymentMethod: string // cod, bkash, nagad
  note?: string
  tags: string[] // always 'saudaai' and the channel
}

type StoreOrder = {
  externalId: string
  number: string
  status: 'confirmed' | 'shipped' | 'delivered' | 'cancelled'
  createdAt: number
  customer: { name: string; phone?: string; email?: string; address?: string; area?: string }
  lines: {
    variantExternalId: string
    productExternalId?: string
    qty: number
    unitPricePoisha: number
  }[]
  shippingPoisha: number
  totalPoisha: number
  paidPoisha: number
  paymentMethod?: string
}
```

Optional routes, so the owner can add products and change stock from SaudaAI (answer 404 if your site does not offer them; the owner is then told to use the store admin):

| Method | Path                    | Body                                                                         | Response                  |
| ------ | ----------------------- | ---------------------------------------------------------------------------- | ------------------------- |
| POST   | `/saudaai/products`     | product without ids, `status: "draft"`, `imageUrl` (SaudaAI's cleaned photo) | the new `ExternalProduct` |
| PATCH  | `/saudaai/products/:id` | `{ status: "active" \| "draft" \| "archived" }`                              | `{ ok: true }`            |
| POST   | `/saudaai/stock`        | `{ variantExternalId, delta }`                                               | `{ stock }`               |
| POST   | `/saudaai/posts`        | `{ title, body, imageUrl }` (a banner made by SaudaAI)                       | `{ url }` of the post     |

Order `status` changes are `confirmed`, `shipped`, `delivered` or `cancelled`. Price the order from your own catalog and refuse it (any 4xx) if stock is short.

Webhooks back to SaudaAI: `POST {SaudaAI}/webhooks/store/{shopId}` with a JSON array of events and `X-SaudaAI-Signature: sha256=<hex HMAC-SHA256 of the raw body with the shared secret>`:

```json
[
  { "type": "product.upsert", "product": { "externalId": "p1", "...": "ExternalProduct" } },
  { "type": "product.delete", "externalId": "p1" },
  { "type": "stock", "variantExternalId": "v1", "stock": 3 },
  { "type": "order.upsert", "externalId": "o1", "status": "delivered", "paidPoisha": 156000 }
]
```

`apps/demo-store` is a complete reference implementation in a few hundred lines.

## Website chat widget

Settings shows a snippet for the shop. Paste it before `</body>` on any site (Shopify `theme.liquid`, a WooCommerce footer code plugin, anywhere):

```html
<script src="https://your-saudaai-host/widget.js" data-shop="<shop public key>" defer></script>
```

Optional: `data-lang="en"` (default Bangla), `data-color="#1a8cf0"`, and `data-product="<store product id>"` on product pages so the assistant knows what the customer is looking at. The widget is one 9 KB file (under 4 KB gzipped), runs inside a Shadow DOM so it cannot clash with the site's styles, and keeps its session in `localStorage` because third-party cookies are blocked on other sites. It supports text, voice notes, quick replies, product photos and live replies.

## Repository

```
apps/server      agent, tools, store connectors and sync, model clients, channels, rendering, jobs, http api, evals
apps/web         owner dashboard (Vue 3, Tailwind) and the embeddable widget (plain TS, own Vite entry)
apps/demo-store  sample shop site implementing the SaudaAI Store API, with the widget embedded
packages/shared  money helpers and request schemas used by server and dashboard
```

Server: Hono, grammY, Drizzle on SQLite (libSQL), zod, p-queue, croner, sharp, Playwright. Web: Vue 3, Vite, Pinia, Tailwind CSS, Inter and Anek Bangla.

## Running locally

Requirements: Node 24, pnpm 10, ffmpeg, a Meta Model API key and a Telegram bot token.

```bash
pnpm install
cp .env.example .env      # META_API_KEY, TELEGRAM_BOT_TOKEN, STORE_SECRET_KEY (openssl rand -base64 32)
pnpm db:seed              # creates the shop account (no products), prints the Telegram link code
pnpm spike                # one call to each model to check keys and response shapes
pnpm dev                  # server on :8787, dashboard on :5173, widget at :8787/widget.js
```

In Telegram send `/start <link code>` to your bot, then `/login` to get a code for the dashboard. Bot commands: `/summary`, `/login`, `/reply <chat> <text>`, `/take <chat>`, `/resume <chat>`.

Products and orders come from a connected store. To try it locally, run the demo store and link the shop to it:

```bash
# DEMO_STORE_TOKEN=<any long random string> in .env
pnpm demo                 # demo store on :8790
pnpm demo:link            # connects the shop to it, syncs, prints DEMO_STORE_* values for .env
```

Add the printed values to `.env`, restart `pnpm demo`, and open `http://localhost:8790`: the chat bubble on every page is the SaudaAI widget, and stock or price changes in `http://localhost:8790/admin?key=<token>` reach SaudaAI through signed webhooks, and an order placed with **Order now** on a product page shows up in SaudaAI as a website order.

Messenger, WhatsApp and Instagram need a public https URL. Locally, `cloudflared tunnel --url http://localhost:8787` works; `pnpm webhooks:set` registers the Telegram webhook and prints the Meta webhook settings.

## Tests and evals

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm eval                        # Muse Spark on the Meta Model API, built-in catalog
pnpm eval --store                # the same cases with the shop connected to the demo store
pnpm eval --provider baseten     # Muse Spark Open, needs BASETEN_API_KEY
```

Tests cover money math, stock, the order lifecycle, the agent loop with a scripted model, approvals, webhook parsing and signatures, the inbox, the HTTP API, rendering, the widget API, analytics, and a connector contract suite that runs the same checks against Shopify and WooCommerce fixtures, a fake custom site and the real demo store.

The eval suite (`apps/server/evals/cases`) has 49 situations across orders, stock, products from photos, payments, customer questions, ordering in chat, safety (prompt injection, discount pressure, a customer trying owner actions, negative stock, the 24-hour window), connected stores (order created in the store on confirm, price changed since the last sync, sold out since the last sync), analytics by voice, widget product context, Instagram, store photos to customers, and promotion (banner to the website, ad to the Facebook Page, both waiting for approval). Each case runs against a fresh fixture shop (a made-up catalog that exists only for tests and evals) with the real model and is judged on outcomes in the database and the store, not on wording. Reports are in `apps/server/evals/reports/`.

| Run (Muse Spark, Meta Model API, 2026-11-01) | Score |
| -------------------------------------------- | ----- |
| Fixture catalog (built-in store)             | 49/49 |
| Same cases, shop connected to the demo store | 49/49 |

Muse Spark Open has not been run (no Baseten key).

## Deploying

```bash
docker build -t saudaai .
docker run -p 8787:8787 -v saudaai-data:/data --env-file .env saudaai
```

The image includes Chromium for rendering and ffmpeg for audio, builds the dashboard and `/widget.js`, and creates the shop account on first start; connect the store from Settings. Set `DEMO_READONLY=1` to let anyone browse the demo dashboard without logging in. The demo store runs from the same image:

```bash
docker run -p 8790:8790 -v demo-store-data:/data --env-file .env \
  -e DEMO_STORE_DATABASE_URL=file:/data/demo-store.db -w /app/apps/demo-store saudaai npx tsx src/index.ts
```

Messenger, WhatsApp and Instagram run in Meta development mode, so only app testers and verified numbers can message the bot; the website widget on the demo store is open to everyone.

## Built during the hackathon

Everything in this repository was written during the building period, Oct 27 - Nov 4, 2026. The commit history reflects the build.

## License

MIT
