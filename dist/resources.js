import { formatToolError } from './format.js';
import { FAVORITES } from './presets.js';
export function buildResources(client) {
    return [
        {
            uri: 'venice://models',
            name: 'Venice model catalog',
            description: 'Live catalog with prices and capability flags. Auth-free.',
            mimeType: 'application/json',
            read: async () => {
                try {
                    const data = await client.get('/v1/models');
                    return {
                        uri: 'venice://models',
                        mimeType: 'application/json',
                        text: JSON.stringify(data, null, 2),
                    };
                }
                catch (err) {
                    return {
                        uri: 'venice://models',
                        mimeType: 'text/plain',
                        text: formatToolError(err),
                    };
                }
            },
        },
        {
            uri: 'venice://styles',
            name: 'Image style presets',
            description: 'Available image style presets for venice_image_generate.',
            mimeType: 'application/json',
            read: async () => {
                try {
                    const data = await client.get('/v1/image/styles');
                    return {
                        uri: 'venice://styles',
                        mimeType: 'application/json',
                        text: JSON.stringify(data, null, 2),
                    };
                }
                catch (err) {
                    return {
                        uri: 'venice://styles',
                        mimeType: 'text/plain',
                        text: formatToolError(err),
                    };
                }
            },
        },
        {
            uri: 'venice://voices',
            name: 'Venice TTS voices',
            description: 'Available TTS voices including cloned voices.',
            mimeType: 'application/json',
            read: async () => {
                try {
                    const data = await client.get('/v1/audio/voices');
                    return {
                        uri: 'venice://voices',
                        mimeType: 'application/json',
                        text: JSON.stringify(data, null, 2),
                    };
                }
                catch (err) {
                    return {
                        uri: 'venice://voices',
                        mimeType: 'text/plain',
                        text: formatToolError(err),
                    };
                }
            },
        },
        // ─── MEDHĀ-OPERATOR ONLY ────────────────────────────────────────────
        {
            uri: 'medha://favorites',
            name: 'Medhā operator favorites',
            description: 'Medhā operator-curated defaults — a single canonical JSON document listing the operator’s preferred model per tool + per-domain (reasoning / coding / roleplay / vision / longctx). Fetch this in any session to know what the operator prefers before picking a model.',
            mimeType: 'application/json',
            read: async () => ({
                uri: 'medha://favorites',
                mimeType: 'application/json',
                text: JSON.stringify(FAVORITES, null, 2),
            }),
        },
    ];
}
//# sourceMappingURL=resources.js.map