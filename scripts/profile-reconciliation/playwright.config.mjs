import { defineConfig } from '@playwright/test';
import original from './playwright.config.js';

const origin = 'http://127.0.0.1:4173';

export default defineConfig({
  ...original,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  webServer: {
    command:
      'VITE_SENTRY_DSN= npm run preview -- --host 127.0.0.1 --port 4173 --strictPort --outDir dist',
    url: origin,
    cwd: '/tmp/work',
    reuseExistingServer: false,
    timeout: 30000,
  },
  use: {
    ...original.use,
    baseURL: origin,
    serviceWorkers: 'block',
    channel: 'chromium',
    launchOptions: { chromiumSandbox: true },
  },
});
