<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, send } from '../api.ts'
import { when } from '../format.ts'
import { useSession } from '../stores/session.ts'
import StatusText from './StatusText.vue'

type Kind = 'builtin' | 'shopify' | 'woocommerce' | 'custom'
type StoreView = {
  kind: Kind
  name: string
  baseUrl?: string | null
  status?: string
  lastSyncAt?: number | null
  lastError?: string | null
  credentials?: Record<string, string>
  webhookUrl?: string
  webhookSecret?: string | null
  webhooksAutomatic?: boolean
  webhooksRefused?: { topic: string; reason: string }[]
}

const session = useSession()
const store = ref<StoreView | null>(null)
const kind = ref<Exclude<Kind, 'builtin'>>('shopify')
const editing = ref(false)
const busy = ref('')
const error = ref('')
const copied = ref('')
const form = ref({
  shopDomain: '',
  accessToken: '',
  apiSecret: '',
  baseUrl: '',
  consumerKey: '',
  consumerSecret: '',
  token: '',
})

const kinds = [
  { value: 'shopify', label: 'Shopify' },
  { value: 'woocommerce', label: 'WooCommerce' },
  { value: 'custom', label: 'My own site' },
] as const

const names: Record<Kind, string> = {
  builtin: 'Built-in catalog',
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  custom: 'Own site (SaudaAI Store API)',
}

const connected = computed(() => store.value && store.value.kind !== 'builtin')

async function load() {
  store.value = await api<StoreView>('/api/store')
}

async function run(label: string, fn: () => Promise<StoreView | unknown>) {
  busy.value = label
  error.value = ''
  try {
    const res = await fn()
    if (res && typeof res === 'object' && 'kind' in res) store.value = res as StoreView
    else await load()
    // the store sets the shop's name and currency
    await session.load()
    editing.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

function connect() {
  const f = form.value
  const body =
    kind.value === 'shopify'
      ? {
          kind: 'shopify',
          shopDomain: f.shopDomain
            .trim()
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, ''),
          accessToken: f.accessToken.trim(),
          apiSecret: f.apiSecret.trim(),
        }
      : kind.value === 'woocommerce'
        ? {
            kind: 'woocommerce',
            baseUrl: f.baseUrl.trim(),
            consumerKey: f.consumerKey.trim(),
            consumerSecret: f.consumerSecret.trim(),
          }
        : { kind: 'custom', baseUrl: f.baseUrl.trim(), token: f.token.trim() }
  return run('connect', () => send<StoreView>('/api/store', 'PUT', body))
}

async function copy(label: string, value: string) {
  await navigator.clipboard.writeText(value)
  copied.value = label
  setTimeout(() => (copied.value = ''), 2000)
}

onMounted(load)
</script>

<template>
  <section class="panel">
    <h2 class="card-head">
      Your store
      <StatusText v-if="connected && store?.status" :status="store.status" />
    </h2>
    <div v-if="store" class="flex flex-col gap-4 p-5 md:p-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="font-medium">{{ names[store.kind] }}</p>
          <p class="text-sm text-muted">
            <template v-if="connected">
              {{ store.name }}<template v-if="store.baseUrl">, {{ store.baseUrl }}</template>
              <br />
              {{ store.lastSyncAt ? `Last synced ${when(store.lastSyncAt)}` : 'Not synced yet' }}
            </template>
            <template v-else>
              Products, stock and orders live here in SaudaAI. Connect your online store to sell
              from it instead.
            </template>
          </p>
          <p v-if="store.lastError" class="mt-1 text-sm text-bad">{{ store.lastError }}</p>
        </div>
        <div v-if="connected && !session.me?.readonly" class="flex gap-2">
          <button
            class="btn-quiet"
            :disabled="!!busy"
            @click="run('sync', () => send('/api/store/sync', 'POST'))"
          >
            {{ busy === 'sync' ? 'Syncing…' : 'Sync now' }}
          </button>
          <button
            class="btn-ghost"
            :disabled="!!busy"
            @click="run('disconnect', () => send<StoreView>('/api/store', 'DELETE'))"
          >
            Disconnect
          </button>
        </div>
      </div>

      <div v-if="connected" class="rounded-lg bg-cloud p-4 text-sm">
        <div v-if="store.webhooksRefused?.length" class="mb-3 rounded-lg bg-warn/10 p-3 text-warn">
          <p class="font-medium">
            The store refused live updates for:
            {{ store.webhooksRefused.map((w) => w.topic).join(', ') }}
          </p>
          <p class="mt-1">{{ store.webhooksRefused[0]!.reason }}</p>
          <p v-if="store.kind === 'shopify'" class="mt-1">
            Order topics need protected customer data access (Shopify admin, Apps, Develop apps,
            your app, Configuration, Protected customer data access); inventory needs the
            read_inventory scope. Then connect again. Until then a full sync runs every 30 minutes.
          </p>
        </div>
        <p v-if="store.webhooksAutomatic" class="text-good">
          Store updates are sent here automatically. A full sync also runs every 30 minutes.
        </p>
        <template v-else>
          <p class="font-medium">Send store updates to SaudaAI</p>
          <p class="mt-1 text-muted">
            <template v-if="store.kind === 'custom'"
              >Have your site POST store events to this URL, signed with this secret
              (X-SaudaAI-Signature: sha256=&lt;hex&gt;).</template
            >
            <template v-else
              >Webhooks are registered automatically once SaudaAI runs on a public https address.
              Until then a full sync runs every 30 minutes.</template
            >
          </p>
          <div v-if="store.kind === 'custom'" class="mt-3 flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <code class="min-w-0 flex-1 truncate rounded bg-white px-2 py-1">{{
                store.webhookUrl
              }}</code>
              <button class="btn-ghost min-h-8 px-2" @click="copy('url', store.webhookUrl!)">
                {{ copied === 'url' ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <div v-if="store.webhookSecret" class="flex items-center gap-2">
              <code class="min-w-0 flex-1 truncate rounded bg-white px-2 py-1">{{
                store.webhookSecret
              }}</code>
              <button class="btn-ghost min-h-8 px-2" @click="copy('secret', store.webhookSecret!)">
                {{ copied === 'secret' ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </div>
        </template>
      </div>

      <template v-if="!session.me?.readonly">
        <button v-if="!editing" class="btn-primary self-start" @click="editing = true">
          {{ connected ? 'Connect a different store' : 'Connect your store' }}
        </button>
        <form
          v-else
          class="flex flex-col gap-4 border-t border-line pt-4"
          @submit.prevent="connect"
        >
          <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Store type">
            <button
              v-for="k in kinds"
              :key="k.value"
              type="button"
              role="radio"
              :aria-checked="kind === k.value"
              :class="kind === k.value ? 'chip-on' : 'chip'"
              @click="kind = k.value"
            >
              {{ k.label }}
            </button>
          </div>

          <template v-if="kind === 'shopify'">
            <p class="text-sm text-muted">
              In Shopify admin open Settings, Apps and sales channels, Develop apps, and create an
              app. Give it read and write access to products, inventory, orders, draft orders and
              merchant-managed fulfillment, plus read access to locations. Install it, then copy the
              Admin API token and the API secret key here.
            </p>
            <label class="block text-sm font-medium"
              >Shop domain<input
                v-model="form.shopDomain"
                class="field mt-1.5 font-normal"
                placeholder="your-shop.myshopify.com"
                required
            /></label>
            <label class="block text-sm font-medium"
              >Admin API access token<input
                v-model="form.accessToken"
                type="password"
                class="field mt-1.5 font-normal"
                placeholder="shpat_…"
                autocomplete="off"
                required
            /></label>
            <label class="block text-sm font-medium"
              >API secret key<input
                v-model="form.apiSecret"
                type="password"
                class="field mt-1.5 font-normal"
                autocomplete="off"
                required
            /></label>
          </template>

          <template v-else-if="kind === 'woocommerce'">
            <p class="text-sm text-muted">
              In WordPress open WooCommerce, Settings, Advanced, REST API, and add a key with Read
              and Write permission. Your site must use https.
            </p>
            <label class="block text-sm font-medium"
              >Site address<input
                v-model="form.baseUrl"
                type="url"
                class="field mt-1.5 font-normal"
                placeholder="https://your-shop.com"
                required
            /></label>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="block text-sm font-medium"
                >Consumer key<input
                  v-model="form.consumerKey"
                  class="field mt-1.5 font-normal"
                  placeholder="ck_…"
                  autocomplete="off"
                  required
              /></label>
              <label class="block text-sm font-medium"
                >Consumer secret<input
                  v-model="form.consumerSecret"
                  type="password"
                  class="field mt-1.5 font-normal"
                  placeholder="cs_…"
                  autocomplete="off"
                  required
              /></label>
            </div>
          </template>

          <template v-else>
            <p class="text-sm text-muted">
              Any site can connect by implementing the five SaudaAI Store API routes (see the
              README). Give SaudaAI the site address and a token your site accepts.
            </p>
            <label class="block text-sm font-medium"
              >Site address<input
                v-model="form.baseUrl"
                type="url"
                class="field mt-1.5 font-normal"
                placeholder="https://your-shop.com"
                required
            /></label>
            <label class="block text-sm font-medium"
              >Access token<input
                v-model="form.token"
                type="password"
                class="field mt-1.5 font-normal"
                autocomplete="off"
                minlength="8"
                required
            /></label>
          </template>

          <div class="flex flex-wrap items-center gap-2">
            <button class="btn-primary" :disabled="!!busy">
              {{ busy === 'connect' ? 'Testing and syncing…' : 'Test and connect' }}
            </button>
            <button type="button" class="btn-ghost" @click="editing = false">Cancel</button>
          </div>
        </form>
      </template>
      <p v-if="error" class="text-sm text-bad" role="alert">{{ error }}</p>
    </div>
  </section>
</template>
