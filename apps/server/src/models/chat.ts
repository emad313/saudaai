import { ModelError, postJson } from './http.ts'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' | 'mp3' } }

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type ToolSpec = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type Endpoint = { provider: string; baseUrl: string; key: string; model: string }

type Completion = {
  choices: {
    message: {
      content: string | null
      reasoning_content?: string
      tool_calls?: ToolCall[]
    }
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

// Muse Spark Open can emit its reasoning inline; it must never reach a seller or customer.
function stripReasoning(text: string | null): string {
  return (text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

export async function complete(
  ep: Endpoint,
  body: {
    messages: ChatMessage[]
    tools?: ToolSpec[]
    json?: boolean
    temperature?: number
    maxTokens?: number
  },
  timeoutMs: number,
) {
  const res = await postJson<Completion>(
    `${ep.baseUrl.replace(/\/$/, '')}/chat/completions`,
    ep.key,
    {
      model: ep.model,
      messages: body.messages,
      ...(body.tools?.length ? { tools: body.tools, tool_choice: 'auto' } : {}),
      ...(body.json ? { response_format: { type: 'json_object' } } : {}),
      temperature: body.temperature ?? 0.2,
      max_tokens: body.maxTokens ?? 1024,
    },
    timeoutMs,
  )
  const msg = res.choices[0]?.message
  if (!msg) throw new ModelError(`${ep.provider}: empty completion`)
  return {
    text: stripReasoning(msg.content),
    toolCalls: msg.tool_calls ?? [],
    inputUnits: res.usage?.prompt_tokens,
    outputUnits: res.usage?.completion_tokens,
  }
}

export function parseJsonReply(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new ModelError('model did not return json')
  return JSON.parse(text.slice(start, end + 1))
}
