import { defineConfig } from 'vitest/config';

// Default (unit) test run for `npm test`. Include ONLY *.test.ts — deliberately NOT the vitest
// default *.spec.ts glob: openapi.spec.ts is the hand-authored OpenAPI *specification* (a source
// module imported by openapi.routes.ts), not a test, and vitest would otherwise try to run it and
// fail with "No test suite found". Integration tests run under vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
