import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from './observability.js';

// Transactional email (dormant-by-default, mirrors the Sentry/VAPID/Lemon-Squeezy gates). Reads
// process.env LIVE (like lsConfig/aiEnabled) so ops can configure SMTP without a rebuild and tests
// can toggle it. Enabled only when an SMTP host AND a from-address (or SMTP user) are present.
//
// CRITICAL: the app's HARD email-verification wall keys off emailEnabled() — when this is false the
// whole verify/activation feature stays OFF (new accounts are born verified, guests auto-login), so a
// deployment with no mail server can never lock anyone out. Configuring SMTP is what arms the wall.
export function emailEnabled(): boolean {
  return Boolean(process.env.SMTP_HOST && (process.env.MAIL_FROM || process.env.SMTP_USER));
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// The From: header. MAIL_FROM ("Prismatix <no-reply@prismatix.tech>") preferred; falls back to the
// SMTP user, then a safe default so the type stays non-optional.
export function mailFrom(): string {
  return process.env.MAIL_FROM || process.env.SMTP_USER || 'Prismatix <no-reply@prismatix.tech>';
}

// Public base URL used to build links inside emails (verification, login). APP_URL wins; otherwise the
// first CORS origin; otherwise the prod host. Trailing slashes trimmed so `${base}/verify-email` is clean.
export function appBaseUrl(): string {
  const raw =
    process.env.APP_URL ||
    (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean)[0] ||
    'https://prismatix.tech';
  return raw.replace(/\/+$/, '');
}

// Lazily-built SMTP transport singleton. Rebuilt after __resetMailTransport() so tests / a config
// change start fresh. secure=true only on the implicit-TLS port 465 unless SMTP_SECURE forces it.
let transport: Transporter | null = null;
function getTransport(): Transporter {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
        : undefined,
    });
  }
  return transport;
}
export function __resetMailTransport(): void {
  transport = null;
}

// Test seam (mirrors observability.__setErrorSink): route sends to a fake sink so itests capture the
// exact message without an SMTP server or the network. A set sink also short-circuits the enabled gate.
type MailSink = (msg: MailMessage) => void;
let sink: MailSink | null = null;
export function __setMailSink(fn: MailSink | null): void {
  sink = fn;
}

// Best-effort send: NEVER throws (a mail failure must not break signup/approval). Returns whether the
// message was actually handed off. When email is disabled it's a logged no-op.
export async function sendMail(msg: MailMessage): Promise<{ delivered: boolean }> {
  if (sink) {
    sink(msg);
    return { delivered: true };
  }
  if (!emailEnabled()) {
    logger.info({ to: msg.to, subject: msg.subject }, '[mailer] email disabled — skipped');
    return { delivered: false };
  }
  try {
    await getTransport().sendMail({
      from: mailFrom(),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    logger.info({ to: msg.to, subject: msg.subject }, '[mailer] sent');
    return { delivered: true };
  } catch (err) {
    logger.error({ err, to: msg.to, subject: msg.subject }, '[mailer] send failed');
    return { delivered: false };
  }
}
