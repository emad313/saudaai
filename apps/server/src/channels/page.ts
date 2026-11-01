import sharp from 'sharp'
import type { Db } from '../db/client.ts'
import { env } from '../env.ts'
import { loadMedia, saveMedia } from '../media/store.ts'
import { ToolError } from '../tools/ctx.ts'
import { graph, graphGet } from './meta.ts'

async function photoForm(db: Db, mediaId: string, extra: Record<string, string>) {
  const file = await loadMedia(db, mediaId)
  if (!file) throw new ToolError('not_found', `image ${mediaId} not found`)
  const form = new FormData()
  form.append('source', new Blob([new Uint8Array(file.bytes)], { type: file.row.mime }), 'image')
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  return form
}

// One image is a photo post; several are uploaded unpublished and attached to one feed post.
export async function postToPage(db: Db, input: { mediaIds: string[]; caption: string }) {
  const pageId = env.MESSENGER_PAGE_ID
  const token = env.MESSENGER_PAGE_TOKEN
  if (!pageId || !token) throw new ToolError('not_configured', 'the Facebook Page is not connected')
  try {
    if (input.mediaIds.length === 1) {
      const res = await graph(
        `${pageId}/photos`,
        token,
        await photoForm(db, input.mediaIds[0]!, { caption: input.caption }),
      )
      const postId = String(res.post_id ?? res.id)
      return { postId, url: `https://www.facebook.com/${postId}` }
    }
    const form = new FormData()
    form.append('message', input.caption)
    for (const [i, id] of input.mediaIds.entries()) {
      const photo = await graph(
        `${pageId}/photos`,
        token,
        await photoForm(db, id, { published: 'false' }),
      )
      form.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: String(photo.id) }))
    }
    const res = await graph(`${pageId}/feed`, token, form)
    return { postId: String(res.id), url: `https://www.facebook.com/${res.id}` }
  } catch (err) {
    if (err instanceof ToolError) throw err
    throw new ToolError(
      'facebook_refused',
      `Facebook did not take the post: ${err instanceof Error ? err.message.slice(0, 300) : err}`,
    )
  }
}

async function publicJpeg(db: Db, mediaId: string) {
  const file = await loadMedia(db, mediaId)
  if (!file) throw new ToolError('not_found', `image ${mediaId} not found`)
  const id =
    file.row.mime === 'image/jpeg'
      ? mediaId
      : (
          await saveMedia(
            db,
            await sharp(file.bytes)
              .flatten({ background: '#ffffff' })
              .jpeg({ quality: 90 })
              .toBuffer(),
            'image/jpeg',
            { role: 'ad', derivedFrom: mediaId },
          )
        ).id
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/media/${id}`
}

// Instagram downloads each image from our public URL and takes only JPEG; several images become a carousel.
export async function postToInstagram(db: Db, input: { mediaIds: string[]; caption: string }) {
  const account = env.INSTAGRAM_ACCOUNT_ID
  const token = env.MESSENGER_PAGE_TOKEN
  if (!account || !token) throw new ToolError('not_configured', 'Instagram is not connected')
  if (!env.PUBLIC_BASE_URL.startsWith('https://')) {
    throw new ToolError(
      'not_public',
      'Instagram fetches the image from SaudaAI, so SaudaAI must run on a public https address',
    )
  }
  try {
    const urls = []
    for (const id of input.mediaIds) urls.push(await publicJpeg(db, id))
    let container: string
    if (urls.length === 1) {
      container = String(
        (await graph(`${account}/media`, token, { image_url: urls[0], caption: input.caption })).id,
      )
    } else {
      const children = []
      for (const url of urls) {
        const item = await graph(`${account}/media`, token, {
          image_url: url,
          is_carousel_item: true,
        })
        children.push(String(item.id))
      }
      const carousel = await graph(`${account}/media`, token, {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption: input.caption,
      })
      container = String(carousel.id)
    }
    const post = await graph(`${account}/media_publish`, token, { creation_id: container })
    const info = await graphGet(`${post.id}?fields=permalink`, token).catch(() => ({}))
    const permalink = (info as { permalink?: string }).permalink
    return { postId: String(post.id), url: permalink ?? 'https://www.instagram.com/' }
  } catch (err) {
    if (err instanceof ToolError) throw err
    throw new ToolError(
      'instagram_refused',
      `Instagram did not take the post: ${err instanceof Error ? err.message.slice(0, 300) : err}`,
    )
  }
}
