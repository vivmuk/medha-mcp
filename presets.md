# Medhā — Operator Presets (canonical defaults)

This document lists the operator-curated defaults that Medhā MCP bakes into its tool descriptions. Single source of truth lives in [`src/presets.ts`](src/presets.ts); the JSON form is exposed as the `medha://favorites` MCP resource.

**How agents should use this**
- The first time an agent connects, the operator's preferred models appear inline in the `venice_chat`, `venice_image_generate`, … `tools/list` descriptions. Agents can pick a model from there directly.
- If in doubt, fetch `medha://favorites` for the canonical JSON dump.
- Operator prefs are HINTS, not hard rules — pass `model="<any-venice-id>"` to override per call.

---

## Reasoning / chat / agents

| Model | When | Cost (USD/M in/out) | Rationale |
|---|---|---|---|
| `minimax-m3-preview` | Default chat, 524K context, agent runs, M3-preview tier | 0.30 / 1.20 | Cheap-and-long — fits a 500K-token conversation for the price of a 50K one on premium. Operator's daily-drive. |
| `claude-sonnet-4-6` | Reserved for hard reasoning + thinker step | 3.60 / 18.00 | Premium reasoning when nuance matters more than cost (podcast scripts, character dossiers). |
| `qwen-3-7-max` | 1M context, multilingual, agent runs that exceed 524K | 2.70 / 8.05 | When `minimax-m3-preview`'s 524K context exhausts, escalate to Qwen Max's 1M. |
| `venice-uncensored-role-play` | Character work, narrative voice | 0.50 / 2.00 | When the system prompt is a persistent character (Medhā dossier prompt). |

## Coding

| Model | When | Rationale |
|---|---|---|
| `qwen3-coder-480b-a35b-instruct-turbo` | Default | Purpose-built 480B coder; cheap large-context. |
| `openai-gpt-oss-120b` | Cheap alt / when mass edits | 0.07 / 0.30 — 30× cheaper than Claude opus for similar edits. |
| `claude-sonnet-4-6` | Architectural design refactors / plan authority | When the task is too ambiguous for `qwen3-coder` alone. |

## Roleplay / character

| Model | When |
|---|---|
| `venice-uncensored-role-play` | Default for persona continuums |
| `venice-uncensored-1-2` | Vision-capable alt (128K ctx) |

## Vision (image+text comprehension)

| Model | When | Cost |
|---|---|---|
| `venice-uncensored-1-2` | Default for image understanding; supportsVision + cheap | 0.20 / 0.90 |
| `minimax-m3-preview` | Long-context vision (524K tokens of image+text possible) | 0.30 / 1.20 |
| `claude-sonnet-4-6` | Premium vision + reasoning (write a structured description for downstream code) | 3.60 / 18.00 |

## Long context (≥500K tokens)

| Model | When |
|---|---|
| `qwen-3-7-max` | Default 1M-token (when context allowed) |
| `minimax-m3-preview` | 524K fallback |
| `gemini-3-1-pro-preview` | Premium 1M + reasoning |

## Image generation

| Model | When | Notes |
|---|---|---|
| `flux-2-pro` | Default | Banned by Venice for explicit content; default for everything else. |
| `qwen-image` | Alt when flux budget tight | Open-source-grade. |
| `lustify-sdxl` | Character / erotic illustration | Operator permits NSFW defaults. |
| `nano-banana-pro` | Photoreal | When "professional photography" wording in prompt. |
| `gpt-image-1` | OpenAI-style text-in-prompt | |
| `anime-wai` | Anime-style / stylization | |

## Image editing

| Model | When |
|---|---|
| `firered-image-edit` | Default single-image edit |
| `qwen-image-edit` | Alt single-image edit |

## Upscale

| Model | When |
|---|---|
| `flux-2-pro` | Default 1-4× enhance |
| `nano-banana-pro` | Alt for photoreal preserve |

## Video generation

| Model | When |
|---|---|
| `ltx-2` | Default — fast, cheap, supports image-to-video from `flux-2-pro` base frames |
| `sora-2` | Premium — when narrative weight justifies the cost |
| `veo3.1-fast` | Premium alt — image-to-video + text-to-video |
| `kling-2.6-pro` | Premium text-to-video for cinematic scenes |
| `wan-2.6-text-to-video` | Open-source-grade text-to-video |
| `seedance-2-0-r2v` | Reference-video → output-video (style transfer) |
| `runway-gen4` | Premium for stylistically distinctive output |

Always quote first via `venice_video_quote({ duration_seconds: <s> })` if you're not 100% sure of cost.

## Audio (TTS)

| Model | When |
|---|---|
| `tts-kokoro` | Default — voice cloning + emotion tags (`[whispers]`, `[sarcastically]`, etc.) |
| `elevenlabs-tts` | Alt when vocals / cloned-voice quality dominates |

## Audio (ASR)

| Model | When |
|---|---|
| `openai/whisper-large-v3` | Default |

## Music

| Model | When |
|---|---|
| `ace-step-15` | Default — broad genre coverage (lofi / classical / EDM / cinematic) |
| `elevenlabs-music` | When vocals matter |
| `minimax-music-v2` / `v25` / `v26` | Operator's three alt tiers |
| `stable-audio-25` | Cinematic / sound design |
| `mmaudio-v2` | Stem separation / sample-level audio |
| `elevenlabs-sound-effects-v2` | SFX (drum hits, ambiences, risers) |

Always quote first via `venice_audio_quote({ duration_seconds: <s> })`.

## Embeddings

| Model | When |
|---|---|
| `text-embedding-3-small` | Default — OpenAI-compatible |
| `gemini-embedding-001` | Alt for Gemini-shaped retroactive batch jobs |

## Web / augment

| Tool | Note |
|---|---|
| `venice_web_search` | Firecrawl-backed ranked results |
| `venice_web_scrape` | One URL → markdown text |
| `venice_text_parser` | PDF / DOCX / EPUB / PPTX / XLSX → text |
| `venice_list_models` | Live catalog (capability flags + USD pricing) — no preset needed |

## Crypto

| Tool | Note |
|---|---|
| `venice_crypto_rpc` | `eth_call` / `eth_blockNumber` to Base, Ethereum, Polygon, Arbitrum, Optimism |
| `venice_x402_*` | Wallet-mode helpers — only relevant if operator adds SIWX token later |

---

## Workflow prompts → model sequences

(`medha_*` prompts actually pull from this table.)

| Prompt | Music | Image | Video | Chat | TTS | ASR |
|---|---|---|---|---|---|---|
| `medha_music_video_brief` | `ace-step-15` | `flux-2-pro` (×4-12) | `ltx-2` (per frame, 4-6s) | `(script polish on demand)` | `tts-kokoro` (optional) | – |
| `medha_podcast_pipeline` | – | – | – | `claude-sonnet-4-6` | `tts-kokoro` | – |
| `medha_dashboard_poster` | – | `flux-2-pro` (1×) | – | `claude-sonnet-4-6` (prompt refinement) | – | – |
| `medha_character_dossier` | – | `flux-2-pro` (optional avatar) | – | `venice-uncensored-role-play` | `tts-kokoro` (sample) | – |

## How to override

Any of `medhā`'s `31` tools accepts a `model=` parameter that overrides the preset. Operators can also flip env defaults via `railway variable set --service medha --skip-deploys`:

```bash
# Rotate chat reasoning to Claude Opus when cost is no object
railway variable set --service medha --skip-deploys "VENICE_DEFAULT_CHAT_MODEL=claude-opus-4-6"
railway service redeploy --service medha --yes

# Pin image to a private model
railway variable set --service medha --skip-deploys "VENICE_DEFAULT_IMAGE_MODEL=my-private-finetune"
```

Then `railway service redeploy --service medha --yes` (restart won't pick up env).

> **Operator note:** rotating values via env is a quick knob; persisting them in `presets.md` + `src/presets.ts` is what other agents see in their tool descriptions. Match the two — keep the public narrative in sync with the runtime defaults.
