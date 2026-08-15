import type { PlatformActivity } from '../api/types';

// Turn a raw platform audit event into a human sentence + a tone for the feed dot. Pure → unit-tested.
// tone: 'good' (create/approve/reactivate), 'bad' (suspend/reject/delete/block), 'neutral' (rest).
export type ActivityTone = 'good' | 'bad' | 'neutral';

function field(o: unknown, k: string): unknown {
  return o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;
}

export function describeActivity(e: PlatformActivity, id = false): { text: string; tone: ActivityTone } {
  const t = e.targetName ?? '—';
  const q = `“${t}”`;
  const V = (en: string, idn: string) => (id ? idn : en);

  if (e.entity === 'Tenant') {
    if (e.action === 'CREATE') return { text: `${V('created', 'membuat')} ${q}`, tone: 'good' };
    if (e.action === 'IMPERSONATE') return { text: `${V('entered', 'masuk ke')} ${q}`, tone: 'neutral' };
    if (e.action === 'EXPORT') return { text: `${V('exported', 'mengekspor')} ${q}`, tone: 'neutral' };
    if (e.action === 'DELETE') return { text: `${V('deleted', 'menghapus')} ${q}`, tone: 'bad' };
    if (e.action === 'UPDATE') {
      if (field(e.after, 'approved')) return { text: `${V('approved', 'menyetujui')} ${q}`, tone: 'good' };
      if (field(e.after, 'rejected')) return { text: `${V('rejected', 'menolak')} ${q}`, tone: 'bad' };
      const bs = field(e.before, 'status'), as = field(e.after, 'status');
      if (as && bs !== as) {
        if (as === 'SUSPENDED') return { text: `${V('suspended', 'menangguhkan')} ${q}`, tone: 'bad' };
        if (as === 'ACTIVE') return { text: `${V('reactivated', 'mengaktifkan')} ${q}`, tone: 'good' };
      }
      const bp = field(e.before, 'plan'), ap = field(e.after, 'plan');
      if (ap && bp !== ap) return { text: `${V('changed', 'mengubah paket')} ${q} ${V('plan', '')} ${String(bp)}→${String(ap)}`.replace(/\s+/g, ' ').trim(), tone: 'neutral' };
      const bn = field(e.before, 'name'), an = field(e.after, 'name');
      if (an && bn !== an) return { text: `${V('renamed', 'mengubah nama')} ${q}`, tone: 'neutral' };
      if (field(e.after, 'customDomain') !== undefined || field(e.before, 'customDomain') !== undefined) return { text: `${V('updated domain for', 'memperbarui domain')} ${q}`, tone: 'neutral' };
      return { text: `${V('updated', 'memperbarui')} ${q}`, tone: 'neutral' };
    }
  }
  if (e.entity === 'User') {
    if (e.action === 'DELETE') return { text: `${V('deleted guest', 'menghapus tamu')} ${q}`, tone: 'bad' };
    if (field(e.after, 'isActive') === true) return { text: `${V('reactivated guest', 'mengaktifkan tamu')} ${q}`, tone: 'good' };
    if (field(e.after, 'isActive') === false) return { text: `${V('deactivated guest', 'menonaktifkan tamu')} ${q}`, tone: 'bad' };
    return { text: `${V('updated guest', 'memperbarui tamu')} ${q}`, tone: 'neutral' };
  }
  if (e.entity === 'BlockedIdentity') {
    if (e.action === 'CREATE') return { text: `${V('blocked', 'memblokir')} ${q}`, tone: 'bad' };
    return { text: V('unblocked an identity', 'mencabut blokir identitas'), tone: 'good' };
  }
  return { text: `${e.action} ${e.entity}`, tone: 'neutral' };
}
