import { css } from './style.ts'

type Line = {
  role: 'customer' | 'agent' | 'seller' | 'system'
  text?: string | null
  imageUrl?: string | null
  quickReplies?: string[]
}

const copy = {
  bn: {
    title: 'দোকানের সাথে কথা বলুন',
    status: 'সাধারণত কয়েক সেকেন্ডে উত্তর দেয়',
    hint: 'যেমন: “এটা M সাইজ আছে? ঢাকায় ডেলিভারি কত?”',
    placeholder: 'লিখুন…',
    send: 'পাঠান',
    record: 'ভয়েস মেসেজ',
    stop: 'রেকর্ডিং থামান',
    voiceSent: 'ভয়েস মেসেজ পাঠানো হয়েছে',
    micError: 'মাইক্রোফোন চালু করা যায়নি, টাইপ করে লিখুন।',
    failed: 'পাঠানো যায়নি, আবার চেষ্টা করুন।',
    open: 'চ্যাট খুলুন',
    close: 'চ্যাট বন্ধ করুন',
  },
  en: {
    title: 'Chat with the shop',
    status: 'Usually replies in seconds',
    hint: 'For example: “Is this in M? What is delivery to Chattogram?”',
    placeholder: 'Write a message…',
    send: 'Send',
    record: 'Voice message',
    stop: 'Stop recording',
    voiceSent: 'Voice message sent',
    micError: 'Could not turn on the microphone, please type instead.',
    failed: 'Could not send, please try again.',
    open: 'Open chat',
    close: 'Close chat',
  },
}

const icons = {
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
  close: 'M6 6l12 12M18 6 6 18',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0M12 18v3',
  stop: 'M7 7h10v10H7z',
  send: 'M4 12 20 4l-6 16-3-7z',
}

function icon(name: keyof typeof icons) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', icons[name])
  svg.append(path)
  return svg
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
) {
  const node = document.createElement(tag)
  const { class: cls, ...rest } = props
  if (cls) node.className = cls
  Object.assign(node, rest)
  node.append(...children)
  return node
}

function start(script: HTMLScriptElement) {
  const key = script.dataset.shop
  if (!key) return
  const base = new URL(script.src).origin
  const api = `${base}/api/w/${encodeURIComponent(key)}`
  const t = copy[script.dataset.lang === 'en' ? 'en' : 'bn']
  const color = /^#[0-9a-f]{3,8}$/i.test(script.dataset.color ?? '')
    ? script.dataset.color!
    : '#1a8cf0'
  const productId = script.dataset.product
  const storageKey = `saudaai:${key}`
  let sid = ''
  try {
    sid = localStorage.getItem(storageKey) ?? ''
  } catch {
    sid = ''
  }

  const host = el('div')
  const root = host.attachShadow({ mode: 'open' })
  root.append(el('style', { textContent: css(color) }))

  const log = el('div', { class: 'log', role: 'log', ariaLive: 'polite' })
  const typing = el('div', { class: 'typing', hidden: true }, el('i'), el('i'), el('i'))
  const error = el('p', { class: 'error', hidden: true, role: 'alert' })
  const input = el('input', { placeholder: t.placeholder, ariaLabel: t.placeholder })
  const mic = el('button', { type: 'button', class: 'round', ariaLabel: t.record }, icon('mic'))
  const send = el(
    'button',
    { type: 'submit', class: 'round send', ariaLabel: t.send },
    icon('send'),
  )
  const form = el('form', { class: 'composer' }, input, mic, send)
  const close = el('button', { type: 'button', class: 'close', ariaLabel: t.close }, icon('close'))
  const title = el('strong', { textContent: t.title })
  const panel = el(
    'section',
    { class: 'panel', hidden: true, role: 'dialog', ariaLabel: t.title },
    el(
      'header',
      {},
      el('span', { class: 'avatar' }, icon('chat')),
      el('div', { class: 'who' }, title, el('small', { textContent: t.status })),
      close,
    ),
    log,
    error,
    form,
  )
  const bubble = el('button', { type: 'button', class: 'bubble', ariaLabel: t.open }, icon('chat'))
  root.append(panel, bubble)
  document.body.append(host)

  const scroll = () => (log.scrollTop = log.scrollHeight)

  function add(line: Line) {
    typing.hidden = true
    const mine = line.role === 'customer'
    const msg = el('div', { class: `msg ${mine ? 'mine' : 'theirs'}` })
    if (line.imageUrl) msg.append(el('img', { src: line.imageUrl, alt: '', loading: 'lazy' }))
    if (line.text) msg.append(el('p', { textContent: line.text }))
    if (line.quickReplies?.length) {
      msg.append(
        el(
          'div',
          { class: 'quick' },
          ...line.quickReplies.map((q) => {
            const b = el('button', { type: 'button', textContent: q })
            b.onclick = () => say(q)
            return b
          }),
        ),
      )
    }
    log.insertBefore(msg, typing)
    scroll()
  }

  function fail(text: string) {
    error.textContent = text
    error.hidden = false
  }

  const headers = () => ({ 'x-saudaai-session': sid })

  async function say(text: string) {
    if (!text.trim()) return
    error.hidden = true
    add({ role: 'customer', text })
    input.value = ''
    const res = await fetch(`${api}/messages`, {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ text, pageUrl: location.href.slice(0, 500), productId }),
    }).catch(() => null)
    if (!res?.ok) fail(t.failed)
  }

  let recorder: MediaRecorder | null = null
  async function toggleVoice() {
    if (recorder) {
      recorder.stop()
      return
    }
    error.hidden = true
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks: Blob[] = []
      const rec = new MediaRecorder(media)
      recorder = rec
      rec.ondataavailable = (e) => chunks.push(e.data)
      rec.onstop = async () => {
        recorder = null
        mic.classList.remove('live')
        mic.replaceChildren(icon('mic'))
        mic.ariaLabel = t.record
        media.getTracks().forEach((track) => track.stop())
        const body = new FormData()
        body.append('voice', new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), 'voice.webm')
        if (productId) body.append('productId', productId)
        add({ role: 'customer', text: t.voiceSent })
        const res = await fetch(`${api}/messages`, {
          method: 'POST',
          headers: headers(),
          body,
        }).catch(() => null)
        if (!res?.ok) fail(t.failed)
      }
      rec.start()
      mic.classList.add('live')
      mic.replaceChildren(icon('stop'))
      mic.ariaLabel = t.stop
    } catch {
      fail(t.micError)
    }
  }

  let ready: Promise<void> | null = null
  function connect() {
    ready ??= (async () => {
      const info = (await fetch(api, { headers: headers() }).then((r) => r.json())) as {
        name: string
        session: string
      }
      sid = info.session
      try {
        localStorage.setItem(storageKey, sid)
      } catch {
        // private mode: the chat still works for this page view
      }
      title.textContent = info.name
      log.append(typing)
      const history = (await fetch(`${api}/messages`, { headers: headers() }).then((r) =>
        r.json(),
      )) as { messages: Line[] }
      if (!history.messages.length)
        log.insertBefore(el('p', { class: 'hint', textContent: t.hint }), typing)
      history.messages.forEach(add)
      const stream = new EventSource(`${api}/stream?session=${sid}`)
      stream.onmessage = (e) => {
        const ev = JSON.parse(e.data) as Line & { kind: string }
        if (ev.kind === 'typing') {
          typing.hidden = false
          scroll()
        } else add(ev)
      }
    })()
    return ready
  }

  function toggle(open: boolean) {
    panel.hidden = !open
    bubble.hidden = open
    if (open) {
      connect()
        .then(() => input.focus())
        .catch(() => fail(t.failed))
    }
  }

  bubble.onclick = () => toggle(true)
  close.onclick = () => toggle(false)
  mic.onclick = toggleVoice
  form.onsubmit = (e) => {
    e.preventDefault()
    connect().then(() => say(input.value))
  }
}

const script = document.currentScript as HTMLScriptElement | null
if (script) {
  if (document.body) start(script)
  else document.addEventListener('DOMContentLoaded', () => start(script))
}
