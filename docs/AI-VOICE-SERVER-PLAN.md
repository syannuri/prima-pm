# Anett — server-side voice (Whisper STT + ElevenLabs TTS)

Upgrade Anett's voice from the browser Web Speech API to server-side providers for natural,
cross-browser voices and better transcription — **dormant-by-default**, with automatic fallback to
the existing Web Speech (Voice v2) when not configured/enabled.

Decisions (2026-08-27): **STT = OpenAI Whisper** (`whisper-1`), **TTS = ElevenLabs** (`eleven_multilingual_v2`, supports Indonesian).

## Prereqs & cost (real money)
- Env keys the user provides (like `ANTHROPIC_API_KEY`): `OPENAI_API_KEY` (Whisper) + `ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` default `eleven_multilingual_v2`).
- Per-use cost: Whisper ≈ $0.006/min; ElevenLabs per-character (can be significant). Bounded per request (max audio duration/size, max TTS chars) + per-tenant opt-in.

## Architecture
- **STT**: client records audio (`MediaRecorder`, webm/opus) → `POST /assistant/stt` (route-level `express.raw({type:['audio/*'], limit})`) → server → OpenAI `/v1/audio/transcriptions` → text → client auto-sends.
- **TTS**: `POST /assistant/tts {text, lang}` → ElevenLabs `/v1/text-to-speech/{voiceId}` → mp3 bytes → client plays via `Audio`.
- **Injectable `VoicePort`** (`transcribe`, `synthesize`) with a `__setVoicePort` test seam (mirrors `AiPort`); live impl uses global `fetch`/`FormData`/`Blob` (Node 24).
- **Gating**: `voiceConfigured()` = both keys set; per-tenant `Tenant.aiVoiceEnabled`; `voiceServerAvailable()` = configured && enabled. `/assistant/available` gains `voiceServer`. `/ai-settings` gains `voiceEnabled`.
- **Bounds**: STT audio ≤ ~12 MB / ~2 min; TTS text ≤ ~1200 chars (truncate).

## Client (Fase 2)
When `voiceServer` is true: mic → `MediaRecorder` → `/stt` → auto-send (replaces Web Speech STT); answers → `/tts` → play mp3 (replaces `speechSynthesis`). **Falls back to Voice v2 (Web Speech)** when `voiceServer` is false or a request errors. The listening waveform + hands-free loop + per-answer read/stop all keep working over the server path.

## Phases (each: itest + rbac 125 + tsc; feat branch → PR)
- **Fase 1 — backend**: `Tenant.aiVoiceEnabled` + migration; `voice.service` (VoicePort + live OpenAI/ElevenLabs + gating + bounds); routes `POST /assistant/stt`, `POST /assistant/tts`; `/available` `voiceServer`; `/ai-settings` `voiceEnabled`. itests (gates 503/403, mocked transcribe/synthesize happy path, bounds).
- **Fase 2 — client**: prefer server STT/TTS when available, fallback to Web Speech; wire into the existing mic/waveform/hands-free/read-aloud.
- **Fase 3 (optional)**: streaming TTS (ElevenLabs stream), per-lang voice map, simple usage/cost logging.

## Deploy
Has a migration (Fase 1). Dormant until `OPENAI_API_KEY` + `ELEVENLABS_API_KEY` set AND a tenant flips `aiVoiceEnabled`. Until then, Web Speech (Voice v2) remains the voice path.
