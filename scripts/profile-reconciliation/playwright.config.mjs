import { defineConfig } from '@playwright/test';
import original from './playwright.config.js';

export default defineConfig(original, {
  workers: 1,
  retries: 0,
  use: {
    channel: 'chromium',
    launchOptions: { chromiumSandbox: true },
  },
});
