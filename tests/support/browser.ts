import { test as base, expect } from '@playwright/test';
import { db, jobs } from '../../apps/api/src/core.js';
// The Redis-backed API limiter shares the worker's Queue instance across spec files.
// Close infrastructure after the worker, never while another spec will reuse it.
export const test = base.extend<{}, { services: void }>({
  services: [
    async ({ browserName: _browserName }, use) => {
      await use();
      await jobs.close();
      await db.$disconnect();
    },
    { scope: 'worker', auto: true },
  ],
});
export { expect };
