import { prisma } from '../../lib/prisma.js';
import { sendMail } from '../../lib/mailer.js';
import { logger } from '../../lib/observability.js';

// Where new-feedback notifications go. Best-effort via the shared mailer (dormant unless SMTP is
// configured), so a missing mail server never blocks a submit — the row is always stored + visible
// in the /admin/feedback inbox.
const feedbackTo = () => process.env.FEEDBACK_EMAIL || 'support@prismatix.tech';

export interface CreateFeedbackInput {
  userId: string;
  userEmail: string;
  role: string;
  type: 'BUG' | 'IDEA' | 'OTHER';
  message: string;
  pageUrl?: string;
  release?: string;
  userAgent?: string;
}

export async function createFeedback(input: CreateFeedbackInput): Promise<{ id: string }> {
  // tenantId is stamped by the tenant extension (Feedback is a scoped model).
  const fb = await prisma.feedback.create({
    data: {
      userId: input.userId,
      type: input.type,
      message: input.message,
      pageUrl: input.pageUrl ?? null,
      role: input.role,
      release: input.release ?? null,
      userAgent: input.userAgent ?? null,
    },
    select: { id: true },
  });
  await notifyAdmin(fb.id, input); // best-effort; never throws
  return { id: fb.id };
}

// --- Admin triage (per-tenant inbox; tenant extension scopes reads to the admin's tenant) ---
export async function listFeedback(status?: string) {
  return prisma.feedback.findMany({
    where: status && status !== 'ALL' ? { status } : {},
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { user: { select: { name: true, email: true } } },
  });
}

export async function updateFeedbackStatus(id: string, status: 'OPEN' | 'REVIEWED' | 'CLOSED') {
  return prisma.feedback.update({ where: { id }, data: { status }, select: { id: true, status: true } });
}

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c));

async function notifyAdmin(id: string, i: CreateFeedbackInput): Promise<void> {
  try {
    const ctx = [i.pageUrl && `Page: ${i.pageUrl}`, i.release && `Release: ${i.release}`].filter(Boolean).join('\n');
    await sendMail({
      to: feedbackTo(),
      subject: `[Feedback · ${i.type}] from ${i.userEmail}`,
      text: `Type: ${i.type}\nFrom: ${i.userEmail} (${i.role})\n${ctx}\n\n${i.message}\n\n— Feedback ${id}`,
      html:
        `<h3>New ${esc(i.type)} feedback</h3>` +
        `<p><b>From:</b> ${esc(i.userEmail)} (${esc(i.role)})</p>` +
        (i.pageUrl ? `<p><b>Page:</b> ${esc(i.pageUrl)}</p>` : '') +
        (i.release ? `<p><b>Release:</b> ${esc(i.release)}</p>` : '') +
        `<hr/><p>${esc(i.message).replace(/\n/g, '<br/>')}</p>` +
        `<p style="color:#94a3b8;font-size:12px">Feedback ${esc(id)}</p>`,
    });
  } catch (err) {
    logger.error({ err }, '[feedback] admin notification failed');
  }
}
