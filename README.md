# SaudaAI

**A voice-first business agent for sellers who run their shop from their phone.**

_Sauda_ (সওদা) is the everyday Bangla word for buying and selling.

Millions of small sellers in Bangladesh, India, Indonesia and across Africa run real businesses through Facebook pages, WhatsApp and chat apps. Orders arrive as chat messages, stock lives in a notebook, invoices are handwritten, and the seller is often more comfortable talking than typing. Software built for "e-commerce" assumes a website, a dashboard and a keyboard. These sellers have none of that time.

With SaudaAI the seller sends a voice note in Bangla:

> "Rahim bhai 2 ta kalo t-shirt nibe, L size, Mirpur 10 e delivery, bikash e pay korbe"

and the agent creates the order, checks and reserves stock, prepares the invoice, and asks the seller for one tap before it goes to the customer.

Built with Meta's models for the Meta Global AI Developer Hackathon (Indie Developer track, "Build for Your World").

## What it does

- **Voice to action**: Bangla/Banglish voice notes become orders, stock updates, expenses and payment entries.
- **Talks to customers where they already are**: Facebook Messenger, WhatsApp and a web chat. Answers price, stock and delivery questions directly from real shop data and takes orders inside the chat.
- **Photo to catalog**: a messy phone photo of a product becomes a clean catalog item with name, price, sizes and colors.
- **Invoices**: Bangla/English invoice images sent to the customer on the channel they used.
- **Ad creatives**: product photo plus one sentence becomes a ready-to-post ad with correctly rendered Bangla text.
- **Payment reminders and daily summary**: who owes what, what sold today, what is running out.

## Meta models used

| Model                         | Used for                                               |
| ----------------------------- | ------------------------------------------------------ |
| Muse Spark Open (via Baseten) | Agent planner and tool calling (open-weight path)      |
| Muse Spark (Meta Model API)   | Agent planner (API path), vision attribute extraction  |
| Muse Voice Transcribe         | Bangla/Banglish voice notes from sellers and customers |
| SAM 3.1                       | Product segmentation from phone photos                 |
| Muse Image                    | Ad creative backgrounds and scenes                     |

## How it works

```
 Seller (Telegram)              Customers (Messenger | WhatsApp | web chat)
        |                                     |
        +-------------> inbox <---------------+
                          |
        voice -> Muse Voice Transcribe   photo -> SAM 3.1 + Muse Spark vision
                          |
                     agent loop (Muse Spark Open / Muse Spark)
                          |
               proposed tool calls, validated with zod
                          |
        information -> answered directly     money or commitments -> seller approval
                          |
              deterministic tools write to the database
                          |
               verification + activity log of every step
```

Design rules that keep the agent trustworthy:

- The model never writes to the database. It proposes tool calls; plain TypeScript validates and runs them.
- Money is integer poisha and every total is computed in code, never taken from model output.
- Customers get direct answers for information. Confirming orders, discounts, cancellations, payments and reminders wait for one tap from the seller on Telegram (or run automatically only if the seller turned that on).
- Every tool call, input, result and latency is logged and visible in the dashboard.
- Customer messages are treated as data, and customers can only reach a restricted tool set.

## Stack

pnpm monorepo, Node 22, TypeScript. Server: Hono, grammY, Drizzle on SQLite, zod. Web: Vue 3, Vite, Tailwind CSS. Rendering: Playwright (HTML to PNG) with Noto Sans Bengali.

```
apps/server     agent, tools, model clients, channels, jobs, http api
apps/web        seller dashboard and public shop chat
packages/shared schemas and money helpers used by both
```

## Running locally

Requirements: Node 22, pnpm 10.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Web: http://localhost:5173. Server: http://localhost:8787.

`.env.example` lists every variable: model credentials (Meta Model API, Baseten), the Telegram bot token, and the Meta app, Messenger Page and WhatsApp Cloud API credentials. Messenger and WhatsApp need a public HTTPS URL for webhooks; locally a tunnel such as `cloudflared tunnel --url http://localhost:8787` works.

```bash
pnpm test
pnpm lint
pnpm typecheck
```

## Built during the hackathon

Everything in this repository was written during the building period, Oct 27 - Nov 4, 2026. The commit history reflects the build.

## License

MIT
