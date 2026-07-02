import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Unit/component tests run under jsdom. Kept separate from vite.config.ts so the
// production build config stays untouched. Tests import { describe, it, ... } from
// 'vitest' explicitly (globals off) so no ambient types leak into the app build.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
