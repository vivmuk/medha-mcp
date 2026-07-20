/**
 * Build a configured MCP server with Venice tools, resources, and prompts.
 * Pure factory — does not bind any transport. Transports live in src/transports/.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VeniceClient } from './venice-client.js';
import { loadConfig } from './config.js';
import { buildTools } from './tools/index.js';
import { buildResources } from './resources.js';
import { buildPrompts } from './prompts.js';
export function buildServer(opts = {}) {
    const cfg = opts.config ?? loadConfig();
    const client = opts.client ?? new VeniceClient(cfg);
    const server = new McpServer({ name: cfg.serverName, version: cfg.serverVersion }, {
        capabilities: {
            tools: {},
            resources: {},
            prompts: {},
            logging: {},
        },
        instructions: [
            'Medhā MCP is an operator-tuned fork of @veniceai/mcp-server.',
            'It exposes 31 Venice primitives (chat / image / video / TTS / ASR / music / web / crypto / x402 / characters) plus 1 operator-curated resource (medha://favorites) and 4 workflow prompts (medha_music_video_brief, medha_podcast_pipeline, medha_dashboard_poster, medha_character_dossier).',
            'Auth: 4 components — (1) the Medhā bearer (VENICE_MCP_AUTH_TOKEN) for /mcp on Railway, (2) the operator Venice key (VENICE_API_KEY) baked in the container, (3) optional per-session SIWX wallet (VENICE_SIWX_TOKEN), (4) operator-curated favorites baked into tool descriptions.',
            'Operator preferences are HINTS, not hard enforced. Pass model="<any-venice-id>" to override per call. If in doubt, fetch the medha://favorites resource for the canonical defaults table.',
        ].join(' '),
    });
    // Tools — cast to any to bypass deep ZodRawShape inference in the SDK.
    // We rely on Zod for runtime validation; TS-side typing is widened.
    const srv = server;
    for (const t of buildTools(client, cfg)) {
        srv.registerTool(t.name, {
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
        }, async (args) => t.handler(args));
    }
    // Resources
    for (const r of buildResources(client)) {
        srv.registerResource(r.uri.replace(/^venice:\/\//, ''), r.uri, {
            title: r.name,
            description: r.description,
            mimeType: r.mimeType,
        }, async () => ({ contents: [await r.read()] }));
    }
    // Prompts
    for (const p of buildPrompts()) {
        srv.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema: p.argsSchema }, async (args) => p.build(args));
    }
    return server;
}
export { loadConfig } from './config.js';
export { VeniceClient } from './venice-client.js';
//# sourceMappingURL=server.js.map