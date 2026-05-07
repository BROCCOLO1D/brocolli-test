import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: /.*\.pw\.ts/,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
    screenshot: 'off',
    video: 'off'
  },
  webServer: {
    command: 'pnpm build && pnpm serve',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 30_000
  }
});
