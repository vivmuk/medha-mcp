// src/presets-runtime.ts
// ────────────────────────────────────────────────────────────────────
// Dynamic preset overlay.
//
// Architecture:
//
//   TOOL_PREFS in src/presets.ts  ─── baked defaults, edited at build time
//          │
//          ▼
//   mcp_settings table (Postgres) ── runtime overrides written by the
//                                    admin SPA at /admin
//          │
//          ▼
//   getEffectiveToolPrefs()        ─── async read with TTL cache; merges
//                                    overlay on top of baked and returns
//                                    the merged map. Admin POST handlers
//                                    call invalidatePresetCache() so the
//                                    next read is fresh.
//
// Setting keys (stored as JSONB):
//   preset.<tool_name>            = { defaultModel?, alternates?, hint? }
//   envHint.<category>            = string (e.g. "Use X for hard reasoning.")
//   veniceDefaults                = { chat?, image?, tts?, asr?, video?, music?, embed? }
//
// If DATABASE_URL is unset or unreachable, all helpers degrade to baked
// defaults — the MCP server keeps working in code-only mode.
// ────────────────────────────────────────────────────────────────────

import { TOOL_PREFS as BAKED_TOOL_PREFS, FAVORITES as BAKED_FAVORITES, type ToolPref } from './presets.js'
import { dbPool, getAllSettings, getSetting, setSetting, deleteSetting } from './db.js'

const TTL_MS = 5_000
let cache: { fetchedAt: number; toolPrefs: Record<string, ToolPref>; envHints: Record<string, string>; veniceDefaults: Record<string, string> } | null = null

async function fetchOverlay(): Promise<typeof cache> {
  const fallback = { fetchedAt: Date.now(), toolPrefs: BAKED_TOOL_PREFS, envHints: {}, veniceDefaults: {} }
  if (!dbPool()) return fallback
  try {
    const rows = await getAllSettings()
    const toolOverlay: Record<string, ToolPref> = {}
    const envHints: Record<string, string> = {}
    const veniceDefaults: Record<string, string> = {}

    for (const row of rows) {
      if (row.key.startsWith('preset.')) {
        const toolName = row.key.slice('preset.'.length)
        const v = row.value as Partial<ToolPref> | undefined
        if (!v || typeof v !== 'object') continue
        const base = BAKED_TOOL_PREFS[toolName]
        toolOverlay[toolName] = {
          defaultModel: typeof v.defaultModel === 'string' ? v.defaultModel : base?.defaultModel ?? '-',
          alternates: Array.isArray(v.alternates) ? v.alternates.filter((x): x is string => typeof x === 'string') : base?.alternates ?? [],
          hint: typeof v.hint === 'string' ? v.hint : base?.hint,
        }
      } else if (row.key.startsWith('envHint.')) {
        const cat = row.key.slice('envHint.'.length)
        if (typeof row.value === 'string') envHints[cat] = row.value
      } else if (row.key === 'veniceDefaults') {
        const v = row.value as Record<string, unknown> | undefined
        if (v && typeof v === 'object') {
          for (const [k, val] of Object.entries(v)) {
            if (typeof val === 'string') veniceDefaults[k] = val
          }
        }
      }
    }

    const toolPrefs: Record<string, ToolPref> = {}
    for (const [k, v] of Object.entries(BAKED_TOOL_PREFS)) toolPrefs[k] = v
    for (const [k, v] of Object.entries(toolOverlay)) toolPrefs[k] = v
    return { fetchedAt: Date.now(), toolPrefs, envHints, veniceDefaults }
  } catch {
    return fallback
  }
}

export async function getEffectiveToolPrefs(): Promise<Record<string, ToolPref>> {
  if (!cache || Date.now() - cache.fetchedAt > TTL_MS) cache = await fetchOverlay()
  return cache!.toolPrefs
}

export async function getEffectiveEnvHints(): Promise<Record<string, string>> {
  if (!cache || Date.now() - cache.fetchedAt > TTL_MS) cache = await fetchOverlay()
  return cache!.envHints
}

export async function getEffectiveVeniceDefaults(): Promise<Record<string, string>> {
  if (!cache || Date.now() - cache.fetchedAt > TTL_MS) cache = await fetchOverlay()
  return cache!.veniceDefaults
}

export async function getEffectiveFavorites(): Promise<{
  description: string
  server: string
  environmentHints: Record<string, string>
  toolsByName: Record<string, ToolPref>
}> {
  const toolPrefs = await getEffectiveToolPrefs()
  const envHints = await getEffectiveEnvHints()
  return {
    description: 'Medhā operator-curated defaults — single canonical set the agent should use unless the task explicitly says otherwise. Edits via /admin persist to mcp_settings and overlay these defaults on next MCP request.',
    server: BAKED_FAVORITES.server,
    environmentHints: { ...BAKED_FAVORITES.environmentHints, ...envHints },
    toolsByName: toolPrefs,
  }
}

export function invalidatePresetCache(): void {
  cache = null
}

// ─── mutators (called by the /admin API) ────────────────────────────

export async function setPresetOverlay(toolName: string, value: Partial<ToolPref>, updatedBy: string | null = null): Promise<boolean> {
  const ok = await setSetting(`preset.${toolName}`, value, updatedBy)
  if (ok) invalidatePresetCache()
  return ok
}

export async function deletePresetOverlay(toolName: string): Promise<boolean> {
  const ok = await deleteSetting(`preset.${toolName}`)
  if (ok) invalidatePresetCache()
  return ok
}

export async function setEnvHint(category: string, value: string, updatedBy: string | null = null): Promise<boolean> {
  const ok = await setSetting(`envHint.${category}`, value, updatedBy)
  if (ok) invalidatePresetCache()
  return ok
}

export async function deleteEnvHint(category: string): Promise<boolean> {
  const ok = await deleteSetting(`envHint.${category}`)
  if (ok) invalidatePresetCache()
  return ok
}

export async function setVeniceDefaults(values: Record<string, string>, updatedBy: string | null = null): Promise<boolean> {
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'string' && v.length > 0) cleaned[k] = v
  }
  const ok = await setSetting('veniceDefaults', cleaned, updatedBy)
  if (ok) invalidatePresetCache()
  return ok
}

// read-only pass-through for /admin
export async function getRawSetting(key: string): Promise<unknown | null> {
  return await getSetting(key)
}
