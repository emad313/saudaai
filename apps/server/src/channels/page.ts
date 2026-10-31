import type { Db } from '../db/client.ts'
import { env } from '../env.ts'
import { loadMedia } from '../media/store.ts'
import { ToolError } from '../tools/ctx.ts'
import { graph } from './meta.ts'

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
