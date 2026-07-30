import { PrismaClient } from '@prisma/client';
import { isProd } from '../config/env.js';
import { tenantExtension } from './tenant/extension.js';

// The tenant-scope extension is ALWAYS applied but is a complete no-op unless
// MULTITENANCY_ENFORCE is on (it early-returns per query), so prod behaviour is unchanged
// until enforcement is dark-launched. Applying it unconditionally keeps the exported client
// type stable. See lib/tenant/extension.ts.
function makeClient() {
  return new PrismaClient({ log: isProd ? ['error'] : ['warn', 'error'] }).$extends(tenantExtension());
}

// Singleton to avoid exhausting DB connections during dev hot-reload.
const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof makeClient> };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (!isProd) globalForPrisma.prisma = prisma;

// The client carries the tenant extension, so its type is the extended client — not the bare
// `PrismaClient`. Helpers that accept "a db handle or a transaction" must use these aliases so
// the extended client and its interactive-transaction client both fit.
export type Db = typeof prisma;
export type TxClient = Omit<Db, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
