import pg from 'pg'
const url = process.argv[2]
console.error('Connecting to', url?.replace(/:\/\/[^:]+:/, '://***/'))
const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 8000 })
async function run() {
  await pool.query('SELECT 1')
  const r = await pool.query('SELECT count(*)::int AS calls, max(ts) AT TIME ZONE \'UTC\' AS last_call FROM mcp_call_log')
  console.log('CALL LOG ROW COUNT:', JSON.stringify(r.rows[0]))
  const r2 = await pool.query('SELECT count(*)::int AS artifacts FROM mcp_artifact')
  console.log('ARTIFACT ROW COUNT:', JSON.stringify(r2.rows[0]))
  const r3 = await pool.query("SELECT id, ts AT TIME ZONE 'UTC' AS utc, method, tool_name, status_code, latency_ms, bearer_hash FROM mcp_call_log ORDER BY ts DESC LIMIT 10")
  console.log('RECENT CALLS (latest 10):')
  for (const row of r3.rows) console.log('  ', JSON.stringify(row))
  const r4 = await pool.query("SELECT id, ts AT TIME ZONE 'UTC' AS utc, kind, model, mime_type, byte_size FROM mcp_artifact ORDER BY ts DESC LIMIT 10")
  console.log('RECENT ARTIFACTS (latest 10):')
  for (const row of r4.rows) console.log('  ', JSON.stringify(row))
  await pool.end()
}
run().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
