# SaudaAI

**A voice-first business agent for sellers who run their shop from their phone.**

_Sauda_ (সওদা) is the everyday Bangla word for buying and selling.

Millions of small sellers in Bangladesh, India, Indonesia and across Africa run real businesses through Facebook pages and WhatsApp. Orders arrive as chat messages, stock lives in a notebook, invoices are handwritten, and the seller is often more comfortable talking than typing. Software built for e-commerce assumes a website, a dashboard and a keyboard. These sellers have none of that time.

SaudaAI gives the seller a back office they can talk to, and gives their customers an assistant that answers on Messenger, WhatsApp and the web, in Bangla, instantly.

> Seller, voice note on Telegram: _"Rahim bhai 2 ta kalo t-shirt nibe, L size, Mirpur 10 e delivery, bikash e pay korbe"_
>
> SaudaAI: drafts order #1043 for Rahim Uddin, reserves two Black T-Shirts in L, adds ৳60 Dhaka delivery, and asks for one tap. On approval Rahim gets the confirmation and a Bangla invoice on his WhatsApp.

Built with Meta's models for the Meta Global AI Developer Hackathon (Indie Developer track, "Build for Your World").

## What it does

**For the seller (Telegram bot + web dashboard)**

- **Voice to action**: Bangla, Banglish or English voice notes become orders, stock updates, payments and expenses.
- **Photo to catalog**: a phone photo of a product on the bed becomes a clean catalog image with name, attributes, sizes and stock. Publishing is one tap.
- **Approvals**: anything that commits the shop or touches money (confirming an order, payments, cancellations, reminders) arrives as Approve / Edit / Cancel buttons. The seller can let small orders confirm themselves.
- **Ad creatives**: _"notun kurti tar eid offer ad banao, 10% off"_ returns square and story ads with the sale price computed in code and Bangla text rendered properly.
- **Daily summary and reminders**: sales, top items, low stock and money due at 10 PM; payment reminders drafted for unpaid orders, respecting each platform's 24-hour messaging window.
- **Live feed and takeover**: every reply the assistant sends to a customer shows up on Telegram, and the seller can take over any chat.

**For the customer (Messenger, WhatsApp, web chat)**

- Ask about price, sizes, stock, delivery charge and order status, by text, voice note or photo, and get an answer in seconds.
- Order inside the chat; the confirmation and invoice come back on the same channel once the shop approves.
- A public shop page with the catalog, chat, voice notes and an order form.

## Meta models

| Model                         | Used for                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Muse Spark Open (via Baseten) | Agent planner with tool calling, the default brain (open weights)                  |
| Muse Spark (Meta Model API)   | Same agent through the API path; vision for product attributes and customer photos |
| Muse Voice Transcribe         | Seller and customer voice notes (Bangla mixed with English)                        |
| SAM 3.1                       | Cutting the product out of messy phone photos                                      |
| Muse Image                    | Scenes behind the product in ad creatives                                          |

The agent runs on either provider with the same tools and the same eval suite (`AGENT_PROVIDER=baseten|meta`).

## How it works

```
 Seller (Telegram)                 Customers (Messenger | WhatsApp | web chat)
        |                                        |
        |                         POST /webhooks/meta (signature checked)
        +---------------> inbox <----------------+
                 dedup, rate limit, one queue per shop
        voice -> Voice Transcribe      photo -> SAM 3.1 + Muse Spark vision
                            |
                 agent loop, up to 6 steps
                 (Muse Spark Open or Muse Spark)
                            |
             proposed tool calls, validated with zod
                            |
           policy: run | ask the seller | refuse
                            |
        plain TypeScript tools write to SQLite, money in poisha
                            |
         verification + activity log of every step
```

Rules that keep the assistant trustworthy:

- The model never writes to the database. It proposes tool calls; code validates and runs them.
- Money is integer poisha and every total is computed from catalog prices, never taken from model output.
- A customer only sees read tools plus ordering and handoff. Seller tools are not even offered to the model in a customer chat.
- Before a reply reaches a customer, code checks that every price in it came from shop data in this turn and that it promises no discount. Anything else is held for the seller.
- Each turn's orders are re-checked against their lines and payments after the agent finishes.
- Every step (tool, arguments, decision, result, latency) is in the agent log in the dashboard.

## Repository

```
apps/server     agent, tools, model clients, channels, rendering, jobs, http api, evals
apps/web        seller dashboard and public shop page (Vue 3, Tailwind)
packages/shared money helpers and request schemas used by both
```

Server: Hono, grammY, Drizzle on SQLite (libSQL), zod, p-queue, croner, sharp, Playwright. Web: Vue 3, Vite, Pinia, Tailwind CSS, Tiro Bangla and Hind Siliguri.

## Running locally

Requirements: Node 22, pnpm 10, ffmpeg, a Telegram bot token and model credentials.

```bash
pnpm install
cp .env.example .env      # fill in keys
pnpm db:seed              # demo shop "Nusrat's Closet", prints the Telegram link code
pnpm spike                # one call to each model to check keys and response shapes
pnpm dev                  # server on :8787, web on :5173
```

In Telegram send `/start <link code>` to your bot, then `/login` to get a code for the dashboard. The customer page is at `http://localhost:5173/s/nusrats-closet`.

Messenger and WhatsApp need a public https URL. Locally, `cloudflared tunnel --url http://localhost:8787` works; `pnpm webhooks:set` registers the Telegram webhook and prints the Meta webhook settings.

Bot commands: `/summary`, `/login`, `/reply <chat> <text>`, `/take <chat>`, `/resume <chat>`.

## Tests and evals

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm eval --provider baseten     # or meta
```

Unit and integration tests cover money math, stock reservation, order lifecycle, the agent loop with a scripted model, approvals, webhook parsing and signatures, the inbox, the HTTP API and rendering.

The eval suite (`apps/server/evals/cases`) has 40 scripted situations across orders, stock, products from photos, payments, customer questions, ordering in chat and safety (prompt injection, discount pressure, a customer trying seller actions, negative stock, the 24-hour window). Each case runs against a fresh demo shop with the real model and is judged on outcomes in the database, not on wording. Results are written to `apps/server/evals/reports/<provider>.json`.

## Deploying

```bash
docker build -t saudaai .
docker run -p 8787:8787 -v saudaai-data:/data --env-file .env saudaai
```

The image includes Chromium for rendering and ffmpeg for audio. It seeds the demo shop on first start. Set `DEMO_READONLY=1` to let anyone browse the demo dashboard without logging in. Messenger and WhatsApp run in Meta development and test mode, so only app testers and verified numbers can message the bot; the public web chat is open to everyone.

## Built during the hackathon

Everything in this repository was written during the building period, Oct 27 - Nov 4, 2026. The commit history reflects the build.

## License

MIT
