/**
 * Decorate tool descriptions with Medhā operator preferences.
 *
 * The upstream tool descriptions end with either:
 *   " Uncensored: NSFW prompts allowed where the model permits."
 *   " No authentication required."
 *   " API key required — this endpoint does not accept x402 wallet auth."
 *   " Supports x402 wallet auth (no Venice account needed) and API key."
 *
 * This helper inserts the operator-preferences line BEFORE whichever of
 * the four suffixes the upstream description already has, so the pref
 * text reads naturally and the auth/NSFW tail remains authoritative.
 *
 * Dynamic preset wiring:
 *   The active pref map is set per MCP session by the HTTP transport
 *   (via `setActiveToolPrefs()`) and falls back to the baked static map
 *   from presets.ts before any session has called the setter. This way
 *   /admin POST changes to mcp_settings overlay the next MCP session's
 *   tool descriptions without redeploys.
 */
import { TOOL_PREFS as BAKED_TOOL_PREFS, renderPref, type ToolPref } from './presets.js'

let activeToolPrefs: Record<string, ToolPref> | null = null

export function setActiveToolPrefs(prefs: Record<string, ToolPref>): void {
  activeToolPrefs = prefs
}

export function getActiveToolPrefs(): Record<string, ToolPref> {
  return activeToolPrefs ?? BAKED_TOOL_PREFS
}

/** Tail patterns that indicate where to splice in the operator prefs. */
const TAIL_PATTERNS: RegExp[] = [
  / Uncensored: NSFW prompts allowed where the model permits\./,
  / No authentication required\./,
  / API key required — this endpoint does not accept x402 wallet auth\./,
  / Supports x402 wallet auth \(no Venice account needed\) and API key\./,
]

export function decorateDescription(name: string, description: string): string {
  const map = activeToolPrefs ?? BAKED_TOOL_PREFS
  const pref = renderPref(name, map)
  if (!pref) return description

  for (const pat of TAIL_PATTERNS) {
    const m = description.match(pat)
    if (m && m.index !== undefined) {
      const before = description.slice(0, m.index).replace(/[ .,;]+$/, '')
      const tail = description.slice(m.index)
      return `${before}. ${pref}${tail}`
    }
  }
  // No tail matched — append at end.
  const trimmed = description.replace(/[ .,;]+$/, '')
  return `${trimmed}. ${pref}`
}
