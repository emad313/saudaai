import { randomInt } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Bot, InlineKeyboard, InputFile, InputMediaBuilder, Keyboard, type Context } from 'grammy'
import type { Deps, SellerLine } from '../agent/deps.ts'
import { conversationById, sendToCustomer } from '../agent/messaging.ts'
import { approve, cancel, isEditable } from '../agent/pending.ts'
import type { Db } from '../db/client.ts'
import { conversations, loginCodes, pendingActions, products, shops } from '../db/schema.ts'
import { env } from '../env.ts'
import type { Inbox } from '../inbox.ts'
import { log } from '../log.ts'
import { loadMedia } from '../media/store.ts'
import { download } from './meta.ts'
import { ToolError, type Shop } from '../tools/ctx.ts'
import { dailySummary } from '../tools/reports.ts'

const help = [
  'Send a voice note or text to run the shop: orders, stock, payments, expenses, ads.',
  'Send a product photo with price and sizes to add it to the catalog.',
  '/summary - today at a glance',
  '/login - code for the web dashboard',
  '/reply <chat> <text> - answer a customer yourself',
  '/take <chat> - pause the assistant in a chat for 2 hours',
  '/resume <chat> - let the assistant answer again',
].join('\n')

const approvalKeys = (id: string, editable: boolean) => {
  const kb = new InlineKeyboard().text('Approve', `pa:${id}:a`)
  if (editable) kb.text('Edit', `pa:${id}:e`)
  return kb.text('Cancel', `pa:${id}:c`)
}

export function createTelegram(db: Db) {
  const bot = env.TELEGRAM_BOT_TOKEN ? new Bot(env.TELEGRAM_BOT_TOKEN) : null
  const editing = new Map<string, string>()

  const chatOf = (shop: Shop) => {
    if (!bot || !shop.telegramChatId) {
      log.info({ shopId: shop.id }, 'seller not on telegram, message kept in dashboard only')
      return null
    }
    return shop.telegramChatId
  }

  const seller: SellerLine = {
    async notify(shop, text, choices) {
      const chat = chatOf(shop)
      if (!chat || !bot) return
      const keyboard = choices?.length
        ? choices
            .reduce((kb, c, i) => (i % 2 ? kb.text(c).row() : kb.text(c)), new Keyboard())
            .oneTime()
            .resized()
        : undefined
      await bot.api.sendMessage(chat, text, keyboard ? { reply_markup: keyboard } : {})
    },

    async askApproval(shop, pending) {
      const chat = chatOf(shop)
      if (!chat || !bot) return
      const keys = approvalKeys(pending.id, isEditable(pending))
      let image: string | null = null
      if (pending.tool === 'confirm_product') {
        const [p] = await db
          .select()
          .from(products)
          .where(eq(products.id, String(pending.args.productId)))
        image = p?.imageId ?? null
      }
      const file = image ? await loadMedia(db, image) : null
      const sent = file
        ? await bot.api.sendPhoto(chat, new InputFile(file.row.path), {
            caption: pending.preview,
            reply_markup: keys,
          })
        : await bot.api.sendMessage(chat, pending.preview, { reply_markup: keys })
      await db
        .update(pendingActions)
        .set({ telegramMessageId: String(sent.message_id) })
        .where(eq(pendingActions.id, pending.id))
    },

    async settle(shop, pending, outcome) {
      const chat = chatOf(shop)
      if (!chat || !bot) return
      const [row] = await db.select().from(pendingActions).where(eq(pendingActions.id, pending.id))
      const messageId = Number(row?.telegramMessageId)
      const text = `${pending.preview}\n\n${outcome}`
      if (!messageId) return void (await bot.api.sendMessage(chat, outcome))
      const edit =
        pending.tool === 'confirm_product'
          ? bot.api.editMessageCaption(chat, messageId, { caption: text })
          : bot.api.editMessageText(chat, messageId, text)
      await edit.catch(() => bot.api.sendMessage(chat, outcome))
    },

    async sendMedia(shop, ids, caption) {
      const chat = chatOf(shop)
      if (!chat || !bot) return
      const files = (await Promise.all(ids.map((id) => loadMedia(db, id)))).filter(
        (f) => f !== null,
      )
      if (files.length === 1) {
        await bot.api.sendPhoto(chat, new InputFile(files[0]!.row.path), caption ? { caption } : {})
        return
      }
      await bot.api.sendMediaGroup(
        chat,
        files.map((f, i) =>
          InputMediaBuilder.photo(new InputFile(f.row.path), i === 0 && caption ? { caption } : {}),
        ),
      )
    },
  }

  async function shopFor(ctx: Context) {
    const chat = String(ctx.chat?.id ?? '')
    const [shop] = await db.select().from(shops).where(eq(shops.telegramChatId, chat))
    if (!shop)
      await ctx.reply(
        'This chat is not linked to a shop yet. Open the dashboard and send /start <link code>.',
      )
    return shop ?? null
  }

  async function fileBytes(fileId: string) {
    if (!bot) throw new Error('telegram not configured')
    const file = await bot.api.getFile(fileId)
    return download(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`)
  }

  function wire(deps: Deps, inbox: Inbox) {
    if (!bot) return
    const chatInShop = async (shop: Shop, id: string | undefined) => {
      const conv = id ? await conversationById(deps, id) : null
      return conv && conv.shopId === shop.id && conv.channel !== 'telegram_seller' ? conv : null
    }
    bot.catch((err) => log.error({ err: err.error }, 'telegram handler failed'))

    bot.command('start', async (ctx) => {
      const code = ctx.match.trim()
      if (!code)
        return void (await ctx.reply(
          `Send /start <link code> from your dashboard settings.\n\n${help}`,
        ))
      const [shop] = await db.select().from(shops).where(eq(shops.linkCode, code))
      if (!shop) return void (await ctx.reply('That link code is not valid.'))
      await db
        .update(shops)
        .set({ telegramChatId: String(ctx.chat.id) })
        .where(eq(shops.id, shop.id))
      await ctx.reply(`Linked to ${shop.name}.\n\n${help}`)
    })

    bot.command('help', (ctx) => ctx.reply(help))

    bot.command('login', async (ctx) => {
      const shop = await shopFor(ctx)
      if (!shop) return
      const code = String(randomInt(100000, 1000000))
      await db
        .insert(loginCodes)
        .values({ code, shopId: shop.id, expiresAt: deps.now() + 10 * 60 * 1000 })
      await ctx.reply(
        `Dashboard code: ${code}\nValid for 10 minutes.\n${env.PUBLIC_BASE_URL}/login`,
      )
    })

    bot.command('summary', async (ctx) => {
      const shop = await shopFor(ctx)
      if (!shop) return
      const s = await dailySummary({ db, shop, actor: 'seller', now: deps.now() })
      const low = s.lowStock.map((l) => `${l.item} (${l.available})`).join(', ') || 'none'
      await ctx.reply(
        `Today: ${s.today.orders} orders, ${s.today.revenue} sold, ${s.today.collected} collected.\nTop: ${s.today.topProducts.map((t) => `${t.name} x${t.qty}`).join(', ') || '-'}\nDue: ${s.dues.due} on ${s.dues.orders} orders\nLow stock: ${low}\nDrafts waiting: ${s.draftOrders}`,
      )
    })

    bot.command('reply', async (ctx) => {
      const shop = await shopFor(ctx)
      if (!shop) return
      const [id, ...rest] = ctx.match.trim().split(/\s+/)
      const conv = await chatInShop(shop, id)
      if (!conv || !rest.length) return void (await ctx.reply('Usage: /reply <chat> <text>'))
      try {
        await sendToCustomer(deps, conv, { kind: 'text', text: rest.join(' ') }, 'seller')
        await ctx.reply('Sent.')
      } catch (err) {
        await ctx.reply(err instanceof ToolError ? err.message : 'Could not send.')
      }
    })

    bot.command(['take', 'resume'], async (ctx) => {
      const shop = await shopFor(ctx)
      if (!shop) return
      const conv = await chatInShop(shop, ctx.match.trim())
      if (!conv) return void (await ctx.reply('Usage: /take <chat> or /resume <chat>'))
      const take = ctx.message?.text?.startsWith('/take')
      await db
        .update(conversations)
        .set({ pausedUntil: take ? deps.now() + 2 * 60 * 60 * 1000 : null })
        .where(and(eq(conversations.id, conv.id), eq(conversations.shopId, shop.id)))
      await ctx.reply(
        take ? 'You have this chat for 2 hours.' : 'The assistant answers this chat again.',
      )
    })

    bot.on('callback_query:data', async (ctx) => {
      const [kind, id, action] = ctx.callbackQuery.data.split(':')
      const shop = await shopFor(ctx)
      if (kind !== 'pa' || !id || !shop) return void (await ctx.answerCallbackQuery())
      try {
        if (action === 'a') {
          await ctx.answerCallbackQuery({ text: 'Working on it' })
          await approve(deps, shop, id)
        } else if (action === 'c') {
          await ctx.answerCallbackQuery({ text: 'Cancelled' })
          await cancel(deps, shop, id)
        } else if (action === 'e') {
          editing.set(String(ctx.chat?.id), id)
          await ctx.answerCallbackQuery()
          await ctx.reply('Send the new text.')
        }
      } catch (err) {
        await ctx
          .answerCallbackQuery({ text: err instanceof ToolError ? err.message : 'Failed' })
          .catch(() => undefined)
      }
    })

    bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) return
      const shop = await shopFor(ctx)
      if (!shop) return
      const chat = String(ctx.chat.id)
      const pendingId = editing.get(chat)
      if (pendingId) {
        editing.delete(chat)
        const res = await approve(deps, shop, pendingId, ctx.message.text).catch((err: Error) => ({
          ok: false,
          line: err.message,
        }))
        if (!res.ok) await ctx.reply(res.line)
        return
      }
      await ctx.replyWithChatAction('typing')
      await inbox.seller(shop, {
        chatId: chat,
        messageId: String(ctx.message.message_id),
        kind: 'text',
        text: ctx.message.text,
      })
    })

    bot.on(['message:voice', 'message:audio'], async (ctx) => {
      const shop = await shopFor(ctx)
      if (!shop) return
      const file = ctx.message.voice ?? ctx.message.audio!
      await ctx.replyWithChatAction('typing')
      await inbox.seller(shop, {
        chatId: String(ctx.chat.id),
        messageId: String(ctx.message.message_id),
        kind: 'voice',
        media: { bytes: await fileBytes(file.file_id), mime: file.mime_type ?? 'audio/ogg' },
      })
    })

    bot.on('message:photo', async (ctx) => {
      const shop = await shopFor(ctx)
      if (!shop) return
      const photo = ctx.message.photo.at(-1)!
      await ctx.replyWithChatAction('typing')
      await inbox.seller(shop, {
        chatId: String(ctx.chat.id),
        messageId: String(ctx.message.message_id),
        kind: 'photo',
        text: ctx.message.caption,
        media: { bytes: await fileBytes(photo.file_id), mime: 'image/jpeg' },
      })
    })
  }

  return { bot, seller, wire }
}
