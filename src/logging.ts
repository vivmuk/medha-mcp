// src/logging.ts — transport-level logging for Medhā MCP HTTP requests.
//
// Wraps the StreamableHTTPServerTransport's underlying res.write/res.json
// to capture both:
//
//   1. The JSON-RPC request body (from req.body — already validated by SDK)
//   2. The JSON-RPC response body (intercepted from res.json/res.send)
//
// Fire-and-forget — never block a response. Persists each call into
// `mcp_call_log` and any extracted artifact URLs/data URIs into `mcp_artifact`.

import type { Request, Response } from 'express'
import { insertArtifact, insertCall, ensureDbReady, dbEnabled } from './db.js'

interface CapturedResponse {
  status: number
  body: unknown                  // parsed JSON-RPC payload, if applicable
  rawText: string                // fallback string for SSE streams
  isJson: boolean
}

export function logMcpHttpCall(req: Request, res: Response, runBody: () => Promise<void>): void {
  if (!dbEnabled()) {
    void runBody()
    return
  }

  const startMs = Date.now()
  const authHeader = req.header('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
  const sessionId = req.header('mcp-session-id') || null

  // Capture response body by overriding res.json + res.write
  const captured: CapturedResponse = { status: 0, body: null, rawText: '', isJson: false }
  const origJson = res.json.bind(res)
  const origWrite = res.write.bind(res)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(res as any).json = function (body: unknown): Response {
    captured.status = res.statusCode
    captured.body = body
    captured.isJson = true
    captured.rawText = JSON.stringify(body)
    return origJson(body)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(res as any).write = function (chunk: Buffer | string, ...rest: unknown[]): boolean {
    if (chunk) captured.rawText += chunk.toString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origWrite as any).call(res, chunk, ...rest)
  }

  void (async () => {
    try {
      await ensureDbReady()
      await runBody()
    } catch (err) {
      captured.status = res.statusCode || 500
      captured.body = { error: (err as Error).message }
      captured.isJson = true
      logStdErr('handler error', (err as Error).message)
      throw err
    }
    // Fire-and-forget logging after response is delivered.
    void persist(req, captured, sessionId, bearer, Date.now() - startMs, captured.body).catch((e) =>
      logStdErr('persist failed', (e as Error).message)
    )
  })()
}

function logStdErr(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error('[medha-log]', ...args)
}

async function persist(
  req: Request,
  captured: CapturedResponse,
  sessionId: string | null,
  bearer: string,
  latencyMs: number,
  parsedBody: unknown
): Promise<void> {
  // Best-effort parse of the JSON-RPC payload in the request.
  const reqBody = (req.body ?? {}) as { method?: string; params?: unknown; id?: unknown }
  const method = typeof reqBody.method === 'string' ? reqBody.method : 'unknown'

  let clientName: string | null = null
  let clientVersion: string | null = null
  if (method === 'initialize' && reqBody.params && typeof reqBody.params === 'object') {
    const p = reqBody.params as Record<string, unknown>
    const ci = (p.clientInfo ?? {}) as Record<string, unknown>
    if (typeof ci.name === 'string') clientName = ci.name
    if (typeof ci.version === 'string') clientVersion = ci.version
  }

  let toolName: string | null = null
  if (method === 'tools/call' && reqBody.params && typeof reqBody.params === 'object') {
    const p = reqBody.params as Record<string, unknown>
    if (typeof p.name === 'string') toolName = p.name
  }

  // Capture summary of response: just keys + lengths + first chars to keep size sane.
  const summary = summarizeResponse(parsedBody)

  // Hash bearer (if present) — never store raw.
  const bearerHash = bearer ? await sha256Hex(bearer, 16) : null

  let errorMessage: string | null = null
  let statusCode = 0
  if (captured.status >= 400) {
    statusCode = captured.status
    errorMessage = summary.error ?? `http ${captured.status}`
  }
  if (summary.error) {
    errorMessage = (errorMessage ? errorMessage + ' | ' : '') + String(summary.error)
  }

  const callId = await insertCall({
    session_id: sessionId,
    client_name: clientName,
    client_version: clientVersion,
    bearer_hash: bearerHash,
    tool_name: toolName,
    method,
    request_json: reqBody,
    response_summary: summary,
    status_code: statusCode,
    latency_ms: latencyMs,
    error_message: errorMessage,
    venice_call_id: summary.venice_call_id ?? null,
  })

  // Persist any artifacts found in the response.
  if (callId && Array.isArray(summary.artifact_hints)) {
    for (const art of summary.artifact_hints) {
      await insertArtifact({
        call_id: callId,
        kind: art.kind,
        model: art.model ?? null,
        venice_url: art.url ?? null,
        mime_type: art.mime ?? null,
        byte_size: art.bytes ?? null,
        prompt: art.prompt ?? null,
        seed: art.seed != null ? String(art.seed) : null,
        params: art.params ?? null,
      })
    }
  }
}

interface ResponseSummary {
  result_kind?: string
  is_error?: boolean
  content_types?: string[]
  media_count?: number
  text_size?: number
  venice_call_id?: string | null
  error?: string | null
  artifact_hints?: ArtifactHint[]
}

interface ArtifactHint {
  kind: string
  url?: string | null
  model?: string | null
  mime?: string | null
  bytes?: number | null
  prompt?: string | null
  seed?: number | string | null
  params?: Record<string, unknown> | null
}

function summarizeResponse(parsed: unknown): ResponseSummary {
  const out: ResponseSummary = {}
  if (!parsed || typeof parsed !== 'object') return out
  const env = parsed as { error?: unknown; result?: unknown }
  if (env.error) {
    const e = env.error as { message?: unknown; code?: unknown }
    out.error = String(e.message ?? JSON.stringify(e))
    return out
  }
  const r = env.result
  if (!r || typeof r !== 'object') return out
  const result = r as Record<string, unknown>

  if (Array.isArray(result.content)) {
    const content = result.content as Array<Record<string, unknown>>
    const types = content.map((c) => String(c.type ?? '')).filter(Boolean)
    out.content_types = types
    out.media_count = types.filter((t) => t === 'image' || t === 'audio').length
    out.text_size = types.includes('text') ? String((content.find((c) => c.type === 'text')?.text ?? '')).length : 0
    if (typeof result.isError === 'boolean') out.is_error = result.isError
    // Capture venice-side call IDs (the SDK sometimes surfaces them in structuredContent).
    const sc = result.structuredContent
    if (sc && typeof sc === 'object') {
      const s = sc as Record<string, unknown>
      if (typeof s.id === 'string') out.venice_call_id = s.id
    }

    out.artifact_hints = []
    for (const block of content) {
      if (block.type === 'image') {
        out.artifact_hints.push({
          kind: 'image',
          url: null,
          model: null,
          mime: typeof block.mimeType === 'string' ? block.mimeType : 'image/*',
          bytes: typeof block.data === 'string' ? block.data.length : null,
          prompt: null,
          seed: null,
          params: null,
        })
      } else if (block.type === 'audio') {
        out.artifact_hints.push({
          kind: 'audio',
          url: null,
          model: null,
          mime: typeof block.mimeType === 'string' ? block.mimeType : 'audio/*',
          bytes: typeof block.data === 'string' ? block.data.length : null,
          prompt: null,
          seed: null,
          params: null,
        })
      } else if (typeof block.text === 'string') {
        // Also detect URL lines ("URL: https://..."), queue_id, etc.
        const text = block.text
        const urlMatch = text.match(/https?:\/\/\S+/)
        if (urlMatch) {
          out.artifact_hints.push({
            kind: classifyArtifactUrl(urlMatch[0]),
            url: urlMatch[0],
            model: null,
            mime: null,
            bytes: null,
            prompt: null,
            seed: null,
            params: null,
          })
        }
        const qmatch = text.match(/queue_id=[^\s,}]+/)
        if (qmatch) out.venice_call_id = (out.venice_call_id ?? qmatch[0].split('=')[1])
      }
    }
  } else if (typeof result.text === 'string') {
    out.result_kind = 'text'
    out.text_size = result.text.length
  }
  return out
}

function classifyArtifactUrl(url: string): string {
  if (/\.(mp4|webm|mov)(?:\?|$)/i.test(url)) return 'video'
  if (/\.(mp3|wav|ogg|m4a|aac|opus)(?:\?|$)/i.test(url)) return 'audio'
  if (/\.(png|jpe?g|webp)(?:\?|$)/i.test(url)) return 'image'
  return 'asset'
}

async function sha256Hex(input: string, hexChars: number): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(input).digest('hex').slice(0, hexChars)
}
