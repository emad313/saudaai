<script setup lang="ts">
import { marked } from 'marked'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import setup from '../help/setup.md?raw'
import using from '../help/using.md?raw'

const guides = [
  { slug: 'using', title: 'Using SaudaAI every day', markdown: using },
  { slug: 'setup', title: 'Setting up your shop', markdown: setup },
]

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const guide = computed(() => guides.find((g) => g.slug === slug.value) ?? null)
// The guides ship inside the app; they are not user input.
const html = computed(() => (guide.value ? (marked.parse(guide.value.markdown) as string) : ''))
</script>

<template>
  <h1 class="page-title">Docs</h1>
  <div class="mt-6 grid gap-6 lg:grid-cols-[15rem_1fr]">
    <nav class="flex flex-col gap-0.5" aria-label="Guides">
      <RouterLink
        to="/docs"
        class="rounded-lg px-3 py-1.5 text-sm hover:bg-sky"
        :class="!guide ? 'bg-sky font-medium text-ink' : 'text-night'"
        >About SaudaAI</RouterLink
      >
      <RouterLink
        v-for="g in guides"
        :key="g.slug"
        :to="`/docs/${g.slug}`"
        class="rounded-lg px-3 py-1.5 text-sm hover:bg-sky"
        :class="slug === g.slug ? 'bg-sky font-medium text-ink' : 'text-night'"
        >{{ g.title }}</RouterLink
      >
    </nav>

    <article v-if="guide" class="panel doc min-w-0 px-6 py-5 md:px-8" v-html="html"></article>

    <section v-else class="panel max-w-3xl px-6 py-6 md:px-8">
      <h2 class="text-xl font-semibold">Why SaudaAI exists</h2>
      <p class="mt-3 leading-relaxed">
        Most small online shops in Bangladesh are run by one or two people from their phone. The
        owner answers the same questions all day on Messenger and WhatsApp, often by voice: price,
        size, stock, delivery charge. Orders are copied into a notebook, totals are added by hand,
        stock drifts from what the website shows, and payment reminders are forgotten. Every hour
        spent in chat is an hour not spent sourcing or packing.
      </p>
      <p class="mt-3 leading-relaxed">
        SaudaAI is an assistant that works on top of the shop the owner already has. It reads the
        products, prices, stock and photos from the store (Shopify, WooCommerce or any site),
        answers customers on Messenger, Instagram, WhatsApp and the website chat in their language,
        takes the order, and creates it in the store. It turns a phone photo into a product and an
        ad, and posts it where the shop sells.
      </p>
      <p class="mt-3 leading-relaxed">
        The owner stays in charge. Anything that commits the shop or touches money waits for one tap
        in Telegram or here in the dashboard. Prices and totals are always computed by the shop's
        code, never written by the model, and every step the assistant takes is in the Agent log.
      </p>
      <p class="mt-4 text-sm text-muted">
        Start with
        <RouterLink to="/docs/using" class="font-medium text-ink hover:underline"
          >Using SaudaAI every day</RouterLink
        >, or
        <RouterLink to="/docs/setup" class="font-medium text-ink hover:underline"
          >Setting up your shop</RouterLink
        >
        to connect a store and chat channels.
      </p>
    </section>
  </div>
</template>
<style scoped>
.doc :deep(h1) {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}
.doc :deep(h2) {
  font-size: 1.2rem;
  font-weight: 600;
  margin: 1.75rem 0 0.5rem;
}
.doc :deep(h3) {
  font-weight: 600;
  margin: 1.25rem 0 0.4rem;
}
.doc :deep(p),
.doc :deep(ul),
.doc :deep(ol),
.doc :deep(table),
.doc :deep(pre) {
  margin: 0.6rem 0;
  line-height: 1.65;
  max-width: 75ch;
}
.doc :deep(ul) {
  list-style: disc;
  padding-left: 1.25rem;
}
.doc :deep(ol) {
  list-style: decimal;
  padding-left: 1.25rem;
}
.doc :deep(li) {
  margin: 0.2rem 0;
}
.doc :deep(a) {
  color: var(--color-ink);
  text-decoration: underline;
}
.doc :deep(code) {
  background: var(--color-sky);
  border-radius: 0.3rem;
  padding: 0.05rem 0.3rem;
  font-size: 0.85em;
  overflow-wrap: anywhere;
}
.doc :deep(pre) {
  background: var(--color-night);
  color: #fff;
  border-radius: 0.6rem;
  padding: 0.8rem 1rem;
  overflow-x: auto;
  max-width: none;
}
.doc :deep(pre code) {
  background: none;
  padding: 0;
  color: inherit;
}
.doc :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.9rem;
  max-width: none;
}
.doc :deep(th),
.doc :deep(td) {
  border: 1px solid var(--color-line);
  padding: 0.35rem 0.6rem;
  text-align: left;
  vertical-align: top;
}
.doc :deep(blockquote) {
  border-left: 3px solid var(--color-line);
  padding-left: 0.8rem;
  color: var(--color-muted);
}
</style>
