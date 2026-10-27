export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init
  const res = await fetch(path, {
    ...rest,
    credentials: 'same-origin',
    headers:
      json === undefined ? rest.headers : { 'content-type': 'application/json', ...rest.headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  })
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (!res.ok)
    throw new ApiError(res.status, body?.error?.message ?? `request failed (${res.status})`)
  return body as T
}

export const send = <T>(path: string, method: string, json?: unknown) =>
  api<T>(path, { method, json })
