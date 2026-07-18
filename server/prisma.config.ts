import path from 'node:path';
// A Prisma config file disables Prisma's automatic .env loading, so load it ourselves —
// migrate/generate/seed all read DATABASE_URL + JWT secrets from server/.env like before.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Replaces the deprecated `package.json#prisma` block (removed in Prisma 7). Keeps the same
// schema location and the `db:seed` command used by `prisma migrate reset` / `prisma db seed`.
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
