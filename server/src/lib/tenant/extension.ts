import { Prisma } from '@prisma/client';
import { getTenantStore } from './context.js';
import { SCOPED_MODELS } from './scopedModels.js';

// The pooled-multitenancy safety net (see docs/MULTITENANCY-POOLED-PLAN.md, Phase 3): a Prisma
// client extension that, for tenant-scoped models, injects `where.tenantId` on every read/update/
// delete/aggregate/count and stamps `tenantId` on every create — reading the active tenant from
// AsyncLocalStorage. It FAIL-CLOSES: a scoped query with no tenant context throws rather than
// leaking across tenants. Global identity models (User/Tenant/Membership/RefreshToken) are never
// scoped. Enforcement is gated by MULTITENANCY_ENFORCE so it is a complete no-op until switched on
// (dark-launch); read live from the env so tests can toggle it.
//
// LIMITATION: raw queries ($queryRaw/$executeRaw) bypass the extension and must be scoped by hand.

function enforcementOn(): boolean {
  return process.env.MULTITENANCY_ENFORCE === 'true';
}

// model -> (relationField -> targetModel) for object relations, from the generated DMMF. Lets us
// recurse into nested writes (e.g. Conversation.create({ data: { members: { create: [...] } } }))
// and stamp only the children that are themselves scoped.
const RELATIONS: Map<string, Map<string, string>> = (() => {
  const m = new Map<string, Map<string, string>>();
  for (const model of Prisma.dmmf.datamodel.models) {
    const fields = new Map<string, string>();
    for (const f of model.fields) if (f.kind === 'object' && f.relationName) fields.set(f.name, f.type);
    m.set(model.name, fields);
  }
  return m;
})();

const WHERE_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany',
]);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

// Recursively add tenantId to create-data for `model` (if scoped) and to nested create/
// createMany/connectOrCreate blocks of its relations that target scoped models.
function stampCreate(model: string, data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => stampCreate(model, d, tenantId));
  if (!data || typeof data !== 'object') return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  if (SCOPED_MODELS.has(model)) out.tenantId = tenantId;
  const rels = RELATIONS.get(model);
  if (rels) {
    for (const [field, target] of rels) {
      const val = out[field];
      if (!val || typeof val !== 'object') continue;
      const nested = { ...(val as Record<string, unknown>) };
      if ('create' in nested) nested.create = stampCreate(target, nested.create, tenantId);
      if ('connectOrCreate' in nested) {
        const coc = nested.connectOrCreate;
        const stampCoc = (c: Record<string, unknown>) => ({ ...c, create: stampCreate(target, c.create, tenantId) });
        nested.connectOrCreate = Array.isArray(coc) ? coc.map(stampCoc) : stampCoc(coc as Record<string, unknown>);
      }
      if ('createMany' in nested && nested.createMany && typeof nested.createMany === 'object') {
        const cm = nested.createMany as Record<string, unknown>;
        if ('data' in cm) nested.createMany = { ...cm, data: stampCreate(target, cm.data, tenantId) };
      }
      out[field] = nested;
    }
  }
  return out;
}

export function tenantExtension() {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!enforcementOn() || !SCOPED_MODELS.has(model)) return query(args);
          const store = getTenantStore();
          if (store?.bypass) return query(args);
          const tenantId = store?.tenantId;
          if (!tenantId) {
            throw new Error(`Tenant context required for ${model}.${operation} but none is set (fail-closed).`);
          }
          const a = (args ?? {}) as Record<string, unknown>;
          if (WHERE_OPS.has(operation)) {
            a.where = { ...((a.where as object | undefined) ?? {}), tenantId };
          }
          if (CREATE_OPS.has(operation) && 'data' in a) {
            a.data = stampCreate(model, a.data, tenantId);
          }
          if (operation === 'upsert') {
            a.where = { ...((a.where as object | undefined) ?? {}), tenantId };
            if ('create' in a) a.create = stampCreate(model, a.create, tenantId);
          }
          return query(a);
        },
      },
    },
  });
}
