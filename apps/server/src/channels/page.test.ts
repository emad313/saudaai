import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../env.ts'
import { saveMedia } from '../media/store.ts'
import { testShop } from '../test/shop.ts'
import { postToInstagram, postToPage } from './page.ts'

let t: Awaited<ReturnType<typeof testShop>>
let calls: { url: string; form: Record<string, string> }[]

beforeEach(async () => {
  t = await testShop()
  env.MESSENGER_PAGE_TOKEN = 'page-token'
  calls = []
  let photo = 0
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const form = Object.fromEntries(
      [...(init.body as FormData).entries()].map(([k, v]) => [
        k,
        typeof v === 'string' ? v : '<file>',
      ]),
    )
    calls.push({ url, form })
    if (url.endsWith('/photos'))
      return Response.json({ id: `ph${++photo}`, post_id: 'PAGE_ID_post1' })
    return Response.json({ id: 'PAGE_ID_post2' })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  env.MESSENGER_PAGE_TOKEN = undefined
})

const image = async (color: string) =>
  saveMedia(
    t.db,
    await sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
      .png()
      .toBuffer(),
    'image/png',
    { role: 'ad' },
  )

describe('postToPage', () => {
  it('posts one image as a photo post with the caption', async () => {
    const ad = await image('#1a8cf0')
    const res = await postToPage(t.db, { mediaIds: [ad.id], caption: 'ঈদ স্পেশাল কুর্তি ৳1,125' })
    expect(res.url).toBe('https://www.facebook.com/PAGE_ID_post1')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toMatch(/\/PAGE_ID\/photos$/)
    expect(calls[0]!.form).toEqual({ source: '<file>', caption: 'ঈদ স্পেশাল কুর্তি ৳1,125' })
  })

  it('uploads several images unpublished and attaches them to one post', async () => {
    const a = await image('#1a8cf0')
    const b = await image('#e04b4b')
    const res = await postToPage(t.db, { mediaIds: [a.id, b.id], caption: 'Notun collection' })
    expect(res.postId).toBe('PAGE_ID_post2')
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['photos', 'photos', 'feed'])
    expect(calls[0]!.form.published).toBe('false')
    expect(calls[2]!.form).toEqual({
      message: 'Notun collection',
      'attached_media[0]': '{"media_fbid":"ph1"}',
      'attached_media[1]': '{"media_fbid":"ph2"}',
    })
  })

  it('says so when facebook refuses', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: '(#200) requires pages_manage_posts' } }, { status: 403 }),
    )
    const ad = await image('#000000')
    await expect(postToPage(t.db, { mediaIds: [ad.id], caption: 'x' })).rejects.toMatchObject({
      code: 'facebook_refused',
    })
  })
})

describe('postToInstagram', () => {
  it('publishes a jpeg copy of the ad from the public url', async () => {
    env.INSTAGRAM_ACCOUNT_ID = 'IG1'
    const base = env.PUBLIC_BASE_URL
    env.PUBLIC_BASE_URL = 'https://saudaai.example'
    const sent: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (!init?.body) return Response.json({ permalink: 'https://www.instagram.com/p/abc/' })
      sent.push({ url, body: JSON.parse(String(init.body)) })
      return Response.json({ id: url.endsWith('media_publish') ? 'post9' : 'container1' })
    })
    try {
      const ad = await image('#1a8cf0')
      const res = await postToInstagram(t.db, { mediaIds: [ad.id], caption: 'Notun kurti' })
      expect(res).toEqual({ postId: 'post9', url: 'https://www.instagram.com/p/abc/' })
      expect(sent[0]!.url).toMatch(/\/IG1\/media$/)
      expect(sent[0]!.body.image_url).toMatch(/^https:\/\/saudaai\.example\/media\/\w+$/)
      expect(sent[0]!.body.image_url).not.toContain(ad.id)
      expect(sent[1]!.body).toEqual({ creation_id: 'container1' })
    } finally {
      env.INSTAGRAM_ACCOUNT_ID = undefined
      env.PUBLIC_BASE_URL = base
    }
  })
})
