import { defineConfig } from '@playwright/test';

const DATABASE_URL = 'postgresql://prima:prima@localhost:5432/prima_pm?schema=public';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  // Dev Vite compiles on demand; a cold first load + the prod backend can be slow,
  // so allow one retry to absorb timing flakiness (functionality is unaffected).
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm --prefix ../server run dev',
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
      timeout: 90_000,
      env: {
        DATABASE_URL,
        JWT_ACCESS_SECRET: 'e2e-access',
        JWT_REFRESH_SECRET: 'e2e-refresh',
        PORT: '4000',
        NODE_ENV: 'development',
        CORS_ORIGIN: 'http://localhost:5173',
      },
    },
    {
      command: 'npm --prefix ../client run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 90_000,
    },
  ],
});
