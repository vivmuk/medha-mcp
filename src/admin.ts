// src/admin.ts
// ────────────────────────────────────────────────────────────────────
// /admin  — REST API + static SPA.
//
// Auth: ADMIN_TOKEN env var (or VENICE_MCP_AUTH_TOKEN if you want a
// quick share with the MCP bearer). Pass as `Authorization: Bearer *** in every
// request. If neither env is set, /admin returns 503 and a clear message.
//
// Endpoints:
//
//   GET    /admin/api/status              health, version, DB state, default models
//   GET    /admin/api/settings            [ { key, value, updatedAt, updatedBy } ]
//   GET    /admin/api/presets/effective   merged view of baked + overrides
//   PUT    /admin/api/preset/:tool        { defaultModel?, alternates?, hint? }
//   DELETE /admin/api/preset/:tool
//   PUT    /admin/api/env-hint/:cat       { value }
//   DELETE /admin/api/env-hint/:cat
//   PUT    /admin/api/venice-defaults     { chat?, image?, tts?, asr?, video?, music?, embed? }
//   GET    /admin/api/calls               ?limit&tool&hours
//   GET    /admin/api/artifacts           ?limit&kind
//   GET    /admin/api/spend               ?hours
//   GET    /admin/api/catalog             live Venice catalog (proxied from api.venice.ai)
//   GET    /admin/api/voices              live Venice voices
//   GET    /admin/api/styles              live Venice image styles
//   GET    /admin/                        SPA HTML (static file)
//   GET    /admin/assets/*                SPA static
//
// ────────────────────────────────────────────────────────────────────

import express, { Router, type Request, type Response, type NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import {
  setPresetOverlay, deletePresetOverlay,
  setEnvHint, deleteEnvHint,
  setVeniceDefaults,
  getEffectiveFavorites,
} from './presets-runtime.js'
import {
  dbPool, dbEnabled,
  listCalls, listArtifacts, spendByHour,
  getAllSettings,
} from './db.js'
import type { VeniceClient } from './venice-client.js'

function checkAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_TOKEN || process.env.VENICE_MCP_AUTH_TOKEN
  if (!expected) {
    res.status(503).json({ error: 'admin disabled — set ADMIN_TOKEN env var' })
    return
  }
  const got = (req.header('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!got || got.length < expected.length - 4) {
    res.status(401).json({ error: 'missing Bearer token' })
    return
  }
  let ok = false
  try {
    const a = Buffer.from(got); const b = Buffer.from(expected)
    ok = a.length === b.length && timingSafeEqual(a, b)
  } catch { ok = false }
  if (!ok) { res.status(401).json({ error: 'invalid Bearer token' }); return }
  next()
}

export function buildAdminRouter(client: VeniceClient): Router {
  const r = express.Router()
  r.use(express.json({ limit: '1mb' }))

  // ─── status ────────────────────────────────────────────────
  r.get('/status', checkAuth, async (_req, res) => {
    const eff = await getEffectiveFavorites()
    const veniceDefaults = await fetchVeniceDefaults()
    res.json({
      ok: true,
      version: process.env.npm_package_version || 'unknown',
      serverName: eff.server,
      dbEnabled: dbEnabled(),
      dbReady: dbPool() != null,
      env: {
        PORT: process.env.PORT || '',
        VENICE_DEFAULT_CHAT_MODEL: veniceDefaults.chat || '',
        VENICE_DEFAULT_IMAGE_MODEL: veniceDefaults.image || '',
        VENICE_DEFAULT_TTS_MODEL: veniceDefaults.tts || '',
        VENICE_DEFAULT_ASR_MODEL: veniceDefaults.asr || '',
        VENICE_DEFAULT_VIDEO_MODEL: veniceDefaults.video || '',
        VENICE_DEFAULT_MUSIC_MODEL: veniceDefaults.music || '',
        VENICE_DEFAULT_EMBED_MODEL: veniceDefaults.embed || '',
      },
      costCapPath: process.env.AIPHARMAXCHANGE_SPEND_PATH || '/tmp/aipharmaxchange_spend',
    })
  })

  // ─── settings ──────────────────────────────────────────────
  r.get('/settings', checkAuth, async (_req, res) => {
    const rows = await getAllSettings()
    res.json({ settings: rows })
  })

  r.get('/presets/effective', checkAuth, async (_req, res) => {
    const eff = await getEffectiveFavorites()
    res.json(eff)
  })

  r.put('/preset/:tool', checkAuth, async (req, res) => {
    const tool = String(req.params.tool)
    const body = req.body || {}
    const ok = await setPresetOverlay(tool, body, 'admin')
    if (!ok) return res.status(503).json({ error: 'DB unavailable' })
    res.json({ ok: true, tool })
  })

  r.delete('/preset/:tool', checkAuth, async (req, res) => {
    const tool = String(req.params.tool)
    const ok = await deletePresetOverlay(tool)
    if (!ok) return res.status(503).json({ error: 'DB unavailable' })
    res.json({ ok: true, tool })
  })

  r.put('/env-hint/:cat', checkAuth, async (req, res) => {
    const cat = String(req.params.cat)
    const { value } = req.body || {}
    if (typeof value !== 'string') return res.status(400).json({ error: 'value (string) required' })
    const ok = await setEnvHint(cat, value, 'admin')
    if (!ok) return res.status(503).json({ error: 'DB unavailable' })
    res.json({ ok: true, category: cat })
  })

  r.delete('/env-hint/:cat', checkAuth, async (req, res) => {
    const cat = String(req.params.cat)
    const ok = await deleteEnvHint(cat)
    if (!ok) return res.status(503).json({ error: 'DB unavailable' })
    res.json({ ok: true, category: cat })
  })

  r.put('/venice-defaults', checkAuth, async (req, res) => {
    const body = req.body || {}
    const ok = await setVeniceDefaults(body, 'admin')
    if (!ok) return res.status(503).json({ error: 'DB unavailable' })
    res.json({ ok: true, applied: body })
  })

  // ─── operations data ───────────────────────────────────────
  r.get('/calls', checkAuth, async (req, res) => {
    const limit = Number(req.query.limit) || 100
    const tool = req.query.tool ? String(req.query.tool) : undefined
    const hours = Number(req.query.hours) || 0
    const rows = await listCalls({ limit, tool, sinceHours: hours || undefined })
    res.json({ calls: rows })
  })

  r.get('/artifacts', checkAuth, async (req, res) => {
    const limit = Number(req.query.limit) || 100
    const kind = req.query.kind ? String(req.query.kind) : undefined
    const rows = await listArtifacts({ limit, kind })
    res.json({ artifacts: rows })
  })

  r.get('/spend', checkAuth, async (req, res) => {
    const hours = Number(req.query.hours) || 24
    const rows = await spendByHour({ sinceHours: hours })
    res.json({ rows, hours })
  })

  // ─── proxies to Venice ─────────────────────────────────────
  r.get('/catalog', checkAuth, async (_req, res) => {
    try {
      const data = await client.get<unknown>('/v1/models')
      res.json(data)
    } catch (err) {
      res.status(502).json({ error: (err as Error).message })
    }
  })

  r.get('/voices', checkAuth, async (_req, res) => {
    try {
      const data = await client.get<unknown>('/v1/audio/voices')
      res.json(data)
    } catch (err) {
      res.status(502).json({ error: (err as Error).message })
    }
  })

  r.get('/styles', checkAuth, async (_req, res) => {
    try {
      const data = await client.get<unknown>('/v1/image/styles')
      res.json(data)
    } catch (err) {
      res.status(502).json({ error: (err as Error).message })
    }
  })

  return r
}

async function fetchVeniceDefaults(): Promise<Record<string, string>> {
  return {
    chat: process.env.VENICE_DEFAULT_CHAT_MODEL || '',
    image: process.env.VENICE_DEFAULT_IMAGE_MODEL || '',
    tts: process.env.VENICE_DEFAULT_TTS_MODEL || '',
    asr: process.env.VENICE_DEFAULT_ASR_MODEL || '',
    video: process.env.VENICE_DEFAULT_VIDEO_MODEL || '',
    music: process.env.VENICE_DEFAULT_MUSIC_MODEL || '',
    embed: process.env.VENICE_DEFAULT_EMBED_MODEL || '',
  }
}
