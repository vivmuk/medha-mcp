// src/logging.ts — transport-level logging for Medhā MCP HTTP requests.
//
// Strategy:
//   - Wrap `transport.send` (StreamableHTTPServerTransport#send) to capture
//     every JSON-RPC payload the SDK writes back to the client. The SDK uses
//     WebStandardReadableStream + @hono/node-server; res.write/res.json
//     overrides don't intercept those writes. transport.send() is the
//     canonical interception point — it receives the {jsonrpc, id, result |
//     | error} payload directly.
//   - Use req.body to read the inbound JSON-RPC request. The bearer is
//     hashed (sha256 first-16) before persistence. Raw bearer never enters
//     any DB row.
//
// Fire-and-forget — every DB insert is wrapped in try/catch so a DB outage
// does NOT break a tools/call response.

import { createHash, randomUUID } from 'node:crypto'
import type { Request } from 'express'
import { insertArtifact, insertCall, ensureDbReady, dbEnabled } from './db.js'

interface CapturedMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  result?: unknown
  error?: unknown
  notification?: boolean
  ts: number
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

interface SendLike {
  (message: unknown, options?: unknown): Promise<void> | void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTransport = { send: (message: any, options?: any) => Promise<void> | void; [k: string]: any }

export function logMcpHttpCall(
  req: Request,
  transport: { send: (...a: unknown[]) => Promise<void> | void } | null | undefined,
  runBody: () => Promise<void>
): void {
  if (!dbEnabled()) {
    void runBody()
    return
  }

  const startMs = Date.now()
  const authHeader = req.header('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
  const sessionId = req.header('mcp-session-id') || null

  // Capture every outbound JSON-RPC message by wrapping transport.send.
  const capturedMessages: CapturedMessage[] = []
  if (transport && typeof transport.send === 'function') {
    const originalSend = transport.send.bind(transport) as SendLike
    transport.send = (msg: unknown, opts?: unknown) => {
      try {
        if (msg && typeof msg === 'object') {
          capturedMessages.push({ ...(msg as CapturedMessage), ts: Date.now() })
        }
      } catch {
        // never let logging crash a tools/call
      }
      return originalSend(msg, opts)
    }
  }

  void (async () => {
    try {
      await ensureDbReady()
      await runBody()
    } catch (err) {
      logStdErr('handler error', (err as Error).message)
      throw err
    }
    void persist(req, capturedMessages, sessionId, bearer, Date.now() - startMs).catch(
      (e) => logStdErr('persist failed', (e as Error).message)
    )
  })()
}

function logStdErr(...args: unknown[]): void {
  if ((process.env.MCP_LOG_LEVEL ?? 'info') === 'silent') return
  // eslint-disable-next-line no-console
  console.error('[medha-log]', ...args)
}

async function persist(
  req: Request,
  messages: CapturedMessage[],
  sessionId: string | null,
  bearer: string,
  latencyMs: number
): Promise<void> {
  const reqBody = (req.body ?? {}) as { method?: string; params?: unknown; id?: unknown }
  const inboundMethod = typeof reqBody.method === 'string' ? reqBody.method : 'unknown'

  // Resolve client name/version from the most recent initialize in this request.
  let clientName: string | null = null
  let clientVersion: string | null = null
  if (inboundMethod === 'initialize' && reqBody.params && typeof reqBody.params === 'object') {
    const p = reqBody.params as Record<string, unknown>
    const ci = (p.clientInfo ?? {}) as Record<string, unknown>
    if (typeof ci.name === 'string') clientName = ci.name
    if (typeof ci.version === 'string') clientVersion = ci.version
  } else {
    // Find initialize message from session start (if any captured upstream).
    const init = messages.find(
      (m) =>
        typeof m.result === 'object' &&
        m.result !== null &&
        typeof (m.result as Record<string, unknown>).serverInfo === 'object'
    )
    if (init && init.result && typeof init.result === 'object') {
      const r = init.result as { serverInfo?: Record<string, unknown> }
      // server is the *server* name — doesn't help for client.
    }
  }

  let toolName: string | null = null
  if (inboundMethod === 'tools/call' && reqBody.params && typeof reqBody.params === 'object') {
    const p = reqBody.params as Record<string, unknown>
    if (typeof p.name === 'string') toolName = p.name
  }

  // The matching outbound response is on the same `id`.
  const responseMsg = messages.find(
    (m) => m.id !== undefined && m.id !== null && reqBody.id !== undefined && reqBody.id !== null && String(m.id) === String(reqBody.id)
  )
  const summary = summarizeResponse(responseMsg)
  const errorMsg = responseMsg?.error ? extractError(responseMsg.error) : null
  const statusCode = errorMsg ? 1 : 0
  const bearerHash = bearer ? createHash('sha256').update(bearer).digest('hex').slice(0, 16) : null
  // Generate a request_id we can correlate with rows in mcp_artifact.
  const rowRequestId = randomUUID()

  const callId = await insertCall({
    session_id: sessionId,
    client_name: clientName,
    client_version: clientVersion,
    bearer_hash: bearerHash,
    tool_name: toolName,
    method: inboundMethod,
    request_json: reqBody,
    response_summary: summary,
    status_code: statusCode,
    latency_ms: latencyMs,
    error_message: errorMsg !== null ? (summary.error ?? 'unknown') : null,
    venice_call_id: summary.venice_call_id ?? null,
  })

  if (Array.isArray(summary.artifact_hints) && summary.artifact_hints.length > 0) {
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

  // Quietly log a one-line summary for ops visibility
  logStdErr(
    'call',
    inboundMethod,
    toolName ?? '-',
    `status=${statusCode}`,
    `latency=${latencyMs}ms`,
    'artifacts=' + (summary.artifact_hints?.length ?? 0)
  )
}

function extractError(err: unknown): string | null {
  if (!err) return null
  if (typeof err === 'string') return err
  if (typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown }
    return String(e.message ?? JSON.stringify(e))
  }
  return null
}

function summarizeResponse(msg: CapturedMessage | undefined): ResponseSummary {
  const out: ResponseSummary = {}
  if (!msg) return out

  if (msg.error) {
    out.error = extractError(msg.error)
    out.is_error = true
    return out
  }
  const r = msg.result
  if (!r || typeof r !== 'object') {
    out.result_kind = 'unknown'
    return out
  }
  const result = r as Record<string, unknown>

  if (Array.isArray(result.content)) {
    const content = result.content as Array<Record<string, unknown>>
    const types = content.map((c) => String(c.type ?? '')).filter(Boolean)
    out.content_types = types
    out.media_count = types.filter((t) => t === 'image' || t === 'audio').length
    const textBlk = content.find((c) => c.type === 'text')
    out.text_size = textBlk && typeof textBlk.text === 'string' ? textBlk.text.length : 0
    if (typeof result.isError === 'boolean') out.is_error = result.isError

    // Structured content may carry Venice-side IDs.
    const sc = result.structuredContent
    if (sc && typeof sc === 'object') {
      const s = sc as Record<string, unknown>
      if (typeof s.id === 'string') out.venice_call_id = s.id
    }

    out.artifact_hints = []
    for (const block of content) {
      if (block.type === 'image') {
        const data = typeof block.data === 'string' ? block.data : null
        out.artifact_hints.push({
          kind: 'image',
          url: null,
          model: null,
          mime: typeof block.mimeType === 'string' ? block.mimeType : 'image/*',
          bytes: data?.length ?? null,
          prompt: null,
          seed: null,
          params: null,
        })
      } else if (block.type === 'audio') {
        const data = typeof block.data === 'string' ? block.data : null
        out.artifact_hints.push({
          kind: 'audio',
          url: null,
          model: null,
          mime: typeof block.mimeType === 'string' ? block.mimeType : 'audio/*',
          bytes: data?.length ?? null,
          prompt: null,
          seed: null,
          params: null,
        })
      } else if (typeof block.text === 'string') {
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
        const qmatch = text.match(/queue_id[=:\s]+([A-Za-z0-9-]+)/i)
        if (qmatch && !out.venice_call_id) out.venice_call_id = qmatch[1]
        const modelMatch = text.match(/model[=:\s]+([A-Za-z0-9._/-]+)/i)
        if (modelMatch) {
          const lastArt = out.artifact_hints[out.artifact_hints.length - 1]
          if (lastArt) lastArt.model = modelMatch[1]
        }
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
