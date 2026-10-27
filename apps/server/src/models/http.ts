export class ModelError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function request(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit; timeoutMs: number },
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: init.method ?? 'POST',
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs),
    }).catch((err: Error) => {
      throw new ModelError(`${url}: ${err.message}`)
    })
    const retryable = res.status === 429 || res.status >= 500
    if (res.ok || !retryable || attempt >= 1) {
      if (!res.ok) throw new ModelError(`${url}: ${res.status} ${await res.text()}`, res.status)
      return res
    }
    await sleep(500 + Math.random() * 1000)
  }
}

export async function postJson<T>(
  url: string,
  key: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const res = await request(url, {
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs,
  })
  return (await res.json()) as T
}
