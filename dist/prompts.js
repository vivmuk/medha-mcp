/**
 * MCP prompt templates: discoverable, parameterized prompts that hosts
 * can offer as quick-launch entry points.
 */
import { z } from 'zod';
export function buildPrompts() {
    return [
        {
            name: 'uncensored-research',
            title: 'Uncensored research',
            description: 'Set up a research session free of nanny refusals (security, medical, legal, journalism).',
            argsSchema: {
                topic: z.string().describe('What you want researched.'),
                domain: z
                    .enum(['security', 'medical', 'legal', 'journalism', 'historical', 'other'])
                    .optional(),
            },
            build: ({ topic, domain }) => ({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `You are an uncensored research assistant. Domain: ${domain ?? 'general'}. ` +
                                `Provide complete, factual analysis. Cite sources where possible. ` +
                                `Do not refuse legitimate research questions.\n\nTopic: ${topic}`,
                        },
                    },
                ],
            }),
        },
        {
            name: 'nsfw-creative-writing',
            title: 'NSFW creative writing',
            description: 'Adult fiction / mature creative writing scaffold.',
            argsSchema: {
                scenario: z.string().describe('Scene or premise.'),
                style: z.string().optional().describe('e.g. "noir", "fantasy", "literary".'),
            },
            build: ({ scenario, style }) => ({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Write an adult creative-writing piece. Style: ${style ?? 'literary'}. ` +
                                `Be vivid and unfiltered as appropriate to the scene. ` +
                                `Length: 600-1000 words.\n\nScene: ${scenario}`,
                        },
                    },
                ],
            }),
        },
        {
            name: 'image-style-explorer',
            title: 'Image style explorer',
            description: 'Generate the same prompt across multiple styles for comparison.',
            argsSchema: {
                prompt: z.string(),
                styles: z
                    .array(z.string())
                    .max(8)
                    .optional()
                    .describe('Style preset names, see venice://styles.'),
            },
            build: ({ prompt, styles }) => {
                const list = styles ?? ['photographic', 'cinematic', 'anime', 'oil-painting'];
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Use the venice_image_generate tool to generate "${prompt}" in each of these styles, ` +
                                    `then describe the differences:\n\n${list.map((s) => `- ${s}`).join('\n')}`,
                            },
                        },
                    ],
                };
            },
        },
        // ─── MEDHĀ-OPERATOR WORKFLOW TEMPLATES ──────────────────────────────
        // Each Medhā prompt template seeds the agent into a known-good multi-
        // tool workflow. The agent orchestrates the tool calls itself (server
        // is thin); the prompt's job is to lay out a clean sequence + the
        // operator's preferred models per step.
        {
            name: 'medha_music_video_brief',
            title: 'Medhā music-video brief',
            description: 'Generate a 30-60s vertical music video: music + 4-8 image frames + video interpolation per frame + optional TTS narration. Operator-recommended model sequence.',
            argsSchema: {
                soundtrack_prompt: z.string().describe('Music prompt — mood / tempo / duration.'),
                scene_concept: z.string().describe('Visual concept for the image frames (single sentence OK).'),
                duration_s: z.number().int().min(15).max(120).optional().describe('Total target length in seconds.'),
                frame_count: z.number().int().min(3).max(12).optional().describe('Number of image frames (default 6).'),
                narration_text: z.string().optional().describe('Optional narrator line(s). If empty, no TTS.'),
                voice: z.string().optional().describe('TTS voice id (default: tts-kokoro default).'),
            },
            build: ({ soundtrack_prompt, scene_concept, duration_s, frame_count, narration_text, voice }) => {
                const frames = frame_count ?? 6;
                const seconds = duration_s ?? 30;
                const narration = narration_text
                    ? `\n7. (Optional) TTS the narration: venice_tts({ input: "${narration_text}", voice: ${voice ? `"${voice}"` : 'tts-kokoro default'}, model: "tts-kokoro" })`
                    : '';
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Build a ${seconds}s music video using these Medhā tools + the operator's preferred models.\n\n` +
                                    `Music prompt: "${soundtrack_prompt}"\nVisual concept: "${scene_concept}"\nFrame count: ${frames}\n\n` +
                                    `Recommended workflow (use this exact sequence of tool calls — but adjust model= if the agent believes a different model would suit the prompt better):\n\n` +
                                    `1. Quote the music generation: venice_audio_quote({ duration_seconds: ${seconds} })\n` +
                                    `2. Queue the music: venice_music_generate({ prompt: "${soundtrack_prompt}", duration: ${seconds}, model: "ace-step-15" }) → captures the queue_id\n` +
                                    `3. Generate ${frames} image frames in parallel (use venice_image_generate, model "flux-2-pro", varying seed per frame so they differ). Frame prompt: "${scene_concept}, frame {i} of ${frames}". Save each frame's image data.\n` +
                                    `4. Poll music: venice_music_status({ queue_id: "…" }) until status = COMPLETED. Capture the music URL.\n` +
                                    `5. For each frame, queue a 4-6s video clip: venice_video_generate({ image_url: <frame base64 data url>, prompt: "subtle parallax, slow camera drift, ambient motion consistent with soundtrack", model: "ltx-2", duration: "4s", aspect_ratio: "9:16" }). Capture each video queue_id.\n` +
                                    `6. Poll each video until COMPLETED: venice_video_status({ queue_id: "…", model: "ltx-2" }). Capture the URLs.\n` +
                                    narration +
                                    `\n\nDeliverable: a list of ${frames} video URLs + a music URL to feed into a final compositor. If the agent has a video-concat tool (ffmpeg / opus-clip / comparable) use it; otherwise hand back the list and the operator will edit.`,
                            },
                        },
                    ],
                };
            },
        },
        {
            name: 'medha_podcast_pipeline',
            title: 'Medhā podcast pipeline',
            description: 'Triple-tool podcast: web research → script via chat → TTS narration. Operator-curated defaults.',
            argsSchema: {
                topic: z.string().describe('Podcast topic or thesis.'),
                minutes: z.number().int().min(2).max(60).optional().describe('Target length (default 8).'),
                voice: z.string().optional().describe('TTS voice (default = tts-kokoro).'),
                research_first: z.boolean().optional().describe('Run venice_web_search before scripting (default true).'),
            },
            build: ({ topic, minutes, voice, research_first }) => {
                const length = minutes ?? 8;
                const research = research_first ?? true;
                const step1 = research
                    ? `1. (Optional) venice_web_search({ query: "${topic}" }) — capture 4-8 ranked URLs.\n2. (Optional) venice_web_scrape({ url: <each result> }) — pull 1-3K words of supporting context.\n`
                    : '';
                const step1n = research ? 3 : 1;
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Produce an ${length}-minute podcast on "${topic}".\n\n` +
                                    `Workflow (orchestrate these tool calls in order):\n\n` +
                                    step1 +
                                    `${step1n}. Script the podcast via venice_chat with model="qwen-3-7-max" (premium reasoning) — ${length} minutes = ≈${length * 150} words. Output as speaker-notes, timestamps, and a [TTS] marker for any line that should be spoken aloud.\n` +
                                    `${step1n + 1}. Extract the spoken portion and TTS it: venice_tts({ input: <script>, voice: ${voice ? `"${voice}"` : 'tts-kokoro default'}, model: "tts-kokoro" }). Capture the audio URL.\n` +
                                    `${step1n + 2}. (Optional) venice_audio_quote({ duration_seconds: ${length * 60} }) — show the cost pre-render.\n\n` +
                                    `Deliverable: a 2-section response — (A) the podcast script + timestamps, (B) the TTS audio URL.`.replace(/3\./, step1n + '.').replace(/3\./, step1n + '.'),
                            },
                        },
                    ],
                };
            },
        },
        {
            name: 'medha_dashboard_poster',
            title: 'Medhā dashboard poster',
            description: 'Generate a hero poster for a landing page or dashboard: chat-composed prompt → flux-2-pro image → optional upscale.',
            argsSchema: {
                subject: z.string().describe('What the poster is about (product, brand, idea).'),
                mood: z.string().optional().describe('Style cues (e.g. "neon noir", "candy-bright", "editorial").'),
                palette: z.string().optional().describe('Color palette hint (e.g. "deep blue + gold accents").'),
                aspect_ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']).optional().describe('Default 16:9 for desktop hero.'),
                upscale: z.boolean().optional().describe('If true, run venice_image_upscale at 2× after generation.'),
            },
            build: ({ subject, mood, palette, aspect_ratio, upscale }) => {
                const ratio = aspect_ratio ?? '16:9';
                const upBlock = upscale
                    ? `\n4. venice_image_upscale({ image_url: <step 3 image>, scale: 2 }) → 4K-class deliverable.`
                    : '';
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Compose a hero poster for "${subject}".\n\nWorkflow:\n\n` +
                                    `1. venice_chat({ messages: [{ role: "user", content: "Write a single dense image-generation prompt for a ${ratio} hero poster about '${subject}'. Tone: ${mood ?? 'editorial'}. Palette: ${palette ?? 'auto'}. Include composition suggestions and lighting." }], model: "qwen-3-7-max" }) → captures the polished prompt.\n` +
                                    `2. venice_image_generate({ prompt: <step 1 output>, model: "flux-2-pro", aspect_ratio: "${ratio == '16:9' ? '16:9' : ratio}", steps: 35 }).\n` +
                                    `3. (Optional) venice_image_remove_bg({ image_url: <step 2 image> }) — if no background is wanted.\n` +
                                    upBlock +
                                    `\nDeliverable: the final image URL (or base64). The operator will drop it in the dashboard.`,
                            },
                        },
                    ],
                };
            },
        },
        {
            name: 'medha_character_dossier',
            title: 'Medhā character dossier',
            description: 'Build a persistent role-play character: persona prompt + reference avatar image + voice clone manifest. Save into a single JSON profile for re-use.',
            argsSchema: {
                name: z.string().describe('Character name.'),
                archetype: z.string().describe('e.g. "mentor archmage", "ragged detective", "AI ethicist".'),
                voice_id: z.string().optional().describe('Reference voice id; if absent, default TTS voice.'),
                characterize: z.boolean().optional().describe('If true, generate a reference image with venice_image_generate.'),
            },
            build: ({ name, archetype, voice_id, characterize }) => {
                const imgBlock = characterize
                    ? `\n5. venice_image_generate({ prompt: "portrait of ${name}, ${archetype}, full character sheet, neutral lighting", model: "flux-2-pro" }). Save the base64 image.`
                    : '';
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Build a persistent character profile named "${name}" (archetype: ${archetype}).\n\nWorkflow:\n\n` +
                                    `1. venice_chat({ messages: [{ role: "system", content: "You are a character designer. Output a structured dossier." }, { role: "user", content: "Write a JSON dossier for ${name}: name, archetype, speaking_style, backstory (200 words), three catchphrase_lines, do_not_break (rules), interactions_with_user. Keep tone vivid." }], model: "venice-uncensored-role-play" }) → JSON profile.\n` +
                                    `2. venice_chat({ messages: [{ role: "user", content: "Write a 600-character system prompt foregrounding ${name}'s voice. Output only the system prompt text." }], model: "venice-uncensored-role-play" }) → system prompt.\n` +
                                    `3. (Optional) venice_voice_clone({ action: "list" }) — scan for an existing voice that fits; if voice_id="${voice_id ?? '<unspecified>'}", document it.\n` +
                                    `4. venice_tts({ input: "Hello, I'm ${name}.", voice: ${voice_id ? `"${voice_id}"` : 'tts-kokoro default'}, model: "tts-kokoro" }) → sample line.\n` +
                                    imgBlock +
                                    `\nDeliverable: a single JSON object with {name, archetype, system_prompt, sample_tts_url, image_data_url?, voice_id}. The operator will save this as a Venice character.`,
                            },
                        },
                    ],
                };
            },
        },
    ];
}
//# sourceMappingURL=prompts.js.map