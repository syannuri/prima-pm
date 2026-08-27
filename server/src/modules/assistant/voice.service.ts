import { prisma } from '../../lib/prisma.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { AppError } from '../../lib/errors.js';

// Server-side voice for Anett — OpenAI Whisper (STT) + ElevenLabs (TTS). Dormant unless the provider
// keys are set AND the caller's tenant opted in (Tenant.aiVoiceEnabled); otherwise the client falls
// back to the browser Web Speech API. See docs/AI-VOICE-SERVER-PLAN.md. Config is read LIVE from env.

export const MAX_STT_BYTES = 12 * 1024 * 1024; // ~2 min of opus
export const MAX_TTS_CHARS = 1200;             // bound per-request cost

export function voiceConfig() {
  return {
    openaiKey: process.env.OPENAI_API_KEY ?? '',
    elevenKey: process.env.ELEVENLABS_API_KEY ?? '',
    elevenVoiceId: process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb', // a default multilingual voice
    elevenModel: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
    sttModel: process.env.OPENAI_STT_MODEL || 'whisper-1',
  };
}
// Both provider keys must be present for the server voice path to exist at all.
export function voiceConfigured(): boolean {
  const c = voiceConfig();
  return !!c.openaiKey && !!c.elevenKey;
}

export interface VoicePort {
  transcribe(audio: Buffer, mime: string, lang: 'id' | 'en'): Promise<string>;
  synthesize(text: string, lang: 'id' | 'en'): Promise<{ audio: Buffer; contentType: string }>;
}

// Live port — calls OpenAI + ElevenLabs over global fetch (Node 24). Kept behind the injectable seam
// so itests never hit the network.
function liveVoicePort(): VoicePort {
  return {
    async transcribe(audio, mime, lang) {
      const { openaiKey, sttModel } = voiceConfig();
      const form = new FormData();
      form.append('file', new Blob([Uint8Array.from(audio)], { type: mime || 'audio/webm' }), 'audio.webm');
      form.append('model', sttModel);
      form.append('language', lang); // ISO-639-1 hint improves accuracy
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${openaiKey}` }, body: form,
      });
      if (!res.ok) throw new AppError(502, 'Transkripsi suara gagal.', 'STT_FAILED');
      const data = (await res.json()) as { text?: string };
      return (data.text ?? '').trim();
    },
    async synthesize(text, _lang) {
      const { elevenKey, elevenVoiceId, elevenModel } = voiceConfig();
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenVoiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: elevenModel, voice_settings: { stability: 0.4, similarity_boost: 0.75 } }),
      });
      if (!res.ok) throw new AppError(502, 'Sintesis suara gagal.', 'TTS_FAILED');
      const audio = Buffer.from(await res.arrayBuffer());
      return { audio, contentType: 'audio/mpeg' };
    },
  };
}

let injected: VoicePort | null = null;
export function __setVoicePort(port: VoicePort | null): void { injected = port; }
function getVoicePort(): VoicePort { return injected ?? liveVoicePort(); }

// Per-tenant opt-in (no tenant → single-tenant deploy, env gate alone governs).
export async function callerVoiceEnabled(): Promise<boolean> {
  const tid = getTenantStore()?.tenantId;
  if (!tid) return true;
  const t = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiVoiceEnabled: true } });
  return t?.aiVoiceEnabled === true;
}
// Whether the server voice path is usable for the caller right now (drives the client's choice of
// server vs Web Speech). Requires both provider keys + the tenant opt-in.
export async function voiceServerAvailable(): Promise<boolean> {
  return voiceConfigured() && (await callerVoiceEnabled());
}

// Guard both endpoints: 503 when unconfigured, 403 when the tenant hasn't opted in.
async function assertVoiceUsable(): Promise<void> {
  if (!voiceConfigured()) throw new AppError(503, 'Fitur suara belum dikonfigurasi.', 'VOICE_DISABLED');
  if (!(await callerVoiceEnabled())) throw new AppError(403, 'Fitur suara belum diaktifkan untuk workspace ini.', 'VOICE_NOT_ENABLED');
}

export async function transcribeAudio(audio: Buffer, mime: string, lang: 'id' | 'en'): Promise<string> {
  await assertVoiceUsable();
  if (!audio?.length) throw new AppError(400, 'Audio kosong.', 'STT_EMPTY');
  if (audio.length > MAX_STT_BYTES) throw new AppError(413, 'Audio terlalu besar.', 'STT_TOO_LARGE');
  return getVoicePort().transcribe(audio, mime, lang);
}

export async function synthesizeSpeech(text: string, lang: 'id' | 'en'): Promise<{ audio: Buffer; contentType: string }> {
  await assertVoiceUsable();
  const t = text.trim().slice(0, MAX_TTS_CHARS);
  if (!t) throw new AppError(400, 'Teks kosong.', 'TTS_EMPTY');
  return getVoicePort().synthesize(t, lang);
}
