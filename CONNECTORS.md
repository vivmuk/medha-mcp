# Connect your agent to Medhā

Once Medhā is live at `https://medha-production.up.railway.app/mcp` (or wherever you deployed it), any of these targets can connect by adding an MCP server entry pointing at `Medhā URL` + `Bearer yourtoken`. Pick the recipe for your host and paste the snippet.

```bash
# Set once per shell so the bearer is hidden from chat history
read -s -p "" BEARER; echo
BEARER=$(cat ~/.config/railway/medha-bearer.token)
MEDHA_URL=https://medha-production.up.railway.app/mcp
```

---

## Claude Desktop (macOS)

Config: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "medha": {
      "url": "MEDHA_URL",
      "headers": {
        "Authorization": "Bearer $BEARER"
      }
    }
  }
}
```

Restart Claude Desktop. Click the 🔨 (hammer) icon in any conversation → you should see 31 tools + `medha://favorites` resource + 7 prompts (including the four `medha_*` workflow briefs).

---

## Claude Code CLI

`claude mcp add` runs a subcommand to register a remote MCP server:

```bash
claude mcp add medha \
  --transport http \
  --url "${MEDHA_URL}" \
  --header "Authorization: Bearer $BEARER"
# (claude CLI 1.0+ — older versions: claude mcp add medha http://... --token Bearer-mode)
```

Verify in-session:

```bash
# Start a Claude Code session and ask:
# "List every Medhā tool name and what it does."
# Claude will call tools/list and report 31 tools.
```

Or hand-edit `~/.claude.json` (mostly equivalent):

```json
{
  "mcpServers": {
    "medha": {
      "url": "${MEDHA_URL}",
      "type": "http",
      "headers": { "Authorization": "Bearer $BEARER" }
    }
  }
}
```

---

## Cursor

Config: `~/.cursor/mcp.json` (or project-scoped: `.cursor/mcp.json` in your repo)

```json
{
  "mcpServers": {
    "medha": {
      "url": "MEDHA_URL",
      "headers": {
        "Authorization": "Bearer $BEARER"
      }
    }
  }
}
```

Restart Cursor (Cmd+Shift+P → "Reload Window"). Open the MCP panel → "medha" should appear with 31 tools.

---

## Codex CLI

Config: `~/.codex/config.toml`

```toml
[[mcp_servers.medha]]
url = "MEDHA_URL"
type = "http"
bearer_token = "BEARER"   # actually, see below
```

Codex currently (CLI ≥ 0.21) uses `bearer_token` for *one* auth head; Medhā's bearer is `Authorization`. If `bearer_token` isn't supported for the HTTP variant, drop it and use header instead:

```bash
# Custom header path (if your Codex version requires it):
codex mcp connect medha --transport http --url "${MEDHA_URL}" --header "Authorization: Bearer $BEARER"
```

Verify in-session: `/mcp` slash command in Codex → list of tools surfaces.

---

## Hermes (the platform) — including Jiva, Rati, Paridhi siblings

Config: `~/.hermes/config.yaml` (or any profile's `cli-config.yaml`)

```yaml
mcp_servers:
  medha:
    url: "${MEDHA_URL}"
    headers:
      Authorization: "Bearer $BEARER"
    timeout: 180
    connect_timeout: 60
```

**Per-agent (Hermes-on-Railway like Jiva / Rati / Paridhi/your next sibling)** — bake into the per-agent entrypoint so it loads on every bot restart. Pattern (lives in `entrypoint.sh` BEFORE `exec hermes gateway run`):

```bash
# Append the Medhā block to $HERMES_HOME/config.yaml, idempotently.
HERMES_HOME="${HERMES_HOME:-/root/.hermes}"
mkdir -p "$HERMES_HOME"
python3 - <<PY
import yaml, pathlib, os
cfg_path = pathlib.Path("${HERMES_HOME}/config.yaml")
cfg = yaml.safe_load(cfg_path.read_text()) if cfg_path.exists() else {}
cfg.setdefault('mcp_servers', {})['medha'] = {
    'url': os.environ['MEDHA_URL'],
    'headers': {'Authorization': f"Bearer {os.environ['MEDHA_BEARER']}"},
    'timeout': 180,
    'connect_timeout': 60,
}
cfg_path.write_text(yaml.safe_dump(cfg, sort_keys=False))
PY
echo "[entrypoint] Medhā MCP block written into $HERMES_HOME/config.yaml"
```

Add to the agent's Railway env (`railway variable set --service <agent> --skip-deploys`):

```
MEDHA_URL=https://medha-production.up.railway.app/mcp
MEDHA_BEARER=<your-64-hex-token>      # push via --stdin per jiva-telegram-deploy skill
```

Then `railway service redeploy --service <agent> --yes` to materialize.

> **Don't put the literal bearer in `entrypoint.sh`** — push via `printf '%s' "$BEARER" | railway variable set MEDHA_BEARER --stdin --skip-deploys`. The literal in source lands in git history and the chat-boundary redact-filter mangles it.

---

## LM Studio / Open WebUI / Continue / Jan / AnythingLLM / LibreChat

All four use the same upstream pattern documented in [@veniceai/mcp-server README § Quickstart](https://github.com/veniceai/venice-mcp-server#quick-start), with one substitution: replace `command: npx` with the Medhā HTTP URL + bearer. See upstream READMEs for host-specific config snippets.

Loose-form OpenAI-API-style MCP hosts (e.g. Continue, Open WebUI's MCP adapter):

```json
{
  "mcpServers": {
    "medha": {
      "type": "http",
      "url": "${MEDHA_URL}",
      "auth": { "type": "bearer", "token": "${BEARER}" }
    }
  }
}
```

---

## Verify it works on any client

Two quick checks once connected:

1. **List view** — ask the agent "What Medhā tools do you have access to?" — should see 31 names including `venice_chat`, `venice_image_generate`, `venice_music_generate`, plus `venice_video_generate` and friends. The descriptions should each end with an `Operator preferences — default: …` line for the relevant tools.
2. **Live call** — "Use venice_chat to write me a one-line haiku about Medhā." If you get a haiku back, end-to-end works — your operator key is paying for it through the bearer-authenticated connection.

If you see `401 unauthorized`, the bearer wasn't picked up — check that the host's MCP config has the bearer header on `/mcp` calls.
If you see `404 Unknown tool: venice_xyz`, server started but the agent is fetching the upstream Venice catalog instead of Medhā — the host points at the wrong URL.
If you see `connection refused`, the bearer is fine but Railway service is DOWN — `railway service status --service medha --json` to check.

---

## Sibling-agent patterns

If you operate multiple Hermes-on-Railway agents (Jiva, Rati, Paridhi, future siblings), they can each connect to Medhā independently. Pros:

- Each agent sees only the tools it asks for — no global tool-bloat in any agent's prompt.
- One shared operator-pool quota — burns your Venice key once across every consumer.
- Single point of model-default mutation: change `src/presets.ts` once, redeploy Medhā, every agent refetches and reflects the new prefs.

Cons:

- Operator pays — every agent's calls count against the same `VENICE_API_KEY`. Watch your spend in `~/.config/railway/venice-spend-tracker` (Phase 7 if you want one).
- One universe-of-tools discoverability — every agent who connects can spend on TTS / video / etc. by default. If you want agents to have a narrower surface, use `MCP allowlists` (post-MCP-2026 addition) or hide specific tools in `medha-mcp/src/tools/index.ts` and rebuild.
