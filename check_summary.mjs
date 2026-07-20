import pg from 'pg'
const url = process.argv[2]
const pool = new pg.Pool({ connectionString: url })
async function run() {
  // Look at the image_generate calls and their summary
  const r = await pool.query(`
    SELECT id, tool_name, response_summary
    FROM mcp_call_log
    WHERE tool_name IN ('venice_image_generate', 'venice_tts', 'venice_music_generate')
    ORDER BY ts DESC LIMIT 5
  `)
  for (const row of r.rows) {
    console.log(`\n--- call ${row.id} ${row.tool_name} ---`)
    console.log(JSON.stringify(row.response_summary, null, 2))
  }
  await pool.end()
}
run().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
