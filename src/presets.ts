/**
 * Medhā operator preferences.
 *
 * Each tool's `description` is enriched with a hint line describing which
 * models the operator prefers to use. These are HINTS — agents can still
 * pass any model in the Venice catalog via `model=` and the server will
 * forward it. The presets exist so the agent doesn't have to re-discover
 * the operator's taste on every prompt.
 *
 * Edit this file to change operator preferences. Then `railway up --detach`
 * to redeploy.
 *
 * Repository convention
 * ---------------------
 * The default-model ENV vars (VENICE_DEFAULT_CHAT_MODEL etc.) are the
 * RUNTIME defaults the server uses when the agent omits `model=`. The
 * presets here are the AGENT-FACING hints shown in tool descriptions.
 * Keep them in sync: i.e. if you set `VENICE_DEFAULT_CHAT_MODEL=minimax-m3-preview`,
 * then `TOOL_PREFS.venice_chat` should also start with "minimax-m3-preview".
 *
 * NOTE: Claude and GPT models are EXCLUDED from operator preferences by policy.
 * The Venice API key must never be used for claude-* or gpt-* / openai-gpt-* models
 * unless the operator explicitly requests one by name.
 */
export interface ToolPref {
  /** Default model the operator expects to be tried first. */
  defaultModel: string
  /** 1-3 alternates the operator also likes (price/quality tiers). */
  alternates: string[]
  /** Free-form hint surfaced alongside the model list. */
  hint?: string
}

export const TOOL_PREFS: Record<string, ToolPref> = {
  // ─── TEXT / REASONING ──────────────────────────────────────────────────
  venice_chat: {
    defaultModel: 'minimax-m3-preview',
    alternates: ['qwen-3-7-max', 'venice-uncensored-role-play', 'gemini-3-1-pro-preview'],
    hint: 'cheap+long (524K ctx) → 1M ctx → character voice → premium reasoning.',
  },
  venice_responses: {
    defaultModel: 'minimax-m3-preview',
    alternates: ['qwen-3-7-max'],
    hint: 'OpenAI Responses API; agentic tool-use loop supported.',
  },
  venice_embeddings: {
    defaultModel: 'text-embedding-3-small',
    alternates: ['gemini-embedding-001'],
    hint: 'Operator batch preferred; OpenAI-compatible.',
  },

  // ─── IMAGE ─────────────────────────────────────────────────────────────
  venice_image_generate: {
    defaultModel: 'flux-2-pro',
    alternates: ['qwen-image', 'lustify-sdxl', 'nano-banana-pro', 'anime-wai'],
    hint: 'Operator default is flux-2-pro. Use nano-banana-pro for photoreal, anime-wai for stylization, lustify-sdxl for character work.',
  },
  venice_image_edit: {
    defaultModel: 'firered-image-edit',
    alternates: ['qwen-image-edit'],
  },
  venice_image_multi_edit: {
    defaultModel: 'flux-2-pro',
    alternates: ['qwen-image'],
    hint: 'Composition / outpainting; 2-8 input images.',
  },
  venice_image_upscale: {
    defaultModel: 'flux-2-pro',
    alternates: ['nano-banana-pro'],
    hint: '1-4× enhancement + replication control.',
  },
  venice_image_remove_bg: {
    defaultModel: 'bria-remove-bg',
    alternates: [],
  },

  // ─── VIDEO ─────────────────────────────────────────────────────────────
  venice_video_generate: {
    defaultModel: 'ltx-2',
    alternates: ['sora-2', 'veo3.1-fast', 'kling-2.6-pro', 'wan-2.6-text-to-video', 'seedance-2-0-r2v', 'runway-gen4'],
    hint: 'Operator prefers ltx-2 for speed. Sora-2 / Veo3.1 / Kling for premium. Seedance 2.0 r2v for video-to-video. Always quote first via venice_video_quote.',
  },
  venice_video_status: { defaultModel: '-', alternates: [], hint: 'POST /v1/video/retrieve — Venice returns PROCESSING or COMPLETED.' },
  venice_video_complete: { defaultModel: '-', alternates: [], hint: 'Cleanup hook; removes server-side media.' },
  venice_video_transcriptions: {
    defaultModel: 'youtube-default',
    alternates: [],
    hint: 'YouTube URL → text transcript.',
  },
  venice_video_quote: { defaultModel: '-', alternates: [], hint: 'Always quote-generate before queue when model pricing is unknown.' },

  // ─── AUDIO (TTS / ASR) ─────────────────────────────────────────────────
  venice_tts: {
    defaultModel: 'tts-kokoro',
    alternates: ['elevenlabs-tts'],
    hint: 'Voice cloning + emotion tags ([whispers], [sarcastically], [laughs], etc.).',
  },
  venice_asr: {
    defaultModel: 'openai/whisper-large-v3',
    alternates: [],
  },
  venice_voice_clone: {
    defaultModel: '-',
    alternates: [],
    hint: 'List built-in voices OR clone from a sample audio URL.',
  },
  venice_audio_quote: { defaultModel: '-', alternates: [], hint: 'Pre-flight price quote for music generation.' },

  // ─── MUSIC ─────────────────────────────────────────────────────────────
  venice_music_generate: {
    defaultModel: 'ace-step-15',
    alternates: ['elevenlabs-music', 'minimax-music-v2', 'minimax-music-v25', 'minimax-music-v26', 'stable-audio-25', 'mmaudio-v2', 'elevenlabs-sound-effects-v2'],
    hint: 'Operator default = ace-step-15 (broad genre). Elevenlabs-music for vocal. MMaudio-V2 for stem separation.',
  },
  venice_music_status: { defaultModel: '-', alternates: [], hint: 'POST /v1/audio/retrieve. Async until COMPLETED.' },
  venice_music_complete: { defaultModel: '-', alternates: [], hint: 'Cleanup hook.' },

  // ─── WEB / AUGMENT ─────────────────────────────────────────────────────
  venice_web_search: { defaultModel: 'firecrawl-default', alternates: [], hint: 'Firecrawl-backed ranked results.' },
  venice_web_scrape: { defaultModel: 'firecrawl-default', alternates: [], hint: 'One URL → markdown text.' },
  venice_text_parser: {
    defaultModel: 'firecrawl-default',
    alternates: [],
    hint: 'PDF / DOCX / EPUB / PPTX / XLSX → text.',
  },

  // ─── CATALOG ───────────────────────────────────────────────────────────
  venice_list_models: { defaultModel: '-', alternates: [], hint: 'Live catalog with capability flags + USD pricing.' },
  venice_list_characters: {
    defaultModel: '-',
    alternates: [],
    hint: 'Public Venice characters (api-key only, no x402).',
  },
  venice_chat_with_character: {
    defaultModel: 'venice-uncensored-role-play',
    alternates: ['venice-uncensored-1-2'],
    hint: 'Use character_slug from list_characters.',
  },

  // ─── CRYPTO ────────────────────────────────────────────────────────────
  venice_crypto_rpc: {
    defaultModel: '-',
    alternates: [],
    hint: 'Proxies eth_call / eth_blockNumber to Base, Ethereum, Polygon, Arbitrum, Optimism.',
  },
}

/**
 * Render the operator-prefs hint as a single sentence for inclusion in a
 * tool description. Returns empty string when no preference is registered.
 *
 * Optional `map` arg lets the caller (e.g. tool-descriptions.ts when active
 * preset has been overlaid via /admin) use a different source map than the
 * baked `TOOL_PREFS`.
 *
 * Format: "Operator preferences: <default>. Also try: <a1>, <a2>, <a3>. <hint>"
 */
export function renderPref(name: string, map: Record<string, ToolPref> = TOOL_PREFS): string {
  const p = map[name]
  if (!p) return ''
  const parts: string[] = []
  if (p.defaultModel && p.defaultModel !== '-') {
    parts.push(`default: ${p.defaultModel}`)
  }
  if (p.alternates.length > 0) {
    parts.push(`also try: ${p.alternates.slice(0, 3).join(' / ')}`)
  }
  const bullet = parts.length > 0 ? `${parts.join('; ')}.` : ''
  const hint = p.hint ? ` ${p.hint}` : ''
  return bullet ? `Operator preferences — ${bullet}${hint}` : hint.trim()
}

/**
 * Full operator presets catalog — exposed via the `medha://favorites`
 * resource so any agent (or the operator's dashboard) can fetch a
 * single canonical JSON document.
 */
export const FAVORITES = {
  description:
    'Medhā operator-curated defaults — single canonical set the agent should use unless the task explicitly says otherwise.',
  server: '@medha/mcp-server',
  environmentHints: {
    reasoning: 'Use qwen-3-7-max for hard reasoning, minimax-m3-preview for cheap+long.',
    coding: 'qwen3-coder-480b-a35b-instruct-turbo first; minimax-m3-preview as cheap alt.',
    roleplay: 'venice-uncensored-role-play first.',
    vision: 'venice-uncensored-1-2 first; minimax-m3-preview for general vision.',
    longctx: 'qwen-3-7-max (1M ctx) first; minimax-m3-preview (524K) as fallback.',
  },
  toolsByName: TOOL_PREFS,
} as const
