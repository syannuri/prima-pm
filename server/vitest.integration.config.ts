import { defineConfig } from 'vitest/config';

// DB-backed HTTP integration tests (supertest). Kept separate from the default
// `npm test` (pure unit suite) and gated behind a DATABASE_URL "test" guard.
// Files are named *.itest.ts so the default unit run never picks them up.
export default defineConfig({
  test: {
    include: ['src/**/*.itest.ts'],
    setupFiles: ['./src/test/integration.setup.ts'],
    fileParallelism: false, // shared DB — run files serially
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
