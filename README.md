# Medhā MCP

> Operator-tuned fork of [@veniceai/mcp-server](https://github.com/veniceai/venice-mcp-server). Same 31 Venice primitives; curated presets for chat/image/video/audio/music baked in via env defaults and surfaced in tool descriptions; one discoverable `medha://favorites` resource so any agent can fetch the operator's preferences before making a call. Use from any MCP host — Claude Desktop, Claude Code, Cursor, Codex CLI, Hermes, Jiva, Rati, LM Studio, Continue, LibreChat, Open WebUI, AnythingLLM, Jan, Le Chat.

---

## What you get

| Surface | Count | Notes |
|---|---|---|
| **Tools** | 31 | Identical to upstream; descriptions augmented with `Operator preferences — default: … also try: …` overlays keyed off `src/presets.ts` |
| **Resources** | 4 | `venice://models`, `venice://styles`, `venice://voices` (upstream) **+** `medha://favorites` (canonical JSON dump of presets) |
| **Prompts** | 7 | 3 upstream (`uncensored-research`, `nsfw-creative-writing`, `image-style-explorer`) **+** 4 Medhā workflow briefs (`medha_music_video_brief`, `medha_podcast_pipeline`, `medha_dashboard_poster`, `medha_character_dossier`) |
| **Transports** | stdio and Streamable HTTP (`/mcp`) | HTTP is the Railway-deployed mode; stdio stays for npx-style install |

The Medhā MCP server is **thin by design**: it forwards agent tool calls to `api.venice.ai`. The agent (Claude Code / Hermes / Codex / Jiva / Rati / Cursor / etc.) is the orchestrator — it plans the steps, picks models, calls tools in order, handles async polling, and stitches art + audio together.

---

## Quickstart (5 min deploy on Railway)

### 1. Get a Venice API key

[venice.ai](https://venice.ai) → Settings → API Keys. Save it locally on the operator's Mac:

```bash
echo "export VENICE_API_KEY=*** ~/.config/railway/venice-rati-key.env
chmod 600 ~/.config/railway/venice-rati-key.env
```

### 2. Clone + push

```bash
gh repo clone veniceai/venice-mcp-server ~/tmp/medha-deploy
cd ~/tmp/medha-deploy
# (already customized to Medhā on master if you cloned vivmuk/medha-mcp;
# upstream clone just needs the Phase 1 patches to branding files.)
```

### 3. Railway project + service

```bash
# Create `medha` project in vivmuk's workspace
railway init --name "medha" --workspace "vivmuk's Projects"
gh repo create vivmuk/medha-mcp \
    --public \
    --description "Medhā — operator-tuned Venice AI MCP bridge." \
    --default-branch master
cd ~/tmp/medha-deploy
git remote rename origin upstream
git remote add origin https://github.com/vivmuk/medha-mcp.git
git fetch upstream --unshallow
git push -u origin master
```

```bash
# Create Railway service that pulls from GitHub
railway add --service medha --repo vivmuk/medha-mcp --branch master
```

### 4. Set env vars

Generate a strong bearer token for the MCP HTTP layer:

```bash
BEARER=$(python3 -c "import secrets; print(secrets.token_hex(32))")
echo "$BEARER" > ~/.config/railway/medha-bearer.token
chmod 600 ~/.config/railway/medha-bearer.token
```

Push secrets via `--stdin` (chat-safe; never argv):

```bash
unset RAILWAY_TOKEN RAILWAY_API_TOKEN

python3 - <<'PY'
import subprocess
from pathlib import Path
KEY = Path("/Users/vivgatesai/.config/railway/venice-rati-key.env").read_text()
KV = {l.split("=",1)[0].lstrip("export ").strip(): l.split("=",1)[1].strip().strip('"').strip("'") for l in KEY.splitlines() if l.startswith("export ")}
BEARER = Path("/Users/vivgatesai/.config/railway/medha-bearer.token").read_text().strip()
base = ["railway","variable","set","--service","medha","--skip-deploys"]
for label, value in [("VENICE_API_KEY", KV["VENICE_API_KEY"]), ("VENICE_MCP_AUTH_TOKEN", BEARER)]:
    subprocess.run(base + [label, "--stdin"], input=value, capture_output=True, text=True, timeout=60)
PY
```

Plain env (no secrets — argv-safe):

```bash
for K in \
  "VENICE_MCP_HTTP=1" \
  "VENICE_MCP_HOST=0.0.0.0" \
  "VENICE_DISABLE_NSFW=0" \
  "VENICE_DEFAULT_CHAT_MODEL=minimax-m3-preview" \
  "VENICE_DEFAULT_IMAGE_MODEL=flux-2-pro" \
  "VENICE_DEFAULT_TTS_MODEL=tts-kokoro" \
  "VENICE_DEFAULT_ASR_MODEL=openai/whisper-large-v3" \
  "VENICE_DEFAULT_VIDEO_MODEL=ltx-2" \
  "VENICE_DEFAULT_MUSIC_MODEL=ace-step-15" \
  "VENICE_HTTP_TIMEOUT_MS=120000" \
  "VENICE_MCP_MAX_SESSIONS=100" \
  "VENICE_MCP_SESSION_TTL_MS=1800000" \
  "PORT=3333" \
  "MEDHA_SERVER_NAME=@medha/mcp-server" \
  "MEDHA_SERVER_VERSION=0.4.0-medha"
do
  railway variable set --service medha --skip-deploys "$K"
done
```

### 5. Deploy + attach domain

```bash
cd ~/tmp/medha-deploy
railway up --service medha --detach
railway domain --service medha
# → https://medha-production.up.railway.app/mcp
```

### 6. Smoke

```bash
BEARER=$(cat ~/.config/railway/medha-bearer.token)
URL=https://medha-production.up.railway.app/mcp

curl -sS -i -X POST "$URL" \
  -H "Authorization: Bearer *** \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}' \
  | head
```

`HTTP 200` with a `mcp-session-id` UUID header → you're live.

### 7. Connect an agent

See [`presets.md`](presets.md) for the canonical defaults table. For Claude Desktop / Claude Code CLI / Cursor / Codex CLI / Hermes / Jiva connector recipes, see [`CONNECTORS.md`](CONNECTORS.md).

---

## Configuration reference

| Env | Default | Purpose |
|---|---|---|
| `VENICE_API_KEY` _(required)_ | _(none)_ | Operator's Venice API key. Forwarded as `Authorization: Bearer` to all upstream calls. |
| `VENICE_SIWX_TOKEN` | _(none)_ | Optional SIWE-signed wallet token (x402 mode). Used only when `VENICE_API_KEY` is unset. |
| `VENICE_MCP_HTTP` | _(unset)_ | Set to `1` to enable HTTP mode (binds `:3333/mcp`). |
| `VENICE_MCP_HOST` | `127.0.0.1` | Bind address. `0.0.0.0` for LAN/Railway. |
| `VENICE_MCP_AUTH_TOKEN` | _(none)_ | Bearer required for `/mcp` when host ≠ loopback. Generate with `python3 -c "import secrets; print(secrets.token_hex(32))"`. |
| `VENICE_MCP_MAX_SESSIONS` | `100` | Cap on concurrent Streamable HTTP sessions. |
| `VENICE_MCP_SESSION_TTL_MS` | `1800000` | Idle session TTL (30 min). |
| `VENICE_HTTP_TIMEOUT_MS` | `60000` | Per-call upstream timeout. Default 120s for video/music latencies. |
| `VENICE_DISABLE_NSFW` | `0` | Set to `1` to remove NSFW capability notes from tool descriptions. |
| `VENICE_DEFAULT_CHAT_MODEL` | `venice-uncensored` | Medhā default: `minimax-m3-preview`. |
| `VENICE_DEFAULT_IMAGE_MODEL` | `flux-2-pro` | (same as upstream) |
| `VENICE_DEFAULT_TTS_MODEL` | `tts-kokoro` | (same as upstream) |
| `VENICE_DEFAULT_ASR_MODEL` | `openai/whisper-large-v3` | (same as upstream) |
| `MEDHA_SERVER_NAME` | `@medha/mcp-server` | Override the MCP `serverInfo.name`. |
| `MEDHA_SERVER_VERSION` | `0.4.0-medha` | Override the MCP `serverInfo.version`. |
| `PORT` | `3333` | Railway-respected; controls the listener. |

---

## Operator preferences

The operator-curated defaults are baked into the **tool descriptions** so agents read them on every `tools/list` call. They are also a single canonical JSON document available via the `medha://favorites` resource:

```bash
# After defining BEARER + SID as in the smoke test:
curl -sS -X POST https://medha-production.up.railway.app/mcp \
  -H "Authorization: Bearer *** \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"medha://favorites"}}'
```

See [`presets.md`](presets.md) for the full table with rationale per domain (reasoning / coding / roleplay / vision / longctx / image / music / video / etc.).

**The operator prefs are HINTS, not hard rules.** Agents you connect can pass `model="<any-venice-id>"` on any call and the server will forward it. The presets exist to save the agent from re-discovering the operator's taste on every prompt.

---

## Workflow prompts (Medhā-only)

Beyond the upstream 3 (`uncensored-research`, `nsfw-creative-writing`, `image-style-explorer`), Medhā ships 4 workflow prompts that guide the agent into known-good multi-tool sequences:

| Prompt | Workflow | Default models |
|---|---|---|
| `medha_music_video_brief` | Quote → music gen → 4-12 image frames → video interpolation per frame → optional TTS. | `ace-step-15` (music) · `flux-2-pro` (image) · `ltx-2` (video) · `tts-kokoro` (TTS) |
| `medha_podcast_pipeline` | Web search → scrape top URLs → script via chat → TTS. | `qwen-3-7-max` (chat) · `tts-kokoro` (TTS) |
| `medha_dashboard_poster` | Chat-compose prompt → flux-2-pro → optional bg-remove → optional 2× upscale. | `qwen-3-7-max` (chat) · `flux-2-pro` (image) |
| `medha_character_dossier` | Dossier + system prompt via roleplay chat → TTS sample → optional avatar image. | `venice-uncensored-role-play` (chat) · `tts-kokoro` (TTS) · `flux-2-pro` (image) |

When the agent invokes one of these prompts, MCP returns a single user-role message that lays out the recommended tool-call sequence with the operator's preferred models. The agent then orchestrates from there.

---

## Provenance + license

Upstream: [github.com/veniceai/venice-mcp-server](https://github.com/veniceai/venice-mcp-server) @ v0.2.0 — MIT-licensed by Venice AI. Medhā is a fork: same code, operator-tuned UX. **No warranty or SLA from Venice AI.** Use at your own risk.

Maintainer: Vivek M (@vivmuk). Brand: Medhā — Sanskrit *medhā* (मेधा) = wisdom / intelligence / mental power.
