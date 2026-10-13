import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const local = resolve(process.cwd(), '.env'),
  root = resolve(process.cwd(), '../../.env');
config({ path: process.env.DOTENV_CONFIG_PATH || (existsSync(local) ? local : root), quiet: true });
