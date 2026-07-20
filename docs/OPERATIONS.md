# Medhā Operations

## Database

Two tables on the Railway Postgres service attached to Medhā (`Postgres-kMkw` service, internal DNS `postgres-kmkw.railway.internal`):

| Table | Purpose |
|---|---|
| `mcp_call_log` | every JSON-RPC request — `session_id`, `client_name`, `bearer_hash` (sha256 prefix of first 16 hex chars — raw bearer never stored), `tool_name`, `method`, `request_json`, `response_summary`, `status_code`, `latency_ms`, `error_message`, `venice_call_id` |
| `mcp_artifact` | every generated asset — `kind` (image / audio / music / video / asset), `model`, `venice_url`, `mime_type`, `byte_size`, `prompt`, `seed`, `params_json` |

Indexes on `(ts DESC)` per table, plus secondary indexes on `tool_name`, `kind`, `session_id`, and `call_id`.

The server is fire-and-forget — DB outage does **not** break a tools/call.

### Inspecting from your operator laptop

```bash
# Open Railway's local proxy on port 5433 (Ctrl+C to close)
railway connect Postgres-kMkw --tunnel-only --port 5433 &
sleep 6
CREDS=$(sed '1,/PostgreSQL tunnel open/d; /Press/q' /tmp/pg_tunnel.log)
HOST=$(echo "$CREDS" | awk '/Host:/ {print $2}')
PORT=$(echo "$CREDS" | awk '/Port:/ {print $2}')
USER=$(echo "$CREDS" | awk '/User:/ {print $2}')
PASS=$(echo "$CREDS" | awk '/Password:/ {print $2}')
DB=$(echo "$CREDS" | awk '/Database:/ {print $2}')

PGPASSWORD="$PASS" psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" \
  -c "SELECT method, tool_name, latency_ms, status_code FROM mcp_call_log ORDER BY ts DESC LIMIT 20;"
```

### Recent activity SQL

```sql
-- Per-method call counts in the last hour
SELECT method, count(*) AS calls, avg(latency_ms)::int AS avg_ms
FROM mcp_call_log
WHERE ts > now() - interval '1 hour'
GROUP BY method ORDER BY calls DESC;

-- Per-tool p99 latency, last 24h
SELECT tool_name,
       count(*) AS calls,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms,
       percentile_disc(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_ms
FROM mcp_call_log
WHERE ts > now() - interval '24 hour'
GROUP BY tool_name ORDER BY calls DESC;

-- Most recent artifacts with their parent call
SELECT a.kind, a.model, a.mime_type, a.byte_size, c.tool_name, c.ts
FROM   mcp_artifact a JOIN mcp_call_log c ON a.call_id = c.id
ORDER  BY c.ts DESC LIMIT 50;

-- Failure breakdown
SELECT tool_name, count(*) AS failures, max(ts) AS last_failure
FROM   mcp_call_log
WHERE  status_code <> 0 OR error_message IS NOT NULL
GROUP  BY tool_name ORDER BY failures DESC;
```

## Rotation

| Action | Effect |
|---|---|
| `printf "<64-hex>" \| railway variable set VENICE_MCP_AUTH_TOKEN --stdin --service medha --skip-deploys && railway service redeploy --service medha --yes` | rotates the bearer; previous bearer stops working |
| `printf "<venice-key>" \| railway variable set VENICE_API_KEY --stdin --service medha --skip-deploys && railway service redeploy --service medha --yes` | swaps the operator's Venice API key |

## Spend / balance

```bash
KEY=$(railway variable get VENICE_INFERENCE_KEY --service medha --plain)
echo "Balance: $(curl -s https://api.venice.ai/api/v1/wallet/balance \
  -H "Authorization: Bearer $KEY" | jq -r .balance)"
```

## Health

```bash
curl -s https://medha-production.up.railway.app/healthz | jq -r
# -> {"ok": true, "name": "@veniceai/mcp-server"}
```

## Adding a future agent

For a new Railway-deployed Hermes agent (say `jiva`, `rati`, `paridhi`) to use Medhā:

```bash
# 1. Add MEDHA_* env to the agent's Railway service.
printf "$MEDHA_BEARER" | railway variable set MEDHA_BEARER --stdin --service jiva --skip-deploys
railway variable set MEDHA_URL --stdin --service jiva --skip-deploys <<<"https://medha-production.up.railway.app/mcp"
# (Use --stdin for both since CLI takes one KEY per stdin call.)

# 2. Bake the MCP block into the agent's entrypoint.
# See CONNECTORS.md § Hermes / Jiva / Rati.
```

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `[medha-db] boot failed` in logs | Postgres unreachable / creds invalid | `railway variable list --service Postgres-kMkw --kv` and check `DATABASE_URL` resolves to `${{Postgres-kMkw.DATABASE_URL}}`; verify `Postgres-kMkw` is online |
| `mcp_artifact` rows = 0 | the call path never returns an image/audio/Url block | check `response_summary.media_count` — if 0 and a tool supposedly returned media, the SDK returned structuredContent instead; capture `structuredContent` field too |
| `mcp_call_log.status_code = 1` | upstream tool returned an error | query `error_message`; check Venice key / model availability |
