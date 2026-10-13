import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({testDir:'tests/e2e',workers:1,fullyParallel:false,timeout:60000,use:{baseURL:process.env.HRMS_URL||'http://127.0.0.1:5173',headless:true,launchOptions:{executablePath:process.env.BROWSER_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}},webServer:{command:'npm run dev',url:`http://127.0.0.1:${process.env.PORT||3000}/api/v1/health`,reuseExistingServer:false,timeout:60000},reporter:'list'});
