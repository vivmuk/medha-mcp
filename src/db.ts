// src/db.ts — Postgres logging / artifact persistence for Medhā MCP.
//
// Optional: set DATABASE_URL on the Railway service and the logger becomes
// active. If unset / unreachable, every helper becomes a no-op so the MCP
// server keeps running.
//
// Two tables: mcp_call_log (every JSON-RPC request), mcp_artifact
// (every URL/data persisted from a call).
//
// All inserts are fire-and-forget with try/catch wrap — a DB outage must
// not break a tools/call response.

import { Pool } from 'pg'
import { createHash } from 'node:crypto'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mcp_call_log (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id      TEXT,
  client_name     TEXT,
  client_version  TEXT,
  bearer_hash     TEXT,
  tool_name       TEXT,
  method          TEXT,
  request_json    JSONB,
  response_summary JSONB,
  status_code     INT,
  latency_ms      INT,
  venice_call_id  TEXT,
  error_message   TEXT
);
CREATE INDEX IF NOT EXISTS mcp_call_log_ts_idx      ON mcp_call_log (ts DESC);
CREATE INDEX IF NOT EXISTS mcp_call_log_tool_idx    ON mcp_call_log (tool_name);
CREATE INDEX IF NOT EXISTS mcp_call_log_session_idx ON mcp_call_log (session_id);

CREATE TABLE IF NOT EXISTS mcp_artifact (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  call_id     BIGINT REFERENCES mcp_call_log(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  model       TEXT,
  venice_url  TEXT,
  mime_type   TEXT,
  byte_size   BIGINT,
  prompt      TEXT,
  seed        TEXT,
  params_json JSONB,
  expires_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mcp_artifact_ts_idx    ON mcp_artifact (ts DESC);
CREATE INDEX IF NOT EXISTS mcp_artifact_kind_idx  ON mcp_artifact (kind);
CREATE INDEX IF NOT EXISTS mcp_artifact_call_idx  ON mcp_artifact (call_id);

-- Medhā admin / dynamic-preset settings.
-- One row per setting key; JSONB value lets us mix types.
-- The admin SPA writes here; presets.ts defaults are the seed values
-- the loader overlays on first boot.
CREATE TABLE IF NOT EXISTS mcp_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);
`

let pool: Pool | null = null
let ready = false
let bootPromise: Promise<void> | null = null

function logStdErr(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error('[medha-db]', ...args)
}

export function dbPool(): Pool | null {
  return ready ? pool : null
}

export function dbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

export function bearerHash(raw: string | undefined | null): string | null {
  if (!raw) return null
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

async function boot(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    logStdErr('DATABASE_URL not set — running without call logging.')
    ready = false
    return
  }
  try {
    pool = new Pool({
      connectionString: url,
      max: Number(process.env.MCP_DB_POOL_MAX ?? '5'),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    pool.on('error', (err: Error) => logStdErr('pool error', err.message))
    await pool.query(SCHEMA_SQL)
    ready = true
    logStdErr('connected & schema ready.')
  } catch (err) {
    logStdErr('boot failed:', (err as Error).message)
    pool = null
    ready = false
  }
}

export function ensureDbReady(): Promise<void> {
  if (ready) return Promise.resolve()
  if (bootPromise) return bootPromise
  bootPromise = boot().finally(() => {
    bootPromise = null
  })
  return bootPromise
}

export interface CallRecord {
  session_id: string | null
  client_name: string | null
  client_version: string | null
  bearer_hash: string | null
  tool_name: string | null
  method: string
  request_json: unknown
  response_summary: unknown | null
  status_code: number
  latency_ms: number
  venice_call_id: string | null
  error_message: string | null
}

export async function insertCall(rec: CallRecord): Promise<number | null> {
  if (!pool || !ready) return null
  try {
    const sql = `
      INSERT INTO mcp_call_log
        (session_id, client_name, client_version, bearer_hash, tool_name, method,
         request_json, response_summary, status_code, latency_ms, venice_call_id, error_message)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id
    `
    const params = [
      rec.session_id,
      rec.client_name,
      rec.client_version,
      rec.bearer_hash,
      rec.tool_name,
      rec.method,
      JSON.stringify(rec.request_json ?? null),
      rec.response_summary == null ? null : JSON.stringify(rec.response_summary),
      rec.status_code ?? 0,
      rec.latency_ms,
      rec.venice_call_id ?? null,
      rec.error_message ?? null,
    ]
    const r = await pool.query(sql, params)
    return r.rows[0]?.id ?? null
  } catch (err) {
    logStdErr('insertCall failed:', (err as Error).message)
    return null
  }
}

export interface ArtifactRecord {
  call_id: number | null
  kind: string
  model: string | null
  venice_url: string | null
  mime_type: string | null
  byte_size: number | null
  prompt?: string | null
  seed?: string | null
  params?: unknown
  expires_at?: Date | null
}

export async function insertArtifact(rec: ArtifactRecord): Promise<number | null> {
  if (!pool || !ready) return null
  try {
    const sql = `
      INSERT INTO mcp_artifact
        (call_id, kind, model, venice_url, mime_type, byte_size, prompt, seed, params_json, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
    `
    const params = [
      rec.call_id,
      rec.kind,
      rec.model,
      rec.venice_url,
      rec.mime_type,
      rec.byte_size,
      rec.prompt ?? null,
      rec.seed != null ? String(rec.seed) : null,
      rec.params == null ? null : JSON.stringify(rec.params),
      rec.expires_at ?? null,
    ]
    const r = await pool.query(sql, params)
    return r.rows[0]?.id ?? null
  } catch (err) {
    logStdErr('insertArtifact failed:', (err as Error).message)
    return null
  }
}

// ─── Settings (admin / dynamic-preset persistence) ─────────────────
//
// Key/value store with JSONB values. The admin SPA writes here when you
// change a default model in the dashboard; presets-loader.ts reads here
// on the next MCP request to build the tool descriptions and favourites.

export interface SettingRow {
  key: string
  value: unknown
  updated_at: Date
  updated_by: string | null
}

export async function getSetting(key: string): Promise<unknown | null> {
  if (!pool || !ready) return null
  try {
    const r = await pool.query('SELECT value, updated_at, updated_by FROM mcp_settings WHERE key = $1', [key])
    return r.rows[0]?.value ?? null
  } catch (err) {
    logStdErr('getSetting failed:', (err as Error).message)
    return null
  }
}

export async function getAllSettings(): Promise<SettingRow[]> {
  if (!pool || !ready) return []
  try {
    const r = await pool.query('SELECT key, value, updated_at, updated_by FROM mcp_settings ORDER BY key')
    return r.rows.map((row: { key: string; value: unknown; updated_at: Date; updated_by: string | null }) => ({
      key: row.key,
      value: row.value,
      updated_at: row.updated_at,
      updated_by: row.updated_by,
    }))
  } catch (err) {
    logStdErr('getAllSettings failed:', (err as Error).message)
    return []
  }
}

export async function setSetting(key: string, value: unknown, updatedBy: string | null = null): Promise<boolean> {
  if (!pool || !ready) return false
  try {
    await pool.query(
      `INSERT INTO mcp_settings (key, value, updated_at, updated_by)
       VALUES ($1, $2::jsonb, now(), $3)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now(), updated_by = $3`,
      [key, JSON.stringify(value), updatedBy]
    )
    return true
  } catch (err) {
    logStdErr('setSetting failed:', (err as Error).message)
    return false
  }
}

export async function deleteSetting(key: string): Promise<boolean> {
  if (!pool || !ready) return false
  try {
    await pool.query('DELETE FROM mcp_settings WHERE key = $1', [key])
    return true
  } catch (err) {
    logStdErr('deleteSetting failed:', (err as Error).message)
    return false
  }
}

// ─── Call log / artifact read paths (for the admin dashboard) ───────

export interface CallLogRow {
  id: number
  ts: Date
  session_id: string | null
  client_name: string | null
  bearer_hash: string | null
  tool_name: string | null
  method: string | null
  status_code: number | null
  latency_ms: number | null
  venice_call_id: string | null
  error_message: string | null
  request_json: unknown
  response_summary: unknown | null
}

export async function listCalls(opts: {
  limit?: number
  tool?: string
  bearer?: string
  sinceHours?: number
} = {}): Promise<CallLogRow[]> {
  if (!pool || !ready) return []
  const limit = Math.min(opts.limit ?? 50, 500)
  const where: string[] = []
  const params: unknown[] = []
  let p = 1
  if (opts.tool) { where.push(`tool_name = $${p++}`); params.push(opts.tool) }
  if (opts.bearer) { where.push(`bearer_hash = $${p++}`); params.push(opts.bearer) }
  if (opts.sinceHours && opts.sinceHours > 0) { where.push(`ts > now() - $${p++} * interval '1 hour'`); params.push(opts.sinceHours) }
  const sql = `
    SELECT id, ts, session_id, client_name, bearer_hash, tool_name, method,
           status_code, latency_ms, venice_call_id, error_message,
           request_json, response_summary
    FROM mcp_call_log
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ts DESC
    LIMIT ${limit}
  `
  try {
    const r = await pool.query(sql, params)
    return r.rows
  } catch (err) {
    logStdErr('listCalls failed:', (err as Error).message)
    return []
  }
}

export interface ArtifactRow {
  id: number
  ts: Date
  call_id: number | null
  kind: string
  model: string | null
  venice_url: string | null
  mime_type: string | null
  byte_size: number | null
  prompt: string | null
  seed: string | null
  params_json: unknown
}

export async function listArtifacts(opts: { limit?: number; kind?: string } = {}): Promise<ArtifactRow[]> {
  if (!pool || !ready) return []
  const limit = Math.min(opts.limit ?? 50, 500)
  try {
    const sql = opts.kind
      ? `SELECT id, ts, call_id, kind, model, venice_url, mime_type, byte_size, prompt, seed, params_json FROM mcp_artifact WHERE kind = $1 ORDER BY ts DESC LIMIT ${limit}`
      : `SELECT id, ts, call_id, kind, model, venice_url, mime_type, byte_size, prompt, seed, params_json FROM mcp_artifact ORDER BY ts DESC LIMIT ${limit}`
    const params = opts.kind ? [opts.kind] : []
    const r = await pool.query(sql, params)
    return r.rows
  } catch (err) {
    logStdErr('listArtifacts failed:', (err as Error).message)
    return []
  }
}

export interface SpendRow {
  ts_hour: Date
  tool_name: string | null
  bearer_hash: string | null
  call_count: number
  avg_latency_ms: number | null
  error_count: number
}

export async function spendByHour(opts: { sinceHours?: number } = {}): Promise<SpendRow[]> {
  if (!pool || !ready) return []
  const since = opts.sinceHours && opts.sinceHours > 0 ? opts.sinceHours : 24
  try {
    const r = await pool.query(`
      SELECT
        date_trunc('hour', ts) AS ts_hour,
        tool_name,
        bearer_hash,
        COUNT(*)::int AS call_count,
        AVG(latency_ms)::int AS avg_latency_ms,
        SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END)::int AS error_count
      FROM mcp_call_log
      WHERE ts > now() - ($1 || ' hours')::interval
      GROUP BY 1, 2, 3
      ORDER BY 1 DESC, 2 NULLS LAST
    `, [String(since)])
    return r.rows
  } catch (err) {
    logStdErr('spendByHour failed:', (err as Error).message)
    return []
  }
}
