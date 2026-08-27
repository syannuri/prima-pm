import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setVoicePort, type VoicePort } from '../assistant/voice.service.js';

// Server-side voice (Whisper STT + ElevenLabs TTS). Exercises the env + per-tenant gates, the raw
// audio STT route, the TTS audio route, and the /available signal — all against a mocked VoicePort
// (never hits the network).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const mockPort: VoicePort = {
  async transcribe(audio, mime) { return `heard ${audio.length}b ${mime}`; },
  async synthesize(text) { return { audio: Buffer.from(`AUDIO:${text}`), contentType: 'audio/mpeg' }; },
};

let prevFlag: string | undefined; let prevOpenai: string | undefined; let prevEleven: string | undefined;
let pmToken = ''; let tid = '';

const enableVoice = (on: boolean) => prisma.tenant.update({ where: { id: tid }, data: { aiVoiceEnabled: on } });

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; prevOpenai = process.env.OPENAI_API_KEY; prevEleven = process.env.ELEVENLABS_API_KEY;
  process.env.MULTITENANCY_ENFORCE = 'true';
  __setVoicePort(mockPort);
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'vco', name: 'V Co', aiNarrativeEnabled: true } });
  tid = t.id;
  const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@vco.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: pm.id, tenantId: tid, role: 'PROJECT_MANAGER' } });
  pmToken = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email, tv: 0, tid });
});

afterAll(async () => {
  __setVoicePort(null);
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('MULTITENANCY_ENFORCE', prevFlag); restore('OPENAI_API_KEY', prevOpenai); restore('ELEVENLABS_API_KEY', prevEleven);
});

const stt = (token: string) => request(app).post(api('/assistant/stt')).set(bearer(token)).set('Content-Type', 'audio/webm').send(Buffer.from('fake-audio-bytes'));
const tts = (token: string, text: string) => request(app).post(api('/assistant/tts')).set(bearer(token)).send({ text, lang: 'id' });

describe('Anett server-side voice — /assistant/stt + /tts', () => {
  it('503 when the provider keys are not set', async () => {
    delete process.env.OPENAI_API_KEY; delete process.env.ELEVENLABS_API_KEY;
    await enableVoice(true);
    expect((await stt(pmToken)).status).toBe(503);
    expect((await tts(pmToken, 'halo')).status).toBe(503);
  });

  it('403 when configured but the tenant has not opted in', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'; process.env.ELEVENLABS_API_KEY = 'el-test';
    await enableVoice(false);
    expect((await stt(pmToken)).status).toBe(403);
    expect((await tts(pmToken, 'halo')).status).toBe(403);
  });

  it('/available reflects voiceServer (false → true once configured + opted in)', async () => {
    await enableVoice(false);
    let res = await request(app).get(api('/assistant/available')).set(bearer(pmToken));
    expect(res.body.voiceServer).toBe(false);
    await enableVoice(true);
    res = await request(app).get(api('/assistant/available')).set(bearer(pmToken));
    expect(res.body.voiceServer).toBe(true);
  });

  it('STT transcribes the raw audio body', async () => {
    await enableVoice(true);
    const res = await stt(pmToken);
    expect(res.status).toBe(200);
    expect(res.body.text).toContain('heard');
    expect(res.body.text).toContain('audio/webm');
  });

  it('TTS returns audio/mpeg bytes (bounded)', async () => {
    await enableVoice(true);
    const res = await tts(pmToken, 'Halo dari Anett');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.body.toString()).toBe('AUDIO:Halo dari Anett');

    const empty = await request(app).post(api('/assistant/tts')).set(bearer(pmToken)).send({ text: '' });
    expect(empty.status).toBe(400); // zod min(1)
  });
});
