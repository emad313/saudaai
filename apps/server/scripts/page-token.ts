import { env } from '../src/env.ts'
import { graphGet, graphUrl } from '../src/channels/meta.ts'
import { request } from '../src/models/http.ts'

const userToken = process.argv[2]
if (!userToken || !env.META_APP_ID || !env.META_APP_SECRET) {
  console.log('usage: pnpm page:token <user token from Graph API Explorer>')
  console.log('needs META_APP_ID and META_APP_SECRET in .env')
  process.exit(1)
}

// A page token fetched with a long-lived user token does not expire; one from a short-lived token lasts hours.
const params = new URLSearchParams({
  grant_type: 'fb_exchange_token',
  client_id: env.META_APP_ID,
  client_secret: env.META_APP_SECRET,
  fb_exchange_token: userToken,
})
const res = await request(`${graphUrl('oauth/access_token')}?${params}`, {
  method: 'GET',
  timeoutMs: 15_000,
})
const { access_token: longToken } = (await res.json()) as { access_token: string }

const accounts = await graphGet('me/accounts?fields=id,name,access_token', longToken)
const pages = (accounts.data ?? []) as { id: string; name: string; access_token: string }[]
if (!pages.length) {
  console.log('no pages for this user; grant pages_show_list and pages_messaging in the explorer')
  process.exit(1)
}
for (const p of pages) {
  const mark = p.id === env.MESSENGER_PAGE_ID ? '  <- MESSENGER_PAGE_ID' : ''
  console.log(`${p.name} (${p.id})${mark}\nMESSENGER_PAGE_TOKEN=${p.access_token}\n`)
}
